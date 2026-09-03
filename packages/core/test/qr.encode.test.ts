/**
 * Tests for core.qr.encode.
 *
 * A hand-written QR encoder cannot check itself. Comparing its output to its own
 * expectations proves the code does what it does, which is not the question. The
 * question is whether a camera the author has never seen will read the square,
 * and the only way to answer it is to decode with something written by other
 * people from the same standard.
 *
 * So the substantial test here encodes at every version and every error
 * correction level and decodes each one with zxing, a C++ implementation with
 * two decades of scanners behind it. That is 160 combinations, and it exists
 * because the block layout table in tables.ts is 160 rows of hand-transcribed
 * constants. A single mistyped number there produces a code that some readers
 * accept and others do not, which is the failure that reaches a user rather than
 * a test.
 *
 * zxing is a devDependency and a test oracle. It is not on the device.
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { beforeAll, describe, expect, it } from 'vitest'
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader'
import { encodeQr, encodeQrText, qrToSvgPath, QrError, type QrCode } from '../src/qr/encode.js'
import { dataCapacity, moduleCount, type EcLevel } from '../src/qr/tables.js'

const LEVELS: readonly EcLevel[] = ['L', 'M', 'Q', 'H']

beforeAll(async () => {
  // The wasm is loaded from disk rather than fetched, because a test suite that
  // reaches the network is a test suite that fails on the aeroplane, and because
  // this repository does not do that.
  const require = createRequire(import.meta.url)
  const wasmBinary = readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm'))
  await prepareZXingModule({ overrides: { wasmBinary }, fireImmediately: true })
}, 30_000)

/**
 * Render a code the way a scanner expects to see one.
 *
 * The quiet zone is four modules, which the standard requires. Leaving it out
 * produces an image that our own reasoning says is a valid code and that real
 * decoders refuse, so it is part of the render rather than the caller's problem.
 */
function toImageData(code: QrCode, scale = 3, quiet = 4): ImageData {
  const dimension = (code.size + quiet * 2) * scale
  const data = new Uint8ClampedArray(dimension * dimension * 4).fill(255)

  for (let y = 0; y < code.size; y += 1) {
    for (let x = 0; x < code.size; x += 1) {
      if (code.modules[y * code.size + x] !== true) continue
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const pixel = (((y + quiet) * scale + dy) * dimension + (x + quiet) * scale + dx) * 4
          data[pixel] = 0
          data[pixel + 1] = 0
          data[pixel + 2] = 0
        }
      }
    }
  }
  return { data, width: dimension, height: dimension, colorSpace: 'srgb' } as ImageData
}

/**
 * Decode with zxing, returning the raw bytes and what the symbol says about
 * itself.
 *
 * Version and correction level come from `extra`, which zxing fills from the
 * code's own format and version blocks. Reading them back is what proves those
 * blocks were written correctly, rather than merely that the data survived.
 */
async function decode(code: QrCode): Promise<{ bytes: Uint8Array; version: number; ec: string }> {
  const results = await readBarcodes(toImageData(code), {
    formats: ['QRCode'],
    tryHarder: true,
  })
  const first = results[0]
  if (first === undefined) {
    throw new Error(`zxing found no QR code in a version ${String(code.version)} render.`)
  }

  const extra = JSON.parse(first.extra) as Record<string, unknown>
  return {
    bytes: Uint8Array.from(first.bytes),
    version: Number.parseInt(String(extra['Version']), 10),
    ec: String(extra['ECLevel']),
  }
}

/** The most bytes that fit at this version and level. */
function maxBytes(version: number, level: EcLevel): number {
  const countBits = version < 10 ? 8 : 16
  return Math.floor((dataCapacity(version, level) * 8 - 4 - countBits) / 8)
}

/**
 * A deterministic payload of arbitrary bytes.
 *
 * Not text, because byte mode must carry a signed transaction, and not random,
 * because a test that fails one run in fifty is a test nobody trusts.
 */
function payload(length: number): Uint8Array {
  const out = new Uint8Array(length)
  for (let i = 0; i < length; i += 1) out[i] = (i * 97 + (i >> 5) * 31) & 0xff
  return out
}

