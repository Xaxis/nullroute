#!/usr/bin/env node
/**
 * Reference runner for the air-gapped signer profile vectors.
 *
 *   node conformance/run.mjs <adapter.mjs> [options]
 *
 *   --vectors <dir>          vector directory (default: spec/vectors/signer-profile)
 *   --known-failures <file>  JSON list of failures the implementer already reports
 *   --only <file.json>       run one vector file
 *   --verbose                print every case, not only the ones that did not pass
 *
 * Node built-ins only, so that an implementer who has never seen nullroute can
 * run it with nothing but Node. It checks the vector files against SHA256SUMS
 * before it runs anything: a vector edited to make an implementation pass is the
 * failure this whole directory exists to prevent.
 *
 * The runner decides pass and fail itself. The adapter reports what the signer
 * did (a verdict, a fee, the frames it would show) and never compares anything,
 * so an adapter cannot pass a case by agreeing with it. Where the runner needs
 * to look inside the signer's output (a signed PSBT, a BBQr frame, a QR symbol)
 * it parses that output here, with code that shares nothing with any signer.
 *
 * The adapter contract is in conformance/README.md.
 */

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { inflateRawSync } from 'node:zlib'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_VECTORS = resolve(HERE, '..', 'spec', 'vectors', 'signer-profile')
const FORMAT = 'signer-profile-vectors'
const FORMAT_VERSION = 1

