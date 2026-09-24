import { type ReactElement, useCallback, useEffect, useMemo, useState } from 'react'
import { encodeQrText, qrToSvgPath, splitBbqr, type QrCode } from '@nullroute/core'

/**
 * A QR code, or a sequence of them, on a 7 inch panel.
 *
 * Spec: ui.screens.qr
 *
 * This is one half of the air gap. Everything the device hands back leaves
 * through here, so the failure that matters is a code that looks right on a
 * desk and will not scan in a room.
 *
 * Three decisions follow from that. The code is an SVG path rather than a
 * bitmap, so it stays crisp at whatever size the layout gives it. It renders on
 * white with a quiet zone, always, even though the rest of the interface is
 * dark: a scanner looks for a light margin and an inverted code with none is a
 * code most phones refuse. And the frame counter is text, not a progress bar,
 * because a user who missed frame 3 of 7 needs to know which one.
 */

export type QrFileType = 'psbt' | 'transaction' | 'json' | 'unicode' | 'binary'

export interface QrDisplayProps {
  /** The payload. Split automatically when it is too large for one code. */
  readonly text: string
  /**
   * What the payload is, for the BBQr header, when splitting.
   *
   * A single-frame payload is shown bare rather than wrapped, because most
   * scanners handle a plain string and a lone BBQr part would need software
   * that speaks the format for no gain.
   */
  readonly fileType?: QrFileType
  /** Milliseconds per frame when animating. */
  readonly interval?: number
  readonly testId?: string
}

/** Slow enough for a phone to lock focus, fast enough not to bore anyone. */
const DEFAULT_INTERVAL = 400

/**
 * The bytes a BBQr sequence carries for this payload.
 *
 * BBQr type P is a PSBT FILE, which BIP-174 defines as binary, and it is what
 * Coldcard writes and what this device's own scanner expects: App decodes a
 * P transfer as binary and base64-encodes it for review. This used to send the
 * characters of the base64 text instead, so a signed PSBT too large for one
 * code reached every reader, this device included, as bytes that are not a
 * PSBT. Decoded here, with `atob` for the same reason App uses `btoa`: no
 * dependency and no Buffer in the browser. Invalid base64 throws, and the
 * display shows the error rather than a sequence nobody can read.
 */
export function bbqrPayload(text: string, fileType: QrFileType): Uint8Array {
  if (fileType !== 'psbt') return new TextEncoder().encode(text)
  const binary = atob(text.replace(/\s+/gu, ''))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function QrDisplay(props: QrDisplayProps): ReactElement {
  const { text, fileType = 'unicode', interval = DEFAULT_INTERVAL, testId } = props

  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const codes = useMemo<readonly QrCode[]>(() => {
    setError(null)
    try {
      // One frame if it fits, which is the common case for an xpub or an
      // address, and a BBQr sequence when it does not.
      return [encodeQrText(text, { level: 'M', version: 12 })]
    } catch {
      try {
        return splitBbqr(bbqrPayload(text, fileType), fileType).map((part) =>
          encodeQrText(part.text, { level: 'M' })
        )
      } catch (err) {
        setError((err as Error).message)
        return []
      }
    }
  }, [text, fileType])

  // A new payload starts at the beginning. Without this a shorter sequence
  // would open on a frame index left over from a longer one and show nothing.
  useEffect(() => {
    setFrame(0)
  }, [codes])

  useEffect(() => {
    if (!playing || codes.length < 2) return
    const timer = setInterval(() => {
      setFrame((current) => (current + 1) % codes.length)
    }, interval)
    return () => {
      clearInterval(timer)
    }
  }, [playing, codes.length, interval])

  const step = useCallback(
    (delta: number) => {
      setPlaying(false)
      setFrame((current) => (current + delta + codes.length) % codes.length)
    },
    [codes.length]
  )

  if (error !== null) {
    return (
      <div className="nr-qr nr-qr--error" data-testid={testId}>
        <p className="nr-note">{error}</p>
      </div>
    )
  }

  const code = codes[frame]
  if (code === undefined) return <div className="nr-qr" data-testid={testId} />

  // Four modules of quiet zone, which the standard requires and scanners
  // enforce. Drawn into the viewBox rather than added as CSS padding so it
  // survives whatever the surrounding layout does.
  const quiet = 4
  const span = code.size + quiet * 2

  return (
    <div className="nr-qr" data-testid={testId}>
      <svg
        className="nr-qr__code"
        viewBox={`0 0 ${String(span)} ${String(span)}`}
        role="img"
        aria-label={
          codes.length > 1
            ? `QR code, frame ${String(frame + 1)} of ${String(codes.length)}`
            : 'QR code'
        }
        data-frame={frame}
        data-frames={codes.length}
        data-version={code.version}
      >
        <rect width={span} height={span} fill="#ffffff" />
        <g transform={`translate(${String(quiet)} ${String(quiet)})`}>
          <path d={qrToSvgPath(code)} fill="#000000" />
        </g>
      </svg>

      {codes.length > 1 && (
        <div className="nr-qr__controls">
          <button
            type="button"
            className="nr-qr__step"
            onClick={() => {
              step(-1)
            }}
            aria-label="Previous frame"
            data-testid="qr-prev"
          >
            &lt;
          </button>
          <button
            type="button"
            className="nr-qr__play"
            onClick={() => {
              setPlaying(!playing)
            }}
            data-testid="qr-play"
          >
            {playing ? 'Pause' : 'Play'}
          </button>
          <button
            type="button"
            className="nr-qr__step"
            onClick={() => {
              step(1)
            }}
            aria-label="Next frame"
            data-testid="qr-next"
          >
            &gt;
          </button>
          <span className="nr-qr__count nr-mono" data-testid="qr-count">
            {frame + 1} / {codes.length}
          </span>
        </div>
      )}

      {codes.length > 1 && (
        <p className="nr-hint">
          This is a BBQr sequence. Keep the camera on it until your wallet has all {codes.length}{' '}
          frames. They can arrive in any order.
        </p>
      )}
    </div>
  )
}
