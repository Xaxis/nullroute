/**
 * Tests for core.qr.ur, against Blockchain Commons' own vectors.
 *
 * Every expected value comes from spec/vectors/ur-bcr.json, copied from bc-ur's
 * test suite and the BCR papers at pinned commits (research/ur-notes.md). Nothing
 * here is computed by this code and then expected back from it, except the
 * round trips, which are labelled as such. BCR-2020-005 says a compliant codec
 * MUST pass the reference implementation's unit tests; these are those tests.
 */

import { readFileSync } from 'node:fs'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { describe, expect, it } from 'vitest'
import {
  FountainDecoder,
  FountainEncoder,
  RandomSampler,
  Xoshiro256,
  chooseDegree,
  chooseFragments,
  crc32,
  findNominalFragmentLength,
  partitionMessage,
  shuffled,
  uint32BE,
} from '../src/qr/ur-fountain.js'
import {
  BYTEWORDS,
  PSBT_UR_TYPE,
  UrDecoder,
  UrEncoder,
  UrError,
  bytewordsDecode,
  bytewordsEncode,
  cborBytes,
  cborBytesDecode,
  decodePart,
  encodePart,
  parseUr,
  psbtFromUr,
  urFramesForPsbt,
  type BytewordsStyle,
} from '../src/qr/ur.js'
import { QR_ALPHANUMERIC } from '../src/qr/encode.js'
import { parsePsbt } from '../src/psbt/parse.js'

interface Vectors {
  crc32: { input_utf8?: string; input_hex?: string; crc32_hex: string }[]
  bytewords: {
    input_hex: string
    standard?: string
    uri?: string
    minimal?: string
  }[]
  bytewords_invalid: { style: BytewordsStyle; input: string }[]
  xoshiro: {
    seed_utf8?: string
    seed_crc32_of_utf8?: string
    outputs_mod_100?: number[]
    next_int_1_10?: number[]
  }[]
  make_message: { cases: { len: number; stream_offset?: number; output_hex: string }[] }
  find_nominal_fragment_length: {
    message_len: number
    min_fragment_len: number
    max_fragment_len: number
    expected: number
  }[]
  random_sampler: { probs: number[]; count: number; samples: number[]; totals_by_value: number[] }[]
  shuffle: { values: number[]; results: number[][] }[]
  choose_degree: { degrees: number[]; totals_by_degree?: number[] }[]
  choose_fragments: { sorted_indexes: number[][] }[]
  partition_message: { fragments_hex: string[] }[]
  xor: { a_hex: string; b_hex: string; a_xor_b_hex: string }[]
  fountain_encoder: { parts_cbor_hex?: string[]; parts_description?: string[] }[]
  fountain_part_cbor: {
    seq_num: number
    seq_len: number
    message_len: number
    checksum: string
    data_hex: string
    cbor_hex: string
  }[]
  ur_single_part: { type: string; cbor_hex: string | null; ur: string }[]
  ur_multipart: { parts: string[] }[]
}

const V = JSON.parse(
  readFileSync(new URL('../../../spec/vectors/ur-bcr.json', import.meta.url), 'utf8')
) as Vectors

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)

/** bc-ur's make_message: Xoshiro256("Wolf").next_data(len) (test.cpp helpers). */
function makeMessage(len: number, seed = 'Wolf'): Uint8Array {
  return Xoshiro256.fromString(seed).nextData(len)
}

/** bc-ur's make_message_ur: the message as a CBOR byte string. */
function makeMessageUr(len: number): Uint8Array {
  return cborBytes(makeMessage(len))
}

