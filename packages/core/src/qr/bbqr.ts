/**
 * BBQr: one payload split across a sequence of QR codes.
 *
 * Spec: core.qr.bbqr
 *
 * A signed PSBT does not fit in one QR code, and a 7 inch screen cannot display
 * a version 40 code at a density a phone camera will read anyway. BBQr is the
 * convention the Bitcoin air-gap ecosystem already settled on, so a user can
 * animate frames on this device and receive them in software written by someone
 * who has never heard of nullroute. Inventing a private framing here would make
 * this device a closed loop, which is the opposite of the point.
 *
 * FORMAT. Every part is a header of exactly eight characters followed by the
 * payload:
 *
 *     B$ 2 P 03 01 <payload>
 *     ^^ ^ ^ ^^ ^^
 *     |  | | |  +-- this part's index, base36, zero based
 *     |  | | +----- how many parts in total, base36
 *     |  | +------- what the payload is (P for PSBT, T for a transaction, ...)
 *     |  +--------- how the payload is encoded (2 for base32, H for hex)
 *     +------------ the magic
 *
 * Two characters of base36 cap a transfer at 1295 parts, which is the format's
 * limit and not ours.
 *
 * THE SPLIT IS ON DECODED BYTES, NOT ENCODED CHARACTERS. Each part has to decode
 * on its own, because a receiver may get part 7 before part 2 and should not
 * have to buffer the whole sequence to know part 7 was garbage. Base32 turns
 * five bytes into eight characters, so every part except the last carries a
 * multiple of five bytes. Splitting mid-group would produce parts that only
 * decode in order, which reads as working right up until a frame is missed.
 *
 * COMPRESSION. This writes `2` (base32) and never `Z` (deflate then base32),
 * because emitting `Z` would mean a compressor in the signing path, and a few
 * extra frames is a cheaper price than that. It READS `Z`, because Coldcard
 * writes it by default and refusing would mean refusing the most common
 * counterpart. Inflating uses the platform's DecompressionStream, which exists
 * in Node and in the browser, so the reader stays free of dependencies too.
 */

import { base32nopad, hex } from '@scure/base'
import { encodeQr, type QrCode } from './encode.js'
import { dataCapacity, type EcLevel } from './tables.js'

export class BbqrError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BbqrError'
  }
}

/** Two base36 characters, so 1296 values and 1295 as the highest index. */
export const MAX_PARTS = 1296

const MAGIC = 'B$'
const HEADER_LENGTH = 8

/**
 * What the payload is. The letters are the format's, and a receiver uses them to
 * decide what to do with the bytes without guessing from their contents.
 */
export const FILE_TYPES = {
  psbt: 'P',
  transaction: 'T',
  json: 'J',
  cbor: 'C',
  unicode: 'U',
  binary: 'B',
} as const
export type FileType = keyof typeof FILE_TYPES

const FILE_TYPE_BY_CHAR = new Map<string, FileType>(
  Object.entries(FILE_TYPES).map(([name, char]) => [char, name as FileType])
)

export interface SplitOptions {
  /** The largest QR version to emit. Denser codes scan worse, so this is low. */
  readonly maxVersion?: number
  readonly level?: EcLevel
}

export interface BbqrPart {
  readonly index: number
  readonly total: number
  readonly fileType: FileType
  /** The complete string, header included, ready to encode. */
  readonly text: string
}

/**
 * Version 12 at level M by default.
 *
 * A version 40 code is 177 modules across. On an 800x480 panel with a margin
 * that leaves under two physical pixels per module, and a phone camera at arm's
 * length will not resolve it. Fewer, sparser frames beat one dense frame nobody
 * can read, and the animation costs the user nothing but seconds.
 */
const DEFAULT_MAX_VERSION = 12
const DEFAULT_LEVEL: EcLevel = 'M'

/** Payload characters that fit in one code, after the eight header characters. */
function payloadCapacity(version: number, level: EcLevel): number {
  const countBits = version < 10 ? 8 : 16
  const bytes = dataCapacity(version, level) - Math.ceil((4 + countBits) / 8)
  return bytes - HEADER_LENGTH
}

function base36(value: number, width: number): string {
  return value.toString(36).toUpperCase().padStart(width, '0')
}

/**
 * Split a payload into BBQr parts.
 *
 * A payload small enough for one code still gets a header, so the receiver has
 * one path rather than two and a single-frame transfer is not a special case
 * that only gets exercised by short test vectors.
 */
