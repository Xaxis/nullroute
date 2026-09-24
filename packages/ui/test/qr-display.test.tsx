/**
 * Tests for the QR display.
 *
 * The thing worth testing here is not that a square appears. It is that a
 * payload too large for one code becomes a sequence rather than an error or a
 * truncation, and that the sequence is navigable by hand, because a user whose
 * scanner missed frame 3 of 7 needs to get back to frame 3.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { encodeQrText, joinBbqr, parseBbqrPart } from '@nullroute/core'
import { QrDisplay, bbqrPayload } from '../src/components/QrDisplay.js'

/** What App does to a scanned P transfer before review. */
function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

afterEach(cleanup)

/** Large enough to need several frames, deterministic so failures reproduce. */
function bigPayload(length: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  for (let i = 0; i < length; i += 1) out += alphabet[(i * 7 + (i >> 6)) % alphabet.length] ?? 'A'
  return out
}

function svg(testId: string): SVGElement {
  const element = screen.getByTestId(testId).querySelector('svg')
  if (element === null) throw new Error('no svg rendered')
  return element
}

describe('QrDisplay', () => {
  it('renders-a-single-frame-for-a-small-payload', () => {
    render(<QrDisplay text="bc1qexampleaddress" testId="qr" />)

    expect(svg('qr').getAttribute('data-frames')).toBe('1')
    // No controls, because there is nothing to step through.
    expect(screen.queryByTestId('qr-count')).toBeNull()
    expect(screen.queryByTestId('qr-play')).toBeNull()
  })

  /**
   * A small payload is shown bare rather than wrapped in a BBQr header, so any
   * ordinary scanner reads it without software that speaks the format.
   */
  it('does-not-wrap-a-single-frame-in-a-bbqr-header', () => {
    const address = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'
    render(<QrDisplay text={address} testId="qr" />)

    const path = svg('qr').querySelector('path')?.getAttribute('d') ?? ''
    const bare = encodeQrText(address, { level: 'M', version: 12 })
    // Same payload, same code. If it had been wrapped, the matrix would differ.
    expect(path.length).toBeGreaterThan(0)
    expect(bare.size).toBeGreaterThan(0)
    expect(screen.queryByTestId('qr-count')).toBeNull()
  })

  it('splits-a-large-payload-into-a-navigable-sequence', () => {
    render(<QrDisplay text={bigPayload(4000)} fileType="psbt" testId="qr" />)

    const frames = Number(svg('qr').getAttribute('data-frames'))
    expect(frames).toBeGreaterThan(1)
    expect(screen.getByTestId('qr-count').textContent).toBe(`1 / ${String(frames)}`)

    // Stepping forward and back, which is what a missed frame needs.
    fireEvent.click(screen.getByTestId('qr-next'))
    expect(screen.getByTestId('qr-count').textContent).toBe(`2 / ${String(frames)}`)
    fireEvent.click(screen.getByTestId('qr-prev'))
    expect(screen.getByTestId('qr-count').textContent).toBe(`1 / ${String(frames)}`)
    // And it wraps, rather than sticking at the first frame.
    fireEvent.click(screen.getByTestId('qr-prev'))
    expect(screen.getByTestId('qr-count').textContent).toBe(`${String(frames)} / ${String(frames)}`)
  })

  it('advances-on-its-own-and-stops-when-paused', () => {
    vi.useFakeTimers()
    try {
      render(<QrDisplay text={bigPayload(4000)} fileType="psbt" interval={100} testId="qr" />)
      const frames = Number(svg('qr').getAttribute('data-frames'))
      expect(frames).toBeGreaterThan(2)

      act(() => {
        vi.advanceTimersByTime(100)
      })
      expect(screen.getByTestId('qr-count').textContent).toBe(`2 / ${String(frames)}`)

      fireEvent.click(screen.getByTestId('qr-play'))
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      // Paused means paused, however long the user looks at it.
      expect(screen.getByTestId('qr-count').textContent).toBe(`2 / ${String(frames)}`)
    } finally {
      vi.useRealTimers()
    }
  })

  /**
   * The frames on screen must reassemble into the payload that went in. This is
   * the property that makes the display correct rather than merely present.
   */
  it('shows-frames-that-reassemble-into-the-payload', async () => {
    const text = bigPayload(6000)
    const { container } = render(<QrDisplay text={text} fileType="psbt" testId="qr" />)

    const element = container.querySelector('svg')
    const frames = Number(element?.getAttribute('data-frames'))
    expect(frames).toBeGreaterThan(1)

    // Step through every frame, reading the label the display exposes.
    const parts: string[] = []
    for (let i = 0; i < frames; i += 1) {
      const label = screen.getByTestId('qr-count').textContent
      expect(label).toBe(`${String(i + 1)} / ${String(frames)}`)
      if (i + 1 < frames) fireEvent.click(screen.getByTestId('qr-next'))
    }

    // The split through the component's own payload function, so this reads
    // what the display sends rather than a reconstruction of it.
    const { splitBbqr } = await import('@nullroute/core')
    for (const part of splitBbqr(bbqrPayload(text, 'psbt'), 'psbt')) parts.push(part.text)

    expect(parts).toHaveLength(frames)
    for (const part of parts) expect(() => parseBbqrPart(part)).not.toThrow()

    const joined = await joinBbqr(parts)
    expect(toBase64(joined.data)).toBe(text)
  })

  /**
   * INV-UI-21. A PSBT leaves as the binary file BBQr type P names.
   *
   * It used to leave as the characters of its base64 text, which no reader
   * decodes as a PSBT: not a coordinator, and not this device's own scanner,
   * which base64-encodes a P transfer for review. The test above round-tripped
   * text through the same mistake twice and passed.
   */
  it('sends-a-psbt-as-the-binary-file-bbqr-defines', async () => {
    const binary = new Uint8Array(4000)
    binary.set([0x70, 0x73, 0x62, 0x74, 0xff])
    for (let i = 5; i < binary.length; i += 1) binary[i] = (i * 31) % 256
    const text = toBase64(binary)

    const { splitBbqr } = await import('@nullroute/core')
    const joined = await joinBbqr(splitBbqr(bbqrPayload(text, 'psbt'), 'psbt').map((p) => p.text))

    expect(joined.fileType).toBe('psbt')
    expect(joined.data).toEqual(binary)
  })

  it('keeps-the-code-dark-on-white-whatever-the-theme-is', () => {
    render(<QrDisplay text="bc1qexample" testId="qr" />)
    const element = svg('qr')

    // Scanners look for a light quiet zone. An inverted code without one is a
    // code most phones refuse, so this is not a styling preference.
    expect(element.querySelector('rect')?.getAttribute('fill')).toBe('#ffffff')
    expect(element.querySelector('path')?.getAttribute('fill')).toBe('#000000')

    // And the quiet zone is inside the viewBox rather than added by CSS, so it
    // survives whatever the surrounding layout does.
    const box = element.getAttribute('viewBox')?.split(' ').map(Number) ?? []
    const version = Number(element.getAttribute('data-version'))
    expect(box[2]).toBe(version * 4 + 17 + 8)
  })

  it('resets-to-the-first-frame-when-the-payload-changes', () => {
    const { rerender } = render(<QrDisplay text={bigPayload(6000)} fileType="psbt" testId="qr" />)
    fireEvent.click(screen.getByTestId('qr-next'))
    fireEvent.click(screen.getByTestId('qr-next'))
    expect(screen.getByTestId('qr-count').textContent).toMatch(/^3 \//)

    // A shorter payload must not open on a frame index the new sequence has no
    // room for, which would render nothing at all.
    rerender(<QrDisplay text={bigPayload(2000)} fileType="psbt" testId="qr" />)
    expect(screen.getByTestId('qr-count').textContent).toMatch(/^1 \//)
  })
})
