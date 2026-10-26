#!/usr/bin/env node
/**
 * Extract the BIP-370 test vectors from the BIP text into JSON.
 *
 * The device refuses every version 2 PSBT (INV-PSBT-19), and the published
 * vectors are how that refusal is shown to cover what BIP-370 itself calls a
 * version 2 PSBT rather than whatever this repository happened to construct.
 * Like BIP-174, BIP-370 prints its vectors inside the BIP text, so the file
 * under spec/vectors/ is an extraction, and an extraction nobody can repeat is
 * a claim rather than a vector. This is the extraction. Run it on the same bips
 * commit and the output is byte-identical to spec/vectors/bip370-psbt.json,
 * whose hash is pinned in parse.spec.yaml.
 *
 * It reads a local copy and never fetches, because the point is that the
 * reviewer chooses where the BIP text comes from.
 *
 * WHAT IT TAKES, and nothing else, from the "Test Vectors" section:
 *
 *   - "The following are invalid PSBTs:" until the next list: every "* Case:"
 *     with its hex and base64, into `invalid`.
 *   - "The following are valid PSBTs" likewise, into `valid`.
 *   - Each "The timelock for the following PSBTs should be computed to be N:"
 *     list into `locktime`, with `expected` set to N, and the "cannot be
 *     computed" list with `expected` set to null.
 *
 * Two irregularities in the text are carried rather than corrected. One case
 * spells its hex line "Bytes in HEx", so the label is matched without regard
 * to case. And the last PSBT in the 1657048460 list has no "* Case:" line, so
 * it is recorded under a description saying so rather than given one the BIP
 * does not.
 *
 * Strings are copied verbatim. Nothing is decoded, re-encoded or normalised,
 * so a transcription error cannot hide behind a round trip; the test checks
 * separately that each hex and base64 pair encode the same bytes.
 *
 * Run: node tools/extract-bip370-vectors.mjs <bip-0370.mediawiki> <bips-commit>
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT = join(ROOT, 'spec/vectors/bip370-psbt.json')

const [source, commit] = process.argv.slice(2)
if (source === undefined || commit === undefined || !/^[0-9a-f]{40}$/.test(commit)) {
  console.error('usage: node tools/extract-bip370-vectors.mjs <bip-0370.mediawiki> <bips-commit>')
  process.exit(2)
}

const text = readFileSync(source, 'utf8')
const start = text.indexOf('\n==Test Vectors==\n')
const end = text.indexOf('\n==Rationale==\n')
if (start < 0 || end < start) throw new Error('No "Test Vectors" section found.')
const lines = text.slice(start, end).split('\n')

const UNLABELLED = '(no "Case:" line in the BIP; listed under the same expected locktime)'
const PRE = /<pre>([^<]*)<\/pre>/
const LOCKTIME = /^The timelock for the following PSBTs should be computed to be (\d+):$/
const out = { invalid: [], valid: [], locktime: [] }
let bucket = undefined
let expected = undefined
let current = undefined

for (const line of lines) {
  const lock = LOCKTIME.exec(line)
  if (line === 'The following are invalid PSBTs:') bucket = out.invalid
  else if (line === 'The following are valid PSBTs') bucket = out.valid
  else if (lock !== null) {
    bucket = out.locktime
    expected = Number(lock[1])
  } else if (line === 'The timelock for the following PSBTs cannot be computed:') {
    bucket = out.locktime
    expected = null
  }

  if (bucket === undefined) continue

  if (line.startsWith('* Case: ')) {
    current = { description: line.slice('* Case: '.length) }
    if (bucket === out.locktime) current.expected = expected
    bucket.push(current)
  } else if (/^\*\* Bytes in hex: /i.test(line)) {
    if (current === undefined || current.hex !== undefined) {
      current = { description: UNLABELLED }
      if (bucket === out.locktime) current.expected = expected
      bucket.push(current)
    }
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
  if (cases.length === 0) throw new Error(`The BIP text produced no ${name} cases.`)
  for (const c of cases) {
    if (c.hex === undefined || c.base64 === undefined) {
      throw new Error(`An entry in ${name} is missing its hex or base64 form.`)
    }
  }
}

const result = {
  note:
    'Extracted from the "Test Vectors" section of bip-0370.mediawiki by ' +
    'tools/extract-bip370-vectors.mjs. Strings are copied verbatim from the ' +
    '<pre> blocks; nothing is decoded or re-encoded. "invalid" and "valid" are ' +
    'the two lists the BIP names; "locktime" is its timelock determination ' +
    'lists, each case carrying the locktime the BIP says it computes to, or ' +
    'null where the BIP says it cannot be computed.',
  source: `https://github.com/bitcoin/bips/blob/${commit}/bip-0370.mediawiki`,
  bipsCommit: commit,
  ...out,
}

writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n')
console.log(
  `wrote ${OUT}: ${String(out.invalid.length)} invalid, ${String(out.valid.length)} valid, ` +
    `${String(out.locktime.length)} locktime`
)
