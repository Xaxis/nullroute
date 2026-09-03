/**
 * Tests for core.descriptor.multisig.
 *
 * Every address here is checked against bitcoinjs-lib rather than against a
 * constant this project wrote down. That matters more for multisig than for
 * anything else in the codebase: a wrong key order does not throw, it produces
 * a perfectly valid address that nobody else in the quorum agrees with, and the
 * mistake surfaces when a coordinator sends funds somewhere the device cannot
 * see them. A vector file we generated ourselves would agree with our own bug.
 */

import { describe, expect, it } from 'vitest'
import * as bitcoin from 'bitcoinjs-lib'
import { BIP32Factory } from 'bip32'
import * as ecc from 'tiny-secp256k1'

import { createBase58check } from '@scure/base'
import { sha256 } from '@noble/hashes/sha2.js'
import { parseDescriptor, DescriptorParseError } from '../src/descriptor/parse.js'
import { deriveMultisigAddresses, findOwnKey, multisigShape } from '../src/descriptor/multisig.js'
import { MAINNET, TESTNET3 } from '../src/network/networks.js'

const bip32 = BIP32Factory(ecc)

/** Three cosigners, from the BIP-32 vector seeds. */
const SEEDS = [
  '000102030405060708090a0b0c0d0e0f',
  'fffcf9f6f3f0edeae7e4e1dedbd8d5d2cfccc9c6c3c0bdbab7b4b1aeaba8a5a29f9c999693908d8a8784817e7b7875726f6c696663605d5a5754514e4b484542',
  '4b381541583be4423346c643850da4b320e46a87ae3d2a4e6da11eba819cd4acba45d239319ac14f863b8d5ab5a0d0c64d2e8a1e7d1457df2e5a3c51c73235be',
]

/** BIP-48 script type 2 is the native segwit multisig account. */
const XPUBS = SEEDS.map((hex) =>
  bip32.fromSeed(Buffer.from(hex, 'hex')).derivePath("m/48'/0'/0'/2'").neutered().toBase58()
)
const NODES = XPUBS.map((x) => bip32.fromBase58(x))

function parse(body: string) {
  return parseDescriptor(body, { allowBadChecksum: true })
}

/** The oracle's answer, built entirely through bitcoinjs-lib. */
function oracle(
  kind: 'wsh' | 'sh-wsh' | 'sh',
  pubkeys: Buffer[],
  sorted: boolean,
  network = bitcoin.networks.bitcoin
): string {
  const ordered = sorted ? [...pubkeys].sort((a, b) => Buffer.compare(a, b)) : pubkeys
  const ms = bitcoin.payments.p2ms({ m: 2, pubkeys: ordered, network })
  if (kind === 'wsh') return bitcoin.payments.p2wsh({ redeem: ms, network }).address ?? ''
  if (kind === 'sh') return bitcoin.payments.p2sh({ redeem: ms, network }).address ?? ''
  return (
    bitcoin.payments.p2sh({
      redeem: bitcoin.payments.p2wsh({ redeem: ms, network }),
      network,
    }).address ?? ''
  )
}

function keysAt(branch: number, index: number): Buffer[] {
  return NODES.map((n) => Buffer.from(n.derive(branch).derive(index).publicKey))
}

