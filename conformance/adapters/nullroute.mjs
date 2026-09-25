/**
 * Adapter: nullroute, from this repository's built packages.
 *
 * Run `make build` first. Every function calls the code the device runs and
 * reports what it did, in the shapes conformance/README.md defines. Where the
 * device's behaviour is spread across the daemon and the UI, the adapter
 * follows the same path the daemon's IPC handler and the review screen take,
 * and names the file it mirrors, so a change there that the adapter does not
 * follow shows up as a failing case rather than a passing copy.
 *
 * The adapter never compares against a vector. It only reports.
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  BbqrCollector,
  UrDecoder,
  psbtFromUr,
  diceToEntropy,
  accountEntropy,
  encodePsbt,
  entropyToWords,
  mnemonicToSeed,
  networkById,
  parsePsbt,
  reviewTransaction,
  signTransaction,
} from '../../packages/core/dist/index.js'
import { buildOwnedIndex, changeLookup, signingPathsFor } from '../../packages/daemon/dist/psbt.js'
import { inputScript } from '../../packages/daemon/dist/ipc/input-script.js'
import { manifestRootHash } from '../../packages/daemon/dist/boot/attestation.js'
import { qrFrames } from '../../packages/ui/dist/components/QrDisplay.js'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

export const name = 'nullroute (packages/*/dist in this checkout)'

/**
 * How far the change search goes on each branch: the daemon's default gap
 * limit, which `psbt.review` and `psbt.sign` use (packages/daemon/src/psbt.spec.yaml).
 */
export const changeSearchBound = 100

const toHex = (bytes) => Buffer.from(bytes).toString('hex')

// --- entropy -------------------------------------------------------------------

export function diceToSeed(rolls) {
  let entropy
  try {
    entropy = diceToEntropy(rolls)
  } catch (err) {
    return { verdict: 'refuse', reason: err.message }
  }
  const entropyHex = toHex(entropy.bytes)
  const mnemonic = entropyToWords(entropy)
  entropy.dispose()
  const seed = mnemonicToSeed(mnemonic, '')
  const seedHex = toHex(seed.bytes)
  seed.dispose()
  return { verdict: 'accept', entropyHex, mnemonic, seedHex }
}

/** The number on the collection screen: `accountEntropy(...).bits`. */
export function diceBitsShown(count) {
  return accountEntropy('1'.repeat(count)).bits
}

// --- review and signing --------------------------------------------------------

/**
 * Sighash as the review names it, turned back into what it commits to.
 *
 * Read from `review.sighash.name`, the string the screen shows, rather than
 * from the numeric type, so the case checks what a user is told.
 */
function sighashMeaning(sighash) {
  const n = sighash.name
  const outputs = n.includes('SIGHASH_NONE')
    ? 'none'
    : n.includes('SIGHASH_SINGLE')
      ? 'one'
      : n.includes('SIGHASH_ALL') || n.includes('SIGHASH_DEFAULT')
        ? 'all'
        : 'unrecognised'
  return outputs === 'unrecognised'
    ? { outputs }
    : { outputs, otherInputsMayBeAdded: n.includes('ANYONECANPAY') }
}

function withWallet(context, fn) {
  const network = networkById(context.network)
  const seed = mnemonicToSeed(context.mnemonic, context.passphrase)
  try {
    return fn(seed, network)
  } finally {
    seed.dispose()
  }
}

/**
 * The daemon rebuilds this index on every request. It depends only on the
 * seed and the network, so it is built once per wallet here: 800 derivations
 * per case would make the run take a minute for no difference in the result.
 */
const ownedIndexes = new Map()

function ownedIndex(context, seed, network) {
  const key = `${context.mnemonic}\0${context.passphrase}\0${context.network}`
  let owned = ownedIndexes.get(key)
  if (owned === undefined) {
    owned = buildOwnedIndex(seed, network, { gapLimit: changeSearchBound })
    ownedIndexes.set(key, owned)
  }
  return owned
}

/** Mirrors `psbt.review` in packages/daemon/src/ipc/methods/psbt.ts. */
function review(psbtBase64, context, seed, network) {
  const tx = parsePsbt(psbtBase64)
  const owned = ownedIndex(context, seed, network)
  const result = reviewTransaction(tx, { network, isChange: changeLookup(owned.index) })
  const ownedInputs = signingPathsFor(
    Array.from({ length: tx.inputsLength }, (_, i) => inputScript(tx, i)),
    owned.index,
    network
  )
  return { tx, owned, result, ownedInputs }
}

