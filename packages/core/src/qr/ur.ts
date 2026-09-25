/**
 * Blockchain Commons UR (BCR-2020-005): the animated QR format SeedSigner, Jade,
 * Keystone and Sparrow speak, alongside BBQr.
 *
 * Spec: core.qr.ur
 *
 * In the tree rather than as a dependency, like the QR encoder, so the code
 * that reads a PSBT off the camera and writes the signed one back is inside the
 * manifest the user checked. Only what a PSBT needs is here: Bytewords, a CBOR
 * byte string, the five-item part array, and the fountain code in
 * ur-fountain.ts. The CBOR reader accepts nothing else and refuses non-minimal
 * lengths and trailing bytes, which is stricter than bc-ur and what
 * BCR-2020-005 asks for (dCBOR).
 *
 * TYPES. A PSBT is written as `crypto-psbt` and read as either `crypto-psbt` or
 * `psbt`. The registry (BCR-2020-006) recommends writing `psbt`, but SeedSigner
 * and Jade read only `crypto-psbt` and every wallet checked writes it
 * (research/ur-notes.md, "PSBT types"). Writing the recommended name would hand
 * a signed PSBT to a coordinator that cannot read it.
 *
 * CASE. Frames are uppercased for display so they fit QR alphanumeric mode, and
 * any case is accepted on input (BCR-2020-005, "case-agnostic").
 */

import {
  FountainDecoder,
  FountainEncoder,
  UrError,
  crc32,
  uint32BE,
  type FountainPart,
} from './ur-fountain.js'

export { UrError } from './ur-fountain.js'

// --- Bytewords (BCR-2020-012) ----------------------------------------------

/**
 * The 256 words, four letters each, in byte order: bc-ur src/bytewords.cpp:17
 * at 4479fb81b2350ae8bafa042a5572b9c64c2c32ca. Every first-and-last letter pair
 * is distinct, which is what lets minimal style keep only those two letters.
 * A test pins the SHA-256 of this string.
 */
export const BYTEWORDS =
  'ableacidalsoapexaquaarchatomauntawayaxisbackbaldbarnbeltbetabiasbluebodybragbrewbulbbuzzcalmcashcatschefcityclawcodecolacookcostcruxcurlcuspcyandarkdatadaysdelidicedietdoordowndrawdropdrumdulldutyeacheasyechoedgeepicevenexamexiteyesfactfairfernfigsfilmfishfizzflapflewfluxfoxyfreefrogfuelfundgalagamegeargemsgiftgirlglowgoodgraygrimgurugushgyrohalfhanghardhawkheathelphighhillholyhopehornhutsicedideaidleinchinkyintoirisironitemjadejazzjoinjoltjowljudojugsjumpjunkjurykeepkenokeptkeyskickkilnkingkitekiwiknoblamblavalazyleaflegsliarlimplionlistlogoloudloveluaulucklungmainmanymathmazememomenumeowmildmintmissmonknailnavyneednewsnextnoonnotenumbobeyoboeomitonyxopenovalowlspaidpartpeckplaypluspoempoolposepuffpumapurrquadquizraceramprealredorichroadrockroofrubyruinrunsrustsafesagascarsetssilkskewslotsoapsolosongstubsurfswantacotasktaxitenttiedtimetinytoiltombtoystriptunatwinuglyundouniturgeuservastveryvetovialvibeviewvisavoidvowswallwandwarmwaspwavewaxywebswhatwhenwhizwolfworkyankyawnyellyogayurtzapszerozestzinczonezoom'

const WORD_BY_ENDS = new Map<string, number>()
for (let i = 0; i < 256; i += 1) {
  WORD_BY_ENDS.set(`${BYTEWORDS.charAt(i * 4)}${BYTEWORDS.charAt(i * 4 + 3)}`, i)
}

export type BytewordsStyle = 'standard' | 'uri' | 'minimal'

function word(byte: number): string {
  return BYTEWORDS.slice(byte * 4, byte * 4 + 4)
}

