#!/usr/bin/env node
/**
 * Extract the BIP-174 test vectors from the BIP text into JSON.
 *
 * BIP-174 publishes its vectors inside bip-0174.mediawiki rather than as a
 * separate file, so the file under spec/vectors/ has to be extracted, and an
 * extraction nobody can repeat is a claim rather than a vector. This is the
 * extraction. Run it on the same bips commit and the output is byte-identical
 * to spec/vectors/bip174-psbt.json, whose hash is pinned in parse.spec.yaml.
 *
 * It reads a local copy and never fetches, because the point is that the
 * reviewer chooses where the BIP text comes from.
 *
 * WHAT IT TAKES, and nothing else, from the "Test Vectors" section:
 *
 *   - "The following are invalid PSBTs:" until the next heading line: every
 *     "* Case:" with its hex and base64, into `invalid`.
 *   - "The following are valid PSBTs:" likewise, into `valid`.
 *   - "Fails Signer checks": the same shape, into `signerChecks`. These are
 *     well-formed PSBTs that a signer must refuse to sign, not parse failures.
 *   - Everything after, the role walk-through: every PSBT given as a hex and
 *     base64 pair, into `roles`, labelled with the sentences introducing it.
 *     Raw transactions (previous transactions, the extractor's output) are
 *     hex only and are not PSBTs, so they are left out.
 *
 * Strings are copied verbatim. Nothing is decoded, re-encoded or normalised,
 * so a transcription error cannot hide behind a round trip; the test checks
 * separately that each hex and base64 pair encode the same bytes.
 *
 * Run: node tools/extract-bip174-vectors.mjs <bip-0174.mediawiki> <bips-commit>
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT = join(ROOT, 'spec/vectors/bip174-psbt.json')

const [source, commit] = process.argv.slice(2)
if (source === undefined || commit === undefined || !/^[0-9a-f]{40}$/.test(commit)) {
  console.error('usage: node tools/extract-bip174-vectors.mjs <bip-0174.mediawiki> <bips-commit>')
  process.exit(2)
}

const text = readFileSync(source, 'utf8')
const start = text.indexOf('\n==Test Vectors==\n')
const end = text.indexOf('\n==Rationale==\n')
if (start < 0 || end < start) throw new Error('No "Test Vectors" section found.')
const lines = text.slice(start, end).split('\n')

const PRE = /<pre>([^<]*)<\/pre>/
const out = { invalid: [], valid: [], signerChecks: [], roles: [] }
let bucket = undefined
let current = undefined
// The sentences since the last PSBT, joined. One sentence is not enough: the
// walk-through often says only "must create this PSBT:" after a list, and the
// role is named in the sentence before the list.
let narrative = []
let lastStep = ''

for (const line of lines) {
  if (line === 'The following are invalid PSBTs:') bucket = out.invalid
  else if (line === 'The following are valid PSBTs:') bucket = out.valid
  else if (line === 'Fails Signer checks') bucket = out.signerChecks
  else if (line.startsWith('The private keys in the tests below')) bucket = out.roles

  if (bucket === undefined) continue

  if (bucket === out.roles) {
    if (line.length > 0 && !line.startsWith('*')) narrative.push(line)
    if (line.startsWith('* Bytes in Hex: ')) {
      // Two PSBTs under one sentence share it.
      if (narrative.length > 0) lastStep = narrative.join(' ')
      narrative = []
      current = { step: lastStep, hex: match(line) }
    } else if (line.startsWith('** Base64 String: ') && current !== undefined) {
      bucket.push({ ...current, base64: match(line) })
      current = undefined
    } else if (line.length === 0) {
      current = undefined
    }
    continue
  }

  if (line.startsWith('* Case: ')) {
    current = { description: line.slice('* Case: '.length) }
    bucket.push(current)
  } else if (line.startsWith('** Bytes in Hex: ') && current !== undefined) {
    current.hex = match(line)
  } else if (line.startsWith('** Base64 String: ') && current !== undefined) {
    current.base64 = match(line)
  }
}

function match(line) {
  const found = PRE.exec(line)
  if (found === null || found[1] === undefined) throw new Error(`No <pre> value in: ${line}`)
  return found[1]
}

for (const [name, cases] of Object.entries(out)) {
  for (const c of cases) {
    if (c.hex === undefined || c.base64 === undefined) {
      throw new Error(`An entry in ${name} is missing its hex or base64 form.`)
    }
  }
}

const result = {
  note:
    'Extracted from the "Test Vectors" section of bip-0174.mediawiki by ' +
    'tools/extract-bip174-vectors.mjs. Strings are copied verbatim from the ' +
    '<pre> blocks; nothing is decoded or re-encoded. "invalid" and "valid" are ' +
    'the two lists the BIP names; "signerChecks" is its "Fails Signer checks" ' +
    'list; "roles" is every PSBT in the role walk-through, labelled with the ' +
    'sentences that introduce it. Raw transactions in the walk-through are not ' +
    'PSBTs and are not included.',
  source: `https://github.com/bitcoin/bips/blob/${commit}/bip-0174.mediawiki`,
  bipsCommit: commit,
  ...out,
}

writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n')
console.log(
  `wrote ${OUT}: ${String(out.invalid.length)} invalid, ${String(out.valid.length)} valid, ` +
    `${String(out.signerChecks.length)} signer checks, ${String(out.roles.length)} role steps`
)
