/**
 * A QR encoder, in the tree rather than as a dependency.
 *
 * Spec: core.qr.encode
 *
 * This is the device's only way to hand anything back across the air gap: an
 * xpub, a descriptor bundle, a signed transaction. It is in-tree so it lands in
 * MANIFEST.lock and a reviewer checking the manifest is checking the code that
 * drew the square they photographed. A dependency here would be code outside the
 * hash that produced the bytes the hash is supposed to cover.
 *
 * Two modes. Byte mode carries anything. Alphanumeric mode carries only the
 * standard's 45 characters and packs two into 11 bits, and it exists because
 * BBQr requires it of every frame ("Your QR MUST use the alphanumeric character
 * encoding", SP-TX-6). A BBQr frame is uppercase base32 or hex under a header
 * drawn from the same set, so it always fits, and it fits in fewer frames.
 *
 * It is NOT cryptography and nothing here is secret. The failure mode is a code
 * that will not scan, which is annoying and obvious, rather than a code that
 * scans as something else. The mask selection and error correction exist to make
 * scanning reliable, not to protect anything.
 *
 * Correctness is established by round-tripping every version and every error
 * correction level through an independent decoder, because a mistyped row in the
 * block-layout table produces a code that some scanners read and others do not,
 * which is exactly the failure that would reach a user rather than a test.
 */

import {
  EC_LEVELS,
  alignmentCentres,
  blockLayout,
  dataCapacity,
  moduleCount,
  type EcLevel,
} from './tables.js'

export class QrError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QrError'
  }
}

export interface QrCode {
  /** Modules per side. */
  readonly size: number
  /** Row-major, true where the module is dark. */
  readonly modules: readonly boolean[]
  readonly version: number
  readonly level: EcLevel
  /** Which of the eight masks scored best. */
  readonly mask: number
}

export interface EncodeOptions {
  readonly level?: EcLevel
  /** Force a version rather than taking the smallest that fits. */
  readonly version?: number
  /**
   * Force a mask rather than scoring all eight.
   *
   * For tests that compare against a reference implementation, which picks its
   * own mask, so a module-by-module comparison needs both sides pinned. Nothing
   * on the device sets this: a fixed mask scans worse, and the scoring exists
   * precisely so the code adapts to its own contents.
   */
  readonly mask?: number
}

// --- GF(256) ---------------------------------------------------------------
//
// The field the standard specifies, with primitive polynomial 0x11D. Log and
// antilog tables are built once because Reed-Solomon multiplies constantly and
// doing it by shifting every time is needlessly slow on a Pi.

const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
{
  let x = 1
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255] ?? 0
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return EXP[((LOG[a] ?? 0) + (LOG[b] ?? 0)) % 255] ?? 0
}

/**
 * The generator polynomial for `degree` error correction codewords.
 *
 * The product of (x - a^i) for i below degree, coefficients in descending order
 * so index 0 is the leading one and the result is monic. Building it the other
 * way round yields the reversed polynomial, which is not monic and produces
 * error correction bytes that are wrong in every position, so the code carries
 * its data intact and no scanner will accept it.
 */
function generator(degree: number): Uint8Array {
  let poly = Uint8Array.from([1])
  for (let i = 0; i < degree; i += 1) {
    const next = new Uint8Array(poly.length + 1)
    for (let j = 0; j < poly.length; j += 1) {
      // Multiplying by x keeps the coefficient's index; multiplying by the root
      // pushes it one lower in degree, which is one higher in the array.
      next[j] = (next[j] ?? 0) ^ (poly[j] ?? 0)
      next[j + 1] = (next[j + 1] ?? 0) ^ gfMul(poly[j] ?? 0, EXP[i] ?? 0)
    }
    poly = next
  }
  return poly
}

/** Reed-Solomon remainder: the error correction codewords for one block. */
function ecCodewords(data: Uint8Array, count: number): Uint8Array {
  const gen = generator(count)
  const remainder = new Uint8Array(count)

  for (const byte of data) {
    const factor = byte ^ (remainder[0] ?? 0)
    remainder.copyWithin(0, 1)
    remainder[count - 1] = 0
    for (let i = 0; i < count; i += 1) {
      remainder[i] = (remainder[i] ?? 0) ^ gfMul(gen[i + 1] ?? 0, factor)
    }
  }
  return remainder
}

// --- Bit buffer ------------------------------------------------------------

class Bits {
  readonly #bits: number[] = []