export function splitBbqr(
  data: Uint8Array,
  fileType: FileType,
  options: SplitOptions = {}
): readonly BbqrPart[] {
  const maxVersion = options.maxVersion ?? DEFAULT_MAX_VERSION
  const level = options.level ?? DEFAULT_LEVEL

  // Base32 takes five bytes to eight characters. Parts must decode standalone,
  // so every part but the last carries a whole number of those groups.
  const capacity = payloadCapacity(maxVersion, level)
  const groupsPerPart = Math.floor(capacity / 8)
  const maxBytesPerPart = groupsPerPart * 5

  // Below one whole group there is no part size that works, and computing a
  // part count from zero bytes per part would divide by zero and report an
  // impossible transfer rather than an impossible setting.
  if (groupsPerPart < 1) {
    throw new BbqrError(
      `QR version ${String(maxVersion)} at level ${level} has no room for a BBQr payload. ` +
        `Raise maxVersion.`
    )
  }

  const total = Math.max(1, Math.ceil(data.length / maxBytesPerPart))
  if (total > MAX_PARTS) {
    throw new BbqrError(
      `That payload needs ${String(total)} QR codes and BBQr allows ${String(MAX_PARTS)}. ` +
        `Raise maxVersion or send it on a card instead.`
    )
  }

  // Rebalance so the parts are near equal rather than several full ones and a
  // sliver, which animates more evenly and makes a dropped frame less costly.
  const perPart = Math.min(maxBytesPerPart, Math.ceil(Math.ceil(data.length / total) / 5) * 5)

  const parts: BbqrPart[] = []
  for (let index = 0; index < total; index += 1) {
    const chunk = data.subarray(index * perPart, Math.min((index + 1) * perPart, data.length))
    const header = `${MAGIC}2${FILE_TYPES[fileType]}${base36(total, 2)}${base36(index, 2)}`
    parts.push({ index, total, fileType, text: header + base32nopad.encode(chunk) })
  }
  return parts
}

/** Split and render, which is what a display actually wants. */
export function splitBbqrToQr(
  data: Uint8Array,
  fileType: FileType,
  options: SplitOptions = {}
): readonly QrCode[] {
  const level = options.level ?? DEFAULT_LEVEL
  return splitBbqr(data, fileType, options).map((part) =>
    encodeQr(new TextEncoder().encode(part.text), { level })
  )
}

export interface ParsedPart {
  readonly index: number
  readonly total: number
  readonly fileType: FileType
  readonly encoding: '2' | 'H' | 'Z'
  /** Still encoded. Decoding happens at join, where Z needs to inflate. */
  readonly payload: string
}

/**
 * Read one part's header.
 *
 * Called on whatever a camera just decoded, which is frequently not a BBQr part
 * at all, so this refuses clearly rather than returning something half filled.
 */
export function parseBbqrPart(text: string): ParsedPart {
  const trimmed = text.trim()
  if (!trimmed.startsWith(MAGIC)) {
    throw new BbqrError('That is not a BBQr part: it does not begin with B$.')
  }
  if (trimmed.length < HEADER_LENGTH) {
    throw new BbqrError('That BBQr part is truncated: the header is incomplete.')
  }

  const encoding = trimmed[2] ?? ''
  if (encoding !== '2' && encoding !== 'H' && encoding !== 'Z') {
    throw new BbqrError(`That BBQr part uses encoding ${encoding}, which is not one this reads.`)
  }

  const typeChar = trimmed[3] ?? ''
  const fileType = FILE_TYPE_BY_CHAR.get(typeChar)
  if (fileType === undefined) {
    throw new BbqrError(`That BBQr part holds file type ${typeChar}, which is not one this reads.`)
  }

  const total = Number.parseInt(trimmed.slice(4, 6), 36)
  const index = Number.parseInt(trimmed.slice(6, 8), 36)
  if (!Number.isInteger(total) || !Number.isInteger(index)) {
    throw new BbqrError('That BBQr part has an unreadable part number.')
  }
  if (total < 1) throw new BbqrError('That BBQr part claims a transfer of no parts.')
  if (index >= total) {
    throw new BbqrError(
      `That BBQr part is number ${String(index + 1)} of ${String(total)}, which cannot be.`
    )
  }

  return { index, total, fileType, encoding, payload: trimmed.slice(HEADER_LENGTH) }
}

/**
 * Track a transfer as frames arrive.
 *
 * A scanner sees parts repeatedly and out of order, so this is a set rather than
 * a list. It refuses parts that disagree with the ones already held: a header
 * that names a different total or a different file type means the camera caught
 * a frame from some other transfer, and merging the two would produce a payload
 * assembled from two different documents.
 */
export class BbqrCollector {
  readonly #parts = new Map<number, ParsedPart>()
  #total: number | undefined
  #fileType: FileType | undefined
  #encoding: ParsedPart['encoding'] | undefined