describe('core.qr.ur primitives', () => {
  /** INV-UR-1. CRC-32 and the SHA-256-seeded generator agree with bc-ur. */
  it('matches-the-reference-crc32', () => {
    for (const c of V.crc32) {
      const input = c.input_hex !== undefined ? hexToBytes(c.input_hex) : utf8(c.input_utf8 ?? '')
      expect(crc32(input).toString(16).padStart(8, '0')).toBe(c.crc32_hex)
    }
  })

  it('matches-the-reference-xoshiro256', () => {
    for (const c of V.xoshiro) {
      const rng =
        c.seed_crc32_of_utf8 !== undefined
          ? new Xoshiro256(uint32BE(crc32(utf8(c.seed_crc32_of_utf8))))
          : Xoshiro256.fromString(c.seed_utf8 ?? '')
      if (c.outputs_mod_100 !== undefined) {
        expect(c.outputs_mod_100.map(() => Number(rng.next() % 100n))).toEqual(c.outputs_mod_100)
      } else {
        expect(c.next_int_1_10?.map(() => rng.nextInt(1, 10))).toEqual(c.next_int_1_10)
      }
    }
  })

  it('makes-the-reference-messages', () => {
    const rng = Xoshiro256.fromString('Wolf')
    for (const c of V.make_message.cases) {
      if (c.stream_offset === undefined) {
        expect(bytesToHex(makeMessage(c.len))).toBe(c.output_hex)
      }
    }
    // The second case continues the same stream past its first ten bytes.
    rng.nextData(10)
    const offset = V.make_message.cases.find((c) => c.stream_offset === 10)
    expect(bytesToHex(rng.nextData(10))).toBe(offset?.output_hex)
  })

  it('samples-shuffles-and-chooses-like-the-reference', () => {
    const s = V.random_sampler[0]
    if (s === undefined) throw new Error('vector missing')
    const sampler = new RandomSampler(s.probs)
    const rng = Xoshiro256.fromString('Wolf')
    const samples = Array.from({ length: s.count }, () => sampler.next(rng))
    expect(samples).toEqual(s.samples)
    expect(s.probs.map((_, i) => samples.filter((x) => x === i).length)).toEqual(s.totals_by_value)

    const [full, prefixes] = V.shuffle
    const shared = Xoshiro256.fromString('Wolf')
    expect(full?.results.map(() => shuffled(full.values, shared))).toEqual(full?.results)
    for (const row of prefixes?.results ?? []) {
      const fresh = Xoshiro256.fromString('Wolf')
      expect(shuffled(prefixes?.values ?? [], fresh).slice(0, row.length)).toEqual(row)
    }

    const message = makeMessage(1024)
    const seqLen = partitionMessage(message, findNominalFragmentLength(1024, 10, 100)).length
    expect(seqLen).toBe(11)
    const [perNonce, oneStream] = V.choose_degree
    expect(
      perNonce?.degrees.map((_, i) =>
        chooseDegree(seqLen, Xoshiro256.fromString(`Wolf-${String(i + 1)}`))
      )
    ).toEqual(perNonce?.degrees)
    const stream = Xoshiro256.fromString('Wolf')
    expect(oneStream?.degrees.map(() => chooseDegree(seqLen, stream))).toEqual(oneStream?.degrees)

    const checksum = crc32(message)
    for (const c of V.choose_fragments) {
      const got = c.sorted_indexes.map((_, i) =>
        chooseFragments(i + 1, seqLen, checksum).sort((a, b) => a - b)
      )
      expect(got).toEqual(c.sorted_indexes)
    }
  })

  it('partitions-and-xors-like-the-reference', () => {
    for (const c of V.find_nominal_fragment_length) {
      expect(findNominalFragmentLength(c.message_len, c.min_fragment_len, c.max_fragment_len)).toBe(
        c.expected
      )
    }
    const message = makeMessage(1024)
    const fragments = partitionMessage(message, findNominalFragmentLength(1024, 10, 100))
    expect(fragments.map(bytesToHex)).toEqual(V.partition_message[0]?.fragments_hex)

    const x = V.xor[0]
    if (x === undefined) throw new Error('vector missing')
    const a = hexToBytes(x.a_hex)
    const b = hexToBytes(x.b_hex)
    expect(bytesToHex(a.map((byte, i) => byte ^ (b[i] ?? 0)))).toBe(x.a_xor_b_hex)
  })
})

describe('core.qr.ur bytewords', () => {
  /** INV-UR-2. The word table is bc-ur's, byte for byte. */
  it('carries-the-reference-word-table', () => {
    expect(BYTEWORDS).toHaveLength(1024)
    expect(bytesToHex(sha256(utf8(BYTEWORDS)))).toBe(
      '99d1914e98bb41ed9c89d6bcd67c63d7d9370bd75ce3e44767cee450b9c79c53'
    )
  })

  /** INV-UR-2. Every style encodes as the reference does and decodes back. */
  it('encodes-and-decodes-every-style', () => {
    for (const c of V.bytewords) {
      const data = hexToBytes(c.input_hex)
      // Not every source lists every style for every input; each listed one is checked.
      for (const style of ['standard', 'uri', 'minimal'] as const) {
        const text = c[style]
        if (text === undefined) continue
        expect(bytewordsEncode(data, style)).toBe(text)
        expect(bytesToHex(bytewordsDecode(text, style))).toBe(c.input_hex)
        expect(bytesToHex(bytewordsDecode(text.toUpperCase(), style))).toBe(c.input_hex)
      }
      expect(c.standard ?? c.minimal, 'every entry lists at least one style').toBeDefined()
    }
  })

  /** INV-UR-2. A bad checksum, a short input and a non-word are refused. */
  it('refuses-what-the-reference-refuses', () => {
    for (const c of V.bytewords_invalid) {
      expect(() => bytewordsDecode(c.input, c.style), c.input).toThrow(UrError)
    }
    // Shares its ends with "able" but is not the word.
    expect(() =>
      bytewordsDecode('axxe acid also lava zoom jade need echo taxi', 'standard')
    ).toThrow(/not a Byteword/)
  })
})