/** Encode with the CRC-32 of the data appended, as every style does. */
export function bytewordsEncode(data: Uint8Array, style: BytewordsStyle): string {
  const all = new Uint8Array(data.length + 4)
  all.set(data)
  all.set(uint32BE(crc32(data)), data.length)
  const words = [...all].map(word)
  if (style === 'standard') return words.join(' ')
  if (style === 'uri') return words.join('-')
  return words.map((w) => `${w.charAt(0)}${w.charAt(3)}`).join('')
}

/** Decode any case, check every word and the trailing CRC-32. */
export function bytewordsDecode(text: string, style: BytewordsStyle): Uint8Array {
  const lower = text.toLowerCase()
  let tokens: string[]
  if (style === 'minimal') {
    if (lower.length % 2 !== 0) throw new UrError('Bytewords of odd length.')
    tokens = []
    for (let i = 0; i < lower.length; i += 2) tokens.push(lower.slice(i, i + 2))
  } else {
    tokens = lower.split(style === 'standard' ? ' ' : '-')
  }
  const bytes = tokens.map((token) => {
    const whole = style !== 'minimal'
    const ends = whole ? `${token.charAt(0)}${token.charAt(3)}` : token
    const value = WORD_BY_ENDS.get(ends)
    // A whole word must be the word, not just share its ends.
    if (value === undefined || (whole && token !== word(value))) {
      throw new UrError(`${JSON.stringify(token)} is not a Byteword.`)
    }
    return value
  })
  if (bytes.length < 5) throw new UrError('Bytewords too short to carry a checksum.')
  const body = Uint8Array.from(bytes.slice(0, -4))
  const expected = uint32BE(crc32(body))
  const got = bytes.slice(-4)
  if (got.some((b, i) => b !== expected[i])) {
    throw new UrError('The Bytewords checksum is wrong: the frame was misread.')
  }
  return body
}

// --- CBOR, only as much as a PSBT needs ------------------------------------

function cborHead(major: number, value: number): number[] {
  if (!Number.isSafeInteger(value) || value < 0) throw new UrError('CBOR value out of range')
  const m = major << 5
  if (value < 24) return [m | value]
  if (value < 0x100) return [m | 24, value]
  if (value < 0x10000) return [m | 25, value >> 8, value & 0xff]
  if (value < 0x100000000) {
    return [
      m | 26,
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    ]
  }
  const big = BigInt(value)
  return [
    m | 27,
    ...Array.from({ length: 8 }, (_, i) => Number((big >> BigInt(56 - i * 8)) & 0xffn)),
  ]
}

/** A CBOR byte string: the whole body of a `psbt` or `crypto-psbt` UR. */
export function cborBytes(data: Uint8Array): Uint8Array {
  const head = cborHead(2, data.length)
  const out = new Uint8Array(head.length + data.length)
  out.set(head)
  out.set(data, head.length)
  return out
}

interface Head {
  readonly major: number
  readonly value: number
  readonly next: number
}

/** One head, minimal encoding only, no indefinite lengths. */
function readHead(bytes: Uint8Array, at: number): Head {
  const first = bytes[at]
  if (first === undefined) throw new UrError('CBOR ends early.')
  const major = first >> 5
  const info = first & 0x1f
  if (info < 24) return { major, value: info, next: at + 1 }
  const width = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : info === 27 ? 8 : 0
  if (width === 0) throw new UrError('CBOR uses an encoding a UR does not allow.')
  if (at + 1 + width > bytes.length) throw new UrError('CBOR ends early.')
  let value = 0n
  for (let i = 0; i < width; i += 1) value = (value << 8n) | BigInt(bytes[at + 1 + i] ?? 0)
  const floor = width === 1 ? 24n : width === 2 ? 0x100n : width === 4 ? 0x10000n : 0x100000000n
  if (value < floor) throw new UrError('CBOR is not minimally encoded.')
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new UrError('CBOR value out of range.')
  return { major, value: Number(value), next: at + 1 + width }
}

function readBytes(bytes: Uint8Array, at: number): { data: Uint8Array; next: number } {
  const head = readHead(bytes, at)
  if (head.major !== 2) throw new UrError('Expected a CBOR byte string.')
  const end = head.next + head.value
  if (end > bytes.length) throw new UrError('CBOR byte string ends early.')
  return { data: bytes.slice(head.next, end), next: end }
}

