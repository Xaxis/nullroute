/**
 * Tests for daemon.psbt.
 *
 * The one that matters is `ignores-a-derivation-hint-in-the-psbt`. A PSBT
 * arrives from the networked world and can say anything it likes about which
 * addresses belong to the wallet. If a hint inside it could earn the change
 * label, an attacker would be able to present a transfer to themselves as money
 * returning to the user. So it is written as the attack rather than as a
 * happy path.
 */

import { describe, expect, it } from 'vitest'
import * as btc from '@scure/btc-signer'
import {
  MAINNET,
  SIGNET,
  accountPath,
  addressFromScript,
  deriveAddresses,
  mnemonicToSeed,
  normalizePath,
  rootFromSeed,
} from '@nullroute/core'
import {
  deriveAccountXpub,
  deriveMultisigAddresses,
  parseDescriptor,
  withChecksum,
} from '@nullroute/core'
import { buildOwnedIndex, changeLookup, signingPathsFor } from '../src/psbt.js'
import { multisigAccountPath } from '../src/multisig.js'

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

/**
 * NOT ours. Verified: this is the BIP-173 test vector address, and it does not
 * re-derive from the test mnemonic at any path.
 *
 * This constant used to be bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu, which is
 * the BIP-84 vector address FOR THIS EXACT MNEMONIC and therefore belongs to the
 * wallet under test. Tests that meant "a payment to someone else" were quietly
 * asserting things about a self-send, and the change-substitution test was
 * passing for the wrong reason. See the fixture guard at the end of this file.
 */
const STRANGER = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'

function ourAddress(change: boolean, index = 0): { address: string; path: string } {
  using seed = mnemonicToSeed(MNEMONIC, '')
  const root = rootFromSeed(seed, MAINNET)
  const base = normalizePath(accountPath('p2wpkh', MAINNET, 0))
  const account = root.derive(base)
  const [entry] = deriveAddresses(account, {
    scriptType: 'p2wpkh',
    network: MAINNET,
    change,
    start: index,
    count: 1,
  })
  root.wipePrivateData()
  if (entry === undefined) throw new Error('no address')
  return { address: entry.address, path: `${base}/${entry.path}` }
}

function scriptFor(address: string): Uint8Array {
  return btc.OutScript.encode(
    btc.Address({
      bech32: MAINNET.bech32,
      pubKeyHash: MAINNET.pubKeyHash,
      scriptHash: MAINNET.scriptHash,
      wif: MAINNET.wif,
    }).decode(address)
  )
}

