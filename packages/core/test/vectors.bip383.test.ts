/**
 * The published BIP-383 descriptor vectors: multi() and sortedmulti().
 *
 * spec/vectors/bip383-descriptors.json is an extraction, pinned by hash in
 * quorum-addresses.spec.yaml. Its source is the "Test Vectors" section of
 * bip-0383.mediawiki at bitcoin/bips 803c984919da30c575942e06b102690903ba01c5,
 * and it was produced by:
 *
 *   node tools/extract-descriptor-vectors.mjs bip-0383.mediawiki <commit>
 *
 * One valid descriptor is a shape this device derives, sh(wsh(multi())) over
 * sixteen keys, and it has to produce the published script exactly. Bare
 * multi() at the top level is parsed and not derived. The rest carry private
 * keys, including both twenty-key vectors, so the twenty-key case is never
 * reached here; this device's own key limit is sixteen (INV-MULTI-12).
 */

import { describe, expect, it } from 'vitest'
import {
  BARE_MULTI,
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

const VECTORS = loadDescriptorVectors(383)

/** In the BIP's order. */
const VALID: readonly ValidOutcome[] = [
  WIF, // multi(1,L4rK...,5KYZ...)
  BARE_MULTI, // multi(1,03a3...,04a3...)
  BARE_MULTI, // sortedmulti(1,04a3...,03a3...)
  XPRV, // sh(multi(2,[00000000/111'/222]xprv...,xprv.../0))
  BARE_MULTI, // sortedmulti(2,xpub.../*,xpub.../0/0/*), children 0 to 2
  XPRV, // wsh(multi(2,xprv.../2147483647'/0,xprv.../1/2/*,xprv.../10/20/30/40/*'))
  DERIVED, // sh(wsh(multi(16,...)))
  WIF, // wsh(multi(20,KzoA...,...))
  WIF, // sh(wsh(multi(20,KzoA...,...)))
]

const INVALID: readonly InvalidOutcome[] = [
  atParse(/will not fit in a bare P2SH redeem script/), // sh(multi(16,...))
  atParse(/is not a number/), // multi(a,...)
  atParse(/out of range/), // multi(0,...)
  // The BIP's defect is the threshold; the keys are read first, and a WIF
  // private key is not read at all.
  atParse(/neither an extended public key nor hex/), // multi(3,L4rK...,5KYZ...)
]

describe('core.descriptor published BIP-383 vectors', () => {
  it('extraction-is-faithful', () => {
    expect(VECTORS.bipsCommit).toBe('803c984919da30c575942e06b102690903ba01c5')
    expect(VECTORS.source).toContain(VECTORS.bipsCommit)
    expect(VECTORS.bip).toBe(383)
    // The counts at the pinned commit. A re-extraction that lost or gained a
    // case changes one of these.
    expect(VECTORS.valid).toHaveLength(9)
    expect(VECTORS.invalid).toHaveLength(4)
    expect(scriptCount(VECTORS)).toBe(13)
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
