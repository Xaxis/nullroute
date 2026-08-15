/**
 * Tests for core.descriptor.parse, using the key expression cases BIP-380
 * publishes plus the refusals that make the parser trustworthy.
 *
 * The refusal tests carry most of the weight here. A descriptor decides which
 * scripts belong to the wallet, so a parser that accepts something it did not
 * fully understand eventually labels an attacker's output as change.
 */

import { describe, expect, it } from 'vitest'
import {
  parseDescriptor,
  parseKeyExpression,
  descriptorKeys,
} from '../src/descriptor/parse.js'
import { withChecksum } from '../src/descriptor/checksum.js'

const XPUB =
  'xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL'
const PUBKEY = '0260b2003c386519fc9eadf2b5cf124dd8eea4c4e68d5e154050a9346ea98ce6006'.slice(0, 66)

describe('core.descriptor.parse key expressions', () => {
  // INV-DPARSE-1: the key expression forms BIP-380 lists as valid.
  it('accepts-bip380-key-expressions', () => {
    const cases = [
      PUBKEY,
      `[deadbeef/0h/0h/0h]${PUBKEY}`,
      `[deadbeef/0'/0'/0']${PUBKEY}`,
      // Mixed notation in one origin, which the BIP explicitly permits.
      `[deadbeef/0'/0h/0']${PUBKEY}`,
      XPUB,
      `[deadbeef/0h/1h/2h]${XPUB}`,
      `[deadbeef/0h/1h/2h]${XPUB}/3/4/5`,
      `[deadbeef/0h/1h/2h]${XPUB}/3/4/5/*`,
      `${XPUB}/3h/4h/5h/*`,
    ]
    for (const input of cases) {
      expect(() => parseKeyExpression(input), input.slice(0, 40)).not.toThrow()
    }
  })

  // INV-DPARSE-2: both hardened notations normalise, so a descriptor from
  // Bitcoin Core (which writes h) parses identically to one from BIP-32.
  it('normalizes-hardened-notation-in-origins', () => {
    const a = parseKeyExpression(`[deadbeef/44h/0h/0h]${XPUB}`)
    const b = parseKeyExpression(`[deadbeef/44'/0'/0']${XPUB}`)
    expect(a.origin?.path).toBe("m/44'/0'/0'")
    expect(a.origin?.path).toBe(b.origin?.path)
    expect(a.origin?.fingerprint).toBe('deadbeef')
  })

  it('records-range-and-multipath', () => {
    const ranged = parseKeyExpression(`${XPUB}/0/*`)
    expect(ranged.kind).toBe('extended')
    if (ranged.kind === 'extended') {
      expect(ranged.ranged).toBe(true)
      expect(ranged.path).toBe('m/0')
    }

    // BIP-389: one descriptor denoting receive and change together.
    const multi = parseKeyExpression(`${XPUB}/<0;1>/*`)
    if (multi.kind === 'extended') {
      expect(multi.multipath).toEqual([0, 1])
      expect(multi.ranged).toBe(true)
    }
  })

  // INV-DPARSE-3: refusals. Each of these is something a lenient parser would
  // wave through, and each would mean deriving scripts nobody enumerated.
  it('refuses-what-it-does-not-understand', () => {
    const bad: [string, RegExp][] = [
      ['', /Empty key expression/],
      [`[deadbee/0h]${XPUB}`, /exactly 8 hex/],
      [`[deadbeefff/0h]${XPUB}`, /exactly 8 hex/],
      [`[deadbeef/0h${XPUB}`, /closing bracket/],
      ['[deadbeef/0h]', /no key follows/],
      ['notakey', /neither an extended public key nor hex/],
      // A 31-byte key is not a valid length for any script type.
      ['ab'.repeat(31), /must be 32 bytes/],
      // A hardened wildcard cannot be derived from a public key at all.
      [`${XPUB}/0/*h`, /hardened wildcard/],
      [`${XPUB}/<0>/*`, /at least two alternatives/],
      [`${XPUB}/<0;1/*`, /closing angle bracket/],
    ]
    for (const [input, pattern] of bad) {
      expect(() => parseKeyExpression(input), input.slice(0, 40)).toThrow(pattern)
    }
  })

  // INV-DPARSE-4: a descriptor is not a place for private key material.
  it('refuses-extended-private-keys', () => {
    const xprv =
      'xprv9s21ZrQH143K3GJpoapnV8SFfukcVBSfeCficPSGfubmSFDxo1kuHnLisriDvSnRRuL2Qrg5ggqHKNVpxR86QEC8w35uxmGoggxtQTPvfUu'
    expect(() => parseKeyExpression(xprv)).toThrow(/extended PRIVATE key/)
  })
})