  push(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i -= 1) this.#bits.push((value >>> i) & 1)
  }

  get length(): number {
    return this.#bits.length
  }

  /** Pad to a byte boundary and return the codewords. */
  toBytes(): Uint8Array {
    while (this.#bits.length % 8 !== 0) this.#bits.push(0)
    const out = new Uint8Array(this.#bits.length / 8)
    for (let i = 0; i < out.length; i += 1) {
      let byte = 0
      for (let j = 0; j < 8; j += 1) byte = (byte << 1) | (this.#bits[i * 8 + j] ?? 0)
      out[i] = byte
    }
    return out
  }
}

/**
 * The 45 characters alphanumeric mode can carry, in the standard's order: a
 * character's value is its index here.
 */
export const QR_ALPHANUMERIC = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:'

/**
 * One run of data in one mode: what the standard calls a segment. Everything
 * after the data (terminator, padding, error correction, placement) is the
 * same for both modes, so only this differs between them.
 */
interface Segment {
  readonly mode: 'byte' | 'alphanumeric'
  /** Characters for alphanumeric, bytes for byte mode, as the count field holds. */
  readonly count: number
  /** The four bit mode indicator. */
  readonly indicator: number
  /** Bits of data after the mode indicator and count. */
  readonly dataBits: number
  readonly writeData: (bits: Bits) => void
}

function byteSegment(data: Uint8Array): Segment {
  return {
    mode: 'byte',
    count: data.length,
    indicator: 0b0100,
    dataBits: data.length * 8,
    writeData: (bits) => {
      for (const byte of data) bits.push(byte, 8)
    },
  }
}

function alphanumericSegment(text: string): Segment {
  const values: number[] = []
  for (const char of text) {
    const value = QR_ALPHANUMERIC.indexOf(char)
    if (value < 0) {
      throw new QrError(
        `${JSON.stringify(char)} is not a QR alphanumeric character. ` +
          `Only digits, capital letters, space and $%*+-./: are.`
      )
    }
    values.push(value)
  }
  const pairs = Math.floor(values.length / 2)
  return {
    mode: 'alphanumeric',
    count: values.length,
    indicator: 0b0010,
    // Two characters in 11 bits, and a trailing single character in 6.
    dataBits: pairs * 11 + (values.length % 2) * 6,
    writeData: (bits) => {
      for (let i = 0; i + 1 < values.length; i += 2) {
        bits.push((values[i] ?? 0) * 45 + (values[i + 1] ?? 0), 11)
      }
      if (values.length % 2 === 1) bits.push(values[values.length - 1] ?? 0, 6)
    },
  }
}

/**
 * Width of the character count field, which grows with the version. Byte mode
 * uses 8 bits below version 10 and 16 from there; alphanumeric uses 9, 11 and
 * 13 across versions 1 to 9, 10 to 26 and 27 to 40.
 */
function countBits(mode: Segment['mode'], version: number): number {
  if (mode === 'byte') return version < 10 ? 8 : 16
  return version < 10 ? 9 : version < 27 ? 11 : 13
}

/** Codewords this segment needs at this version: mode, count, data. */
function codewordsNeeded(segment: Segment, version: number): number {
  return Math.ceil((4 + countBits(segment.mode, version) + segment.dataBits) / 8)
}

/**
 * The most characters (alphanumeric) or bytes (byte mode) one code carries at
 * this version and level. BBQr sizes its frames with this, so a frame is never
 * one character too long for the version it was sized against.
 */
export function segmentCapacity(mode: Segment['mode'], version: number, level: EcLevel): number {
  const bits = dataCapacity(version, level) * 8 - 4 - countBits(mode, version)
  if (mode === 'byte') return Math.floor(bits / 8)
  return Math.floor(bits / 11) * 2 + (bits % 11 >= 6 ? 1 : 0)
}

/** The smallest version that holds this segment at this level. */
function chooseVersion(segment: Segment, level: EcLevel): number {
  for (let version = 1; version <= 40; version += 1) {
    if (codewordsNeeded(segment, version) <= dataCapacity(version, level)) return version
  }
  throw new QrError(
    `${String(segment.count)} ${segment.mode === 'byte' ? 'bytes' : 'characters'} will not ` +
      `fit in a single QR code at level ${level}. Split it across several with the BBQr encoder.`
  )
}

// --- Data encoding ---------------------------------------------------------

function encodeData(segment: Segment, version: number, level: EcLevel): Uint8Array {
  const capacity = dataCapacity(version, level)
  const bits = new Bits()

  bits.push(segment.indicator, 4)
  bits.push(segment.count, countBits(segment.mode, version))
  segment.writeData(bits)

  // Terminator, up to four bits, truncated if the capacity ends sooner.
  const remaining = capacity * 8 - bits.length
  bits.push(0, Math.min(4, Math.max(0, remaining)))

  const codewords = bits.toBytes()
  const out = new Uint8Array(capacity)
  out.set(codewords.subarray(0, capacity))

  // The standard's pad bytes, alternating, for whatever is left.
  for (let i = codewords.length; i < capacity; i += 1) {
    out[i] = (i - codewords.length) % 2 === 0 ? 0xec : 0x11
  }
  return out
}

/**
 * Split into blocks, compute error correction, and interleave.
 *
 * The interleaving is what makes a burst of damage survivable: consecutive
 * codewords in the final stream come from different blocks, so a scratch across
 * the code spreads its errors over many blocks rather than destroying one.
 */
function interleave(data: Uint8Array, version: number, level: EcLevel): Uint8Array {
  const { ecPerBlock, g1, d1, g2, d2 } = blockLayout(version, level)

  const blocks: { data: Uint8Array; ec: Uint8Array }[] = []
  let offset = 0
  for (let i = 0; i < g1 + g2; i += 1) {
    const size = i < g1 ? d1 : d2
    const slice = data.subarray(offset, offset + size)
    offset += size
    blocks.push({ data: slice, ec: ecCodewords(slice, ecPerBlock) })
  }

  const out: number[] = []
  const maxData = Math.max(d1, d2)
  for (let i = 0; i < maxData; i += 1) {
    for (const block of blocks) {
      if (i < block.data.length) out.push(block.data[i] ?? 0)
    }
  }
  for (let i = 0; i < ecPerBlock; i += 1) {
    for (const block of blocks) out.push(block.ec[i] ?? 0)
  }
  return Uint8Array.from(out)
}

// --- Matrix ----------------------------------------------------------------

interface Grid {
  modules: (boolean | null)[]
  reserved: boolean[]
  size: number
}

function newGrid(size: number): Grid {
  return {
    modules: new Array<boolean | null>(size * size).fill(null),
    reserved: new Array<boolean>(size * size).fill(false),
    size,
  }
}

function set(grid: Grid, x: number, y: number, dark: boolean, reserve = true): void {
  if (x < 0 || y < 0 || x >= grid.size || y >= grid.size) return
  grid.modules[y * grid.size + x] = dark
  if (reserve) grid.reserved[y * grid.size + x] = true
}

function placeFinder(grid: Grid, cx: number, cy: number): void {
  for (let dy = -1; dy <= 7; dy += 1) {
    for (let dx = -1; dx <= 7; dx += 1) {
      const x = cx + dx
      const y = cy + dy
      if (x < 0 || y < 0 || x >= grid.size || y >= grid.size) continue
      const inner = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6
      const ring = dx === 0 || dx === 6 || dy === 0 || dy === 6
      const core = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4
      set(grid, x, y, inner && (ring || core))
    }
  }
}

function placeFunctionPatterns(grid: Grid, version: number): void {
  const size = grid.size

  placeFinder(grid, 0, 0)
  placeFinder(grid, size - 7, 0)
  placeFinder(grid, 0, size - 7)

  // Timing patterns, alternating from module 8 to the far finder.
  for (let i = 8; i < size - 8; i += 1) {
    const dark = i % 2 === 0
    set(grid, i, 6, dark)
    set(grid, 6, i, dark)
  }

  // Alignment patterns, skipping the three that overlap a finder.
  const centres = alignmentCentres(version)
  for (const cy of centres) {
    for (const cx of centres) {
      const nearFinder =
        (cx <= 8 && cy <= 8) || (cx <= 8 && cy >= size - 9) || (cx >= size - 9 && cy <= 8)
      if (nearFinder) continue
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const edge = Math.abs(dx) === 2 || Math.abs(dy) === 2
          const centre = dx === 0 && dy === 0
          set(grid, cx + dx, cy + dy, edge || centre)
        }
      }
    }
  }

  // The dark module. Always set, always here.
  set(grid, 8, size - 8, true)

  // Format information areas, reserved now and filled after masking.
  for (let i = 0; i < 9; i += 1) {
    if (i !== 6) {
      set(grid, i, 8, false)
      set(grid, 8, i, false)
    }
  }
  // Eight bits run along row 8 beside the top-right finder, and the other seven
  // run up column 8 beside the bottom-left one. Seven, not eight: the eighth
  // module up that column is the dark module set just above, and reserving eight
  // here would overwrite it with a light module.
  for (let i = 0; i < 8; i += 1) set(grid, size - 1 - i, 8, false)
  for (let i = 0; i < 7; i += 1) set(grid, 8, size - 1 - i, false)

  // Version information, from version 7. Two 3x6 blocks near the far finders.
  if (version >= 7) {
    const bits = versionBits(version)
    for (let i = 0; i < 18; i += 1) {
      const dark = ((bits >> i) & 1) === 1
      const a = Math.floor(i / 3)
      const b = i % 3
      set(grid, a, size - 11 + b, dark)
      set(grid, size - 11 + b, a, dark)
    }
  }
}