// --- arguments ---------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    adapter: undefined,
    vectors: DEFAULT_VECTORS,
    known: undefined,
    only: undefined,
    verbose: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--vectors') args.vectors = resolve(argv[(i += 1)])
    else if (a === '--known-failures') args.known = resolve(argv[(i += 1)])
    else if (a === '--only') args.only = argv[(i += 1)]
    else if (a === '--verbose') args.verbose = true
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`)
    else if (args.adapter === undefined) args.adapter = resolve(a)
    else throw new Error(`unexpected argument ${a}`)
  }
  if (args.adapter === undefined) {
    throw new Error(
      'usage: node conformance/run.mjs <adapter.mjs> [--known-failures file] [--only file] [--verbose]'
    )
  }
  return args
}

// --- the pin: SHA256SUMS -------------------------------------------------------

const sha256hex = (bytes) => createHash('sha256').update(bytes).digest('hex')

/**
 * Every vector file must be listed in SHA256SUMS and match it, and every line in
 * SHA256SUMS must name a file that exists. `sha256sum -c SHA256SUMS` in the
 * directory checks the same thing without this runner.
 */
function checkPins(dir) {
  const problems = []
  const listed = new Map()
  const text = readFileSync(join(dir, 'SHA256SUMS'), 'utf8')
  for (const line of text.split('\n')) {
    if (line === '') continue
    const m = /^([0-9a-f]{64}) {2}(\S+)$/.exec(line)
    if (m === null) {
      problems.push(`SHA256SUMS: malformed line ${JSON.stringify(line)}`)
      continue
    }
    listed.set(m[2], m[1])
  }
  const present = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
  for (const f of present) {
    const pinned = listed.get(f)
    if (pinned === undefined) problems.push(`${f} is not listed in SHA256SUMS`)
    else if (sha256hex(readFileSync(join(dir, f))) !== pinned) {
      problems.push(
        `${f} does not match SHA256SUMS. A vector changed; re-pin it deliberately or restore it.`
      )
    }
  }
  for (const f of listed.keys())
    if (!present.includes(f)) problems.push(`SHA256SUMS lists ${f}, which is missing`)
  return { problems, files: present }
}

// --- small decoders the checks need -------------------------------------------

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** RFC 4648 base32 without padding, as BBQr encoding 2 uses it. */
function base32Decode(text) {
  let bits = 0
  let value = 0
  const out = []
  for (const ch of text) {
    const v = B32.indexOf(ch)
    if (v < 0) throw new Error(`not base32: ${JSON.stringify(ch)}`)
    value = (value << 5) | v
    bits += 5
    if (bits >= 8) {
      bits -= 8
      out.push((value >>> bits) & 0xff)
    }
  }
  return Buffer.from(out)
}

/** The eight-character BBQr header (BBQr.md, "Header"). */
function parseBbqrHeader(text) {
  if (typeof text !== 'string' || text.length < 8 || !text.startsWith('B$')) return undefined
  return {
    encoding: text[2],
    fileType: text[3],
    total: Number.parseInt(text.slice(4, 6), 36),
    index: Number.parseInt(text.slice(6, 8), 36),
    payload: text.slice(8),
  }
}

function decodeBbqrPayload(encoding, payload) {
  if (encoding === 'H') return Buffer.from(payload, 'hex')
  if (encoding === '2') return base32Decode(payload)
  if (encoding === 'Z') return base32Decode(payload)
  throw new Error(`unknown BBQr encoding ${encoding}`)
}

/** BIP-174 key-value maps, split without interpreting any key. */
function readCompact(b, i) {
  const x = b[i]
  if (x < 0xfd) return [x, i + 1]
  if (x === 0xfd) return [b.readUInt16LE(i + 1), i + 3]
  if (x === 0xfe) return [b.readUInt32LE(i + 1), i + 5]
  return [Number(b.readBigUInt64LE(i + 1)), i + 9]
}

function readMap(b, i) {
  const pairs = []
  for (;;) {
    let klen
    ;[klen, i] = readCompact(b, i)
    if (klen === 0) return [pairs, i]
    const key = b.subarray(i, i + klen)
    i += klen
    let vlen
    ;[vlen, i] = readCompact(b, i)
    pairs.push({ key: key.toString('hex'), value: b.subarray(i, i + vlen).toString('hex') })
    i += vlen
  }
}

function txCounts(tx) {
  let i = 4
  let nin
  ;[nin, i] = readCompact(tx, i)
  for (let k = 0; k < nin; k += 1) {
    i += 36
    let len
    ;[len, i] = readCompact(tx, i)
    i += len + 4
  }
  const [nout] = readCompact(tx, i)
  return [nin, nout]
}

function parsePsbtMaps(base64) {
  const b = Buffer.from(base64, 'base64')
  if (b.subarray(0, 5).toString('hex') !== '70736274ff') throw new Error('not a PSBT (magic)')
  let i = 5
  let global
  ;[global, i] = readMap(b, i)
  const unsigned = global.find((kv) => kv.key === '00')
  if (unsigned === undefined) throw new Error('PSBT has no unsigned transaction')
  const [nin, nout] = txCounts(Buffer.from(unsigned.value, 'hex'))
  const inputs = []
  const outputs = []
  for (let k = 0; k < nin; k += 1) {
    let m
    ;[m, i] = readMap(b, i)
    inputs.push(m)
  }
  for (let k = 0; k < nout; k += 1) {
    let m
    ;[m, i] = readMap(b, i)
    outputs.push(m)
  }
  return { global, inputs, outputs }
}

/** Key types that carry a signature or a finished witness (BIP-174, BIP-371). */
const SIGNATURE_KEY_TYPES = new Set(['02', '07', '08', '13', '14'])

// --- QR: the mode of the first segment --------------------------------------

/**
 * Read the mode indicator of the first data segment from a QR symbol.
 *
 * Only as much of ISO/IEC 18004 as that needs: the format information beside
 * the top-left finder gives the mask, and the first data codeword sits in the
 * bottom-right corner in every version, clear of every function pattern. Its
 * first four bits, unmasked, are the mode. Interleaving does not move it,
 * because the stream starts with block one's first codeword.
 */
function qrFirstMode(rows) {
  const n = rows.length
  if (n < 21 || (n - 17) % 4 !== 0 || rows.some((r) => r.length !== n)) {
    throw new Error(`modules are not a QR symbol (${String(n)} rows)`)
  }
  const dark = (row, col) => rows[row][col] === '1'
  // Format bits 0-14 around the top-left finder, as the encoder places them.
  const at = []
  for (let i = 0; i <= 5; i += 1) at.push([i, 8])
  at.push([7, 8], [8, 8], [8, 7])
  for (let i = 9; i <= 14; i += 1) at.push([8, 14 - i])
  let read = 0
  at.forEach(([row, col], bit) => {
    if (dark(row, col)) read |= 1 << bit
  })
  let best = { distance: 99, mask: -1 }
  for (let data = 0; data < 32; data += 1) {
    let rem = data
    for (let k = 0; k < 10; k += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    const word = ((data << 10) | rem) ^ 0x5412
    let diff = word ^ read
    let distance = 0
    while (diff !== 0) {
      distance += diff & 1
      diff >>>= 1
    }
    if (distance < best.distance) best = { distance, mask: data & 7 }
  }
  if (best.distance > 3) throw new Error('format information unreadable')
  const masks = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (_, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ]
  const mask = masks[best.mask]
  const bit = (row, col) => (dark(row, col) !== mask(row, col) ? 1 : 0)
  const mode =
    (bit(n - 1, n - 1) << 3) |
    (bit(n - 1, n - 2) << 2) |
    (bit(n - 2, n - 1) << 1) |
    bit(n - 2, n - 2)
  return (
    { 0b0001: 'numeric', 0b0010: 'alphanumeric', 0b0100: 'byte', 0b1000: 'kanji', 0b0111: 'eci' }[
      mode
    ] ?? `0b${mode.toString(2).padStart(4, '0')}`
  )
}

// --- checks --------------------------------------------------------------------

const normalizePath = (p) => (typeof p === 'string' ? p.replace(/h/g, "'").toLowerCase() : p)

/**
 * One case's result. `must` failures fail the case; `should` misses are
 * reported as advisories and never fail it.
 */
class Outcome {
  constructor() {
    this.must = []
    this.should = []
  }
  expect(check, ok, message) {
    if (!ok) this.must.push({ check, message })
  }
  advise(check, ok, message) {
    if (!ok) this.should.push({ check, message })
  }
}

const show = (v) => JSON.stringify(v)

function checkVerdict(o, expected, actual) {
  if (expected.verdict !== undefined) {
    o.expect(
      'verdict',
      actual?.verdict === expected.verdict,
      `verdict ${show(actual?.verdict)}, expected ${show(expected.verdict)}`
    )
  }
  if (expected.verdictIn !== undefined) {
    o.expect(
      'verdict',
      expected.verdictIn.includes(actual?.verdict),
      `verdict ${show(actual?.verdict)}, expected one of ${show(expected.verdictIn)}`
    )
  }
}

function compareOutput(o, level, want, got, bound) {
  const record = level === 'must' ? o.expect.bind(o) : o.advise.bind(o)
  const label = `output ${String(want.index)}`
  if (got === undefined) {
    record(label, false, `${label} missing from the review`)
    return
  }
  let kind = want.kind
  if (typeof kind === 'object' && kind !== null) {
    kind = kind.changeIfIndexBelowBound < bound ? 'change' : 'payment'
  }
  if (want.address !== undefined) {
    record(
      `${label}.address`,
      got.address === want.address,
      `${label} address ${show(got.address)}, expected ${show(want.address)}`
    )
  }
  if (want.amountSats !== undefined) {
    record(
      `${label}.amount`,
      String(got.amountSats) === want.amountSats,
      `${label} amount ${show(got.amountSats)}, expected ${want.amountSats}`
    )
  }
  record(
    `${label}.kind`,
    got.kind === kind,
    `${label} kind ${show(got.kind)}, expected ${show(kind)}`
  )
  if (kind === 'change' && want.changePath !== undefined && got.kind === 'change') {
    record(
      `${label}.changePath`,
      normalizePath(got.changePath) === normalizePath(want.changePath),
      `${label} change path ${show(got.changePath)}, expected ${want.changePath}`
    )
  }
}

async function runReview(adapter, c, contexts, o) {
  const r = await adapter.reviewPsbt(c.input.psbt, contexts[c.input.context])
  const e = c.expected
  checkVerdict(o, e, r)
  if (e.feeSats !== undefined) {
    o.expect(
      'fee',
      r?.feeSats !== undefined && String(r.feeSats) === e.feeSats,
      `fee ${show(r?.feeSats)} sat, expected ${e.feeSats}`
    )
  }
  const bound = typeof adapter.changeSearchBound === 'number' ? adapter.changeSearchBound : Infinity
  const byIndex = new Map((r?.outputs ?? []).map((out) => [out.index, out]))
  for (const want of e.outputs ?? []) compareOutput(o, 'must', want, byIndex.get(want.index), bound)
  for (const want of e.shouldOutputs ?? [])
    compareOutput(o, 'should', want, byIndex.get(want.index), bound)
  if (e.sighash !== undefined) {
    for (const [k, v] of Object.entries(e.sighash)) {
      o.expect(
        `sighash.${k}`,
        r?.sighash?.[k] === v,
        `sighash ${k} ${show(r?.sighash?.[k])}, expected ${show(v)}`
      )
    }
  }
  if (e.locktime !== undefined) {
    o.expect(
      'locktime',
      r?.locktime?.kind === e.locktime.kind && r?.locktime?.value === e.locktime.value,
      `locktime ${show(r?.locktime)}, expected ${show(e.locktime)}`
    )
  }
  if (e.replaceable !== undefined) {
    o.expect(
      'replaceable',
      r?.replaceable === e.replaceable,
      `replaceable ${show(r?.replaceable)}, expected ${show(e.replaceable)}`
    )
  }
  for (const code of e.warnings?.should ?? []) {
    o.advise(`warning.${code}`, (r?.warnings ?? []).includes(code), `no ${code} warning (SHOULD)`)
  }
  for (const index of e.claimedOutputs?.should ?? []) {
    o.advise(
      'claimed',
      (r?.claimedOutputs ?? []).includes(index),
      `output ${String(index)} not reported as claimed by the transaction (SHOULD)`
    )
  }
  if (e.unknownFieldsReported?.should !== undefined) {
    const n = e.unknownFieldsReported.should
    o.advise(
      'unknown-fields',
      (r?.unknownFieldsReported ?? 0) >= n,
      `reported ${show(r?.unknownFieldsReported)} unknown fields, expected at least ${String(n)} (SHOULD)`
    )
  }
}

async function runSign(adapter, c, contexts, o) {
  const r = await adapter.signPsbt(c.input.psbt, contexts[c.input.context], { override: false })
  const e = c.expected
  checkVerdict(o, e, r)
  if (r?.verdict !== 'signed') return
  let before
  let after
  try {
    before = parsePsbtMaps(c.input.psbt)
    after = parsePsbtMaps(r.psbtBase64)
  } catch (err) {
    o.expect('psbt', false, `signed PSBT does not parse: ${err.message}`)
    return
  }
  const unsigned = (m) => m.global.find((kv) => kv.key === '00')?.value
  o.expect(
    'unsigned-tx',
    unsigned(before) === unsigned(after),
    'the unsigned transaction changed during signing'
  )
  for (const [index, want] of Object.entries(e.signatures ?? {})) {
    const map = after.inputs[Number(index)] ?? []
    const has = map.some((kv) => SIGNATURE_KEY_TYPES.has(kv.key.slice(0, 2)))
    o.expect(
      `signature.${index}`,
      has === want,
      `input ${index} ${has ? 'has' : 'has no'} signature, expected ${want ? 'one' : 'none'}`
    )
  }
  for (const p of e.preserved ?? []) {
    const map =
      p.map === 'global'
        ? after.global
        : p.map === 'input'
          ? after.inputs[p.index]
          : after.outputs[p.index]
    const kept = (map ?? []).some((kv) => kv.key === p.keyHex && kv.value === p.valueHex)
    o.expect(
      `preserved.${p.map}.${p.keyHex}`,
      kept,
      `${p.map}${p.index === null ? '' : ` ${String(p.index)}`} pair ${p.keyHex}=${p.valueHex} missing from the signed PSBT`
    )
  }
}

async function runDice(adapter, c, o) {
  const r = await adapter.diceToSeed(c.input.rolls)
  const e = c.expected
  checkVerdict(o, e, r)
  if (e.verdict !== 'accept' || r?.verdict !== 'accept') return
  o.expect(
    'entropy',
    r.entropyHex?.toLowerCase() === e.entropyHex,
    `entropy ${show(r.entropyHex)}, expected ${e.entropyHex}`
  )
  o.expect(
    'mnemonic',
    r.mnemonic === e.mnemonic,
    `mnemonic ${show(r.mnemonic)}, expected ${show(e.mnemonic)}`
  )
  o.expect(
    'seed',
    r.seedHex?.toLowerCase() === e.seedHex,
    `seed ${show(r.seedHex)}, expected ${e.seedHex}`
  )
  // SP-HW-9: nothing random enters dice mode, so a second run is identical.
  const again = await adapter.diceToSeed(c.input.rolls)
  o.expect(
    'deterministic',
    show(again) === show(r),
    'a second run with the same rolls gave a different result'
  )
}

async function runAccounting(adapter, c, o) {
  const shown = await adapter.diceBitsShown(c.input.count)
  o.expect(
    'bits',
    Number.isInteger(shown) && shown >= 0 && shown <= c.expected.maxBits,
    `shows ${show(shown)} bits after ${String(c.input.count)} rolls, more than ${String(c.expected.maxBits)}`
  )
}

async function runManifest(adapter, c, o) {
  const files = c.input.files.map((f) => ({
    path: f.path,
    bytes: new Uint8Array(Buffer.from(f.contentBase64, 'base64')),
  }))
  const r = await adapter.buildManifest(files)
  const e = c.expected
  o.expect(
    'manifest',
    r?.manifest === e.manifest,
    `manifest differs:\n${String(r?.manifest)}\nexpected:\n${e.manifest}`
  )
  o.expect('root', r?.root === e.root, `root ${show(r?.root)}, expected ${e.root}`)
  for (const wrong of e.rootMustNotBe ?? []) {
    o.expect(
      'locale-order',
      r?.root !== wrong,
      `root ${wrong} is the locale-ordered manifest's root`
    )
  }
}