describe('core.descriptor.multisig', () => {
  // INV-MULTI-1. Every supported shape, cross-checked against an independent
  // implementation over a range of indexes.
  it('agrees-with-bitcoinjs-on-every-supported-shape', () => {
    const cases = [
      ['wsh', `wsh(sortedmulti(2,${XPUBS.map((x) => `${x}/0/*`).join(',')}))`, true],
      ['wsh', `wsh(multi(2,${XPUBS.map((x) => `${x}/0/*`).join(',')}))`, false],
      ['sh-wsh', `sh(wsh(sortedmulti(2,${XPUBS.map((x) => `${x}/0/*`).join(',')})))`, true],
      ['sh', `sh(sortedmulti(2,${XPUBS.map((x) => `${x}/0/*`).join(',')}))`, true],
    ] as const

    for (const [kind, body, sorted] of cases) {
      const derived = deriveMultisigAddresses(parse(body), {
        network: MAINNET,
        start: 0,
        count: 8,
      })
      expect(derived).toHaveLength(8)
      for (const [i, entry] of derived.entries()) {
        expect(entry.address, `${kind} sorted=${String(sorted)} index ${String(i)}`).toBe(
          oracle(kind, keysAt(0, i), sorted)
        )
      }
    }
  })

  /**
   * INV-MULTI-2, and the reason sorting is done per index.
   *
   * Lexicographic order is not preserved through derivation. If it were, a
   * cheaper implementation could sort the parent xpubs once and reuse the
   * order, and this test exists to show that such an implementation would be
   * wrong. With these three cosigners all six orderings occur within forty
   * indexes.
   */
  it('sorts-at-every-index-because-the-order-changes', () => {
    const orders = new Set<string>()
    for (let i = 0; i < 40; i += 1) {
      const withPosition = keysAt(0, i).map((key, position) => ({ key, position }))
      withPosition.sort((a, b) => Buffer.compare(a.key, b.key))
      orders.add(withPosition.map((k) => k.position).join(''))
    }
    expect(orders.size).toBeGreaterThan(1)

    // And the addresses follow that, rather than one fixed order.
    const body = `wsh(sortedmulti(2,${XPUBS.map((x) => `${x}/0/*`).join(',')}))`
    const derived = deriveMultisigAddresses(parse(body), { network: MAINNET, count: 40 })
    for (const [i, entry] of derived.entries()) {
      expect(entry.address).toBe(oracle('wsh', keysAt(0, i), true))
    }
  })

  // multi and sortedmulti are different wallets. Confusing them produces
  // addresses the rest of the quorum has never heard of.
  it('gives-different-addresses-for-multi-and-sortedmulti', () => {
    const keys = XPUBS.map((x) => `${x}/0/*`).join(',')
    const sorted = deriveMultisigAddresses(parse(`wsh(sortedmulti(2,${keys}))`), {
      network: MAINNET,
      count: 4,
    })
    const unsorted = deriveMultisigAddresses(parse(`wsh(multi(2,${keys}))`), {
      network: MAINNET,
      count: 4,
    })
    const overlap = sorted.filter((s, i) => s.address === unsorted[i]?.address)
    expect(overlap.length).toBeLessThan(4)
  })

  // INV-MULTI-3. BIP-389 multipath picks the branch; a single-branch
  // descriptor already carries its branch and must ignore the flag.
  it('selects-the-branch-of-a-multipath-descriptor', () => {
    const body = `wsh(sortedmulti(2,${XPUBS.map((x) => `${x}/<0;1>/*`).join(',')}))`
    const descriptor = parse(body)

    const receive = deriveMultisigAddresses(descriptor, { network: MAINNET, count: 3 })
    const change = deriveMultisigAddresses(descriptor, {
      network: MAINNET,
      count: 3,
      change: true,
    })

    for (let i = 0; i < 3; i += 1) {
      expect(receive[i]?.address).toBe(oracle('wsh', keysAt(0, i), true))
      expect(change[i]?.address).toBe(oracle('wsh', keysAt(1, i), true))
      expect(receive[i]?.address).not.toBe(change[i]?.address)
    }
  })

  it('ignores-the-change-flag-on-a-single-branch-descriptor', () => {
    // The branch is already written into the descriptor. Applying `change`
    // again would derive 0/1/index and produce a wallet nobody shares.
    const body = `wsh(sortedmulti(2,${XPUBS.map((x) => `${x}/1/*`).join(',')}))`
    const descriptor = parse(body)
    const asReceive = deriveMultisigAddresses(descriptor, { network: MAINNET, count: 3 })
    const asChange = deriveMultisigAddresses(descriptor, {
      network: MAINNET,
      count: 3,
      change: true,
    })
    expect(asChange.map((a) => a.address)).toEqual(asReceive.map((a) => a.address))
    for (const [i, entry] of asReceive.entries()) {
      expect(entry.address).toBe(oracle('wsh', keysAt(1, i), true))
    }
  })

  /**
   * The prefix on an extended key is a label, not key material. BIP-380 treats
   * it that way and coordinators emit xpub, tpub, ypub and Zpub for the same
   * wallet, so derivation accepts whatever prefix arrives and the network only
   * decides how the resulting address is encoded.
   *
   * Network confusion is caught in `findOwnKey` instead, where it can be: this
   * device's account key is derived under the session network's coin type, so a
   * mainnet quorum does not contain the key it holds on signet.
   */
  it('encodes-for-the-network-it-is-given', () => {
    const body = `wsh(sortedmulti(2,${XPUBS.map((x) => `${x}/0/*`).join(',')}))`
    const main = deriveMultisigAddresses(parse(body), { network: MAINNET, count: 1 })
    const test = deriveMultisigAddresses(parse(body), { network: TESTNET3, count: 1 })
    expect(main[0]?.address).toMatch(/^bc1/)
    expect(test[0]?.address).toMatch(/^tb1/)
    expect(test[0]?.address).toBe(oracle('wsh', keysAt(0, 0), true, bitcoin.networks.testnet))
  })

  /**
   * INV-MULTI-4. The check that stops someone registering a quorum they are
   * not in.
   *
   * A coordinator supplying a descriptor with the user's key swapped out
   * produces a wallet that looks entirely normal and cannot be spent from. The
   * match is on the key material, never on the fingerprint in the origin, which
   * is four bytes of unauthenticated hint that an attacker writes by hand.
   */
  it('finds-our-own-key-and-refuses-to-find-one-that-is-absent', () => {
    const body = `wsh(sortedmulti(2,${XPUBS.map((x) => `${x}/0/*`).join(',')}))`
    const descriptor = parse(body)

    expect(findOwnKey(descriptor, XPUBS[1] ?? '')?.position).toBe(1)
    expect(findOwnKey(descriptor, XPUBS[2] ?? '')?.position).toBe(2)

    const stranger = bip32
      .fromSeed(Buffer.from('ab'.repeat(32), 'hex'))
      .derivePath("m/48'/0'/0'/2'")
      .neutered()
      .toBase58()
    expect(findOwnKey(descriptor, stranger)).toBeUndefined()
  })

  /**
   * The same key serialises differently as xpub, ypub and zpub. A wallet that
   * compared the strings would tell a user their key is not in a quorum that
   * demonstrably contains it.
   */
  it('matches-our-key-across-different-serialisation-prefixes', () => {
    const body = `wsh(sortedmulti(2,${XPUBS.map((x) => `${x}/0/*`).join(',')}))`
    const descriptor = parse(body)

    // Re-serialise cosigner 0 under the Zpub version bytes used for segwit
    // multisig accounts, leaving all 74 bytes of key material untouched. Only
    // the four version bytes differ, which is exactly the case a string
    // comparison would get wrong.
    const base58c = createBase58check(sha256)
    const decoded = base58c.decode(XPUBS[0] ?? '')
    const asZpub = base58c.encode(Uint8Array.from([0x02, 0xaa, 0x7e, 0xd3, ...decoded.slice(4)]))

    expect(asZpub).not.toBe(XPUBS[0])
    expect(asZpub.startsWith('Zpub')).toBe(true)
    expect(findOwnKey(descriptor, asZpub)?.position).toBe(0)
  })

  // Shapes this device will not derive are refused, rather than approximated.
  it('refuses-shapes-it-does-not-understand', () => {
    expect(() => multisigShape(parse(`wpkh(${XPUBS[0] ?? ''}/0/*)`))).toThrow(/not a multisig one/)
    expect(() => multisigShape(parse(`wsh(pk(${XPUBS[0] ?? ''}/0/*))`))).toThrow(
      /Expected multi\(\) or sortedmulti\(\)/
    )
    // An unsatisfiable quorum is caught by the parser before it ever reaches
    // this module. Asserted here so that the layer responsible is recorded:
    // multisigShape keeps its own threshold check because it takes a public
    // Descriptor a caller could build without parsing text.
    expect(() => parse(`wsh(sortedmulti(4,${XPUBS.map((x) => `${x}/0/*`).join(',')}))`)).toThrow(
      /threshold 4 is out of range/
    )
  })

  it('refuses-an-absurd-derivation-count', () => {
    const body = `wsh(sortedmulti(2,${XPUBS.map((x) => `${x}/0/*`).join(',')}))`
    expect(() => deriveMultisigAddresses(parse(body), { network: MAINNET, count: 5000 })).toThrow(
      DescriptorParseError
    )
  })

  it('reports-the-quorum-it-parsed', () => {
    const body = `wsh(sortedmulti(2,${XPUBS.map((x) => `${x}/0/*`).join(',')}))`
    const shape = multisigShape(parse(body))
    expect(shape).toMatchObject({ kind: 'wsh', threshold: 2, total: 3, sorted: true })
  })
})
