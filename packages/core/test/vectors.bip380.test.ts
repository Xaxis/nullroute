/**
 * The published BIP-380 key expression vectors.
 *
 * spec/vectors/bip380-key-expressions.json is an extraction, pinned by hash in
 * descriptor/parse.spec.yaml. Its source is the key expression part of the
 * "Test Vectors" section of bip-0380.mediawiki at bitcoin/bips
 * 93607da01df07348dcd37ddf62d3cae350436783, and it was produced by:
 *
 *   node tools/extract-bip380-vectors.mjs bip-0380.mediawiki <commit>
 *
 * The checksum vectors from the same section are tested in
 * descriptor.checksum.test.ts.
 *
 * Every published expression is listed below with what this device does with
 * it, in the BIP's order, so a change that moves one fails here. Valid
 * expressions holding a private key, and the two whose wildcard is hardened,
 * are refused by design: this device reads descriptors that describe a wallet,
 * and a public key cannot derive a hardened child.
 *
 * This file found one disagreement. BIP-380 lists `[deadbeef/0H/0H/0H]...` as
 * invalid, since bitcoin/bips 3cc71d7c (July 2025), and the parser accepted it,
 * treating H as a third hardened marker. It is refused now (INV-DPARSE-3).
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { HDKey } from '@scure/bip32'
import {
  DescriptorParseError,
  parseKeyExpression,
  type KeyExpression,
  type KeyOrigin,
} from '../src/descriptor/parse.js'
import { derivePubkeyAt } from '../src/descriptor/derive-key.js'

interface Case {
  readonly description: string
  readonly expression: string
}

interface Vectors {
  readonly source: string
  readonly bipsCommit: string
  readonly valid: readonly Case[]
  readonly invalid: readonly Case[]
}

const VECTORS = JSON.parse(
  readFileSync(
    new URL('../../../spec/vectors/bip380-key-expressions.json', import.meta.url),
    'utf8'
  )
) as Vectors

/** What a parsed key expression has to hold, beyond the key material itself. */
interface Parses {
  readonly origin?: KeyOrigin
  /** The derivation after an extended key, canonical. */
  readonly path?: string
  readonly ranged?: boolean
}

type Outcome = { readonly parses: Parses } | { readonly refused: RegExp; readonly why: string }

const PRIVATE = {
  refused: /extended PRIVATE key/,
  why: 'an extended private key (INV-DPARSE-4)',
} as const
const WIF = {
  refused: /neither an extended public key nor hex/,
  why: 'a WIF private key, which is neither an extended public key nor hex (INV-DPARSE-4)',
} as const
const HARDENED_WILDCARD = {
  refused: /hardened wildcard/,
  why: 'a hardened wildcard, which a public key cannot derive (INV-DPARSE-3)',
} as const

const ORIGIN_000 = { fingerprint: 'deadbeef', path: "m/0'/0'/0'" }
const ORIGIN_012 = { fingerprint: 'deadbeef', path: "m/0'/1'/2'" }

/** In the BIP's order. */
const VALID: readonly Outcome[] = [
  { parses: {} }, // Compressed public key
  { parses: {} }, // Uncompressed public key
  { parses: { origin: ORIGIN_000 } }, // with key origin, h
  { parses: { origin: ORIGIN_000 } }, // with key origin, '
  { parses: { origin: ORIGIN_000 } }, // with key origin, mixed
  WIF, // WIF uncompressed private key
  WIF, // WIF compressed private key
  { parses: { path: '', ranged: false } }, // Extended public key
  { parses: { origin: ORIGIN_012, path: '', ranged: false } }, // with key origin
  { parses: { origin: ORIGIN_012, path: 'm/3/4/5', ranged: false } }, // with derivation
  { parses: { origin: ORIGIN_012, path: 'm/3/4/5', ranged: true } }, // and children
  // Hardened steps after a public key parse, and derivation refuses them;
  // checked separately below.
  { parses: { path: "m/3'/4'/5'", ranged: true } },
  HARDENED_WILDCARD, // xpub.../3h/4h/5h/*h
  HARDENED_WILDCARD, // [deadbeef/0h/1h/2]xpub.../3h/4h/5h/*h
  PRIVATE, // Extended private key, and its six variants
  PRIVATE,
  PRIVATE,
  PRIVATE,
  PRIVATE,
  PRIVATE,
  PRIVATE,
]

/**
 * In the BIP's order, with what refuses each. Three name a defect the device
 * never reaches, because the key in them is an xprv and that is refused first;
 * the same defect on the public half of each key is checked separately below.
 */