  /** Returns true when this part was new. */
  add(text: string): boolean {
    const part = parseBbqrPart(text)

    if (this.#total === undefined) {
      this.#total = part.total
      this.#fileType = part.fileType
      this.#encoding = part.encoding
    } else if (
      part.total !== this.#total ||
      part.fileType !== this.#fileType ||
      part.encoding !== this.#encoding
    ) {
      throw new BbqrError(
        'That QR code belongs to a different transfer. Start again with one sequence in view.'
      )
    }

    const existing = this.#parts.get(part.index)
    if (existing !== undefined) {
      // The same index arriving with different contents means two different
      // sequences, or a misread. Either way, assembling would be wrong.
      if (existing.payload !== part.payload) {
        throw new BbqrError(
          `Part ${String(part.index + 1)} arrived twice with different contents. Start again.`
        )
      }
      return false
    }

    this.#parts.set(part.index, part)
    return true
  }

  get total(): number | undefined {
    return this.#total
  }

  get received(): number {
    return this.#parts.size
  }

  get fileType(): FileType | undefined {
    return this.#fileType
  }

  get complete(): boolean {
    return this.#total !== undefined && this.#parts.size === this.#total
  }

  /** Indices still outstanding, so a screen can say which frames to wait for. */
  get missing(): readonly number[] {
    if (this.#total === undefined) return []
    const out: number[] = []
    for (let i = 0; i < this.#total; i += 1) if (!this.#parts.has(i)) out.push(i)
    return out
  }

  reset(): void {
    this.#parts.clear()
    this.#total = undefined
    this.#fileType = undefined
    this.#encoding = undefined
  }

  async assemble(): Promise<{ readonly data: Uint8Array; readonly fileType: FileType }> {
    if (this.#total === undefined) throw new BbqrError('No BBQr parts have been read yet.')
    if (!this.complete) {
      throw new BbqrError(
        `Still waiting on ${String(this.#total - this.#parts.size)} of ${String(this.#total)} parts.`
      )
    }
    const ordered: ParsedPart[] = []
    for (let i = 0; i < this.#total; i += 1) {
      const part = this.#parts.get(i)
      if (part === undefined) throw new BbqrError(`Part ${String(i + 1)} is missing.`)
      ordered.push(part)
    }
    return {
      data: await joinParts(ordered),
      fileType: this.#fileType ?? 'binary',
    }
  }
}

function decodePayload(part: ParsedPart): Uint8Array {
  try {
    if (part.encoding === 'H') return hex.decode(part.payload.toLowerCase())
    return base32nopad.decode(part.payload.toUpperCase())
  } catch (err) {
    throw new BbqrError(
      `Part ${String(part.index + 1)} did not decode: ${(err as Error).message}. ` +
        `Rescan that frame.`
    )
  }
}

/**
 * Inflate a `Z` payload.
 *
 * BBQr's Z is a raw deflate stream with no zlib wrapper. DecompressionStream is
 * a platform API in both Node and the browser, which keeps the reader free of a
 * dependency for a path that only exists to accept other people's files.
 */
async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new BbqrError(
      'These QR codes are compressed and this platform cannot decompress them. ' +
        'Ask the sender to turn compression off.'
    )
  }
  try {
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(data)
        controller.close()
      },
    })
    // The type argument is given rather than inferred: DecompressionStream is
    // declared with an untyped readable side, so inference would make every
    // chunk `any` and quietly disable checking on the loop below.
    const reader = source
      .pipeThrough<Uint8Array>(new DecompressionStream('deflate-raw'))
      .getReader()

    const chunks: Uint8Array[] = []
    let length = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      length += value.length
    }
    const out = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      out.set(chunk, offset)
      offset += chunk.length
    }
    return out
  } catch (err) {
    throw new BbqrError(`Those compressed QR codes did not decompress: ${(err as Error).message}`)
  }
}

async function joinParts(ordered: readonly ParsedPart[]): Promise<Uint8Array> {
  const chunks = ordered.map(decodePayload)
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const joined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.length
  }

  // Z compresses the whole payload before splitting, so inflation happens once
  // on the joined bytes rather than per part.
  return ordered[0]?.encoding === 'Z' ? inflateRaw(joined) : joined
}

/** Join a complete set of parts, in any order. */
export async function joinBbqr(
  texts: readonly string[]
): Promise<{ readonly data: Uint8Array; readonly fileType: FileType }> {
  const collector = new BbqrCollector()
  for (const text of texts) collector.add(text)
  return collector.assemble()
}
