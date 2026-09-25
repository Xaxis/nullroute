/**
 * Tests for the scan screen and the reader configuration behind it.
 *
 * Two things matter here and neither is the camera.
 *
 * The first is that the decoder's WebAssembly is never fetched off-origin.
 * zxing-wasm's default points at a CDN, and a device that reaches for one has
 * both a network capability it must not have and a screen that hangs in the
 * field while working perfectly on a developer's machine.
 *
 * The second is that frames from two different transfers are never assembled
 * together. That produces a PSBT which parses, describes a plausible
 * transaction, and is not the one anybody meant to sign.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { splitBbqr, urFramesForPsbt } from '@nullroute/core'
import { ScanScreen, type ScanResult } from '../src/screens/ScanScreen.js'
import { assertSameOrigin, ScannerError, wasmLocation } from '../src/lib/scanner.js'

afterEach(cleanup)

/**
 * jsdom cannot construct a MediaStream and validates `srcObject` against one,
 * so assigning a stand-in throws. Replacing the accessor is the smallest shim
 * that lets the screen run; `play()` is left alone deliberately, so the
 * tolerance for environments where it is not implemented gets exercised rather
 * than mocked away.
 */
beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
    configurable: true,
    get: () => null,
    set: () => {
      /* jsdom's own setter would reject a stand-in stream. */
    },
  })
})

const ORIGIN = 'http://localhost:5180'

/** A camera that yields nothing, so the frame loop is driven by `decode`. */
function fakeCamera(): () => Promise<MediaStream> {
  const track = { stop: vi.fn() }
  return () =>
    Promise.resolve({
      getTracks: () => [track],
    } as unknown as MediaStream)
}

/**
 * Feed a fixed script of decoded strings, one per polling tick.
 *
 * The screen pulls pixels off a video element that jsdom never paints, so
 * decoding is injected rather than simulated. What is under test is the
 * assembly logic, not the camera.
 */
function scriptedFrames(script: readonly (readonly string[])[]) {
  let tick = 0
  return () => Promise.resolve(script[tick++] ?? [])
}

/** The signer profile's 1-input 20-output PSBT, base64: a real PSBT. */
function psbtVector(): string {
  const vectors = JSON.parse(
    readFileSync(resolve(process.cwd(), 'spec/vectors/signer-profile/bbqr-psbt.json'), 'utf8')
  ) as { cases: { id: string; input: { psbtBase64?: string } }[] }
  const text = vectors.cases.find((c) => c.id === 'write-1in20out')?.input.psbtBase64
  if (text === undefined) throw new Error('vector missing')
  return text
}

function mount(script: readonly (readonly string[])[], onResult = vi.fn()) {
  render(
    <ScanScreen
      onResult={onResult}
      onCancel={vi.fn()}
      openCamera={fakeCamera()}
      readFrame={scriptedFrames(script)}
    />
  )
  return onResult
}

describe('scanner configuration', () => {
  /**
   * The one that would ship a broken device. A relative or same-origin path is
   * what the bundler emits; anything else means the reader fetches its decoder
   * from somewhere that is not this machine.
   */
  it('refuses-a-decoder-location-that-is-not-on-this-origin', () => {
    expect(() => {
      assertSameOrigin(
        'https://fastly.jsdelivr.net/npm/zxing-wasm@3.1.3/dist/reader/x.wasm',
        ORIGIN
      )
    }).toThrow(ScannerError)
    expect(() => {
      assertSameOrigin('https://example.com/x.wasm', ORIGIN)
    }).toThrow(/not this device/)
    // Protocol-relative resolves against the page's scheme and still leaves us.
    expect(() => {
      assertSameOrigin('//evil.example/x.wasm', ORIGIN)
    }).toThrow(/not this device/)
  })

  /**
   * The bundler must be emitting the decoder locally. If the `?url` import were
   * dropped and zxing's own default came back, this is what would catch it.
   */
  it('points-at-a-decoder-on-our-own-origin', () => {
    expect(() => {
      assertSameOrigin(wasmLocation(), ORIGIN)
    }).not.toThrow()
    expect(wasmLocation()).not.toMatch(/jsdelivr|unpkg|cdn/i)
  })

  it('accepts-a-bundled-asset-path', () => {
    expect(() => {
      assertSameOrigin('/assets/zxing_reader-a1b2c3.wasm', ORIGIN)
    }).not.toThrow()
    expect(() => {
      assertSameOrigin('assets/zxing_reader.wasm', ORIGIN)
    }).not.toThrow()
    expect(() => {
      assertSameOrigin(`${ORIGIN}/assets/zxing_reader.wasm`, ORIGIN)
    }).not.toThrow()
  })
})

