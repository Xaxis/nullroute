/**
 * Camera decoding, and the one place the QR reader is configured.
 *
 * Spec: ui.screens.qr
 *
 * THE IMPORTANT PART. zxing-wasm ships a default `locateFile` that resolves its
 * WebAssembly binary to `https://fastly.jsdelivr.net`. On this device that is a
 * network call, and network calls are the thing that must not exist here. So the
 * binary is imported through the bundler, emitted beside the rest of the
 * application, and served from the same loopback origin as everything else.
 *
 * `assertSameOrigin` exists so this is checked rather than remembered. Dropping
 * the override during a refactor would leave a device that appears to work on a
 * developer's machine, where the CDN answers, and hangs on a camera screen in
 * the field. That is a failure a user would read as broken hardware.
 *
 * Decoding is the one job worth a dependency. Reading a QR code from a camera
 * means binarisation under uneven light, perspective correction, and
 * Reed-Solomon error correction over a partly misread matrix. Writing that
 * ourselves would be a large amount of subtle code whose failure mode is
 * accepting a payload that is not what was on the other screen. The encoder is
 * in the tree because drawing is tractable; the decoder is not.
 */

import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader'

export class ScannerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScannerError'
  }
}

/**
 * Refuse a location that is not on our own origin.
 *
 * A bare path or a same-origin absolute URL is fine. Anything with a host that
 * is not ours means the reader would fetch code from somewhere else, which on an
 * air-gapped device is both a hang and a supply chain hole.
 */
export function assertSameOrigin(url: string, origin: string): void {
  // A relative path cannot reach off-origin, and is what a bundler emits.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith('//')) return

  let parsed: URL
  try {
    parsed = new URL(url, origin)
  } catch {
    throw new ScannerError(`The QR reader was pointed at an unreadable location: ${url}`)
  }
  if (parsed.origin !== origin) {
    throw new ScannerError(
      `The QR reader would load its decoder from ${parsed.origin}, which is not this device. ` +
        `Refusing: nothing here may reach the network.`
    )
  }
}

/** Where the decoder's WebAssembly actually lives, after bundling. */
export function wasmLocation(): string {
  return wasmUrl
}

let prepared: Promise<void> | undefined

/**
 * Load the decoder, once.
 *
 * Idempotent because several screens may mount a scanner and the module is
 * several megabytes. The promise is cached rather than the result so concurrent
 * callers wait on the same load instead of starting a second one.
 */
export async function prepareScanner(origin: string): Promise<void> {
  assertSameOrigin(wasmUrl, origin)
  prepared ??= prepareZXingModule({
    overrides: { locateFile: () => wasmUrl },
    fireImmediately: true,
  }).then(() => undefined)
  await prepared
}

/**
 * Decode whatever QR codes are in a frame.
 *
 * Loads the decoder on first use rather than making the caller remember to.
 * Preparation is cached, so the cost lands on the first frame and no later one,
 * and a screen that injects its own decoder never touches the WebAssembly at
 * all.
 *
 * Returns every result rather than the first, because a user holding a phone
 * showing an animated sequence may have two frames in shot, and dropping one
 * silently would stall a transfer with no explanation.
 */
export async function decodeFrame(image: ImageData): Promise<readonly string[]> {
  await prepareScanner(globalThis.location.origin)
  const results = await readBarcodes(image, { formats: ['QRCode'], tryHarder: false })
  return results.filter((result) => result.isValid).map((result) => result.text)
}
