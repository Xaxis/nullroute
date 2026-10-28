/**
 * The published BIP-387 descriptor vectors: multi_a() and sortedmulti_a().
 *
 * spec/vectors/bip387-descriptors.json is an extraction, pinned by hash in
 * quorum-addresses.spec.yaml. Its source is the "Test Vectors" section of
 * bip-0387.mediawiki at bitcoin/bips 5aadddb511a5dcfe4599531bd8ae5e5b96d0f793,
 * and it was produced by:
 *
 *   node tools/extract-descriptor-vectors.mjs bip-0387.mediawiki <commit>
 *
 * Two valid descriptors carry no private key, tr(KEY,multi_a()) over fixed
 * x-only keys and tr(KEY,sortedmulti_a()) over two ranged xpubs, and both have
 * to derive the published script exactly, the second at children 0 to 2. The
 * other four carry a private key and are refused. Two of those are the BIP's
 * only multi_a() and sortedmulti_a() over the same keys, so the test also runs
 * them with each xprv replaced by its public half, which derives the same
 * keys: they have to produce the published script too.
 *
 * No case failed. The refusal of sh(multi_a()) and wsh(multi_a()) used to say
 * taproot multisig was not supported yet, which was untrue; it now says where
 * multi_a() goes.
 */

import { describe, expect, it } from 'vitest'
import { HDKey } from '@scure/bip32'
import {
  DERIVED,
  WIF,
  XPRV,
  atParse,
  checkInvalid,
  checkValid,
  expectScriptsAreHex,
  loadDescriptorVectors,
  scriptCount,
  type InvalidOutcome,
  type ValidOutcome,
} from './fixtures/descriptor-vectors.js'

const VECTORS = loadDescriptorVectors(387)

/** In the BIP's order. */
const VALID: readonly ValidOutcome[] = [
  WIF, // tr(L4rK...,multi_a(1,KzoA...))
  DERIVED, // tr(a34b...,multi_a(1,669b...))
  XPRV, // tr(5092...,multi_a(2,[00000000/111'/222]xprv...,xprv.../0))
  XPRV, // tr(5092...,sortedmulti_a(2,[00000000/111'/222]xprv...,xprv.../0))
  DERIVED, // tr(5092...,sortedmulti_a(2,xpub.../*,xpub.../0/0/*)), children 0 to 2
  XPRV, // tr(5092...,multi_a(2,xprv.../2147483647'/0,xprv.../1/2/*,xprv.../10/20/30/40/*'))
]

const INVALID: readonly InvalidOutcome[] = [
  atParse(/multi_a\(\) cannot go at the top level/), // multi_a(1,...) at the top level
  atParse(/multi_a\(\) cannot go inside sh\(\)/), // sh(multi_a(1,...))
  atParse(/multi_a\(\) cannot go inside wsh\(\)/), // wsh(multi_a(1,...))
  atParse(/is not a number/), // multi_a(a,...)
  atParse(/out of range/), // multi_a(0,...)
  atParse(/uncompressed key cannot go under tr\(\)/), // multi_a(1,04a3...), INV-TR-7
  // The BIP's defect is the threshold; the keys are read first, and a WIF
  // private key is not read at all.
  atParse(/neither an extended public key nor hex/), // multi_a(3,L4rK...,5KYZ...)
]

/** Each xprv in a descriptor replaced by its own public half. */
function publicHalf(descriptor: string): string {
  return descriptor.replace(
    /xprv[1-9A-HJ-NP-Za-km-z]+/g,
    (xprv) => HDKey.fromExtendedKey(xprv).publicExtendedKey
  )
}

describe('core.descriptor published BIP-387 vectors', () => {
  it('extraction-is-faithful', () => {
    expect(VECTORS.bipsCommit).toBe('5aadddb511a5dcfe4599531bd8ae5e5b96d0f793')
    expect(VECTORS.source).toContain(VECTORS.bipsCommit)
    expect(VECTORS.bip).toBe(387)
    // The counts at the pinned commit. A re-extraction that lost or gained a
    // case changes one of these.
    expect(VECTORS.valid).toHaveLength(6)
    expect(VECTORS.invalid).toHaveLength(7)
    expect(scriptCount(VECTORS)).toBe(10)
    expectScriptsAreHex(VECTORS)
    expect(VALID).toHaveLength(VECTORS.valid.length)
    expect(INVALID).toHaveLength(VECTORS.invalid.length)
  })

  /** INV-DESC-9. */
  it('handles-every-published-valid-descriptor', () => {
    for (const [i, c] of VECTORS.valid.entries()) checkValid(c, VALID[i])

    // multi_a() and sortedmulti_a() over the same two keys, one with an
    // origin, written in an order that sorting changes. With each xprv
    // replaced by its public half, both have to derive the published script.
    // Derived from the vectors, not published by the BIP. The sixth valid
    // descriptor has no such variant: its hardened steps after the key need
    // the private half.
    for (const i of [2, 3]) {
      const c = VECTORS.valid[i]
      if (c === undefined) throw new Error(`valid vector ${String(i)} is missing`)
      expect(c.descriptor).toContain('xprv')
      checkValid({ ...c, descriptor: publicHalf(c.descriptor) }, DERIVED)
    }
    expect(VECTORS.valid[2]?.scripts).not.toEqual(VECTORS.valid[3]?.scripts)
  })

  /** INV-DESC-10 and INV-TR-7. */
  it('refuses-every-published-invalid-descriptor', () => {
    for (const [i, c] of VECTORS.invalid.entries()) checkInvalid(c, INVALID[i])
  })
})