async function runJoin(adapter, c, o) {
  const r = await adapter.bbqrJoin(c.input.frames)
  const e = c.expected
  checkVerdict(o, e, r)
  if (e.verdict !== 'complete' || r?.verdict !== 'complete') return
  o.expect(
    'fileType',
    r.fileType === e.fileType,
    `file type ${show(r.fileType)}, expected ${e.fileType}`
  )
  const data = Buffer.from(r.data ?? [])
  if (e.dataBase64 !== undefined) {
    o.expect(
      'data',
      data.toString('base64') === e.dataBase64,
      `assembled ${String(data.length)} bytes that differ from the expected payload`
    )
  }
  if (e.dataSha256 !== undefined) {
    o.expect(
      'data',
      sha256hex(data) === e.dataSha256 && data.length === e.dataLength,
      `assembled ${String(data.length)} bytes, sha256 ${sha256hex(data)}; expected ${String(e.dataLength)} bytes, ${e.dataSha256}`
    )
  }
}

async function runUrJoin(adapter, c, o) {
  const r = await adapter.urJoin(c.input.frames)
  const e = c.expected
  checkVerdict(o, e, r)
  if (e.verdict !== 'complete' || r?.verdict !== 'complete') return
  o.expect('type', r.type === e.type, `UR type ${show(r.type)}, expected ${e.type}`)
  const data = Buffer.from(r.data ?? [])
  o.expect(
    'data',
    data.toString('base64') === e.dataBase64,
    `assembled ${String(data.length)} bytes that differ from the expected PSBT`
  )
}