/** BCH(18,6) version information, as the standard tabulates it. */
function versionBits(version: number): number {
  let remainder = version
  for (let i = 0; i < 12; i += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25)
  }
  return ((version << 12) | remainder) & 0x3ffff
}

/** BCH(15,5) format information, masked with the standard's constant. */
function formatBits(level: EcLevel, mask: number): number {
  const data = (EC_LEVELS[level] << 3) | mask
  let remainder = data
  for (let i = 0; i < 10; i += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537)
  }
  return ((data << 10) | remainder) ^ 0x5412
}

function placeFormat(grid: Grid, level: EcLevel, mask: number): void {
  const bits = formatBits(level, mask)
  const size = grid.size

  for (let i = 0; i < 15; i += 1) {
    const dark = ((bits >> i) & 1) === 1
    // Around the top-left finder.
    if (i < 6) set(grid, 8, i, dark)
    else if (i < 8) set(grid, 8, i + 1, dark)
    else if (i < 9) set(grid, 7, 8, dark)
    else set(grid, 14 - i, 8, dark)

    // And the copy split between the other two.
    if (i < 8) set(grid, size - 1 - i, 8, dark)
    else set(grid, 8, size - 15 + i, dark)
  }
}

/** The eight mask conditions, by index. */
function maskAt(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0
    case 1:
      return y % 2 === 0
    case 2:
      return x % 3 === 0
    case 3:
      return (x + y) % 3 === 0
    case 4:
      return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
  }
}

