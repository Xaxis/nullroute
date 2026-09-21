/**
 * Tests for core.qr.bbqr.
 *
 * The split is the easy half. The interesting half is the collector, because a
 * camera pointed at an animating screen sees frames repeatedly, out of order,
 * and occasionally from whatever else is in shot. Assembling a payload out of
 * two different transfers would produce a PSBT that parses, describes a
 * plausible transaction, and is not the one anybody meant to sign.
 *
 * So most of what follows is about refusing, and the round-trips exist to prove
 * the refusals are not simply refusing everything.
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { base32nopad } from '@scure/base'
import { beforeAll, describe, expect, it } from 'vitest'
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader'
import {
  BbqrCollector,
  BbqrError,
  joinBbqr,
  parseBbqrPart,
  splitBbqr,
  splitBbqrToQr,
  MAX_PARTS,
} from '../src/qr/bbqr.js'
import { type QrCode } from '../src/qr/encode.js'

beforeAll(async () => {
  const require = createRequire(import.meta.url)
  const wasmBinary = readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm'))
  await prepareZXingModule({ overrides: { wasmBinary }, fireImmediately: true })
}, 30_000)

function payload(length: number): Uint8Array {
  const out = new Uint8Array(length)
  for (let i = 0; i < length; i += 1) out[i] = (i * 131 + (i >> 7) * 17) & 0xff
  return out
}

async function decodeText(code: QrCode): Promise<string> {
  const scale = 3
  const quiet = 4
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
  const results = await readBarcodes(
    { data, width: dimension, height: dimension, colorSpace: 'srgb' } as ImageData,
    { formats: ['QRCode'], tryHarder: true }
  )
  const first = results[0]
  if (first === undefined) throw new Error('no QR code found')
  return first.text
}

describe('core.qr.bbqr', () => {
  // INV-QR-2. What goes out comes back, at sizes that need one frame and many.
  it('round-trips-payloads-of-every-size', async () => {
    for (const length of [0, 1, 5, 6, 100, 1000, 4321, 20_000]) {
      const data = payload(length)
      const parts = splitBbqr(data, 'psbt')
      const joined = await joinBbqr(parts.map((part) => part.text))

      expect(Buffer.from(joined.data).equals(Buffer.from(data)), `length ${String(length)}`).toBe(
        true
      )
      expect(joined.fileType).toBe('psbt')
    }
  })

  it('writes-the-header-the-format-specifies', () => {
    const parts = splitBbqr(payload(5000), 'psbt')
    expect(parts.length).toBeGreaterThan(1)

    parts.forEach((part, index) => {
      // B$ then encoding, file type, total, index. Eight characters, exactly.
      expect(part.text.slice(0, 4)).toBe('B$2P')
      expect(part.text.slice(4, 6)).toBe(parts.length.toString(36).toUpperCase().padStart(2, '0'))
      expect(part.text.slice(6, 8)).toBe(index.toString(36).toUpperCase().padStart(2, '0'))
      expect(part.index).toBe(index)
      expect(part.total).toBe(parts.length)
    })
  })

  /**
   * INV-QR-3. Each part decodes on its own.
   *
   * A receiver that must hold every frame before it can check any of them cannot
   * tell a user which frame to rescan. Base32 turns five bytes into eight
   * characters, so a split that ignored that boundary would produce parts that
   * only decode in sequence.
   */
  it('makes-every-part-independently-decodable', () => {
    for (const length of [37, 1000, 9999]) {
      for (const part of splitBbqr(payload(length), 'psbt')) {
        const parsed = parseBbqrPart(part.text)
        expect(() => base32nopad.decode(parsed.payload)).not.toThrow()
      }
    }
  })

  it('accepts-parts-in-any-order-and-tolerates-repeats', async () => {
    const data = payload(3000)
    const parts = splitBbqr(data, 'psbt')
    expect(parts.length).toBeGreaterThan(2)

    const collector = new BbqrCollector()
    // Backwards, with the first frame seen three times, as a camera would.
    expect(collector.add(parts[0]?.text ?? '')).toBe(true)
    expect(collector.add(parts[0]?.text ?? '')).toBe(false)
    for (const part of [...parts].reverse()) collector.add(part.text)
    expect(collector.add(parts[0]?.text ?? '')).toBe(false)

    expect(collector.complete).toBe(true)
    expect(collector.received).toBe(parts.length)
    expect(Buffer.from((await collector.assemble()).data).equals(Buffer.from(data))).toBe(true)
  })

  it('reports-what-it-is-still-waiting-for', async () => {
    const parts = splitBbqr(payload(3000), 'psbt')
    const collector = new BbqrCollector()
    for (const part of parts) if (part.index !== 1) collector.add(part.text)

    expect(collector.complete).toBe(false)
    expect(collector.missing).toEqual([1])
    expect(collector.total).toBe(parts.length)
    await expect(collector.assemble()).rejects.toThrow(/waiting on 1 of/)

    collector.reset()
    expect(collector.received).toBe(0)
    expect(collector.total).toBeUndefined()
  })

  /**
   * INV-QR-4. Frames from a second transfer must not be folded in.
   *
   * The realistic version of this is two devices animating side by side, or a
   * user restarting an export mid-scan. Both produce valid parts that belong to
   * different payloads, and joining them silently is how someone signs a
   * transaction assembled from two documents.
   */
  it('refuses-parts-that-belong-to-a-different-transfer', () => {
    const a = splitBbqr(payload(3000), 'psbt')
    const b = splitBbqr(payload(9000), 'psbt')
    const c = splitBbqr(payload(3000), 'json')

    const collector = new BbqrCollector()
    collector.add(a[0]?.text ?? '')
    // A different total means a different payload.
    expect(() => collector.add(b[1]?.text ?? '')).toThrow(/different transfer/)
    // As does a different file type.
    expect(() => collector.add(c[1]?.text ?? '')).toThrow(/different transfer/)
  })

  it('refuses-the-same-index-arriving-with-different-contents', () => {
    const a = splitBbqr(payload(3000), 'psbt')
    const b = splitBbqr(payload(3000).fill(9), 'psbt')
    expect(a.length).toBe(b.length)

    const collector = new BbqrCollector()
    collector.add(a[0]?.text ?? '')
    expect(() => collector.add(b[0]?.text ?? '')).toThrow(/twice with different contents/)
  })

  it('refuses-anything-that-is-not-a-bbqr-part', () => {
    expect(() => parseBbqrPart('bitcoin:bc1qexample')).toThrow(/does not begin with B\$/)
    expect(() => parseBbqrPart('B$2P')).toThrow(/truncated/)
    expect(() => parseBbqrPart('B$9P0100')).toThrow(/encoding 9/)
    expect(() => parseBbqrPart('B$2?0100')).toThrow(/file type \?/)
    expect(() => parseBbqrPart('B$2P0000')).toThrow(/transfer of no parts/)
    // Part 3 of 2 cannot be.
    expect(() => parseBbqrPart('B$2P0202')).toThrow(/which cannot be/)
    expect(() => parseBbqrPart('')).toThrow(BbqrError)
  })

  it('refuses-a-payload-that-needs-more-parts-than-the-format-allows', () => {
    // Version 10 at level H carries 65 bytes a frame, so this needs some three
    // thousand of them and the format has room for 1295.
    expect(() => splitBbqr(payload(200_000), 'psbt', { maxVersion: 10, level: 'H' })).toThrow(
      /BBQr allows/
    )
    /*
     * THE COUNT OF VALUES IS NOT THE LARGEST TOTAL, and this was 1296, which
     * is the count. The index field runs 0 through 1295; the total field is the
     * same two base36 characters and counts from one, so the largest total it
     * can write is 1295. The guard is `total > MAX_PARTS`, so a payload needing
     * exactly 1296 parts was accepted and wrote 1296 as "100": a nine character
     * header on a format whose header is eight, emitted as a whole transfer no
     * reader can parse.
     *
     * The line above this one has always said the format has room for 1295.
     */
    expect(MAX_PARTS).toBe(1295)
    // The property that value exists for: the total fits the field, and one
    // more does not.
    expect(MAX_PARTS.toString(36)).toHaveLength(2)
    expect((MAX_PARTS + 1).toString(36)).toHaveLength(3)

    // And a density cap with no room for even one base32 group says so, rather
    // than dividing by zero and reporting an impossible number of parts.
    expect(() => splitBbqr(payload(100), 'psbt', { maxVersion: 1, level: 'H' })).toThrow(
      /no room for a BBQr payload/
    )
  })

  it('reports-an-undecodable-payload-against-the-part-that-carried-it', async () => {
    const parts = splitBbqr(payload(200), 'psbt')
    const broken = parts.map((part, i) => (i === 0 ? `${part.text.slice(0, -1)}1` : part.text))
    // 1 is not in the base32 alphabet, so this is a misread rather than a
    // different payload, and the message has to say which frame to try again.
    await expect(joinBbqr(broken)).rejects.toThrow(/Part 1 did not decode/)
  })

  /**
   * Coldcard writes compressed parts by default. Refusing them would mean
   * refusing the counterpart most users actually own.
   */
  it('reads-compressed-parts-it-does-not-write', async () => {
    const data = payload(4000)
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(data)
        controller.close()
      },
    })
    const reader = source.pipeThrough<Uint8Array>(new CompressionStream('deflate-raw')).getReader()
    const chunks: Uint8Array[] = []
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
    const deflated = new Uint8Array(Buffer.concat(chunks.map((c) => Buffer.from(c))))

    // Compression happens before the split, so it inflates once at the join.
    const text = `B$ZP0100${base32nopad.encode(deflated)}`
    const joined = await joinBbqr([text])
    expect(Buffer.from(joined.data).equals(Buffer.from(data))).toBe(true)
  })

  /**
   * INV-QR-5. The frames a screen shows are frames a camera reads.
   *
   * Splitting correctly and then emitting a code too dense to scan would satisfy
   * every other test here, so this one goes through the renderer and an
   * independent decoder rather than checking the strings.
   */
  it('emits-frames-an-independent-decoder-reads-back', async () => {
    const data = payload(2400)
    const parts = splitBbqr(data, 'psbt')
    const codes = splitBbqrToQr(data, 'psbt')

    expect(codes).toHaveLength(parts.length)
    for (const code of codes) {
      // Nothing denser than the cap, whatever the payload.
      expect(code.version).toBeLessThanOrEqual(12)
    }

    const scanned: string[] = []
    for (const code of codes) scanned.push(await decodeText(code))
    expect(scanned).toEqual(parts.map((part) => part.text))

    const joined = await joinBbqr(scanned)
    expect(Buffer.from(joined.data).equals(Buffer.from(data))).toBe(true)
  }, 60_000)

  it('honours-a-lower-density-cap-by-using-more-frames', () => {
    const data = payload(4000)
    const dense = splitBbqr(data, 'psbt', { maxVersion: 20 })
    const sparse = splitBbqr(data, 'psbt', { maxVersion: 8 })
    expect(sparse.length).toBeGreaterThan(dense.length)
  })
})