describe('core.qr.ur encoding', () => {
  /** INV-UR-3. The fountain encoder's first twenty parts, CBOR for CBOR. */
  it('encodes-the-reference-fountain-parts', () => {
    const expected = V.fountain_encoder[0]?.parts_cbor_hex ?? []
    expect(expected).toHaveLength(20)
    const encoder = new FountainEncoder(makeMessage(256), 30)
    const parts = expected.map(() => bytesToHex(encodePart(encoder.nextPart())))
    expect(parts).toEqual(expected)
  })

  /** INV-UR-3. The paper's part, both ways, and the reader's strictness. */
  it('reads-and-writes-the-part-array-strictly', () => {
    const p = V.fountain_part_cbor[0]
    if (p === undefined) throw new Error('vector missing')
    const part = {
      seqNum: p.seq_num,
      seqLen: p.seq_len,
      messageLen: p.message_len,
      checksum: Number(p.checksum),
      data: hexToBytes(p.data_hex),
    }
    expect(bytesToHex(encodePart(part))).toBe(p.cbor_hex)
    const read = decodePart(hexToBytes(p.cbor_hex))
    expect({ ...read, data: bytesToHex(read.data) }).toEqual({ ...part, data: p.data_hex })

    // 12 written in two bytes rather than one: not minimal, so not dCBOR.
    expect(() => decodePart(hexToBytes('85180c0818641a12345678450105030305'))).toThrow(/minimal/)
    expect(() => decodePart(hexToBytes(`${p.cbor_hex}00`))).toThrow(/Trailing/)
    expect(() => cborBytesDecode(hexToBytes('4401020304ff'))).toThrow(/Trailing/)
  })

  /** INV-UR-3. Single-part URs from bc-ur and both papers. */
  it('encodes-and-decodes-the-reference-single-part-urs', () => {
    for (const c of V.ur_single_part) {
      const cbor = c.cbor_hex === null ? makeMessageUr(50) : hexToBytes(c.cbor_hex)
      const encoder = new UrEncoder(c.type, cbor, 1_000_000)
      expect(encoder.singlePart).toBe(true)
      expect(encoder.nextPart()).toBe(c.ur)

      const decoder = new UrDecoder()
      decoder.receive(c.ur.toUpperCase())
      expect(decoder.complete).toBe(true)
      expect(bytesToHex(decoder.result().cbor)).toBe(bytesToHex(cbor))
      expect(decoder.result().type).toBe(c.type)
    }
  })

  /** INV-UR-3. The multipart UR strings, and the first twenty of them decoding. */
  it('encodes-the-reference-multipart-ur', () => {
    const expected = V.ur_multipart[0]?.parts ?? []
    expect(expected.length).toBeGreaterThan(9)
    const encoder = new UrEncoder('bytes', makeMessageUr(256), 30)
    expect(expected.map(() => encoder.nextPart())).toEqual(expected)

    const decoder = new UrDecoder()
    for (const part of expected) decoder.receive(part)
    expect(bytesToHex(decoder.result().cbor)).toBe(bytesToHex(makeMessageUr(256)))
  })
})