describe('core.qr.encode', () => {
  /**
   * INV-QR-1. Every version and level, encoded here and decoded elsewhere.
   *
   * Each case fills the version to capacity, so the block layout is exercised at
   * the boundary where an off-by-one in the table shows up rather than at some
   * comfortable middle where a wrong row still happens to work.
   */
  it('round-trips-every-version-and-level-through-an-independent-decoder', async () => {
    const failures: string[] = []

    for (let version = 1; version <= 40; version += 1) {
      for (const level of LEVELS) {
        const data = payload(maxBytes(version, level))
        const code = encodeQr(data, { version, level })

        expect(code.size, `version ${String(version)} size`).toBe(moduleCount(version))

        try {
          const decoded = await decode(code)
          if (Buffer.compare(Buffer.from(decoded.bytes), Buffer.from(data)) !== 0) {
            failures.push(
              `v${String(version)}${level}: decoded ${String(decoded.bytes.length)} bytes, ` +
                `expected ${String(data.length)}`
            )
            continue
          }
          // zxing reads the version and level out of the code's own format and
          // version blocks, so agreement means those were written correctly
          // and not merely that the data survived.
          if (decoded.version !== version) {
            failures.push(
              `v${String(version)}${level}: format block says version ${String(decoded.version)}`
            )
          }
          if (decoded.ec !== level) {
            failures.push(`v${String(version)}${level}: format block says level ${decoded.ec}`)
          }
        } catch (err) {
          failures.push(`v${String(version)}${level}: ${(err as Error).message}`)
        }
      }
    }

    expect(failures, `${String(failures.length)} of 160 combinations failed`).toEqual([])
  }, 300_000)

  it('picks-the-smallest-version-that-fits', () => {
    expect(encodeQr(payload(10), { level: 'M' }).version).toBe(1)
    // One byte past version 1 at level M must step up rather than truncate.
    const justOver = maxBytes(1, 'M') + 1
    expect(encodeQr(payload(justOver), { level: 'M' }).version).toBe(2)
  })

  it('refuses-a-payload-that-does-not-fit', () => {
    expect(() => encodeQr(payload(maxBytes(40, 'H') + 1), { level: 'H' })).toThrow(QrError)
    expect(() => encodeQr(payload(maxBytes(40, 'H') + 1), { level: 'H' })).toThrow(/BBQr/)
    expect(() => encodeQr(payload(10), { version: 1, level: 'H' })).toThrow(/do not fit/)
    expect(() => encodeQr(payload(1), { version: 41 })).toThrow(/1 to 40/)
    expect(() => encodeQr(payload(1), { version: 0 })).toThrow(/1 to 40/)
  })

  /**
   * A higher correction level means less room, always. If this ever inverts, a
   * row in the layout table has its levels transposed.
   */
  it('gives-less-room-as-correction-rises', () => {
    for (let version = 1; version <= 40; version += 1) {
      const capacities = LEVELS.map((level) => dataCapacity(version, level))
      for (let i = 1; i < capacities.length; i += 1) {
        expect(capacities[i], `version ${String(version)} level ${LEVELS[i] ?? ''}`).toBeLessThan(
          capacities[i - 1] ?? 0
        )
      }
    }
  })

  it('encodes-text-as-utf8', async () => {
    const text = 'nullroute: an air-gapped signer. Uñicode ok. 100 rolls, not 99.'
    const decoded = await decode(encodeQrText(text))
    expect(new TextDecoder().decode(decoded.bytes)).toBe(text)
  })

  /**
   * The mask is chosen by score, not fixed. A code that always used mask 0 would
   * still decode in a test and scan badly in a room, so this checks the
   * selection actually varies with content.
   */
  it('chooses-a-mask-by-score-rather-than-always-the-same-one', () => {
    const masks = new Set<number>()
    for (let i = 0; i < 40; i += 1) masks.add(encodeQrText(`payload number ${String(i)}`).mask)
    expect(masks.size).toBeGreaterThan(1)
  })

  it('renders-an-svg-path-with-one-rect-per-dark-module', () => {
    const code = encodeQrText('svg')
    const path = qrToSvgPath(code)
    const dark = code.modules.filter(Boolean).length
    expect(path.match(/M/g)?.length).toBe(dark)
    expect(dark).toBeGreaterThan(0)
    // And it is a path, not markup, so a caller cannot be tricked into
    // injecting anything by controlling the payload.
    expect(path).not.toMatch(/[<>&"']/)
  })

  /**
   * The finder patterns are the three big squares, and they are what a scanner
   * locates first. Checking them directly catches a matrix that decodes because
   * zxing is forgiving rather than because it is right.
   */
  it('places-the-three-finder-patterns-and-the-dark-module', () => {
    const code = encodeQrText('finders')
    const at = (x: number, y: number): boolean => code.modules[y * code.size + x] === true

    for (const [ox, oy] of [
      [0, 0],
      [code.size - 7, 0],
      [0, code.size - 7],
    ] as const) {
      expect(at(ox + 0, oy + 0), 'outer ring').toBe(true)
      expect(at(ox + 1, oy + 1), 'inner light ring').toBe(false)
      expect(at(ox + 3, oy + 3), 'core').toBe(true)
    }
    // Always set, in every code, at this exact module.
    expect(at(8, code.size - 8)).toBe(true)
  })

  it('is-deterministic', () => {
    const data = payload(200)
    const a = encodeQr(data, { level: 'Q' })
    const b = encodeQr(data, { level: 'Q' })
    expect(a.modules).toEqual(b.modules)
    expect(a.mask).toBe(b.mask)
  })
})
