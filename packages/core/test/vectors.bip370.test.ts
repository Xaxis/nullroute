/**
 * The published BIP-370 (PSBT version 2) test vectors, and why every one of
 * them is refused.
 *
 * This device reads version 0 only (INV-PSBT-19). @scure/btc-signer reads both
 * versions, so before the refusal existed a version 2 PSBT went to the review
 * screen down a path no test fed: it was accepted, not refused, and nothing
 * here had checked what the screen made of its per-input locktimes or its
 * modifiable flags. The vectors are how the refusal is shown to cover what
 * BIP-370 itself calls a version 2 PSBT, rather than one this repository
 * happened to build.
 *
 * spec/vectors/bip370-psbt.json is an extraction, pinned by hash in
 * parse.spec.yaml. Its source is the "Test Vectors" section of
 * bip-0370.mediawiki at bitcoin/bips 1e431879afd53be71a3bafe29ddae93837337f40,
 * and it was produced by:
 *
 *   node tools/extract-bip370-vectors.mjs bip-0370.mediawiki <commit>
 *
 * Every PSBT goes through parsePsbt twice, as base64 text and as raw bytes,
 * because the device accepts both and a vector one path refused and the other
 * accepted would be a bug where an attacker controls the input.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { base64 } from '@scure/base'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { parsePsbt } from '../src/psbt/parse.js'
import { PsbtError } from '../src/psbt/review.js'

interface Case {
  readonly description: string
  readonly hex: string
  readonly base64: string
}

interface LocktimeCase extends Case {
  /** What the BIP says the locktime computes to, or null where it cannot be. */
  readonly expected: number | null
}

interface Vectors {
  readonly source: string
  readonly bipsCommit: string
  readonly invalid: readonly Case[]
  readonly valid: readonly Case[]
  readonly locktime: readonly LocktimeCase[]
}

const VECTORS = JSON.parse(
  readFileSync(new URL('../../../spec/vectors/bip370-psbt.json', import.meta.url), 'utf8')
) as Vectors

/** The refusal's message, or undefined when the input parsed. */
function refusal(input: string | Uint8Array): string | undefined {
  try {
    parsePsbt(input)
    return undefined
  } catch (err) {
    // Only a PsbtError counts as refusal. Anything else is a crash in the
    // parser, which is a different bug from accepting bad input.
    expect(err).toBeInstanceOf(PsbtError)
    return (err as Error).message
  }
}

describe('core.psbt.parse published BIP-370 vectors', () => {
  it('extraction-is-faithful', () => {
    expect(VECTORS.bipsCommit).toBe('1e431879afd53be71a3bafe29ddae93837337f40')
    expect(VECTORS.source).toContain(VECTORS.bipsCommit)
    // The counts at the pinned commit. A re-extraction that lost or gained a
    // case changes one of these.
    expect(VECTORS.invalid).toHaveLength(24)
    expect(VECTORS.valid).toHaveLength(14)
    expect(VECTORS.locktime).toHaveLength(10)
    expect(VECTORS.locktime.filter((c) => c.expected === null)).toHaveLength(1)
    for (const c of [...VECTORS.invalid, ...VECTORS.valid, ...VECTORS.locktime]) {
      expect(bytesToHex(base64.decode(c.base64)), c.description).toBe(c.hex)
    }
  })

  /**
   * INV-PSBT-19. Every well-formed version 2 PSBT the BIP publishes is refused,
   * and the refusal says which version was found and what to send instead, so
   * the person holding it knows the fix is an export setting rather than a
   * broken transaction.
   *
   * The one locktime case whose locktime the BIP says cannot be computed is
   * refused too, by the library before the version is examined; it is
   * asserted with the rest so that no published version 2 PSBT is left out.
   */
  it('refuses-every-published-version-2-psbt', () => {
    for (const c of [...VECTORS.valid, ...VECTORS.locktime]) {
      for (const [form, input] of [
        ['base64', c.base64],
        ['bytes', hexToBytes(c.hex)],
      ] as const) {
        const message = refusal(input)
        expect(message, `${form}: ${c.description}`).toBeDefined()
        if ('expected' in c && c.expected === null) continue
        expect(message, `${form}: ${c.description}`).toMatch(/version 2 PSBT/)
        expect(message, `${form}: ${c.description}`).toMatch(/version 0/)
      }
    }
  })

  /** INV-PSBT-9. Every PSBT the BIP lists as invalid is refused. */
  it('refuses-every-published-invalid-bip370-psbt', () => {
    for (const c of VECTORS.invalid) {
      expect(refusal(c.base64), `base64: ${c.description}`).toBeDefined()
      expect(refusal(hexToBytes(c.hex)), `bytes: ${c.description}`).toBeDefined()
    }
  })
})
