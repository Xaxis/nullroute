/**
 * Adapter: Krux, from its own source at a pinned commit.
 *
 * Run it through conformance/interop/krux-adapter.sh, which fetches Krux at a
 * pinned commit of its develop branch and embit at the commit Krux's
 * vendor/embit submodule names there, checks both by commit hash, and sets
 * the two variables below.
 *
 * Each call runs krux/bridge.py, which calls Krux's own functions in the
 * order its pages call them and names the page and lines it follows. Nothing
 * on either side compares against a vector. Krux is MicroPython on MaixPy;
 * krux/stubs.py stands in for the MaixPy modules it imports, following Krux's
 * own test suite.
 *
 * The review reports only what Krux's screens draw. They show no nLockTime,
 * replaceability, sighash type or unknown pairs, and show change beside its
 * branch and index ("1/0") rather than its path, so those fields are left out
 * or reported as drawn, and the cases that check them fail.
 *
 * What Krux has no equivalent for, or what needs code this does not run, is
 * left out, so those cases are reported as not run: the entropy count on
 * screen (Krux's dice page shows a Shannon estimate of the rolls, not the
 * count the profile defines), the manifest, and UR, whose decoder is a C
 * extension (cUR through MaixPy) that this does not build.
 */

import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = process.env.KRUX_SRC
const EMBIT = process.env.KRUX_EMBIT
if (!SRC || !EMBIT) {
  throw new Error(
    'krux.mjs: KRUX_SRC and KRUX_EMBIT are not set; run conformance/interop/krux-adapter.sh'
  )
}
const BRIDGE = join(dirname(fileURLToPath(import.meta.url)), 'krux', 'bridge.py')

export const name = `Krux ${process.env.KRUX_COMMIT ?? '(commit not given)'} (develop, after ${process.env.KRUX_TAG ?? '?'}) with embit ${process.env.KRUX_EMBIT_COMMIT ?? '(commit not given)'} (after ${process.env.KRUX_EMBIT_TAG ?? '?'}), pure-Python secp256k1`

/**
 * The ECDSA nonce scheme (SP-SIG-1). Krux signs with embit's `PSBT.sign_with`,
 * which calls `PrivateKey.sign(msg_hash)` with `grind=True` (embit/ec.py lines
 * 218-231): RFC 6979, retried with additional data LE32(1), LE32(2) and so on
 * until the DER signature is 70 bytes or fewer, which with a low S is a low R.
 * Measured with embit's pure-Python secp256k1; the device's MaixPy C module
 * was not run.
 */
export const ecdsaNonces = 'rfc6979-low-r'

/**
 * Krux does not search for change. An output is change or a self-transfer
 * only when the loaded wallet's descriptor owns it (psbt.py lines 268-289):
 * embit's Descriptor.owns re-derives the one path the output's derivation
 * record names and compares the script (embit/descriptor/descriptor.py lines
 * 209-239). The index has no limit: one more than OWN_INDEX_WINDOW (1000)
 * past the lowest index the inputs spend from is still change, shown after a
 * "Distant address!" warning (psbt.py lines 43 and 372-401, home.py lines
 * 435-452). So no index is beyond a bound.
 */
export const changeSearchBound = Infinity

function bridge(request) {
  // -I: Krux's and embit's trees are fetched code, so nothing from the
  // environment or the current directory joins the import path.
  const r = spawnSync('python3', ['-I', BRIDGE, SRC, EMBIT], {
    input: JSON.stringify(request),
    encoding: 'utf8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    maxBuffer: 16 * 1024 * 1024,
  })
  if (r.status !== 0) throw new Error(`bridge.py exited ${String(r.status)}: ${r.stderr}`)
  return JSON.parse(r.stdout)
}

export function diceToSeed(rolls) {
  return bridge({ op: 'diceToSeed', rolls })
}

/** Krux has no override, so the verdict is `allow` or `refuse`. */
export function reviewPsbt(psbt, context) {
  return bridge({ op: 'reviewPsbt', psbt, context })
}

/** Krux has no override, so `options.override` changes nothing. */
export function signPsbt(psbt, context) {
  return bridge({ op: 'signPsbt', psbt, context })
}

/** The bridge carries the joined bytes as base64; the runner wants them as bytes. */
export function bbqrJoin(frames) {
  const { dataBase64, ...r } = bridge({ op: 'bbqrJoin', frames })
  return dataBase64 === undefined
    ? r
    : { ...r, data: new Uint8Array(Buffer.from(dataBase64, 'base64')) }
}

/**
 * Frames as text only. The QR symbol is drawn by MaixPy's C qrcode module,
 * which this does not run, so the runner cannot read each frame's QR mode.
 */
export function bbqrEncodePsbt(psbt) {
  return bridge({ op: 'bbqrEncodePsbt', psbt })
}
