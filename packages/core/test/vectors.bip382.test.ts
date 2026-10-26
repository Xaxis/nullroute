/**
 * The published BIP-382 descriptor vectors: wpkh() and wsh().
 *
 * spec/vectors/bip382-descriptors.json is an extraction, pinned by hash in
 * quorum-addresses.spec.yaml. Its source is the "Test Vectors" section of
 * bip-0382.mediawiki at bitcoin/bips a31ee298c4a609ba40a67f9ba5abc86d300f4050,
 * and it was produced by:
 *
 *   node tools/extract-descriptor-vectors.mjs bip-0382.mediawiki <commit>
 *
 * Every valid descriptor here holds a single key, which this device parses and
 * derives no address from, or a private key, which it refuses. Six of the
 * invalid ones parse and are refused by deriveQuorumAddresses: the parser does
 * not check where wpkh() and wsh() may appear, nor that the keys under them
 * are compressed. That last rule is enforced where this device does derive
 * from wsh(), in multisigShape (INV-MULTI-14).
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

const VECTORS = loadDescriptorVectors(382)

/** In the BIP's order. */
const VALID: readonly ValidOutcome[] = [
  WIF, // wpkh(L4rK...)
  SINGLE_KEY, // wpkh(03a3...)
  XPRV, // wpkh([ffffffff/13']xprv.../1/2/0)
  SINGLE_KEY, // wpkh([ffffffff/13']xpub.../1/2/*), children 0 to 2
  XPRV, // sh(wpkh(xprv.../10/20/30/40/*'))
  XPRV, // sh(wpkh(xprv.../10/20/30/40/*h))
  WIF, // wsh(pkh(L4rK...))
  SINGLE_KEY, // wsh(pkh(03a3...))
  WIF, // wsh(pk(L4rK...))
  SINGLE_KEY, // wsh(pk(03a3...))
  WIF, // sh(wsh(pkh(L4rK...)))
  SINGLE_KEY, // sh(wsh(pkh(03a3...)))
]

const INVALID: readonly InvalidOutcome[] = [
  // The BIP's defect is the uncompressed key; what stops it here is that a WIF
  // private key is not read at all.
  atParse(/neither an extended public key nor hex/), // wpkh(5KYZ...)
  atParse(/neither an extended public key nor hex/), // sh(wpkh(5KYZ...))
  atEvaluation(/not a multisig one/), // wpkh(04...)
  atEvaluation(/found wpkh/), // sh(wpkh(04...))
  atParse(/neither an extended public key nor hex/), // wsh(pk(5KYZ...))
  atEvaluation(/found pk/), // wsh(pk(04...))
  atEvaluation(/found wpkh/), // wsh(wpkh(...))
  atEvaluation(/found wsh/), // wsh(wsh(pkh(...)))
  atEvaluation(/found wsh/), // sh(wsh(wsh(pkh(...))))
  atParse(/neither an extended public key nor hex/), // wpkh(wsh(pkh(...)))
  atParse(/not a script expression/), // wsh(KEY)
]

describe('core.descriptor published BIP-382 vectors', () => {
  it('extraction-is-faithful', () => {
    expect(VECTORS.bipsCommit).toBe('a31ee298c4a609ba40a67f9ba5abc86d300f4050')
    expect(VECTORS.source).toContain(VECTORS.bipsCommit)
    expect(VECTORS.bip).toBe(382)
    // The counts at the pinned commit. A re-extraction that lost or gained a
    // case changes one of these.
    expect(VECTORS.valid).toHaveLength(12)
    expect(VECTORS.invalid).toHaveLength(11)
    expect(scriptCount(VECTORS)).toBe(18)
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