describe('core.qr.ur decoding', () => {
  /**
   * INV-UR-4. bc-ur's decoder test: 32767 bytes, parts starting at 100, so every
   * one the decoder sees is mixed and it has to reduce its way to the message.
   */
  it('decodes-from-mixed-parts-alone', () => {
    const message = makeMessage(32767)
    const encoder = new FountainEncoder(message, 1000, 100)
    const decoder = new FountainDecoder()
    let parts = 0
    while (!decoder.complete) {
      decoder.receive(encoder.nextPart())
      parts += 1
      expect(parts).toBeLessThan(500)
    }
    expect(bytesToHex(decoder.result ?? new Uint8Array(0))).toBe(bytesToHex(message))
  })

  it('decodes-a-multipart-ur-joined-late', () => {
    const cbor = makeMessageUr(32767)
    const encoder = new UrEncoder('bytes', cbor, 1000, 100)
    const decoder = new UrDecoder()
    while (!decoder.complete) decoder.receive(encoder.nextPart())
    expect(bytesToHex(decoder.result().cbor)).toBe(bytesToHex(cbor))
  })

  /**
   * INV-UR-4. Two transfers are refused, not merged (SP-TX-5). UR, unlike BBQr,
   * carries a checksum of the whole message, so this check is exact.
   */
  it('refuses-frames-from-two-transfers', () => {
    const a = new UrEncoder('bytes', makeMessageUr(256), 30)
    const b = new UrEncoder('bytes', cborBytes(makeMessage(256, 'Fox')), 30)
    const decoder = new UrDecoder()
    decoder.receive(a.nextPart())
    b.nextPart()
    expect(() => decoder.receive(b.nextPart())).toThrow(/different transfer/)

    const typed = new UrDecoder()
    typed.receive(a.nextPart())
    expect(() => typed.receive(new UrEncoder('psbt', makeMessageUr(256), 30).nextPart())).toThrow(
      /different transfer/
    )
  })

  /** INV-UR-4. A frame whose text and CBOR disagree about its number is refused. */
  it('refuses-a-part-numbered-differently-inside', () => {
    const frame = new UrEncoder('bytes', makeMessageUr(256), 30).nextPart()
    const lying = frame.replace('/1-9/', '/2-9/')
    expect(lying).not.toBe(frame)
    expect(() => new UrDecoder().receive(lying)).toThrow(/one number in its text/)
  })

  /** INV-UR-4. Strict on the string: empty components and odd types are refused. */
  it('refuses-malformed-ur-strings', () => {
    const good = new UrEncoder('bytes', makeMessageUr(50), 1000).nextPart()
    expect(() => parseUr(good.replace('ur:bytes/', 'ur:bytes//'))).toThrow(UrError)
    expect(() => parseUr(good.replace('ur:bytes/', 'ur:by_tes/'))).toThrow(/no valid type/)
    expect(() => parseUr(good.replace('ur:', 'xr:'))).toThrow(/not a UR/)
    expect(() => parseUr(`${good.slice(0, -2)}aa`)).toThrow(/checksum|not a Byteword/)
    expect(() => parseUr('ur:bytes/0-9/aeaeaeaeae')).toThrow(/sequence number/)
  })

  /** INV-UR-4. A message that joins with the wrong checksum is refused, never returned. */
  it('refuses-a-message-whose-checksum-is-wrong', () => {
    const message = makeMessage(256)
    const encoder = new FountainEncoder(message, 30)
    const decoder = new FountainDecoder()
    const parts = Array.from({ length: encoder.seqLen }, () => encoder.nextPart())
    const tampered = parts.map((part, i) =>
      i === 3 ? { ...part, data: part.data.map((b, j) => (j === 0 ? b ^ 1 : b)) } : part
    )
    expect(() => {
      for (const part of tampered) decoder.receive(part)
    }).toThrow(/checksum is wrong/)
    expect(decoder.result).toBeUndefined()
  })
})

describe('core.qr.ur psbt', () => {
  /**
   * INV-UR-5. The registry's own `psbt` vector reads as a PSBT, and so does the
   * same body under the name every wallet writes.
   */
  it('reads-a-psbt-under-either-registered-name', () => {
    const vector = V.ur_single_part.find((c) => c.type === 'psbt')
    if (vector === undefined) throw new Error('vector missing')
    for (const text of [vector.ur, vector.ur.replace('ur:psbt/', 'ur:crypto-psbt/')]) {
      const decoder = new UrDecoder()
      decoder.receive(text.toUpperCase())
      const psbt = psbtFromUr(decoder.result())
      expect(() => parsePsbt(psbt)).not.toThrow()
      expect(bytesToHex(cborBytes(psbt))).toBe((vector.cbor_hex ?? '').toLowerCase())
    }
    const other = new UrDecoder()
    other.receive(V.ur_single_part.find((c) => c.type === 'seed')?.ur ?? '')
    expect(() => psbtFromUr(other.result())).toThrow(/not a PSBT/)
  })

  /**
   * INV-UR-5. What this device shows: crypto-psbt, uppercase, every character
   * in the QR alphanumeric set, and frames that decode back to the PSBT,
   * including from the mixed half of the loop alone.
   */
  it('writes-a-psbt-as-uppercase-crypto-psbt-frames', () => {
    const vector = V.ur_single_part.find((c) => c.type === 'psbt')
    const psbt = cborBytesDecode(hexToBytes(vector?.cbor_hex ?? ''))
    const frames = urFramesForPsbt(psbt, 40)
    expect(frames.length).toBeGreaterThan(2)
    for (const frame of frames) {
      expect(frame.startsWith(`UR:${PSBT_UR_TYPE.toUpperCase()}/`)).toBe(true)
      for (const char of frame) expect(QR_ALPHANUMERIC).toContain(char)
    }

    const all = new UrDecoder()
    for (const frame of frames) all.receive(frame)
    expect(bytesToHex(psbtFromUr(all.result()))).toBe(bytesToHex(psbt))

    const lateHalf = new UrDecoder()
    for (const frame of frames.slice(frames.length / 2)) lateHalf.receive(frame)
    if (lateHalf.complete) {
      expect(bytesToHex(psbtFromUr(lateHalf.result()))).toBe(bytesToHex(psbt))
    }
  })
})
