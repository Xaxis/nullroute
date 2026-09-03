/**
 * A quorum this device agrees to is one every path can act on.
 *
 * ACCEPTING IS A PROMISE. Whatever descriptor kind registration returns a
 * review for, everything downstream has to handle it: deriving addresses to
 * show a user, confirming an address belongs to the quorum, and contributing to
 * the owned index so change coming back is recognised as the wallet's own.
 *
 * THE DIVERGENCE THIS CATCHES. Taproot quorums were supported almost
 * everywhere. Registration read them, its smoke test derived an address,
 * `buildOwnedIndex` included them so change was recognised, and signing worked.
 * The two IPC methods that SHOW a user an address called the older derivation
 * function unconditionally and refused taproot, so a taproot quorum could be
 * agreed to, signed for and recognised, and never displayed: the receive
 * screen's quorum tab errored, and so did the screen for comparing addresses
 * between devices.
 *
 * The rule is not about taproot. It is that a build teaching the parser a new
 * script kind without teaching the rest fails here rather than on somebody's
 * wallet.
 *
 * A NOTE ON HOW THIS WAS FOUND, because the method matters more than the bug.
 * I first concluded taproot quorums were broken outright, on two readings that
 * both looked conclusive and were both wrong: a probe that called
 * `deriveMultisigAddresses` on a tr descriptor, which correctly refuses it, and
 * an owned-index count compared against no baseline. Hence the baseline
 * assertions below.
 */

import { describe, expect, it } from 'vitest'
import {
  deriveAccountXpub,
  deriveMultisigAddresses,
  deriveTaprootAddresses,
  mnemonicToSeed,
  networkById,
  parseDescriptor,
  withChecksum,
} from '@nullroute/core'
import { multisigAccountPath, reviewRegistration } from '../src/multisig.js'
import { buildOwnedIndex } from '../src/psbt.js'
import { createHandler } from '../src/handler.js'
import { Session } from '../src/session.js'
import type { BootAttestation } from '../src/boot/attestation.js'

const NETWORK = networkById('regtest')
const MNEMONICS = [
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  'legal winner thank year wave sausage worth useful legal winner thank yellow',
  'letter advice cage absurd amount doctor acoustic avoid letter advice cage above',
]

/** A NUMS point, as a coordinator writes a script-path-only taproot descriptor. */
const NUMS = '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0'

/** The three cosigner key expressions, at the path registration looks for. */
function quorumKeys(): string[] {
  const path = multisigAccountPath(NETWORK, 0)
  return MNEMONICS.map((mnemonic) => {
    using seed = mnemonicToSeed(mnemonic, '')
    const account = deriveAccountXpub(seed, NETWORK, path)
    return `[${account.masterFingerprint}${path.slice(1)}]${account.xpub}/<0;1>/*`
  })
}

const wsh = (): string => withChecksum(`wsh(sortedmulti(2,${quorumKeys().join(',')}))`)
const shWsh = (): string => withChecksum(`sh(wsh(sortedmulti(2,${quorumKeys().join(',')})))`)
const tr = (): string => withChecksum(`tr(${NUMS},sortedmulti_a(2,${quorumKeys().join(',')}))`)

/**
 * Derive with the function that matches the KIND.
 *
 * Calling the older one for a tr descriptor is what made taproot quorums look
 * unsupported when they were not, so a test that repeated the mistake would
 * have enshrined it.
 */
function addressesFor(text: string, count: number): readonly { address: string }[] {
  const parsed = parseDescriptor(text)
  const options = { network: NETWORK, change: false, start: 0, count }
  return parsed.script.kind === 'tr'
    ? deriveTaprootAddresses(parsed, options)
    : deriveMultisigAddresses(parsed, options)
}

/** Accepted, and then derivable. The promise, over one descriptor. */
function assertAcceptedIsDerivable(text: string): void {
  using seed = mnemonicToSeed(MNEMONICS[0] ?? '', '')
  reviewRegistration(text, seed, NETWORK)

  const addresses = addressesFor(text, 2)
  expect(addresses).toHaveLength(2)
  expect(addresses[0]?.address.length).toBeGreaterThan(0)
}