/**
 * Lay the codewords out, bottom-right to top-left, two columns at a time.
 *
 * The zigzag skips the vertical timing pattern column, which is why the column
 * index steps past 6 rather than through it.
 */
function placeData(grid: Grid, codewords: Uint8Array, mask: number): void {
  const size = grid.size
  let bit = 0
  let upward = true

  for (let right = size - 1; right >= 1; right -= 2) {
    // Step the loop variable itself, not a copy. Column 6 is the vertical timing
    // pattern, so the pair straddling it shifts one left and every pair after it
    // shifts too. Skipping with a local would leave the sequence running
    // 6, 4, 2, which visits column 4 twice and never reaches column 0.
    if (right === 6) right = 5
    for (let step = 0; step < size; step += 1) {
      const y = upward ? size - 1 - step : step
      for (const x of [right, right - 1]) {
        const index = y * size + x
        if (grid.reserved[index]) continue

        const byte = codewords[bit >>> 3] ?? 0
        const value = ((byte >>> (7 - (bit & 7))) & 1) === 1
        bit += 1
        grid.modules[index] = value !== maskAt(mask, x, y)
      }
    }
    upward = !upward
  }
}

/** The standard's four penalty rules, summed. Lower is better. */
function penalty(grid: Grid): number {
  const size = grid.size
  const at = (x: number, y: number): boolean => grid.modules[y * size + x] === true
  let score = 0

  // Rule 1: runs of five or more of the same colour, in both directions.
  for (let i = 0; i < size; i += 1) {
    for (const horizontal of [true, false]) {
      let run = 1
      for (let j = 1; j < size; j += 1) {
        const current = horizontal ? at(j, i) : at(i, j)
        const previous = horizontal ? at(j - 1, i) : at(i, j - 1)
        if (current === previous) {
          run += 1
        } else {
          if (run >= 5) score += run - 2
          run = 1
        }
      }
      if (run >= 5) score += run - 2
    }
  }

  // Rule 2: every 2x2 block of one colour.
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const a = at(x, y)
      if (a === at(x + 1, y) && a === at(x, y + 1) && a === at(x + 1, y + 1)) score += 3
    }
  }

  // Rule 3: the finder-like 1:1:3:1:1 sequence with four light modules beside it.
  const patternA = [true, false, true, true, true, false, true, false, false, false, false]
  const patternB = [false, false, false, false, true, false, true, true, true, false, true]
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      for (const pattern of [patternA, patternB]) {
        if (x + pattern.length <= size) {
          let match = true
          for (let i = 0; i < pattern.length; i += 1) {
            if (at(x + i, y) !== pattern[i]) {
              match = false
              break
            }
          }
          if (match) score += 40
        }
        if (y + pattern.length <= size) {
          let match = true
          for (let i = 0; i < pattern.length; i += 1) {
            if (at(x, y + i) !== pattern[i]) {
              match = false
              break
            }
          }
          if (match) score += 40
        }
      }
    }
  }

  // Rule 4: deviation from an even balance of dark and light.
  let dark = 0
  for (let i = 0; i < size * size; i += 1) if (grid.modules[i] === true) dark += 1
  const percent = (dark * 100) / (size * size)
  score += Math.floor(Math.abs(percent - 50) / 5) * 10

  return score
}