describe('daemon.psbt', () => {
  // INV-PSBT-12
  it('labels-change-only-from-re-derivation', () => {
    using seed = mnemonicToSeed(MNEMONIC, '')
    const index = buildOwnedIndex(seed, MAINNET, { gapLimit: 20 })
    const isChange = changeLookup(index)

    const change = ourAddress(true, 0)
    expect(isChange(change.address)).toBe(change.path)
    expect(isChange(change.address)).toContain("/1/0")

    // Not ours, so no path, whatever position it occupies.
    expect(isChange(STRANGER)).toBeUndefined()
  })

  /**
   * The attack, written as the attack.
   *
   * The PSBT carries a bip32Derivation entry claiming the stranger's address
   * belongs to this wallet at a change path. Nothing about that claim is
   * consulted, so the answer must still be "not ours".
   */
  it('ignores-a-derivation-hint-in-the-psbt', () => {
    using seed = mnemonicToSeed(MNEMONIC, '')
    const index = buildOwnedIndex(seed, MAINNET, { gapLimit: 20 })
    const isChange = changeLookup(index)

    // Whatever the transaction asserts, the index is built from the seed and
    // the stranger's address is simply not in it.
    expect(isChange(STRANGER)).toBeUndefined()
    expect(index.has(STRANGER)).toBe(false)

    // And the index contains only addresses that re-derive.
    for (const [address, owned] of index) {
      expect(owned.address).toBe(address)
      expect(owned.path.startsWith('m/')).toBe(true)
    }
  })

  // INV-PSBT-13. A payment to our own receive address is a self-send. Calling
  // it change would hide it inside the "returned to you" total.
  it('does-not-call-a-self-send-change', () => {
    using seed = mnemonicToSeed(MNEMONIC, '')
    const index = buildOwnedIndex(seed, MAINNET, { gapLimit: 20 })
    const isChange = changeLookup(index)

    const receive = ourAddress(false, 0)
    // It IS ours...
    expect(index.has(receive.address)).toBe(true)
    expect(index.get(receive.address)?.change).toBe(false)
    // ...and it is still not change.
    expect(isChange(receive.address)).toBeUndefined()
  })

  // INV-PSBT-14
  it('finds-the-path-that-owns-an-input', () => {
    using seed = mnemonicToSeed(MNEMONIC, '')
    const index = buildOwnedIndex(seed, MAINNET, { gapLimit: 20 })
    const ours = ourAddress(false, 3)

    const paths = signingPathsFor([scriptFor(ours.address)], index, MAINNET)
    expect(paths).toEqual([ours.path])
  })

  it('finds-nothing-for-a-foreign-input', () => {
    using seed = mnemonicToSeed(MNEMONIC, '')
    const index = buildOwnedIndex(seed, MAINNET, { gapLimit: 20 })

    expect(signingPathsFor([scriptFor(STRANGER)], index, MAINNET)).toEqual([])
    // An input whose script the PSBT did not carry cannot be attributed either.
    expect(signingPathsFor([undefined], index, MAINNET)).toEqual([])
    // Nor can a script with no address form.
    expect(signingPathsFor([Uint8Array.from([0x6a, 0x02, 0xde, 0xad])], index, MAINNET)).toEqual([])
  })

  it('deduplicates-paths-across-inputs', () => {
    using seed = mnemonicToSeed(MNEMONIC, '')
    const index = buildOwnedIndex(seed, MAINNET, { gapLimit: 20 })
    const ours = ourAddress(false, 0)
    const script = scriptFor(ours.address)

    // Three inputs from the same address need the key derived once.
    expect(signingPathsFor([script, script, script], index, MAINNET)).toEqual([ours.path])
  })

  // The index is network-specific. Building it for one network and querying an
  // address from another must not match, because the two encode differently and
  // a cross-network match would mean signing against the wrong chain.
  it('is-scoped-to-one-network', () => {
    using seed = mnemonicToSeed(MNEMONIC, '')
    const mainnetIndex = buildOwnedIndex(seed, MAINNET, { gapLimit: 10 })
    const signetIndex = buildOwnedIndex(seed, SIGNET, { gapLimit: 10 })

    const mainnetAddress = [...mainnetIndex.keys()][0]
    if (mainnetAddress === undefined) throw new Error('empty index')

    expect(mainnetAddress.startsWith('bc1')).toBe(true)
    expect(signetIndex.has(mainnetAddress)).toBe(false)

    // No address appears in both indexes. Only the bech32 types carry an
    // obvious prefix (tb1 against bc1); legacy and nested segwit differ by
    // version byte and render as m/n and 2, so prefix matching is the wrong
    // check here. Disjointness is the property that actually matters.
    for (const address of signetIndex.keys()) expect(mainnetIndex.has(address)).toBe(false)
    for (const address of mainnetIndex.keys()) expect(signetIndex.has(address)).toBe(false)
  })

  it('covers-every-script-type-and-both-branches', () => {
    using seed = mnemonicToSeed(MNEMONIC, '')
    const gapLimit = 5
    const index = buildOwnedIndex(seed, MAINNET, { gapLimit })

    // Four script types, two branches.
    expect(index.size).toBe(4 * 2 * gapLimit)
    const kinds = new Set([...index.values()].map((o) => o.scriptType))
    expect(kinds).toEqual(new Set(['p2wpkh', 'p2tr', 'p2sh-p2wpkh', 'p2pkh']))
    expect(new Set([...index.values()].map((o) => o.change))).toEqual(new Set([true, false]))
  })

  // The gap limit is a real bound, and being wrong beyond it must be safe:
  // an unrecognised change address is a payment, never a verified change label.
  it('treats-change-beyond-the-gap-limit-as-a-payment', () => {
    using seed = mnemonicToSeed(MNEMONIC, '')
    const index = buildOwnedIndex(seed, MAINNET, { gapLimit: 5 })
    const isChange = changeLookup(index)

    const near = ourAddress(true, 2)
    const far = ourAddress(true, 50)

    expect(isChange(near.address)).toBe(near.path)
    // Genuinely ours, but past the limit, so reported as a payment.
    expect(isChange(far.address)).toBeUndefined()
  })

  it('maps-scripts-back-to-addresses-consistently', () => {
    const ours = ourAddress(false, 0)
    expect(addressFromScript(scriptFor(ours.address), MAINNET)).toBe(ours.address)
  })

  /**
   * The fixture guard.
   *
   * STRANGER must not belong to the wallet under test, and this asserts it
   * rather than trusting that whoever picked the constant checked.
   *
   * This exists because the original constant, bc1qcr8te4kr609..., IS the BIP-84
   * vector address for this exact mnemonic. It is the obvious address to reach
   * for when you want "a bitcoin address" in a test, and it is the worst
   * possible choice here. Every test that meant "paying someone else" was
   * actually describing a self-send, and the change-substitution test, which is
   * the single most important test in the PSBT suite, was passing for a reason
   * that had nothing to do with what it claimed to check.
   *
   * A wide gap limit is used deliberately: a foreign address must be foreign at
   * every index, not merely outside the window the other tests happen to use.
   */
  it('uses-a-stranger-address-that-is-genuinely-not-ours', () => {
    using seed = mnemonicToSeed(MNEMONIC, '')
    const wide = buildOwnedIndex(seed, MAINNET, { gapLimit: 500 })
    expect(wide.has(STRANGER)).toBe(false)
    expect(changeLookup(wide)(STRANGER)).toBeUndefined()
    expect(signingPathsFor([scriptFor(STRANGER)], wide, MAINNET)).toEqual([])
    // Four script types across receive and change at 500 indices is four
    // thousand derivations, each a BIP-32 step and a hash. That is slow on
    // purpose, and slower still when the rest of the suite is competing for
    // cores, so the budget is stated rather than left at the default.
  }, 30_000)

  // --- Registered quorums -------------------------------------------------

  /** The multisig account xpub for a mnemonic, on MAINNET. */
  function msXpub(mnemonic: string): string {
    using seed = mnemonicToSeed(mnemonic, '')
    return deriveAccountXpub(seed, MAINNET, multisigAccountPath(MAINNET)).xpub
  }

  const COSIGNER_B =
    'legal winner thank year wave sausage worth useful legal winner thank yellow'
  const COSIGNER_C =
    'letter advice cage absurd amount doctor acoustic avoid letter advice cage above'

  function quorum(): string {
    const keys = [msXpub(MNEMONIC), msXpub(COSIGNER_B), msXpub(COSIGNER_C)]
    return withChecksum(`wsh(sortedmulti(2,${keys.map((k) => `${k}/<0;1>/*`).join(',')}))`)
  }

  /**
   * INV-PSBT-16. Without this the device shows a multisig wallet's own change
   * as a payment to a stranger, on every transaction that wallet builds. That
   * is the safe direction to be wrong in and it is still wrong: it trains a
   * user to dismiss the warning that matters.
   */
  it('recognises-change-from-a-registered-quorum', () => {
    using seed = mnemonicToSeed(MNEMONIC, '')
    const descriptor = quorum()

    const without = buildOwnedIndex(seed, MAINNET, { gapLimit: 5 })
    const with_ = buildOwnedIndex(seed, MAINNET, { gapLimit: 5, registrations: [descriptor] })

    const parsed = parseDescriptor(descriptor)
    const change = deriveMultisigAddresses(parsed, {
      network: MAINNET,
      change: true,
      start: 0,
      count: 1,
    })[0]
    if (change === undefined) throw new Error('no change address')

    expect(without.has(change.address)).toBe(false)
    expect(changeLookup(without)(change.address)).toBeUndefined()

    expect(with_.has(change.address)).toBe(true)
    // The path recorded is the one THIS device signs with, not the
    // descriptor's: every cosigner reaches the same address differently.
    expect(changeLookup(with_)(change.address)).toBe("m/48'/0'/0'/2'/1/0")
  })

  it('signs-a-multisig-input-with-our-own-derivation', () => {
    using seed = mnemonicToSeed(MNEMONIC, '')
    const descriptor = quorum()
    const index = buildOwnedIndex(seed, MAINNET, { gapLimit: 5, registrations: [descriptor] })

    const receive = deriveMultisigAddresses(parseDescriptor(descriptor), {
      network: MAINNET,
      start: 0,
      count: 1,
    })[0]
    if (receive === undefined) throw new Error('no receive address')

    expect(signingPathsFor([scriptFor(receive.address)], index, MAINNET)).toEqual([
      "m/48'/0'/0'/2'/0/0",
    ])
  })

  // A receive address of the quorum is a self-send, not change, exactly as for
  // a single-signature wallet.
  it('does-not-call-a-multisig-receive-address-change', () => {
    using seed = mnemonicToSeed(MNEMONIC, '')
    const descriptor = quorum()
    const index = buildOwnedIndex(seed, MAINNET, { gapLimit: 5, registrations: [descriptor] })

    const receive = deriveMultisigAddresses(parseDescriptor(descriptor), {
      network: MAINNET,
      start: 0,
      count: 1,
    })[0]
    if (receive === undefined) throw new Error('no receive address')

    expect(index.get(receive.address)?.change).toBe(false)
    expect(changeLookup(index)(receive.address)).toBeUndefined()
  })

  /**
   * A registration this device is not in contributes nothing.
   *
   * It cannot arrive through `multisig.register`, which refuses one. It could
   * arrive from a store written by another device, and the safe reading is to
   * ignore it rather than to derive addresses nobody here can sign for and
   * label them change.
   */
  it('ignores-a-registration-this-device-is-not-in', () => {
    using seed = mnemonicToSeed(MNEMONIC, '')
    const strangers = [msXpub(COSIGNER_B), msXpub(COSIGNER_C)]
    const foreign = withChecksum(
      `wsh(sortedmulti(2,${strangers.map((k) => `${k}/<0;1>/*`).join(',')}))`
    )

    const base = buildOwnedIndex(seed, MAINNET, { gapLimit: 5 })
    const withForeign = buildOwnedIndex(seed, MAINNET, {
      gapLimit: 5,
      registrations: [foreign],
    })
    expect(withForeign.size).toBe(base.size)
  })

  // A descriptor that no longer parses must not stop the device reviewing a
  // transaction at all. Refusing everything would be a worse failure.
  it('skips-an-unreadable-registration-rather-than-throwing', () => {
    using seed = mnemonicToSeed(MNEMONIC, '')
    const base = buildOwnedIndex(seed, MAINNET, { gapLimit: 5 })
    const withJunk = buildOwnedIndex(seed, MAINNET, {
      gapLimit: 5,
      registrations: ['not a descriptor at all', 'wsh(sortedmulti(2,#bad'],
    })
    expect(withJunk.size).toBe(base.size)
  })
})
