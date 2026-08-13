/**
 * Tests for core.descriptor.checksum, against BIP-380's own test vectors.
 *
 * A note on how these vectors were obtained, because it matters. The first
 * version of this file asserted three checksums transcribed from a summary
 * rather than from the BIP. Two of the three were wrong, and the failure looked
 * exactly like an implementation bug: the code produced consistent, plausible
 * checksums that did not match the file. Running BIP-380's own reference
 * implementation against both is what settled it, and the vectors here are now
 * copied verbatim from the BIP's Test Vectors section.
 *
 * That is the argument for pinning vector files by hash in the spec, rather
 * than the argument for trusting one's memory of a BIP.
 */

import { describe, expect, it } from 'vitest'
import { fc, test } from '@fast-check/vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DescriptorChecksumError,
  descriptorChecksum,
  stripChecksum,
  verifyChecksum,
  withChecksum,
} from '../src/descriptor/checksum.js'

const REPO_ROOT = new URL('../../../', import.meta.url).pathname
const VECTORS = JSON.parse(
  readFileSync(join(REPO_ROOT, 'spec/vectors/bip380-checksum.json'), 'utf8')
) as {
  validChecksum: { descriptor: string; checksum: string }[]
  rejected: { case: string; why: string }[]
  invalidCharacter: { case: string; why: string }[]
}

describe('core.descriptor.checksum', () => {
  // INV-DESC-1
  it('matches-official-vectors', () => {
    for (const { descriptor, checksum } of VECTORS.validChecksum) {
      expect(descriptorChecksum(descriptor), descriptor).toBe(checksum)
      expect(verifyChecksum(`${descriptor}#${checksum}`).valid).toBe(true)
    }
  })

  // INV-DESC-2: every rejection case the BIP lists. A wrong-length checksum is
  // a distinct failure from a wrong value, and both must be refused.
  it('rejects-every-invalid-case', () => {
    for (const { case: input, why } of VECTORS.rejected) {
      expect(verifyChecksum(input).valid, `${input} (${why})`).toBe(false)
    }
  })

  it('rejects-characters-outside-the-charset', () => {
    for (const { case: input } of VECTORS.invalidCharacter) {
      expect(() => descriptorChecksum(stripChecksum(input))).toThrow(DescriptorChecksumError)
    }
    for (const character of ['\n', '\t', 'é', '€']) {
      expect(() => descriptorChecksum(`raw(${character})`)).toThrow(/not permitted/)
    }
  })

  // INV-DESC-3: the reason the checksum exists. A descriptor is transcribed by
  // hand, and without this a single wrong character produces a valid descriptor
  // for a DIFFERENT wallet, which sends funds somewhere unrecoverable.
  it('detects-single-character-corruption', () => {
    const body =
      "wpkh([d34db33f/44'/0'/0']xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/1/*)"
    const checksum = descriptorChecksum(body)
    expect(verifyChecksum(`${body}#${checksum}`).valid).toBe(true)

    let undetected = 0
    let tested = 0
    for (let i = 0; i < body.length; i += 1) {
      const original = body[i]
      if (original === undefined) continue
      const replacement = original === 'a' ? 'b' : 'a'
      const corrupted = body.slice(0, i) + replacement + body.slice(i + 1)
      tested += 1
      if (verifyChecksum(`${corrupted}#${checksum}`).valid) undetected += 1
    }

    expect(tested).toBeGreaterThan(100)
    expect(undetected).toBe(0)
  })

  // INV-DESC-4: a descriptor with no checksum is not valid. The checksum is the
  // only defence against transcription, and accepting one without discards it.
  it('treats-a-missing-checksum-as-invalid', () => {
    const verdict = verifyChecksum('raw(deadbeef)')
    expect(verdict.valid).toBe(false)
    expect(verdict.provided).toBeUndefined()
    // The caller can still see what it should be, so accepting one anyway is a
    // visible decision rather than a default.
    expect(verdict.expected).toBe('89f8spxm')
  })

  it('appends-and-replaces-a-checksum', () => {
    expect(withChecksum('raw(deadbeef)')).toBe('raw(deadbeef)#89f8spxm')
    expect(withChecksum('raw(deadbeef)#00000000')).toBe('raw(deadbeef)#89f8spxm')
  })

  // INV-DESC-5
  test.prop([fc.stringMatching(/^[0-9a-f]{2,40}$/)])('round-trips', (hex) => {
    expect(verifyChecksum(withChecksum(`raw(${hex})`)).valid).toBe(true)
  })
})
