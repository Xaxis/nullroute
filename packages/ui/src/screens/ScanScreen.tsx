import { type ReactElement, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { BbqrCollector, parseBbqrPart } from '@nullroute/core'
import { Screen } from '../components/Screen.js'
import { Refusal } from '../components/Refusal.js'
import { Button } from '../components/Button.js'
import { decodeFrame } from '../lib/scanner.js'

/**
 * The camera side of the air gap.
 *
 * Spec: ui.screens.qr
 *
 * A user points the device at another screen showing one code or an animated
 * sequence. Frames arrive out of order, repeatedly, and sometimes from whatever
 * else is in shot. The collector in core handles the ordering and the refusals;
 * this screen's job is to say what is happening, because a scanner that shows
 * nothing while it works is one people give up on.
 *
 * WHAT THIS SCREEN DOES NOT DO. It does not decide anything. A completed
 * payload goes back to the caller as bytes and is parsed and reviewed by the
 * ordinary code, on the ordinary screens. The BBQr file type in the header says
 * what to try first and is never a permission: a payload announcing itself as a
 * PSBT still has to survive the PSBT parser and still has to be read by a human
 * before anything is signed.
 */

export type ScanResult =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'bbqr'; readonly fileType: string; readonly data: Uint8Array }

export interface ScanScreenProps {
  /**
   * The navigation menu, when leaving this screen is free.
   *
   * The only signal this device gives for that. It replaced a Home button in
   * the same corner meaning the same thing, which is how that corner came to
   * have three states and no rule.
   */
  readonly nav?: ReactNode
  readonly title?: string
  readonly hint?: string
  readonly onResult: (result: ScanResult) => void
  readonly onCancel: () => void
  /** Who this device is and which wallet it has open. See `Identity`. */
  readonly identity?: ReactNode
  readonly banner?: ReactElement | null
  /**
   * Injected in tests, where there is no camera, no canvas and no wasm.
   *
   * The seam is one whole frame rather than the decode step, because pulling
   * pixels off a video element is platform glue with nothing to get wrong,
   * while what happens to the strings that come back is the part worth testing.
   * Production passes neither and gets the real ones.
   */
  readonly openCamera?: () => Promise<MediaStream>
  readonly readFrame?: () => Promise<readonly string[]>
}

/** Frames a second to attempt. Higher just burns CPU on a Pi. */
const SCAN_INTERVAL = 200

async function defaultCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    // The rear camera on anything that has two. `ideal` rather than `exact` so
    // a device with one camera still works instead of throwing.
    video: { facingMode: { ideal: 'environment' }, width: 1280, height: 720 },
    audio: false,
  })
}

/**
 * Start the preview, tolerating every way `play()` can fail to be a promise.
 *
 * Whether the preview runs is separate from whether scanning works. The camera
 * is already open by this point and frames may keep arriving even if nothing is
 * painted, so a failure here records a note and returns rather than aborting the
 * scan. Autoplay policies reject the promise; older and non-browser
 * implementations return undefined or throw outright, which is why the call is
 * wrapped rather than merely having `.catch` attached.
 *
 * Nothing is swallowed: every path sets a note the screen displays.
 */
function startPlayback(video: HTMLVideoElement, note: (message: string) => void): void {
  let result: unknown
  try {
    result = video.play()
  } catch (err) {
    note((err as Error).message)
    return
  }
  if (result instanceof Promise) {
    result.catch((err: unknown) => {
      note((err as Error).message)
    })
    return
  }
  if (result === undefined) note('this browser did not report whether playback started')
}

