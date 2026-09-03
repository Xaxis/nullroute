/**
 * Tests for core.descriptor.taproot.
 *
 * Every address is checked against the signer library rather than a constant
 * this project wrote down, for the same reason the multisig tests are: a wrong
 * tweak or a mis-shaped tree produces a valid, well-formed address that nobody
 * else agrees with, and a vector file we generated ourselves would agree with
 * our own bug.
 *
 * The properties that matter most here are the ones that fail silently. Tree
 * shape changes the merkle root, so `{{A,B},C}` and `{A,{B,C}}` are different
 * wallets. `multi_a` and `sortedmulti_a` are different wallets. Neither
 * difference is visible in an address.
 */

import { describe, expect, it } from 'vitest'
import * as btc from '@scure/btc-signer'
import { hex } from '@scure/base'

import { parseDescriptor, DescriptorParseError } from '../src/descriptor/parse.js'
import { deriveTaprootAddresses, taprootQuorum } from '../src/descriptor/taproot.js'
import { MAINNET, TESTNET3 } from '../src/network/networks.js'

/** x-only keys. The first is the BIP-386 single-key vector. */
const INTERNAL = 'a34b99f22c790c4e36b2b3c2c35a36db06226e41c692fc82b8b56ac1c540c5bd'
const A = '669b8afcec803a0d323e9a17f3ea8e68e8abe5a278020a929adbec52421adbd0'
const B = 'a0434d9e47f3c86235477c7b1ae6ae5d3442d49b1943c2b752a68e2a47e247c7'
const C = 'f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9'

function parse(body: string) {
  return parseDescriptor(body, { allowBadChecksum: true })
}

function address(body: string, network = MAINNET): string {
  const derived = deriveTaprootAddresses(parse(body), { network, count: 1 })
  const first = derived[0]
  if (first === undefined) throw new Error('no address derived')
  return first.address
}

describe('core.descriptor.taproot', () => {
  // INV-TR-1. Key path only, against the library.
  it('agrees-with-the-library-on-a-key-path-descriptor', () => {
    const ours = address(`tr(${INTERNAL})`)
    const theirs = btc.p2tr(hex.decode(INTERNAL), undefined, MAINNET).address
    expect(ours).toBe(theirs)
    expect(ours).toMatch(/^bc1p/)
  })

  it('agrees-with-the-library-on-a-script-path-descriptor', () => {
    const ours = address(`tr(${INTERNAL},{pk(${A}),sortedmulti_a(2,${A},${B})})`)
    const sorted = [hex.decode(A), hex.decode(B)].sort((x, y) => Buffer.compare(x, y))
    const theirs = btc.p2tr(
      hex.decode(INTERNAL),
      [btc.p2tr_pk(hex.decode(A)), btc.p2tr_ms(2, sorted)],
      MAINNET
    ).address
    expect(ours).toBe(theirs)
  })

  /**
   * INV-TR-2. The commitment is over the tree, so its shape is part of the
   * wallet. Flattening a tree into a set of leaves would be the taproot
   * equivalent of ignoring sortedmulti's ordering.
   */
  it('treats-tree-shape-as-part-of-the-address', () => {
    const left = address(`tr(${INTERNAL},{{pk(${A}),pk(${B})},pk(${C})})`)
    const right = address(`tr(${INTERNAL},{pk(${A}),{pk(${B}),pk(${C})}})`)
    expect(left).not.toBe(right)
  })

  // INV-TR-3. sortedmulti_a sorts its x-only keys; multi_a keeps written order.
  it('sorts-only-when-the-descriptor-says-to', () => {
    const written = address(`tr(${INTERNAL},multi_a(2,${B},${A}))`)
    const sorted = address(`tr(${INTERNAL},sortedmulti_a(2,${B},${A}))`)
    expect(written).not.toBe(sorted)

    // And sorting genuinely makes key order irrelevant.
    expect(address(`tr(${INTERNAL},sortedmulti_a(2,${A},${B}))`)).toBe(sorted)

    // While multi_a is order-significant, which is why it warrants a warning
    // at registration.
    expect(address(`tr(${INTERNAL},multi_a(2,${A},${B}))`)).not.toBe(written)
  })

  it('encodes-for-the-network-it-is-given', () => {
    const body = `tr(${INTERNAL},sortedmulti_a(2,${A},${B}))`
    expect(address(body, MAINNET)).toMatch(/^bc1p/)
    expect(address(body, TESTNET3)).toMatch(/^tb1p/)
    expect(address(body, MAINNET)).not.toBe(address(body, TESTNET3))
  })

  // INV-TR-4. A leaf this device cannot sign for changes the merkle root, so
  // deriving anyway would produce a wallet whose addresses are wrong with
  // nothing on screen to reveal it.
  it('refuses-a-leaf-it-cannot-sign-for', () => {
    expect(() => address(`tr(${INTERNAL},{pk(${A}),wpkh(${A})})`)).toThrow(/not supported/)
    expect(() => address(`tr(${INTERNAL},{pk(${A}),wpkh(${A})})`)).toThrow(DescriptorParseError)
  })

  it('refuses-a-branch-that-is-not-binary', () => {
    // The merkle construction in BIP-341 is binary, so {A,B,C} has no defined
    // commitment and must not be re-associated into a shape nobody chose.
    expect(() => parse(`tr(${INTERNAL},{pk(${A}),pk(${B}),pk(${C})})`)).toThrow(
      /exactly two subtrees/
    )
  })

  it('refuses-a-descriptor-that-is-not-taproot', () => {
    expect(() =>
      deriveTaprootAddresses(parse(`wpkh(${INTERNAL})`), { network: MAINNET, count: 1 })
    ).toThrow(/not a tr\(\) one/)
  })

  // INV-TR-5. The quorum is summarised only when the answer is unambiguous.
  it('reports-a-single-multisig-leaf-and-refuses-to-guess-between-two', () => {
    expect(taprootQuorum(parse(`tr(${INTERNAL})`))).toBeUndefined()
    expect(taprootQuorum(parse(`tr(${INTERNAL},pk(${A}))`))).toBeUndefined()

    const one = taprootQuorum(parse(`tr(${INTERNAL},sortedmulti_a(2,${A},${B}))`))
    expect(one).toMatchObject({ threshold: 2, total: 2, sorted: true })

    const two = `tr(${INTERNAL},{multi_a(2,${A},${B}),sortedmulti_a(2,${B},${C})})`
    expect(() => taprootQuorum(parse(two))).toThrow(/no single answer/)
  })

  // A tr() whose internal key is fixed but whose leaves are ranged IS ranged.
  // Treating it as fixed would derive one address for an entire wallet.
  it('counts-a-ranged-leaf-as-a-ranged-descriptor', () => {
    const xpub =
      'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8'
    expect(parse(`tr(${INTERNAL},pk(${xpub}/0/*))`).ranged).toBe(true)
    expect(parse(`tr(${INTERNAL},pk(${A}))`).ranged).toBe(false)
  })

  it('derives-a-range-of-addresses-that-all-differ', () => {
    const xpub =
      'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8'
    const derived = deriveTaprootAddresses(parse(`tr(${xpub}/0/*)`), {
      network: MAINNET,
      count: 5,
    })
    expect(derived).toHaveLength(5)
    expect(new Set(derived.map((d) => d.address)).size).toBe(5)
    expect(derived.every((d) => !d.hasScriptPath)).toBe(true)
  })
})
