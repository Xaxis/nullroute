/**
 * The published BIP-385 descriptor vectors: raw() and addr().
 *
 * spec/vectors/bip385-descriptors.json is an extraction, pinned by hash in
 * quorum-addresses.spec.yaml. Its source is the "Test Vectors" section of
 * bip-0385.mediawiki at bitcoin/bips 4b63b2eb99dc6f40f1793044c7add57367af9381,
 * and it was produced by:
 *
 *   node tools/extract-descriptor-vectors.mjs bip-0385.mediawiki <commit>
 *
 * raw() and addr() name a script or an address with no keys in it, so there is
 * nothing this device could sign for or recognise as its own change. Both
 * parse and deriveQuorumAddresses refuses both. addr(asdf) is refused at parse
 * because asdf decodes as an address on no network (INV-DPARSE-12), and raw()
 * or addr() anywhere but the top level is refused there too.
 */

import { describe, expect, it } from 'vitest'
import {
  ADDRESS,
  RAW_SCRIPT,
  atParse,
  checkInvalid,
  checkValid,
  expectScriptsAreHex,
  loadDescriptorVectors,
  scriptCount,
  type InvalidOutcome,
  type ValidOutcome,
} from './fixtures/descriptor-vectors.js'

const VECTORS = loadDescriptorVectors(385)

/** In the BIP's order. */
const VALID: readonly ValidOutcome[] = [
  RAW_SCRIPT, // raw(deadbeef)
  RAW_SCRIPT, // raw(5121...52ae)
  RAW_SCRIPT, // raw(a914...87)
  ADDRESS, // addr(3PUNyaW7M55oKWJ3kDukwk9bsKvryra15j)
]

const INVALID: readonly InvalidOutcome[] = [
  atParse(/takes exactly one hex script/), // raw(asdf)
  atParse(/does not name a Bitcoin address/), // addr(asdf)
  atParse(/raw\(\) cannot go inside sh\(\)/), // sh(raw(...))
  atParse(/raw\(\) cannot go inside wsh\(\)/), // wsh(raw(...))
  atParse(/addr\(\) cannot go inside sh\(\)/), // sh(addr(...))
  atParse(/addr\(\) cannot go inside wsh\(\)/), // wsh(addr(...))
]

describe('core.descriptor published BIP-385 vectors', () => {
  it('extraction-is-faithful', () => {
    expect(VECTORS.bipsCommit).toBe('4b63b2eb99dc6f40f1793044c7add57367af9381')
    expect(VECTORS.source).toContain(VECTORS.bipsCommit)
    expect(VECTORS.bip).toBe(385)
    // The counts at the pinned commit. A re-extraction that lost or gained a
    // case changes one of these.
    expect(VECTORS.valid).toHaveLength(4)
    expect(VECTORS.invalid).toHaveLength(6)
    expect(scriptCount(VECTORS)).toBe(4)
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