export function reviewPsbt(psbtBase64, context) {
  return withWallet(context, (seed, network) => {
    let r
    try {
      r = review(psbtBase64, context, seed, network)
    } catch (err) {
      return { verdict: 'refuse', reason: err.message }
    }
    const { result, ownedInputs } = r
    // The Sign control in packages/ui/src/screens/PsbtScreen.tsx (`maySign`):
    // never with no owned input, and past a blocking warning only with the
    // one-signature override.
    const verdict =
      ownedInputs.length === 0 ? 'refuse' : result.signable ? 'allow' : 'block-until-override'
    const lockWarning = result.warnings.find((w) => w.kind === 'locktime')
    const unknown = result.warnings.find((w) => w.kind === 'unknown-fields')
    return {
      verdict,
      reasons: result.warnings.filter((w) => w.blocking).map((w) => w.message),
      feeSats: result.fee.feeSats.toString(),
      outputs: result.outputs.map((o) => ({
        index: o.index,
        address: o.address ?? null,
        amountSats: o.amountSats.toString(),
        kind: o.kind,
        ...(o.changePath === undefined ? {} : { changePath: o.changePath }),
      })),
      claimedOutputs: result.outputs
        .filter((o) => o.changeRejectedBecause !== undefined)
        .map((o) => o.index),
      sighash: sighashMeaning(result.sighash),
      // What the screen says: "cannot confirm until block N" or "until <date>".
      locktime:
        lockWarning === undefined
          ? { kind: 'none', value: result.locktime }
          : {
              kind: lockWarning.message.includes('until block') ? 'height' : 'time',
              value: result.locktime,
            },
      replaceable: result.replaceable,
      unknownFieldsReported:
        unknown === undefined ? 0 : Number(/carries (\d+) field/.exec(unknown.message)?.[1] ?? 0),
      warnings: result.warnings.map((w) => (w.kind === 'high-fee-rate' ? 'high-fee' : w.kind)),
    }
  })
}

/** Mirrors `psbt.sign` in packages/daemon/src/ipc/methods/psbt.ts. */
export function signPsbt(psbtBase64, context, options) {
  return withWallet(context, (seed, network) => {
    let r
    try {
      r = review(psbtBase64, context, seed, network)
    } catch (err) {
      return { verdict: 'refuse', reason: err.message }
    }
    if (r.ownedInputs.length === 0) {
      return { verdict: 'refuse', reason: 'no input belongs to this wallet' }
    }
    try {
      const signed = signTransaction(r.tx, seed, {
        network,
        paths: r.ownedInputs,
        review: r.result,
        overrideBlockingWarnings: options?.override === true,
      })
      return { verdict: 'signed', psbtBase64: encodePsbt(signed.psbt) }
    } catch (err) {
      return { verdict: 'refuse', reason: err.message }
    }
  })
}

// --- manifest ------------------------------------------------------------------

/**
 * The pipeline `make manifest` runs. Read out of the Makefile so that if the
 * recipe changes, this adapter stops rather than testing an old copy.
 */
const RECIPE = 'LC_ALL=C sort -z | xargs -0 shasum -a 256 > MANIFEST.lock'

export function buildManifest(files) {
  const makefile = readFileSync(join(ROOT, 'Makefile'), 'utf8')
  if (!makefile.includes(RECIPE)) {
    throw new Error(
      'The Makefile no longer contains the manifest pipeline this adapter runs. Update the adapter.'
    )
  }
  const dir = mkdtempSync(join(tmpdir(), 'nullroute-conformance-'))
  try {
    for (const f of files) {
      mkdirSync(dirname(join(dir, f.path)), { recursive: true })
      writeFileSync(join(dir, f.path), f.bytes)
    }
    const listing = Buffer.concat(files.map((f) => Buffer.from(`${f.path}\0`, 'utf8')))
    const run = spawnSync('sh', ['-c', RECIPE], { cwd: dir, input: listing })
    if (run.status !== 0) throw new Error(`manifest recipe failed: ${run.stderr.toString()}`)
    return {
      manifest: readFileSync(join(dir, 'MANIFEST.lock'), 'utf8'),
      // What the daemon puts on the lock screen.
      root: manifestRootHash(dir),
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// --- QR transport ------------------------------------------------------------

/**
 * The scanner's UR path, as packages/ui/src/screens/ScanScreen.tsx drives it:
 * frames into UrDecoder, and a PSBT out of the completed body.
 */
export function urJoin(frames) {
  const decoder = new UrDecoder()
  try {
    for (const frame of frames) {
      decoder.receive(frame)
      if (decoder.complete === true) break
    }
    if (decoder.complete !== true) return { verdict: 'incomplete' }
    const result = decoder.result()
    return { verdict: 'complete', type: result.type, data: psbtFromUr(result) }
  } catch (err) {
    return { verdict: 'refuse', reason: err.message }
  }
}

/** The scanner's collector, as packages/ui/src/screens/ScanScreen.tsx drives it. */
export async function bbqrJoin(frames) {
  const collector = new BbqrCollector()
  try {
    for (const frame of frames) collector.add(frame)
    if (!collector.complete) return { verdict: 'incomplete' }
    const { data, fileType } = await collector.assemble()
    const letter = { psbt: 'P', transaction: 'T', json: 'J', cbor: 'C', unicode: 'U', binary: 'B' }[
      fileType
    ]
    return { verdict: 'complete', fileType: letter, data }
  } catch (err) {
    return { verdict: 'refuse', reason: err.message }
  }
}

const rows = (code) =>
  Array.from({ length: code.size }, (_, r) =>
    code.modules
      .slice(r * code.size, (r + 1) * code.size)
      .map((m) => (m ? '1' : '0'))
      .join('')
  )

/** What the display shows for a PSBT: QrDisplay's own frames, not a copy. */
export function bbqrEncodePsbt(psbtBase64) {
  return {
    frames: qrFrames(psbtBase64, 'psbt').map((frame) => ({
      text: frame.text,
      modules: rows(frame.code),
    })),
  }
}
