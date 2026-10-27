/**
 * The published BIP-389 vectors: multipath key expressions.
 *
 * spec/vectors/bip389-descriptors.json is an extraction, pinned by hash in
 * parse.spec.yaml. Its source is the "Test Vectors" section of
 * bip-0389.mediawiki at bitcoin/bips 5aadddb511a5dcfe4599531bd8ae5e5b96d0f793,
 * and it was produced by:
 *
 *   node tools/extract-descriptor-vectors.mjs bip-0389.mediawiki <commit>
 *
 * BIP-389 lists, under each valid multipath descriptor, the descriptors it
 * expands into, not scripts. Two valid descriptors, pk() and pkh() with the
 * element as the last step, parse and are checked against every expansion
 * (checkMultipath says how); neither is a kind deriveQuorumAddresses derives,
 * so no published vector derives an address. Three put further steps after
 * the element, which this device refuses by design (INV-DPARSE-3), and one
 * holds an xprv. Every invalid descriptor is refused at parse.
 *
 * WHAT THIS FILE FOUND. BIP-389 requires every tuple in a descriptor to have
 * the same number of values, and nothing checked it: `<0;1>` beside `<0;1;2>`
 * parsed, and derivation took the first two values of each, so a descriptor
 * the BIP lists as invalid derived addresses. Neither published vector for
 * this reached the rule, both being refused first for an element before the
 * last step (and one for its xprv), so each is run again below with that
 * obstacle removed. Both of those variants derived addresses before; they are
 * refused now (INV-DPARSE-11). A repeated value in one tuple, which the BIP
 * also forbids and publishes no vector for, parsed too and is refused now.
 */

import { describe, expect, it } from 'vitest'
import { HDKey } from '@scure/bip32'
import {
  MULTIPATH_BEFORE_LAST_STEP,
  SINGLE_KEY,
  XPRV,
  atParse,
  checkInvalid,
  checkMultipath,
  loadDescriptorVectors,
  parseRefusal,
  type InvalidOutcome,
  type ValidOutcome,
} from './fixtures/descriptor-vectors.js'

const VECTORS = loadDescriptorVectors(389)

/** In the BIP's order. */
const VALID: readonly ValidOutcome[] = [
  SINGLE_KEY, // pk(xpub.../<0;1>)
  XPRV, // pkh(xprv.../<2147483647h;0>/0), whose element is also before the last step
  MULTIPATH_BEFORE_LAST_STEP, // wpkh([ffffffff/13h]xpub.../<1;3>/2/*)
  MULTIPATH_BEFORE_LAST_STEP, // multi(2,xpub.../<1;2>/*,xpub.../<3;4>/0/*)
  SINGLE_KEY, // pkh(xpub.../<0;1;2>), three values
  MULTIPATH_BEFORE_LAST_STEP, // sh(multi(2,xpub.../<1;2;3>/0/*,xpub.../0/*,xpub.../0/0/<3;4;5>/*))
]

const INVALID: readonly InvalidOutcome[] = [
  atParse(/extended PRIVATE key/), // Multiple multipath specifiers, pkh(xprv.../<0;1>/<2;3>)
  atParse(/Key origin path/), // Multipath specifier in origin
  // Mismatched lengths, refused for the element before the last step in
  // pk(xpub.../<1;2;3>/0/*) before the lengths are compared.
  atParse(/read only as the last step/),
  atParse(/extended PRIVATE key/), // Mismatched lengths, sh(multi(2,xprv...))
  atParse(/at least two alternatives/), // Empty multipath specifier
  atParse(/"0>" is not a number/), // Missing multipath start
  atParse(/missing its closing angle bracket/), // Missing multipath end
  atParse(/Multipath element "" is not a number/), // Missing index in multipath specifier
]

/** Each xprv in a descriptor replaced by its own public half. */
function publicHalf(descriptor: string): string {
  return descriptor.replace(
    /xprv[1-9A-HJ-NP-Za-km-z]+/g,
    (xprv) => HDKey.fromExtendedKey(xprv).publicExtendedKey
  )
}

/** The one element both mismatched-length vectors place before the last step, moved to it. */
function elementLast(descriptor: string): string {
  const moved = descriptor.replace('/<1;2;3>/0/*', '/0/<1;2;3>/*')
  expect(moved).not.toBe(descriptor)
  return moved
}

describe('core.descriptor.parse published BIP-389 vectors', () => {
  it('extraction-is-faithful', () => {
    expect(VECTORS.bipsCommit).toBe('5aadddb511a5dcfe4599531bd8ae5e5b96d0f793')
    expect(VECTORS.source).toContain(VECTORS.bipsCommit)
    expect(VECTORS.bip).toBe(389)
    // The counts at the pinned commit. A re-extraction that lost or gained a
    // case changes one of these.
    expect(VECTORS.valid).toHaveLength(6)
    expect(VECTORS.invalid).toHaveLength(8)
    expect(VECTORS.valid.flatMap((c) => c.expansions ?? [])).toHaveLength(14)
    // Expansions, not scripts: a re-extraction that mixed them up shows here.
    for (const c of VECTORS.valid) {
      expect(c.scripts, c.descriptor.slice(0, 40)).toBeUndefined()
      for (const expansion of c.expansions ?? []) expect(expansion).toMatch(/^[a-z]+\(.*\)$/)
    }
    expect(VALID).toHaveLength(VECTORS.valid.length)
    expect(INVALID).toHaveLength(VECTORS.invalid.length)
  })

  /** INV-DPARSE-10. */
  it('handles-every-published-valid-multipath-descriptor', () => {
    for (const [i, c] of VECTORS.valid.entries()) checkMultipath(c, VALID[i])
  })

  /** INV-DPARSE-11. */
  it('refuses-every-published-invalid-multipath-descriptor', () => {
    for (const [i, c] of VECTORS.invalid.entries()) checkInvalid(c, INVALID[i])

    // The three refused before the defect the BIP names is reached, run again
    // with the obstacle removed: the defect alone is refused too. Derived from
    // the vectors, not published by the BIP. Before INV-DPARSE-11 the two
    // mismatched-length variants parsed and derived addresses.
    const variants: [number, (descriptor: string) => string, RegExp][] = [
      [0, publicHalf, /read only as the last step/],
      [2, elementLast, /offer 4 and 3 values/],
      [3, (d) => elementLast(publicHalf(d)), /offer 3 and 2 values/],
    ]
    for (const [index, variant, pattern] of variants) {
      const c = VECTORS.invalid[index]
      if (c === undefined) throw new Error(`invalid vector ${String(index)} is missing`)
      expect(parseRefusal(variant(c.descriptor)), c.description).toMatch(pattern)
    }
  })
})
