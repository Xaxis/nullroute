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
  canonicalKeyExpression,
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

  /**
   * INV-DPARSE-3. A key that starts like an extended key has to be one.
   *
   * The prefix list answered "do the first four characters look familiar", and
   * that was the whole test. `xpub` on its own parsed. So did a real key with
   * one extra character, which is the case that matters, because the BIP-380
   * checksum is over the descriptor STRING: every malformed key below has a
   * perfectly valid descriptor checksum of its own, and the parser's error
   * offers it.
   *
   * It mattered twice over. The failure arrived later and somewhere else, from
   * the library asked to derive an address, rather than from the thing that
   * read the descriptor. And `keyPayload`, which makes one key spelled xpub and
   * Zpub compare equal so a quorum cannot list one device twice, compares the
   * bytes under the version: appending a character changes all of them, so the
   * same key with a typo was a second, distinct cosigner and a 2-of-3 that is
   * really a 2-of-2 was accepted.
   */
  it('refuses-a-key-that-only-starts-like-an-extended-key', () => {
    const bad: [string, RegExp][] = [
      // The real key with one more character on the end.
      [`${XPUB}x`, /83 bytes rather than 82/],
      // The prefix and nothing else.
      ['xpub', /rather than 82/],
      // Characters base58 does not contain.
      ['xpubTHISISNOTAKEYATALL', /not valid base58/],
      // Right length and shape, wrong check bytes: one character swapped for
      // another inside the payload, which is what a mistyped key looks like.
      [
        `${XPUB.slice(0, 20)}${XPUB[20] === 'a' ? 'b' : 'a'}${XPUB.slice(21)}`,
        /fails its own checksum/,
      ],
    ]
    for (const [input, pattern] of bad) {
      expect(() => parseKeyExpression(input), input.slice(0, 30)).toThrow(pattern)
    }

    // And the real one still parses, so this is validation rather than a ban.
    expect(parseKeyExpression(`${XPUB}/0/*`).kind).toBe('extended')
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

    const nested = parseDescriptor(`tr(${PUBKEY},{{pk(${PUBKEY}),pk(${PUBKEY})},pk(${PUBKEY})})`, {
      allowBadChecksum: true,
    })
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

  /*
   * INV-DPARSE-8. One key expression, one spelling.
   *
   * BIP-380 allows ' and h and H for a hardened step, and a fingerprint is hex
   * and therefore case-insensitive. This parser has always normalised all of
   * them; what was missing was a way to WRITE the normal form back out, so
   * assembleQuorum emitted keys as the user typed them and the same quorum got
   * a different checksum on each co-signer's device.
   */
  it('writes-one-spelling-for-every-legal-form-of-the-same-key', () => {
    const xpub =
      'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj'
    const canonical = `[73c5da0a/48'/0'/0'/2']${xpub}/<0;1>/*`

    for (const written of [
      canonical,
      `[73C5DA0A/48h/0h/0h/2h]${xpub}/<0;1>/*`,
      `[73c5da0A/48H/0'/0h/2']${xpub}/<0;1>/*`,
      `  ${canonical}  `,
    ]) {
      expect(canonicalKeyExpression(written)).toBe(canonical)
    }
  })

  // The suffix is taken from the text rather than rebuilt, so the shapes that
  // are not a plain multipath have to survive it unchanged.
  it('leaves-a-key-it-cannot-improve-exactly-as-it-was', () => {
    const xpub =
      'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj'
    for (const written of [
      xpub,
      `[73c5da0a]${xpub}`,
      `${xpub}/0/*`,
      `[73c5da0a/48'/0'/0'/2']${xpub}`,
    ]) {
      expect(canonicalKeyExpression(written)).toBe(written)
    }
  })

  /*
   * The round trip is the safety property, not a detail.
   *
   * Rewriting a descriptor is the one place where a normalisation that changed
   * the meaning would be worst: the device would register a quorum deriving
   * different addresses and report a matching checksum for it. So the canonical
   * text is re-parsed and compared, and anything that does not survive throws.
   */
  it('canonicalises-only-what-parses-back-to-the-same-key', () => {
    const xpub =
      'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj'
    const before = parseKeyExpression(`[73C5DA0A/48h/0h/0h/2h]${xpub}/<0;1>/*`)
    const after = parseKeyExpression(
      canonicalKeyExpression(`[73C5DA0A/48h/0h/0h/2h]${xpub}/<0;1>/*`)
    )
    expect(after).toStrictEqual(before)
    expect(() => canonicalKeyExpression('not-a-key')).toThrow()
  })

  /*
   * SLIP-132, including the capitalised prefixes a coordinator actually emits.
   *
   * Ypub, Zpub, Upub and Vpub are the multisig variants: P2WSH-in-P2SH and
   * P2WSH, mainnet and testnet. They were refused with "neither an extended
   * public key nor hex", so a coordinator export for a P2WSH quorum, the
   * commonest kind this device exists for, could not be imported at all and
   * the workaround was hand-editing the descriptor.
   *
   * Two other modules had already assumed they parsed: derive-key.ts reads the
   * version bytes off the key and says so in a comment naming Zpub, and
   * findOwnKey compares the version-stripped payload, so membership was always
   * prefix-agnostic. This gate was the only thing in the way.
   */
  it('accepts-every-slip-132-prefix', () => {
    // Prefix swapping is legitimate here BECAUSE the four version bytes carry
    // no key material, which is the property the parser relies on. The base58
    // checksum is not re-derived, so this asserts the gate rather than the
    // encoding, which is what changed.
    const gate = (prefix: string): boolean => {
      try {
        parseKeyExpression(
          `${prefix}${'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj'.slice(4)}`
        )
        return true
      } catch (err) {
        return !(err as Error).message.includes('neither an extended public key nor hex')
      }
    }
    for (const prefix of [
      'xpub',
      'ypub',
      'zpub',
      'Ypub',
      'Zpub',
      'tpub',
      'upub',
      'vpub',
      'Upub',
      'Vpub',
    ]) {
      expect(gate(prefix), prefix).toBe(true)
    }
    // And still refuses what is neither an extended key nor hex, so widening
    // the list has not turned the gate off.
    expect(gate('wpub')).toBe(false)
    expect(() => parseKeyExpression('not-a-key-at-all')).toThrow(/neither an extended/)
  })
})