describe('core.descriptor.parse script expressions', () => {
  it('parses-the-single-sig-forms', () => {
    for (const [input, kind] of [
      [`pkh(${PUBKEY})`, 'pkh'],
      [`wpkh(${XPUB}/0/*)`, 'wpkh'],
      [`pk(${PUBKEY})`, 'pk'],
      [`tr(${XPUB}/0/*)`, 'tr'],
    ] as const) {
      const d = parseDescriptor(withChecksum(input))
      expect(d.script.kind, input.slice(0, 20)).toBe(kind)
    }
  })

  it('parses-nested-scripts', () => {
    const d = parseDescriptor(withChecksum(`sh(wpkh(${XPUB}/0/*))`))
    expect(d.script.kind).toBe('sh')
    if (d.script.kind === 'sh') expect(d.script.inner.kind).toBe('wpkh')
    expect(d.ranged).toBe(true)
  })

  it('parses-multisig-into-the-tree', () => {
    // Not evaluable until phase 3, but the AST carries it so that phase extends
    // the evaluator rather than reshaping the parse.
    const d = parseDescriptor(withChecksum(`wsh(sortedmulti(2,${XPUB}/0/*,${PUBKEY}))`))
    expect(d.script.kind).toBe('wsh')
    if (d.script.kind === 'wsh' && d.script.inner.kind === 'sortedmulti') {
      expect(d.script.inner.threshold).toBe(2)
      expect(d.script.inner.keys).toHaveLength(2)
    }
    expect(descriptorKeys(d.script)).toHaveLength(2)
  })

  // INV-DPARSE-5: the checksum is enforced at the parse boundary, not left to
  // a caller who might forget.
  it('enforces-the-checksum', () => {
    const body = `wpkh(${XPUB}/0/*)`
    expect(() => parseDescriptor(body)).toThrow(/no checksum/)
    expect(() => parseDescriptor(`${body}#00000000`)).toThrow(/should be/)
    expect(() => parseDescriptor(withChecksum(body))).not.toThrow()
    // The escape hatch exists but must be asked for explicitly.
    expect(() => parseDescriptor(body, { allowBadChecksum: true })).not.toThrow()
  })

  // Script trees ARE supported now. Their derivation lives in
  // core.descriptor.taproot; this only asserts the parser keeps the shape.
  it('parses-a-taproot-script-tree', () => {
    const one = parseDescriptor(`tr(${PUBKEY},pk(${PUBKEY}))`, { allowBadChecksum: true })
    expect(one.script.kind).toBe('tr')

    const nested = parseDescriptor(
      `tr(${PUBKEY},{{pk(${PUBKEY}),pk(${PUBKEY})},pk(${PUBKEY})})`,
      { allowBadChecksum: true }
    )
    expect(nested.script.kind).toBe('tr')
    if (nested.script.kind !== 'tr' || nested.script.tree === undefined) {
      throw new Error('expected a script tree')
    }
    // Shape preserved: a branch on the left, a leaf on the right.
    expect(Array.isArray(nested.script.tree)).toBe(true)
  })

  it('refuses-malformed-or-unknown-scripts', () => {
    const bad: [string, RegExp][] = [
      ['wpkh', /not a script expression/],
      ['wpkh(', /not a script expression/],
      [`frobnicate(${PUBKEY})`, /Unknown descriptor function/],
      [`wpkh(${PUBKEY},${PUBKEY})`, /exactly one key/],
      [`sh(${PUBKEY},${PUBKEY})`, /exactly one inner script/],
      [`multi(0,${PUBKEY})`, /out of range/],
      [`multi(2,${PUBKEY})`, /out of range/],
      [`multi(${PUBKEY})`, /needs a threshold/],
      // A taproot branch is binary. `{A}` and `{A,B,C}` have no defined
      // merkle commitment, so they are refused rather than re-associated into
      // a shape the writer did not choose.
      [`tr(${PUBKEY},{pk(${PUBKEY})})`, /exactly two subtrees/],
      [`tr(${PUBKEY},{pk(${PUBKEY}),pk(${PUBKEY}),pk(${PUBKEY})})`, /exactly two subtrees/],
      [`tr(${PUBKEY},pk(${PUBKEY}),pk(${PUBKEY}))`, /internal key and an optional script tree/],
    ]
    for (const [input, pattern] of bad) {
      expect(() => parseDescriptor(input, { allowBadChecksum: true }), input.slice(0, 30)).toThrow(
        pattern
      )
    }
  })

  it('splits-arguments-at-the-top-level-only', () => {
    // A naive comma split would see three arguments here and mis-parse.
    const d = parseDescriptor(withChecksum(`sh(wsh(multi(2,${PUBKEY},${PUBKEY})))`))
    expect(d.script.kind).toBe('sh')
    expect(descriptorKeys(d.script)).toHaveLength(2)
  })
})
