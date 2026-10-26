/**
 * The published BIP-381 descriptor vectors: pk(), pkh() and sh().
 *
 * spec/vectors/bip381-descriptors.json is an extraction, pinned by hash in
 * quorum-addresses.spec.yaml. Its source is the "Test Vectors" section of
 * bip-0381.mediawiki at bitcoin/bips 66dbdb47101c9db105abffb4e449f9be0f1fd13b,
 * and it was produced by:
 *
 *   node tools/extract-descriptor-vectors.mjs bip-0381.mediawiki <commit>
 *
 * Every valid descriptor here is a single-key one, which this device parses
 * and derives no address from, or one carrying a private key, which it
 * refuses. fixtures/descriptor-vectors.ts says what each outcome checks.
 */

import { describe, expect, it } from 'vitest'
import {
  SINGLE_KEY,
  WIF,
  XPRV,
  atEvaluation,
  atParse,
  checkInvalid,
  checkValid,
  expectScriptsAreHex,
  loadDescriptorVectors,
  scriptCount,
  type InvalidOutcome,
  type ValidOutcome,
} from './fixtures/descriptor-vectors.js'

const VECTORS = loadDescriptorVectors(381)

/** In the BIP's order. */
const VALID: readonly ValidOutcome[] = [
  WIF, // pk(L4rK...)
  SINGLE_KEY, // pk(03a3...)
  WIF, // pkh([deadbeef/1/2'/3/4']L4rK...)
  SINGLE_KEY, // pkh([deadbeef/1/2'/3/4']03a3...)
  SINGLE_KEY, // pkh([deadbeef/1/2h/3/4h]03a3...)
  WIF, // pk(5KYZ...)
  SINGLE_KEY, // pk(04a3...)
  WIF, // pkh(5KYZ...)
  SINGLE_KEY, // pkh(04a3...)
  WIF, // sh(pk(L4rK...))
  SINGLE_KEY, // sh(pk(03a3...))
  WIF, // sh(pkh(L4rK...))
  SINGLE_KEY, // sh(pkh(03a3...))
  XPRV, // pkh(xprv.../2147483647'/0)
  SINGLE_KEY, // pkh([bd16bee5/2147483647h]xpub.../0)
  XPRV, // pk(xprv.../0)
  SINGLE_KEY, // pk(xpub.../0)
]

const INVALID: readonly InvalidOutcome[] = [
  atParse(/neither an extended public key nor hex/), // pk(pk(...))
  atParse(/neither an extended public key nor hex/), // pkh(pk(...))
  atParse(/not a script expression/), // sh(KEY)
  atEvaluation(/found sh/), // sh(sh(pkh(...)))
]

describe('core.descriptor published BIP-381 vectors', () => {
  it('extraction-is-faithful', () => {
    expect(VECTORS.bipsCommit).toBe('66dbdb47101c9db105abffb4e449f9be0f1fd13b')
    expect(VECTORS.source).toContain(VECTORS.bipsCommit)
    expect(VECTORS.bip).toBe(381)
    // The counts at the pinned commit. A re-extraction that lost or gained a
    // case changes one of these.
    expect(VECTORS.valid).toHaveLength(17)
    expect(VECTORS.invalid).toHaveLength(4)
    expect(scriptCount(VECTORS)).toBe(17)
    expectScriptsAreHex(VECTORS)
    expect(VALID).toHaveLength(VECTORS.valid.length)
    expect(INVALID).toHaveLength(VECTORS.invalid.length)
  })

  /** INV-DESC-9. */
  it('handles-every-published-valid-descriptor', () => {
    for (const [i, c] of VECTORS.valid.entries()) checkValid(c, VALID[i])
  })

  /** INV-DESC-10. */
  it('refuses-every-published-invalid-descriptor', () => {
    for (const [i, c] of VECTORS.invalid.entries()) checkInvalid(c, INVALID[i])
  })
})