/**
 * Encode bytes as a QR code.
 *
 * The mask is chosen by scoring all eight, which is what the standard says to
 * do and what makes a code readable at an angle in poor light. Skipping it
 * produces a valid code that scans badly, which is the worst kind of wrong here:
 * it works on the developer's phone and fails on the user's.
 */
export function encodeQr(data: Uint8Array, options: EncodeOptions = {}): QrCode {
  return encodeSegment(byteSegment(data), options)
}

/**
 * Text in alphanumeric mode, for BBQr frames (SP-TX-6). Refuses any character
 * outside QR_ALPHANUMERIC rather than falling back to byte mode, because a
 * frame that silently changed mode would pass every test here and fail the
 * one requirement this function exists to meet.
 */
export function encodeQrAlphanumeric(text: string, options: EncodeOptions = {}): QrCode {
  return encodeSegment(alphanumericSegment(text), options)
}

function encodeSegment(segment: Segment, options: EncodeOptions): QrCode {
  const level = options.level ?? 'M'
  const version = options.version ?? chooseVersion(segment, level)

  if (version < 1 || version > 40 || !Number.isInteger(version)) {
    throw new QrError(`QR version ${String(version)} does not exist. Versions run 1 to 40.`)
  }
  if (codewordsNeeded(segment, version) > dataCapacity(version, level)) {
    throw new QrError(
      `${String(segment.count)} ${segment.mode === 'byte' ? 'bytes' : 'characters'} do not ` +
        `fit in version ${String(version)} at level ${level}.`
    )
  }

  const codewords = interleave(encodeData(segment, version, level), version, level)
  const size = moduleCount(version)

  if (options.mask !== undefined && (options.mask < 0 || options.mask > 7)) {
    throw new QrError(`QR mask ${String(options.mask)} does not exist. Masks run 0 to 7.`)
  }
  const candidates = options.mask === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [options.mask]

  let best: { grid: Grid; mask: number; score: number } | undefined
  for (const mask of candidates) {
    const grid = newGrid(size)
    placeFunctionPatterns(grid, version)
    placeData(grid, codewords, mask)
    placeFormat(grid, level, mask)
    const score = penalty(grid)
    if (best === undefined || score < best.score) best = { grid, mask, score }
  }
  if (best === undefined) throw new QrError('No mask could be selected.')

  return {
    size,
    modules: best.grid.modules.map((module) => module === true),
    version,
    level,
    mask: best.mask,
  }
}

/** UTF-8 text, which is what every payload here actually is. */
export function encodeQrText(text: string, options: EncodeOptions = {}): QrCode {
  return encodeQr(new TextEncoder().encode(text), options)
}

/**
 * The code as an SVG path, for a screen that has no canvas.
 *
 * One path element with a rectangle per dark module. Larger than a bitmap and
 * far easier to render crisply at any size, which matters on a 7 inch panel
 * where a blurry code is one a camera will not read.
 */
export function qrToSvgPath(code: QrCode): string {
  const parts: string[] = []
  for (let y = 0; y < code.size; y += 1) {
    for (let x = 0; x < code.size; x += 1) {
      if (code.modules[y * code.size + x] === true) {
        parts.push(`M${String(x)} ${String(y)}h1v1h-1z`)
      }
    }
  }
  return parts.join('')
}
