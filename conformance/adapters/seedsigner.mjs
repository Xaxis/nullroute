/**
 * Adapter: SeedSigner, from its own source at a pinned commit.
 *
 * The first adapter here for a signer this repository did not write. Run it
 * through conformance/interop/seedsigner-adapter.sh, which fetches SeedSigner
 * and the embit release its requirements.txt pins, checks both against
 * pinned hashes, and sets the two variables below.
 *
 * Each call runs seedsigner/bridge.py, which calls SeedSigner's own functions
 * in the order its views call them and names the view and lines it follows.
 * Nothing on either side compares against a vector.
 *
 * The review reports only what SeedSigner's review screens draw. They show no
 * nLockTime, replaceability, sighash type or unknown pairs, show a change
 * address as its first and last seven characters, and show change as
 * "change address #n" rather than a path, so those fields are left out and
 * the cases that check them fail.
 *
 * The two QR joins run SeedSigner's own decoder (models/decode_qr.py), which
 * imports urtypes, a package its requirements.txt pins by hash.
 * SEEDSIGNER_URTYPES names that package's `src/`; without it the join cases
 * fail with a message saying so, rather than being skipped.
 *
 * What SeedSigner has no equivalent for is left out, so those cases are
 * reported as not run: the entropy count on screen (SeedSigner shows "Dice
 * Roll n/99", not bits), the manifest, and writing BBQr, which SeedSigner
 * reads but never writes (its signed PSBT is shown as UR, views/psbt_views.py
 * lines 1155-1167).
 */

import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = process.env.SEEDSIGNER_SRC
const EMBIT = process.env.SEEDSIGNER_EMBIT
const URTYPES = process.env.SEEDSIGNER_URTYPES
if (!SRC || !EMBIT) {
  throw new Error(
    'seedsigner.mjs: SEEDSIGNER_SRC and SEEDSIGNER_EMBIT are not set; run conformance/interop/seedsigner-adapter.sh'
  )
}
const BRIDGE = join(dirname(fileURLToPath(import.meta.url)), 'seedsigner', 'bridge.py')

export const name = `SeedSigner ${process.env.SEEDSIGNER_COMMIT ?? '(commit not given)'} with embit ${process.env.SEEDSIGNER_EMBIT_VERSION ?? '(version not given)'}`

/**
 * The ECDSA nonce scheme (SP-SIG-1). SeedSigner signs with embit's
 * `PSBT.sign_with`, which calls `PrivateKey.sign(msg_hash, grind=True)`
 * (embit/ec.py): RFC 6979, retried with additional data LE32(1), LE32(2) and so
 * on until the DER signature is 70 bytes or fewer, which with a low S is a low R.
 */
export const ecdsaNonces = 'rfc6979-low-r'

/**
 * SeedSigner does not search for change. It re-derives the one path an
 * output's derivation record names (models/psbt_parser.py lines 1015-1019 and
 * 1042-1045), and an output with no record is a payment (lines 1020-1023 and
 * 1028-1031). The path must return to a base path one of the seed's inputs
 * spends from, on branch 0 or 1, at an unhardened index, or the transaction
 * is refused (lines 1861-1912 and 1995-1996). The index itself has no limit:
 * an index more than CHANGE_ADDRESS_INDEX_WINDOW (10,000) past the smallest
 * input index on that base path is still change, shown with a warning (lines
 * 328, 1915-1943 and 1998-1999). So no index is beyond a bound.
 */
export const changeSearchBound = Infinity

function bridge(request) {
  // -I: SeedSigner's tree is fetched code, so nothing from the environment or
  // the current directory joins its import path.
  const r = spawnSync('python3', ['-I', BRIDGE, SRC, EMBIT, ...(URTYPES ? [URTYPES] : [])], {
    input: JSON.stringify(request),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  if (r.status !== 0) throw new Error(`bridge.py exited ${String(r.status)}: ${r.stderr}`)
  return JSON.parse(r.stdout)
}

export function diceToSeed(rolls) {
  return bridge({ op: 'diceToSeed', rolls })
}

/** SeedSigner has no override, so the verdict is `allow` or `refuse`. */
export function reviewPsbt(psbt, context) {
  return bridge({ op: 'reviewPsbt', psbt, context })
}

/** SeedSigner has no override, so `options.override` changes nothing. */
export function signPsbt(psbt, context) {
  return bridge({ op: 'signPsbt', psbt, context })
}

/** The bridge carries the joined bytes as base64; the runner wants them as bytes. */
function joined(op, frames) {
  const { dataBase64, ...r } = bridge({ op, frames })
  return dataBase64 === undefined
    ? r
    : { ...r, data: new Uint8Array(Buffer.from(dataBase64, 'base64')) }
}

/** Needs SEEDSIGNER_URTYPES; without it the bridge stops and the case fails. */
export function urJoin(frames) {
  return joined('urJoin', frames)
}

/** Needs SEEDSIGNER_URTYPES, as urJoin does: both load the same decoder module. */
export function bbqrJoin(frames) {
  return joined('bbqrJoin', frames)
}