async function runEncode(adapter, c, o) {
  const r = await adapter.bbqrEncodePsbt(c.input.psbtBase64)
  const e = c.expected
  const frames = r?.frames ?? []
  o.expect(
    'frames',
    frames.length >= e.minFrames,
    `${String(frames.length)} frames, expected at least ${String(e.minFrames)}`
  )
  const headers = frames.map((f) => parseBbqrHeader(f.text))
  if (headers.some((h) => h === undefined)) {
    o.expect('header', false, 'a frame is not a BBQr part')
    return
  }
  o.expect(
    'fileType',
    headers.every((h) => h.fileType === e.fileType),
    `file types ${show([...new Set(headers.map((h) => h.fileType))])}, expected ${e.fileType}`
  )
  o.expect(
    'encoding',
    headers.every((h) => e.encodingIn.includes(h.encoding)),
    `encodings ${show([...new Set(headers.map((h) => h.encoding))])}, expected one of ${show(e.encodingIn)} (SP-TX-4)`
  )
  const consistent =
    headers.every((h) => h.total === frames.length && h.encoding === headers[0].encoding) &&
    new Set(headers.map((h) => h.index)).size === frames.length
  o.expect('sequence', consistent, 'frames do not form one complete sequence')
  if (consistent) {
    const ordered = [...headers].sort((a, b) => a.index - b.index)
    let data = Buffer.concat(ordered.map((h) => decodeBbqrPayload(h.encoding, h.payload)))
    if (ordered[0].encoding === 'Z') data = inflateRawSync(data)
    o.expect(
      'payload',
      data.toString('base64') === e.dataBase64,
      `joined payload is ${String(data.length)} bytes and is not the binary PSBT (SP-TX-2)`
    )
  }
  if (e.qrMode !== undefined) {
    frames.forEach((f, i) => {
      if (!Array.isArray(f.modules)) {
        o.expect(
          'qrMode',
          false,
          `frame ${String(i)} has no modules, so its QR mode cannot be checked`
        )
        return
      }
      let mode
      try {
        mode = qrFirstMode(f.modules)
      } catch (err) {
        mode = `unreadable (${err.message})`
      }
      o.expect(
        'qrMode',
        mode === e.qrMode,
        `frame ${String(i)} is in QR ${mode} mode, expected ${e.qrMode} (SP-TX-6)`
      )
    })
  }
}