/** The inside of a byte-string body, refusing anything else or anything after. */
export function cborBytesDecode(cbor: Uint8Array): Uint8Array {
  const { data, next } = readBytes(cbor, 0)
  if (next !== cbor.length) throw new UrError('Trailing bytes after the CBOR body.')
  return data
}

/** [seqNum, seqLen, messageLen, checksum, data] (bcr-2024-001-multipart-ur.md:719-729). */
export function encodePart(part: FountainPart): Uint8Array {
  const head = [
    0x85,
    ...cborHead(0, part.seqNum),
    ...cborHead(0, part.seqLen),
    ...cborHead(0, part.messageLen),
    ...cborHead(0, part.checksum),
  ]
  const data = cborBytes(part.data)
  const out = new Uint8Array(head.length + data.length)
  out.set(head)
  out.set(data, head.length)
  return out
}

export function decodePart(cbor: Uint8Array): FountainPart {
  const array = readHead(cbor, 0)
  if (array.major !== 4 || array.value !== 5) throw new UrError('A UR part is a five item array.')
  let at = array.next
  const uints: number[] = []
  for (let i = 0; i < 4; i += 1) {
    const head = readHead(cbor, at)
    if (head.major !== 0) throw new UrError('A UR part header holds unsigned integers.')
    uints.push(head.value)
    at = head.next
  }
  const { data, next } = readBytes(cbor, at)
  if (next !== cbor.length) throw new UrError('Trailing bytes after a UR part.')
  const [seqNum = 0, seqLen = 0, messageLen = 0, checksum = 0] = uints
  if (seqNum < 1 || seqNum > 0xffffffff || checksum > 0xffffffff) {
    throw new UrError('A UR part number or checksum is out of range.')
  }
  return { seqNum, seqLen, messageLen, checksum, data }
}

// --- UR strings --------------------------------------------------------------

const TYPE = /^[a-z0-9-]+$/

export interface ParsedUr {
  readonly type: string
  /** Present for a multipart frame. */
  readonly seq?: { readonly num: number; readonly len: number }
  /** Bytes after the Bytewords checksum: the CBOR body, or one part's CBOR. */
  readonly body: Uint8Array
}

/** True when a scanned string is a UR, in any case. */
export function isUr(text: string): boolean {
  return text.trim().toLowerCase().startsWith('ur:')
}

/**
 * Read one frame. Stricter than bc-ur on the string: empty path components, a
 * signed or padded sequence number, and a type outside [a-z0-9-] are refused
 * rather than normalised.
 */
export function parseUr(text: string): ParsedUr {
  const lower = text.trim().toLowerCase()
  if (!lower.startsWith('ur:')) throw new UrError('That is not a UR: it does not begin with ur:.')
  const path = lower.slice(3).split('/')
  const type = path[0] ?? ''
  if (!TYPE.test(type)) throw new UrError('That UR has no valid type.')
  if (path.length === 2) {
    return { type, body: bytewordsDecode(path[1] ?? '', 'minimal') }
  }
  if (path.length === 3) {
    const match = /^([1-9][0-9]*)-([1-9][0-9]*)$/.exec(path[1] ?? '')
    if (match === null) throw new UrError('That UR part has an unreadable sequence number.')
    const num = Number(match[1])
    const len = Number(match[2])
    if (!Number.isSafeInteger(num) || !Number.isSafeInteger(len) || num > 0xffffffff) {
      throw new UrError('That UR part number is out of range.')
    }
    return { type, seq: { num, len }, body: bytewordsDecode(path[2] ?? '', 'minimal') }
  }
  throw new UrError('That UR has the wrong number of parts in its path.')
}

/**
 * Produce frames for one UR: a single frame when the body fits one fragment,
 * otherwise parts that run on past seqLen, the later ones mixed, which is what
 * lets a receiver that joins partway through still finish.
 */
export class UrEncoder {
  readonly type: string
  readonly #cbor: Uint8Array
  readonly #fountain: FountainEncoder

