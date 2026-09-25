#!/usr/bin/env node
/**
 * Extract the BIP-143 worked examples from the BIP text into JSON.
 *
 * BIP-143 publishes no vector file. Its "Example" section prints each case as
 * an annotated listing: an unsigned transaction, the outputs it spends, and for
 * each signature the fields that go into the sighash, the preimage, the hash,
 * and usually the key and the signature. spec/vectors/bip143-sighash.json is
 * that section copied out by this tool, so anyone can repeat the extraction.
 * Run it on the same bips commit and the output is byte-identical to the
 * committed file, whose hash is pinned in sign.spec.yaml.
 *
 * It reads a local copy and never fetches, because the point is that the
 * reviewer chooses where the BIP text comes from.
 *
 * HOW THE LISTING IS READ. The BIP's layout is regular but not a format, so
 * the rules are spelled out here rather than left to the code:
 *
 *   - "=== Name ===" starts a section. "The following is an unsigned
 *     transaction" starts an example within it, and so does "The following
 *     transaction is a", which introduces the last No FindAndDelete case and
 *     gives a signed transaction rather than an unsigned one. The hex is on
 *     the same line or the next one.
 *   - "The (first |second )?input comes from ...:" starts an input. Its
 *     "label: value" lines up to the next blank line belong to it. A label
 *     whose value is not hex takes the next line if that line is pure hex,
 *     which is how the BIP gives a redeemScript it first prints as opcodes.
 *   - Every other "label: value" line updates a running set of sighash fields
 *     (outpoint, scriptCode, amount, nHashType, preimage), reset at each new
 *     example. A value that is not hex, such as "(see below)", clears the
 *     field. A "sigHash:" line records one signing case with the fields as
 *     they stand, and the "public key", "private key" and "signature" lines
 *     after it attach to that case. A signing case that names no key uses the
 *     key of the input it spends, which the test looks up by outpoint.
 *   - "The serialized signed transaction is:" gives `signedTx`. The
 *     transaction after "the signatures are still valid when the input-output
 *     pairs are swapped" gives `swappedTx`.
 *
 * Values are copied verbatim, including one signature the BIP prints with a
 * space before its hash type byte. Nothing is decoded or re-encoded, so a
 * transcription error cannot hide behind a round trip; the test checks
 * separately that every published preimage hashes to its published sigHash.
 *
 * Run: node tools/extract-bip143-vectors.mjs <bip-0143.mediawiki> <bips-commit>
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT = join(ROOT, 'spec/vectors/bip143-sighash.json')

const [source, commit] = process.argv.slice(2)
if (source === undefined || commit === undefined || !/^[0-9a-f]{40}$/.test(commit)) {
  console.error('usage: node tools/extract-bip143-vectors.mjs <bip-0143.mediawiki> <bips-commit>')
  process.exit(2)
}

const text = readFileSync(source, 'utf8')
const start = text.indexOf('\n== Example ==\n')
const end = text.indexOf('\n== Deployment ==\n')
if (start < 0 || end < start) throw new Error('No "Example" section found.')
const lines = text.slice(start, end).split('\n')

const HEX = /^[0-9a-f]+$/
// One space is allowed inside a value for the signature printed as "... 01".
const HEX_VALUE = /^[0-9a-f]+(?: [0-9a-f]+)*$/
const LABEL = /^\s*([A-Za-z][A-Za-z |]*?)\s*:\s*(.*)$/
const INPUT_FIELDS = {
  scriptPubKey: 'scriptPubKey',
  redeemScript: 'redeemScript',
  witnessScript: 'witnessScript',
  'private key': 'privateKey',
  'public key': 'publicKey',
  signature: 'signature',
}
const KEY_FIELDS = {
  'private key': 'privateKey',
  'public key': 'publicKey',
  pubkey: 'publicKey',
  signature: 'signature',
}
const SIGHASH_FIELDS = ['outpoint', 'scriptCode', 'amount', 'nHashType']

const sections = []
let section = undefined
let example = undefined
let input = undefined
let inputLabel = undefined
let fields = {}
let signing = undefined
// Set when a line announces a transaction whose hex is on the next line.
let pendingTx = undefined

for (const raw of lines) {
  const line = raw.trimEnd()
  const trimmed = line.trim()

  const heading = /^=== (.+) ===$/.exec(line)
  if (heading !== null) {
    section = { name: heading[1], examples: [] }
    sections.push(section)
    example = input = signing = pendingTx = undefined
    continue
  }
  if (section === undefined) continue

  if (pendingTx !== undefined && trimmed.length > 0) {
    if (!HEX.test(trimmed)) throw new Error(`Expected a transaction after "${pendingTx}": ${line}`)
    example[pendingTx] = trimmed
    pendingTx = undefined
    continue
  }

  const opens = /The following (is an unsigned transaction|transaction is a)/.exec(line)
  if (opens !== null) {
    example = { inputs: [], signatures: [] }
    section.examples.push(example)
    fields = {}
    input = signing = undefined
    const key = opens[1] === 'is an unsigned transaction' ? 'unsignedTx' : 'signedTx'
    const tail = /:\s*([0-9a-f]+)$/.exec(line)
    if (tail !== null) example[key] = tail[1]
    else pendingTx = key
    continue
  }
  if (example === undefined) continue

  if (/^The (first |second )?input comes from .*:$/.test(trimmed)) {
    input = { description: trimmed }
    example.inputs.push(input)
    inputLabel = undefined
    continue
  }

  if (trimmed.startsWith('The serialized signed transaction is:')) {
    const tail = /:\s*([0-9a-f]+)$/.exec(line)
    if (tail !== null) example.signedTx = tail[1]
    else pendingTx = 'signedTx'
    continue
  }
  if (trimmed.includes('the signatures are still valid when the input-output pairs are swapped')) {
    pendingTx = 'swappedTx'
    continue
  }

  if (input !== undefined) {
    if (trimmed.length === 0) {
      input = undefined
      continue
    }
    const labelled = LABEL.exec(line)
    if (labelled !== null && INPUT_FIELDS[labelled[1]] !== undefined) {
      const name = INPUT_FIELDS[labelled[1]]
      const value = labelled[2]
      if (name === 'scriptPubKey') {
        const spk = /^([0-9a-f]+),?\s+value:\s*([0-9.]+)$/.exec(value)
        if (spk === null) throw new Error(`Unreadable scriptPubKey line: ${line}`)
        input.scriptPubKey = spk[1]
        input.value = spk[2]
      } else {
        input[name] = value
      }
      inputLabel = name
    } else if (HEX.test(trimmed) && inputLabel !== undefined && !HEX.test(input[inputLabel])) {
      input[`${inputLabel}Text`] = input[inputLabel]
      input[inputLabel] = trimmed
    }
    continue
  }

  const labelled = LABEL.exec(line)
  if (labelled === null) continue
  const label = labelled[1]
  const value = labelled[2]
  const hex = HEX_VALUE.test(value) ? value : undefined

  if (/^(hash )?preimage( for [A-Z|]+)?$/.test(label)) {
    fields.preimage = hex
    fields.label = label
    signing = undefined
  } else if (SIGHASH_FIELDS.includes(label)) {
    fields[label] = hex
    signing = undefined
  } else if (/^sighash$/i.test(label)) {
    if (hex === undefined || fields.preimage === undefined) {
      throw new Error(`A sigHash with no preimage before it: ${line}`)
    }
    signing = {}
    for (const name of ['label', ...SIGHASH_FIELDS, 'preimage']) {
      if (fields[name] !== undefined) signing[name] = fields[name]
    }
    signing.sigHash = hex
    example.signatures.push(signing)
  } else if (signing !== undefined && KEY_FIELDS[label] !== undefined) {
    signing[KEY_FIELDS[label]] = hex ?? value
  }
}

let signatures = 0
for (const s of sections) {
  for (const e of s.examples) {
    if (e.unsignedTx === undefined && e.signedTx === undefined) {
      throw new Error(`An example in ${s.name} has no transaction.`)
    }
    if (e.signatures.length === 0) throw new Error(`An example in ${s.name} has no sigHash.`)
    signatures += e.signatures.length
  }
}

const result = {
  note:
    'Extracted from the "Example" section of bip-0143.mediawiki by ' +
    'tools/extract-bip143-vectors.mjs, which states the reading rules. Values are ' +
    'copied verbatim; nothing is decoded or re-encoded. Each section is a heading ' +
    'of the BIP; each example is one transaction; each entry in "signatures" is ' +
    'one published sigHash with the fields the BIP lists for it. "amount" and ' +
    '"nHashType" are little-endian as printed; "scriptCode" carries its length ' +
    'prefix as printed; "value" is in BTC as printed.',
  source: `https://github.com/bitcoin/bips/blob/${commit}/bip-0143.mediawiki`,
  bipsCommit: commit,
  sections,
}

writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n')
console.log(
  `wrote ${OUT}: ${String(sections.length)} sections, ` +
    `${String(sections.reduce((n, s) => n + s.examples.length, 0))} examples, ` +
    `${String(signatures)} sighashes`
)