/**
 * Accepted, and then visible to change detection.
 *
 * Against a baseline. A count on its own says nothing: the single-signature
 * entries are there either way, and comparing against nothing is what made an
 * ignored registration look like a working one.
 */
function assertContributesToOwnedIndex(text: string): void {
  using seed = mnemonicToSeed(MNEMONICS[0] ?? '', '')
  reviewRegistration(text, seed, NETWORK)

  const withQuorum = buildOwnedIndex(seed, NETWORK, { gapLimit: 5, registrations: [text] })
  const without = buildOwnedIndex(seed, NETWORK, { gapLimit: 5, registrations: [] })
  expect(withQuorum.index.size).toBeGreaterThan(without.index.size)
  // And it was read, rather than counted as one this device could not parse.
  // A registration that silently failed would also add no addresses, so the
  // size comparison alone cannot tell the two apart.
  expect(withQuorum.unreadable).toBe(0)
}

/** Accepted, and then showable AND confirmable through the IPC surface. */
async function assertAddressMethodsWork(text: string): Promise<void> {
  const session = new Session()
  session.setNetwork(NETWORK)
  const handler = createHandler({
    attestation: { passed: true } as unknown as BootAttestation,
    session,
  })
  const call = (method: string, params: Record<string, unknown>): Promise<unknown> =>
    handler({ id: '1', method, params })

  try {
    await call('wallet.import', { mnemonic: MNEMONICS[0] ?? '', passphrase: '' })

    const derived = (await call('multisig.addresses', {
      descriptor: text,
      start: 0,
      count: 2,
    })) as { addresses: { address: string }[] }
    expect(derived.addresses).toHaveLength(2)

    const address = derived.addresses[0]?.address ?? ''
    expect(await call('multisig.verifyAddress', { descriptor: text, address })).toMatchObject({
      found: true,
      index: 0,
    })
  } finally {
    session.lock()
  }
}

describe('an accepted quorum is derivable', () => {
  /** INV-MULTI-11. */
  it('wsh-sortedmulti-derives-addresses-after-being-accepted', () => {
    assertAcceptedIsDerivable(wsh())
  })

  /** INV-MULTI-11. */
  it('sh-wsh-sortedmulti-derives-addresses-after-being-accepted', () => {
    assertAcceptedIsDerivable(shWsh())
  })

  /** INV-MULTI-11. Taproot quorums are supported, which this asserts rather than assumes. */
  it('tr-sortedmulti-a-derives-addresses-after-being-accepted', () => {
    assertAcceptedIsDerivable(tr())
  })
})

describe('an accepted quorum is visible to change detection', () => {
  /** INV-MULTI-11. */
  it('wsh-sortedmulti-adds-owned-scripts-beyond-the-single-signature-ones', () => {
    assertContributesToOwnedIndex(wsh())
  })

  /**
   * INV-MULTI-11. The silent half, and the dangerous one. A registration the
   * owned index ignores produces a device that cannot tell its own change from
   * a stranger's, with nothing anywhere reporting a problem.
   */
  it('tr-sortedmulti-a-adds-owned-scripts-beyond-the-single-signature-ones', () => {
    assertContributesToOwnedIndex(tr())
  })
})

describe('an accepted quorum can be shown to a user', () => {
  /** INV-MULTI-11. */
  it('wsh-sortedmulti-derives-an-address-and-confirms-it-belongs', async () => {
    await assertAddressMethodsWork(wsh())
  })

  /**
   * INV-MULTI-11. The one that was broken: agreed to, signed for, recognised
   * as change, and impossible to display.
   */
  it('tr-sortedmulti-a-derives-an-address-and-confirms-it-belongs', async () => {
    await assertAddressMethodsWork(tr())
  })
})

describe('what registration still refuses', () => {
  /**
   * INV-MULTI-11. A tr() with no quorum in it keeps its own clearer error. A
   * blanket refusal of taproot would have swallowed this one, which is a
   * reason the refusal is not blanket.
   */
  it('still-says-a-single-key-taproot-descriptor-is-not-a-quorum', () => {
    using seed = mnemonicToSeed(MNEMONICS[0] ?? '', '')
    const single = withChecksum(`tr(${quorumKeys()[0] ?? ''})`)

    expect(() => reviewRegistration(single, seed, NETWORK)).toThrow(/no multisig leaf/)
  })
})