  constructor(type: string, cbor: Uint8Array, maxFragmentLen: number, firstSeqNum = 0) {
    if (!TYPE.test(type)) throw new UrError(`${JSON.stringify(type)} is not a UR type.`)
    this.type = type
    this.#cbor = cbor
    this.#fountain = new FountainEncoder(cbor, maxFragmentLen, firstSeqNum)
  }

  get singlePart(): boolean {
    return this.#fountain.seqLen === 1
  }

  get seqLen(): number {
    return this.#fountain.seqLen
  }

  nextPart(): string {
    if (this.singlePart) return `ur:${this.type}/${bytewordsEncode(this.#cbor, 'minimal')}`
    const part = this.#fountain.nextPart()
    const body = bytewordsEncode(encodePart(part), 'minimal')
    return `ur:${this.type}/${String(part.seqNum)}-${String(part.seqLen)}/${body}`
  }
}

/**
 * Collect frames of one UR.
 *
 * Refuses, with a message a screen can show, a frame of another type, a frame
 * whose string and CBOR disagree about its number, and (in the fountain
 * decoder) a frame from a transfer with a different length or checksum. The
 * reference drops such frames silently; this device says so and starts over.
 */
export class UrDecoder {
  #type: string | undefined
  readonly #fountain = new FountainDecoder()
  #single: Uint8Array | undefined

  get type(): string | undefined {
    return this.#type
  }

  get complete(): boolean {
    return this.#single !== undefined || this.#fountain.complete
  }

  /** Parts known outright and how many there are, for a progress count. */
  get progress(): { readonly known: number; readonly total: number | undefined } {
    if (this.#single !== undefined) return { known: 1, total: 1 }
    return { known: this.#fountain.fragmentsKnown, total: this.#fountain.seqLen }
  }

  /** Returns true when the frame added something. */
  receive(text: string): boolean {
    if (this.complete) return false
    const frame = parseUr(text)
    if (this.#type === undefined) this.#type = frame.type
    else if (frame.type !== this.#type) {
      throw new UrError(
        'That QR code belongs to a different transfer. Start again with one sequence in view.'
      )
    }
    if (frame.seq === undefined) {
      if (this.#fountain.seqLen !== undefined) {
        throw new UrError(
          'That QR code belongs to a different transfer. Start again with one sequence in view.'
        )
      }
      this.#single = frame.body
      return true
    }
    const part = decodePart(frame.body)
    if (part.seqNum !== frame.seq.num || part.seqLen !== frame.seq.len) {
      throw new UrError('That UR part says one number in its text and another inside.')
    }
    return this.#fountain.receive(part)
  }

  /** The CBOR body, once complete. */
  result(): { readonly type: string; readonly cbor: Uint8Array } {
    const cbor = this.#single ?? this.#fountain.result
    if (this.#type === undefined || cbor === undefined) {
      throw new UrError('The UR is not complete yet.')
    }
    return { type: this.#type, cbor }
  }
}

// --- PSBTs -------------------------------------------------------------------

/** What this device writes, and what it reads. See the header on why. */
export const PSBT_UR_TYPE = 'crypto-psbt'
export const PSBT_UR_TYPES_READ: readonly string[] = ['crypto-psbt', 'psbt']

/** The binary PSBT inside a completed UR, or an error naming what arrived instead. */
export function psbtFromUr(result: {
  readonly type: string
  readonly cbor: Uint8Array
}): Uint8Array {
  if (!PSBT_UR_TYPES_READ.includes(result.type)) {
    throw new UrError(`That UR holds ${result.type}, not a PSBT.`)
  }
  return cborBytesDecode(result.cbor)
}

/**
 * The frames to animate for a PSBT, uppercased for QR alphanumeric mode.
 *
 * Twice the fragment count: every fragment once, then as many mixed parts,
 * which a receiver that missed frames can use without waiting for the loop.
 * The display repeats the list, and a repeated part is ignored by any decoder.
 */
export function urFramesForPsbt(psbt: Uint8Array, maxFragmentLen: number): readonly string[] {
  const encoder = new UrEncoder(PSBT_UR_TYPE, cborBytes(psbt), maxFragmentLen)
  const count = encoder.singlePart ? 1 : encoder.seqLen * 2
  return Array.from({ length: count }, () => encoder.nextPart().toUpperCase())
}