export function ScanScreen(props: ScanScreenProps): ReactElement {
  const {
    title = 'Scan',
    hint,
    onResult,
    onCancel,

    identity,
    banner,
    openCamera = defaultCamera,
    nav,
  } = props

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const collectorRef = useRef(new BbqrCollector())
  const doneRef = useRef(false)

  const [status, setStatus] = useState<'starting' | 'scanning' | 'failed'>('starting')
  const [error, setError] = useState<string | null>(null)
  /** Playback trouble, which is not the same as a transfer that went wrong. */
  const [playbackNote, setPlaybackNote] = useState<string | null>(null)
  const [received, setReceived] = useState(0)
  const [total, setTotal] = useState<number | undefined>(undefined)
  const [missing, setMissing] = useState<readonly number[]>([])

  /**
   * Pull the current video frame through the decoder.
   *
   * Returns nothing rather than throwing when the video has no dimensions yet,
   * which is every tick between the camera opening and the first frame landing.
   */
  const grabFrame = useCallback(async (): Promise<readonly string[]> => {
    const element = videoRef.current
    const canvas = canvasRef.current
    if (element === null || canvas === null) return []
    if (element.videoWidth === 0) return []

    canvas.width = element.videoWidth
    canvas.height = element.videoHeight
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (context === null) return []
    context.drawImage(element, 0, 0)

    return decodeFrame(context.getImageData(0, 0, canvas.width, canvas.height))
  }, [])

  const readFrame = props.readFrame ?? grabFrame

  /**
   * Handle one decoded string.
   *
   * A payload that is not a BBQr part is returned as text immediately: a bare
   * address, a descriptor or a small PSBT needs no reassembly, and requiring the
   * sender to wrap it would rule out most software.
   */
  const consume = useCallback(
    async (text: string): Promise<void> => {
      if (doneRef.current) return

      let isPart = true
      try {
        parseBbqrPart(text)
      } catch {
        isPart = false
      }

      if (!isPart) {
        doneRef.current = true
        onResult({ kind: 'text', text })
        return
      }

      // A frame from another transfer, or the same index twice with different
      // contents, or a full set that does not join into one document. Say so
      // and start over rather than assembling a payload out of two.
      const startOver = (err: unknown): void => {
        setError((err as Error).message)
        collectorRef.current.reset()
        setReceived(0)
        setTotal(undefined)
        setMissing([])
      }

      try {
        collectorRef.current.add(text)
      } catch (err) {
        startOver(err)
        return
      }

      setError(null)
      setReceived(collectorRef.current.received)
      setTotal(collectorRef.current.total)
      setMissing(collectorRef.current.missing)

      // `=== true`, for the same reason as everywhere else on this device.
      // The collector is local rather than the daemon, so this is the weaker
      // case, and assembling a sequence that is not complete would hand the
      // review screen a truncated transaction.
      if (collectorRef.current.complete === true) {
        // Caught here, not left to the polling loop. That loop discards what
        // it awaits, so a refusal from assemble vanished, the collector stayed
        // complete, and every later frame retried the same failed join while
        // the screen sat on a full progress count with nothing to say.
        let assembled: Awaited<ReturnType<BbqrCollector['assemble']>>
        try {
          assembled = await collectorRef.current.assemble()
        } catch (err) {
          startOver(err)
          return
        }
        doneRef.current = true
        onResult({ kind: 'bbqr', fileType: assembled.fileType, data: assembled.data })
      }
    },
    [onResult]
  )

  useEffect(() => {
    let stream: MediaStream | undefined
    let timer: ReturnType<typeof setInterval> | undefined
    let cancelled = false

    const start = async (): Promise<void> => {
      try {
        // The decoder loads itself on its first frame, so nothing is awaited
        // here but the camera. That keeps the permission prompt as the first
        // thing that happens, rather than several megabytes of WebAssembly.
        stream = await openCamera()
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop()
          return
        }

        const video = videoRef.current
        if (video !== null) {
          video.srcObject = stream
          startPlayback(video, setPlaybackNote)
        }
        setStatus('scanning')

        timer = setInterval(() => {
          void (async () => {
            if (doneRef.current) return
            for (const text of await readFrame()) await consume(text)
          })()
        }, SCAN_INTERVAL)
      } catch (err) {
        if (cancelled) return
        setStatus('failed')
        setError((err as Error).message)
      }
    }

    void start()

    return () => {
      cancelled = true
      if (timer !== undefined) clearInterval(timer)
      // Release the camera. A signing device that leaves it running after the
      // screen is gone is one with a light on and no explanation for it.
      if (stream !== undefined) for (const track of stream.getTracks()) track.stop()
    }
  }, [openCamera, readFrame, consume])

  const restart = useCallback(() => {
    collectorRef.current.reset()
    doneRef.current = false
    setReceived(0)
    setTotal(undefined)
    setMissing([])
    setError(null)
  }, [])

  return (
    <Screen
      title={title}
      subtitle={hint ?? 'Hold the other screen inside the frame.'}
      banner={banner}
      nav={nav}
      identity={identity}
      testId="scan-screen"
      actions={
        <>
          <Button onClick={onCancel} testId="scan-cancel">
            Cancel
          </Button>
          <div className="nr-spacer" />
          <Button onClick={restart} testId="scan-restart">
            Start over
          </Button>
        </>
      }
    >
      <div className="nr-scan">
        <div className="nr-scan__viewport">
          {/* Muted and inline, or mobile browsers refuse to autoplay. */}
          <video
            ref={videoRef}
            className="nr-scan__video"
            muted
            playsInline
            data-testid="scan-video"
          />
          <div className="nr-scan__reticle" />
        </div>
        <canvas ref={canvasRef} className="nr-scan__canvas" />
      </div>

      {status === 'starting' && <p className="nr-note">Starting the camera.</p>}

      {status === 'scanning' && playbackNote !== null && (
        <p className="nr-note" data-testid="scan-playback-note">
          The preview did not start ({playbackNote}). Scanning is still running, but if nothing
          arrives, the camera is not delivering frames.
        </p>
      )}

      {status === 'failed' && (
        <div className="nr-banner nr-banner--caution" data-testid="scan-failed">
          <strong>No camera</strong>
          <span>{error ?? 'The camera could not be opened.'}</span>
        </div>
      )}

      {status === 'scanning' && total !== undefined && (
        <div className="nr-card nr-card--tight" data-testid="scan-progress">
          <div className="nr-row">
            <span className="nr-label">Frames</span>
            <span className="nr-value nr-mono">
              {received} of {total}
            </span>
          </div>
          {missing.length > 0 && (
            <div className="nr-row">
              <span className="nr-label">Waiting for</span>
              <span className="nr-value nr-mono" data-testid="scan-missing">
                {/* One-based, because the frame counter on the other screen is.
                    Capped so a long list does not push the layout apart. */}
                {missing
                  .slice(0, 12)
                  .map((index) => index + 1)
                  .join(', ')}
                {missing.length > 12 ? ` and ${String(missing.length - 12)} more` : ''}
              </span>
            </div>
          )}
        </div>
      )}

      {error !== null && status === 'scanning' && (
        <Refusal title="Frames did not match" testId="scan-error" tone="warn">
          {error}
        </Refusal>
      )}
    </Screen>
  )
}
