/**
 * The published BIP-386 descriptor vectors: tr().
 *
 * spec/vectors/bip386-descriptors.json is an extraction, pinned by hash in
 * quorum-addresses.spec.yaml. Its source is the "Test Vectors" section of
 * bip-0386.mediawiki at bitcoin/bips 9d735fb36fdd6a5860febe7e84680aa220baad23,
 * and it was produced by:
 *
 *   node tools/extract-descriptor-vectors.mjs bip-0386.mediawiki <commit>
 *
 * Two valid descriptors carry no private key, tr(KEY) and tr(KEY,pk(KEY)), and
 * both have to derive the published script exactly. The other four carry a
 * private key and are refused; the last of them is printed with no script, and
 * the extraction keeps it that way.
 *
 * tr() over an uncompressed key is the case this file found. The parser
 * accepts a 65-byte key and deriveTaprootAddresses took its x coordinate, so
 * the published invalid descriptor derived an address. It is refused now
 * (INV-TR-7).
 */

import { describe, expect, it } from 'vitest'
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

const VECTORS = loadDescriptorVectors(386)

/** In the BIP's order. */
const VALID: readonly ValidOutcome[] = [
  DERIVED, // tr(a34b...)
  WIF, // tr(L4rK...)
  XPRV, // tr(xprv.../0/*,pk(xprv.../1/*))
  DERIVED, // tr(a34b...,pk(669b...))
  XPRV, // tr(a34b...,{pk(xprv.../0),{{pk(xpub...),pk(02df...)},pk(L4rK...)}})
  WIF, // tr(a34b...,pkh(L4rK...)), printed with no script
]

const INVALID: readonly InvalidOutcome[] = [
  atParse(/neither an extended public key nor hex/), // tr(5KYZ...)
  atParse(/uncompressed key cannot go under tr\(\)/), // tr(04a3...)
  atParse(/tr\(\) cannot go inside wsh\(\)/), // wsh(tr(...))
  atParse(/tr\(\) cannot go inside sh\(\)/), // sh(tr(...))
]

describe('core.descriptor published BIP-386 vectors', () => {
  it('extraction-is-faithful', () => {
    expect(VECTORS.bipsCommit).toBe('9d735fb36fdd6a5860febe7e84680aa220baad23')
    expect(VECTORS.source).toContain(VECTORS.bipsCommit)
    expect(VECTORS.bip).toBe(386)
    // The counts at the pinned commit. A re-extraction that lost or gained a
    // case changes one of these.
    expect(VECTORS.valid).toHaveLength(6)
    expect(VECTORS.invalid).toHaveLength(4)
    expect(scriptCount(VECTORS)).toBe(7)
    expect(VECTORS.valid.filter((c) => c.scripts?.length === 0)).toHaveLength(1)
    expectScriptsAreHex(VECTORS)
    expect(VALID).toHaveLength(VECTORS.valid.length)
    expect(INVALID).toHaveLength(VECTORS.invalid.length)
  })

  /** INV-DESC-9. */
  it('handles-every-published-valid-descriptor', () => {
    for (const [i, c] of VECTORS.valid.entries()) checkValid(c, VALID[i])
  })

  /** INV-DESC-10 and INV-TR-7. */
  it('refuses-every-published-invalid-descriptor', () => {
    for (const [i, c] of VECTORS.invalid.entries()) checkInvalid(c, INVALID[i])
  })
})