const INVALID: readonly RegExp[] = [
  /Key origin path/, // Children indicator in key origin
  /Key origin path/, // Trailing slash in key origin
  /exactly 8 hex/, // Too short fingerprint
  /exactly 8 hex/, // Too long fingerprint
  /Key origin path/, // 0f
  /Key origin path/, // -0
  /marks a hardened step with H/, // 0H, accepted before INV-DPARSE-3 covered it
  /extended PRIVATE key/, // xprv.../3H/4h/5h/*H
  /neither an extended public key nor hex/, // Private key with derivation
  /neither an extended public key nor hex/, // Private key with derivation children
  /extended PRIVATE key/, // xprv.../2147483648
  /extended PRIVATE key/, // xprv.../1aa
  /neither an extended public key nor hex/, // Multiple key origins
  /neither an extended public key nor hex/, // Missing key origin start
  /exactly 8 hex/, // Non hex fingerprint
  /no key follows/, // Key origin with no public key
]

/** parseKeyExpression's refusal, or undefined when it parsed. */
function refusal(expression: string): string | undefined {
  try {
    parseKeyExpression(expression)
    return undefined
  } catch (err) {
    expect(err, expression.slice(0, 40)).toBeInstanceOf(DescriptorParseError)
    return (err as Error).message
  }
}

/** The key as written, without its origin or its derivation. */
function material(expression: string): string {
  const afterOrigin = expression.startsWith('[')
    ? expression.slice(expression.indexOf(']') + 1)
    : expression
  return afterOrigin.split('/')[0] ?? ''
}

function expected(expression: string, parses: Parses): KeyExpression {
  const key = material(expression)
  const origin = parses.origin === undefined ? {} : { origin: parses.origin }
  return key.startsWith('xpub')
    ? {
        kind: 'extended',
        ...origin,
        xpub: key,
        path: parses.path ?? '',
        ranged: parses.ranged ?? false,
      }
    : { kind: 'raw', ...origin, hex: key, byteLength: key.length / 2 }
}

describe('core.descriptor.parse published BIP-380 key expression vectors', () => {
  it('extraction-is-faithful', () => {
    expect(VECTORS.bipsCommit).toBe('93607da01df07348dcd37ddf62d3cae350436783')
    expect(VECTORS.source).toContain(VECTORS.bipsCommit)
    // The counts at the pinned commit. A re-extraction that lost or gained a
    // case changes one of these.
    expect(VECTORS.valid).toHaveLength(21)
    expect(VECTORS.invalid).toHaveLength(16)
    expect(VALID).toHaveLength(VECTORS.valid.length)
    expect(INVALID).toHaveLength(VECTORS.invalid.length)
    // Every extended key the BIP prints is a real one: its own base58check
    // passes, so a character lost in transcription would show here.
    for (const c of [...VECTORS.valid, ...VECTORS.invalid]) {
      const key = material(c.expression)
      if (!/^x(pub|prv)/.test(key)) continue
      expect(() => HDKey.fromExtendedKey(key), c.description).not.toThrow()
    }
  })

  /** INV-DPARSE-1. */
  it('parses-every-published-valid-public-key-expression', () => {
    VECTORS.valid.forEach((c, i) => {
      const outcome = VALID[i]
      if (outcome === undefined || !('parses' in outcome)) return
      expect(parseKeyExpression(c.expression), c.description).toStrictEqual(
        expected(c.expression, outcome.parses)
      )
    })
    expect(VALID.filter((o) => 'parses' in o)).toHaveLength(10)

    // Hardened steps written after a public key parse, as the BIP says they
    // may, and are refused when this device tries to derive through them.
    const hardened = VECTORS.valid[11]
    if (hardened === undefined) throw new Error('vector 11 is missing')
    expect(hardened.description).toBe(
      'Extended public key with hardened derivation and unhardened children'
    )
    expect(() => derivePubkeyAt(parseKeyExpression(hardened.expression), 0, false)).toThrow(
      /hardened step/
    )
  })

  /** INV-DPARSE-3 and INV-DPARSE-4. */
  it('refuses-the-published-forms-it-declines-by-design', () => {
    VECTORS.valid.forEach((c, i) => {
      const outcome = VALID[i]
      if (outcome === undefined || !('refused' in outcome)) return
      expect(refusal(c.expression), `${c.description}: ${outcome.why}`).toMatch(outcome.refused)
    })
    expect(VALID.filter((o) => 'refused' in o)).toHaveLength(11)
  })

  /** INV-DPARSE-3. */
  it('refuses-every-published-invalid-key-expression', () => {
    VECTORS.invalid.forEach((c, i) => {
      const pattern = INVALID[i]
      if (pattern === undefined) throw new Error(`No outcome listed for ${c.description}`)
      expect(refusal(c.expression), c.description).toMatch(pattern)
    })

    // The three whose xprv is refused before their defect is reached, with the
    // xprv replaced by its own public half: the defect alone is refused too.
    // These are derived from the vectors, not published by the BIP.
    for (const [index, pattern] of [
      [7, /marks a hardened step with H/],
      [10, /out of range/],
      [11, /not a number/],
    ] as const) {
      const c = VECTORS.invalid[index]
      if (c === undefined) throw new Error(`invalid vector ${String(index)} is missing`)
      const xprv = material(c.expression)
      const xpub = HDKey.fromExtendedKey(xprv).publicExtendedKey
      expect(refusal(c.expression.replace(xprv, xpub)), c.description).toMatch(pattern)
    }
  })
})