const OPERATIONS = {
  diceToSeed: { needs: ['diceToSeed'], run: (a, c, _, o) => runDice(a, c, o) },
  diceBitsShown: { needs: ['diceBitsShown'], run: (a, c, _, o) => runAccounting(a, c, o) },
  review: { needs: ['reviewPsbt'], run: runReview },
  sign: { needs: ['signPsbt'], run: runSign },
  buildManifest: { needs: ['buildManifest'], run: (a, c, _, o) => runManifest(a, c, o) },
  bbqrJoin: { needs: ['bbqrJoin'], run: (a, c, _, o) => runJoin(a, c, o) },
  bbqrEncodePsbt: { needs: ['bbqrEncodePsbt'], run: (a, c, _, o) => runEncode(a, c, o) },
  urJoin: { needs: ['urJoin'], run: (a, c, _, o) => runUrJoin(a, c, o) },
}

// --- main ----------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const pins = checkPins(args.vectors)
  if (pins.problems.length > 0) {
    for (const p of pins.problems) console.error(`pin: ${p}`)
    console.error('Refusing to run vectors that do not match their pinned hashes.')
    process.exit(2)
  }

  // The mode reader is the one check here that parses a picture rather than
  // text, so it proves itself against an unrelated encoder before it is
  // trusted with a signer's frames.
  const fixture = JSON.parse(readFileSync(join(HERE, 'fixtures', 'qr-mode.json'), 'utf8'))
  for (const s of fixture.samples) {
    const got = qrFirstMode(s.modules)
    if (got !== s.mode) {
      console.error(
        `runner self-check: read a version ${String(s.version)} ${s.mode} symbol as ${got}`
      )
      process.exit(2)
    }
  }

  const adapter = await import(pathToFileURL(args.adapter).href)
  const known =
    args.known === undefined ? [] : JSON.parse(readFileSync(args.known, 'utf8')).failures
  const knownKey = (file, id, check) => `${file}\0${id}\0${check}`
  const knownSet = new Map(known.map((k) => [knownKey(k.file, k.case, k.check), k]))
  const knownUsed = new Set()

  console.log(`adapter: ${adapter.name ?? args.adapter}`)
  console.log(`vectors: ${args.vectors} (${String(pins.files.length)} files, all match SHA256SUMS)`)

  const totals = { pass: 0, known: 0, fail: 0, notRun: 0, advisories: 0 }
  for (const file of pins.files) {
    if (args.only !== undefined && file !== args.only) continue
    const doc = JSON.parse(readFileSync(join(args.vectors, file), 'utf8'))
    if (doc.format !== FORMAT || doc.version !== FORMAT_VERSION) {
      console.log(
        `FAIL ${file}: format ${show(doc.format)} version ${show(doc.version)} is not ${FORMAT} ${String(FORMAT_VERSION)}`
      )
      totals.fail += 1
      continue
    }
    const counts = { pass: 0, known: 0, fail: 0, notRun: 0 }
    const lines = []
    for (const c of doc.cases) {
      const op = OPERATIONS[c.operation]
      if (op === undefined) throw new Error(`${file} ${c.id}: unknown operation ${c.operation}`)
      const missing = op.needs.filter((fn) => typeof adapter[fn] !== 'function')
      if (missing.length > 0) {
        counts.notRun += 1
        lines.push(`  not run  ${c.id}: adapter has no ${missing.join(', ')}`)
        continue
      }
      const o = new Outcome()
      try {
        await op.run(adapter, c, doc.contexts ?? {}, o)
      } catch (err) {
        o.expect('adapter', false, `adapter threw: ${err?.stack ?? String(err)}`)
      }
      const unknownFailures = o.must.filter((f) => !knownSet.has(knownKey(file, c.id, f.check)))
      for (const f of o.must)
        if (knownSet.has(knownKey(file, c.id, f.check)))
          knownUsed.add(knownKey(file, c.id, f.check))
      const reqs = c.requirements.join(' ')
      if (o.must.length === 0) {
        counts.pass += 1
        if (args.verbose) lines.push(`  pass     ${c.id} [${reqs}]`)
      } else if (unknownFailures.length === 0) {
        counts.known += 1
        lines.push(`  known    ${c.id} [${reqs}]`)
        for (const f of o.must)
          lines.push(
            `             ${f.message}  (${knownSet.get(knownKey(file, c.id, f.check)).reason})`
          )
      } else {
        counts.fail += 1
        lines.push(`  FAIL     ${c.id} [${reqs}]`)
        for (const f of o.must) lines.push(`             ${f.message}`)
      }
      for (const s of o.should) {
        totals.advisories += 1
        lines.push(`  advisory ${c.id}: ${s.message}`)
      }
    }
    totals.pass += counts.pass
    totals.known += counts.known
    totals.fail += counts.fail
    totals.notRun += counts.notRun
    const status =
      counts.fail > 0
        ? 'FAIL'
        : counts.notRun > 0
          ? 'INCOMPLETE'
          : counts.known > 0
            ? 'KNOWN'
            : 'PASS'
    console.log(
      `${status.padEnd(10)} ${file}: ${String(counts.pass)} passed, ${String(counts.known)} known failures, ${String(counts.fail)} failed, ${String(counts.notRun)} not run, of ${String(doc.cases.length)}`
    )
    for (const l of lines) console.log(l)
  }

  // A known failure that no longer fails means the list is stale. Say so and
  // fail, so the list keeps describing the implementation rather than its past.
  const stale = [...knownSet.keys()].filter(
    (k) => !knownUsed.has(k) && (args.only === undefined || k.startsWith(`${args.only}\0`))
  )
  for (const k of stale) {
    const [file, id, check] = k.split('\0')
    console.log(
      `STALE      known failure ${file} ${id} ${check} did not fail; remove it from the list`
    )
  }

  console.log(
    `\n${String(totals.pass)} passed, ${String(totals.known)} known failures, ${String(totals.fail)} failed, ${String(totals.notRun)} not run, ${String(totals.advisories)} advisories`
  )
  process.exit(totals.fail > 0 || totals.notRun > 0 || stale.length > 0 ? 1 : 0)
}

export { qrFirstMode, parsePsbtMaps, base32Decode, parseBbqrHeader }

// Run only when invoked as a script, so the decoders above can be imported and
// checked on their own.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err?.stack ?? String(err))
    process.exit(2)
  })
}
