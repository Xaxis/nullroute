/**
 * The published BIP-384 descriptor vectors: combo().
 *
 * spec/vectors/bip384-descriptors.json is an extraction, pinned by hash in
 * quorum-addresses.spec.yaml. Its source is the "Test Vectors" section of
 * bip-0384.mediawiki at bitcoin/bips 2490324891d21038365b4d62708f94b26cea7ac0,
 * and it was produced by:
 *
 *   node tools/extract-descriptor-vectors.mjs bip-0384.mediawiki <commit>
 *
 * combo() is a kind this device does not support. It parses, so that a user
 * pasting one is told what it is, and deriveQuorumAddresses refuses it. Its
 * vectors list several scripts for one key rather than one per child index.
 */

import { describe, expect, it } from 'vitest'
import {
  COMBO,
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

const VECTORS = loadDescriptorVectors(384)

/** In the BIP's order. */
const VALID: readonly ValidOutcome[] = [
  WIF, // combo(L4rK...)
  COMBO, // combo(04a3...), two scripts
  COMBO, // combo([01234567]xpub...), four scripts
  XPRV, // combo(xprv.../*), two children of four scripts
]

const INVALID: readonly InvalidOutcome[] = [
  atParse(/combo\(\) cannot go inside sh\(\)/), // sh(combo(...))
  atParse(/combo\(\) cannot go inside wsh\(\)/), // wsh(combo(...))
  atParse(/neither an extended public key nor hex/), // combo(pkh(...))
]

describe('core.descriptor published BIP-384 vectors', () => {
  it('extraction-is-faithful', () => {
    expect(VECTORS.bipsCommit).toBe('2490324891d21038365b4d62708f94b26cea7ac0')
    expect(VECTORS.source).toContain(VECTORS.bipsCommit)
    expect(VECTORS.bip).toBe(384)
    // The counts at the pinned commit. A re-extraction that lost or gained a
    // case changes one of these.
    expect(VECTORS.valid).toHaveLength(4)
    expect(VECTORS.invalid).toHaveLength(3)
    expect(scriptCount(VECTORS)).toBe(18)
    expect(VECTORS.valid.filter((c) => c.children !== undefined)).toHaveLength(1)
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