describe('ScanScreen', () => {
  it('returns-a-plain-payload-without-waiting-for-a-sequence', async () => {
    const address = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'
    const onResult = mount([[address]])

    await waitFor(() => {
      expect(onResult).toHaveBeenCalledWith({ kind: 'text', text: address })
    })
  })

  it('assembles-a-sequence-arriving-out-of-order', async () => {
    // Small enough that the polling loop gets through it quickly, large
    // enough to need several frames.
    // Labelled binary: arbitrary bytes are not a PSBT, and a psbt label now
    // makes the join check that they are (INV-QR-10).
    const data = new Uint8Array(700).map((_, i) => (i * 31) & 0xff)
    const parts = splitBbqr(data, 'binary')
    expect(parts.length).toBeGreaterThan(2)

    // Backwards, with a repeat, as a camera pointed at a loop would see it.
    const script = [...parts]
      .reverse()
      .map((part) => [part.text])
      .concat([[parts[0]?.text ?? '']])

    const onResult = vi.fn()
    mount(script, onResult)

    await waitFor(
      () => {
        expect(onResult).toHaveBeenCalled()
      },
      { timeout: 8000 }
    )

    const result = onResult.mock.calls[0]?.[0] as ScanResult
    expect(result.kind).toBe('bbqr')
    if (result.kind !== 'bbqr') throw new Error('expected a bbqr result')
    expect(result.fileType).toBe('binary')
    expect(Buffer.from(result.data).equals(Buffer.from(data))).toBe(true)
  }, 15_000)

  it('shows-which-frames-it-is-still-waiting-for', async () => {
    const parts = splitBbqr(new Uint8Array(700).fill(7), 'psbt')
    expect(parts.length).toBeGreaterThan(2)

    // Everything except frame 2, repeatedly, so the screen settles incomplete.
    const withoutSecond = parts.filter((part) => part.index !== 1).map((part) => [part.text])
    mount([...withoutSecond, ...withoutSecond])

    await waitFor(() => {
      expect(screen.getByTestId('scan-progress')).toBeTruthy()
    })
    await waitFor(
      () => {
        // One-based, matching the counter on the screen being photographed.
        expect(screen.getByTestId('scan-missing').textContent).toBe('2')
      },
      // One tick per frame at 200ms, twice through, plus room to settle.
      { timeout: 8000 }
    )
  }, 15_000)

  /**
   * INV-QR-4 at the screen level. Two sequences in shot must not be merged, and
   * the user has to be told rather than left with a silently wrong payload.
   */
  it('refuses-frames-from-a-second-transfer-and-says-so', async () => {
    const a = splitBbqr(new Uint8Array(700).fill(1), 'psbt')
    const b = splitBbqr(new Uint8Array(9000).fill(2), 'psbt')
    const onResult = vi.fn()

    mount([[a[0]?.text ?? ''], [b[1]?.text ?? '']], onResult)

    await waitFor(() => {
      expect(screen.getByTestId('scan-error').textContent).toContain('different transfer')
    })
    // And nothing was handed back.
    expect(onResult).not.toHaveBeenCalled()
  })

  /**
   * INV-QR-10 at the screen level. A full set of frames that does not join
   * into one PSBT is refused with the reason, and the count starts over.
   *
   * The refusal used to be thrown into the polling loop, which discards what
   * it awaits: the screen sat on a full count with nothing to say, and every
   * later frame retried the same failed join.
   */
  it('says-so-when-a-full-set-does-not-join-and-starts-over', async () => {
    const vectors = JSON.parse(
      // From the repository root, as theme.test.tsx reads styles.css: under
      // jsdom import.meta.url is not a file URL.
      readFileSync(resolve(process.cwd(), 'spec/vectors/signer-profile/bbqr-psbt.json'), 'utf8')
    ) as { cases: { id: string; input: { frames: string[] } }[] }
    const frames = vectors.cases.find((c) => c.id === 'two-transfers-disjoint-indices')?.input
      .frames
    if (frames === undefined) throw new Error('vector missing')
    const onResult = vi.fn()

    mount(
      frames.map((frame) => [frame]),
      onResult
    )

    await waitFor(
      () => {
        expect(screen.getByTestId('scan-error').textContent).toContain('do not join into one PSBT')
      },
      { timeout: 8000 }
    )
    expect(onResult).not.toHaveBeenCalled()
    expect(screen.queryByTestId('scan-progress')).toBeNull()
  }, 15_000)

  /**
   * INV-UI-107. A PSBT sent as UR is read as a PSBT: joined late, out of
   * order, from mixed frames, and handed back as binary with its UR type.
   */
  it('reads-a-psbt-sent-as-ur', async () => {
    const text = psbtVector()
    const binary = Uint8Array.from(atob(text), (char) => char.charCodeAt(0))
    const frames = urFramesForPsbt(binary, 200)
    expect(frames.length).toBeGreaterThan(4)
    // Joined partway through the loop, backwards, then the loop comes round
    // again as the display repeats it. Decoding from mixed frames alone is
    // core's test (decodes-from-mixed-parts-alone); this one is the screen.
    const script = [...frames.slice(2).reverse(), ...frames].map((frame) => [frame])
    const onResult = vi.fn()
    mount(script, onResult)

    await waitFor(
      () => {
        expect(onResult).toHaveBeenCalled()
      },
      { timeout: 8000 }
    )
    const result = onResult.mock.calls[0]?.[0] as ScanResult
    if (result.kind !== 'ur') throw new Error(`expected a ur result, got ${result.kind}`)
    expect(result.type).toBe('crypto-psbt')
    expect(Buffer.from(result.data).equals(Buffer.from(binary))).toBe(true)
  }, 15_000)

  /**
   * INV-UI-107. A single-frame UR is a PSBT too, not text. Before UR was read
   * it went to the review screen as the string "UR:CRYPTO-PSBT/...".
   */
  it('reads-a-single-frame-ur-as-a-psbt-not-text', async () => {
    const text = psbtVector()
    const binary = Uint8Array.from(atob(text), (char) => char.charCodeAt(0))
    const [only] = urFramesForPsbt(binary, 100_000)
    const onResult = vi.fn()
    mount([[only ?? '']], onResult)
    await waitFor(() => {
      expect(onResult).toHaveBeenCalled()
    })
    expect((onResult.mock.calls[0]?.[0] as ScanResult).kind).toBe('ur')
  })

  /** INV-UI-107. A UR that is not a PSBT is refused by name. */
  it('refuses-a-ur-that-is-not-a-psbt', async () => {
    const onResult = vi.fn()
    mount([['ur:seed/oyadgdstaslplabghydrpfmkbggufgludprfgmamdpwmox'.toUpperCase()]], onResult)
    await waitFor(() => {
      expect(screen.getByTestId('scan-error').textContent).toContain('not a PSBT')
    })
    expect(onResult).not.toHaveBeenCalled()
  })

  it('reports-a-camera-that-will-not-open', async () => {
    render(
      <ScanScreen
        onResult={vi.fn()}
        onCancel={vi.fn()}
        openCamera={() => Promise.reject(new Error('Permission denied'))}
        readFrame={() => Promise.resolve([])}
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId('scan-failed').textContent).toContain('Permission denied')
    })
  })

  it('releases-the-camera-when-it-goes-away', async () => {
    const track = { stop: vi.fn() }
    const stream = { getTracks: () => [track] } as unknown as MediaStream

    const { unmount } = render(
      <ScanScreen
        onResult={vi.fn()}
        onCancel={vi.fn()}
        openCamera={() => Promise.resolve(stream)}
        readFrame={() => Promise.resolve([])}
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId('scan-video')).toBeTruthy()
    })
    unmount()
    // A signing device that leaves the camera running is one with a light on
    // and no explanation for it.
    await waitFor(() => {
      expect(track.stop).toHaveBeenCalled()
    })
  })
})
