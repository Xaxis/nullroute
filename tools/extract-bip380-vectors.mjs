#!/usr/bin/env node
/**
 * Extract the BIP-380 key expression test vectors from the BIP text into JSON.
 *
 * BIP-380 prints two sets of vectors. The checksum cases are vendored by hand
 * in spec/vectors/bip380-checksum.json. This takes the other set, the valid
 * and invalid key expressions, which every descriptor this device reads is
 * built from. They are printed inside the BIP text, so the file is an
 * extraction, and an extraction nobody can repeat is a claim rather than a
 * vector. This is the extraction. Run it on the same bips commit and the
 * output is byte-identical to spec/vectors/bip380-key-expressions.json, whose
 * hash is pinned in descriptor/parse.spec.yaml.
 *
 * It reads a local copy and never fetches, because the point is that the
 * reviewer chooses where the BIP text comes from.
 *
 * WHAT IT TAKES, and nothing else, from the "Test Vectors" section: the
 * bullets after "The following tests cover key expressions:", into `valid`
 * under "Valid expressions:" and into `invalid` under "Invalid expression:".
 * The expression is the last <tt> element on the bullet; the description is
 * the text before it, with the separating colon removed.
 *
 * One irregularity in the text is carried rather than corrected: the two WIF
 * bullets have no colon between description and expression, so the colon is
 * optional. Descriptions keep their own <tt> markup verbatim.
 *
 * Strings are copied verbatim. Nothing is decoded or re-encoded.
 *
 * Run: node tools/extract-bip380-vectors.mjs <bip-0380.mediawiki> <bips-commit>
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT = join(ROOT, 'spec/vectors/bip380-key-expressions.json')

const [source, commit] = process.argv.slice(2)
if (source === undefined || commit === undefined || !/^[0-9a-f]{40}$/.test(commit)) {
  console.error('usage: node tools/extract-bip380-vectors.mjs <bip-0380.mediawiki> <bips-commit>')
  process.exit(2)
}

const text = readFileSync(source, 'utf8')
const start = text.indexOf('\n==Test Vectors==\n')
if (start < 0) throw new Error('No "Test Vectors" section found.')
const after = text.indexOf('\n==', start + 1)
const section = text.slice(start, after < 0 ? undefined : after)
const keys = section.indexOf('\nThe following tests cover key expressions:\n')
if (keys < 0) throw new Error('No key expression vectors found.')
const lines = section.slice(keys).split('\n')

const out = { valid: [], invalid: [] }
let bucket = undefined

for (const line of lines) {
  if (line === 'Valid expressions:') bucket = out.valid
  else if (line === 'Invalid expression:') bucket = out.invalid
  if (bucket === undefined || !line.startsWith('* ')) continue
  bucket.push(split(line))
}

/** "* DESCRIPTION[:] <tt>EXPRESSION</tt>" into its two parts. */
function split(line) {
  const open = line.lastIndexOf('<tt>')
  if (open < 0 || !line.endsWith('</tt>')) throw new Error(`No <tt> expression in: ${line}`)
  const expression = line.slice(open + '<tt>'.length, -'</tt>'.length)
  const description = line.slice(2, open).trim().replace(/:$/, '').trim()
  if (expression.length === 0 || description.length === 0) {
    throw new Error(`Empty description or expression in: ${line}`)
  }
  return { description, expression }
}

for (const [name, cases] of Object.entries(out)) {
  if (cases.length === 0) throw new Error(`The BIP text produced no ${name} key expressions.`)
}

const result = {
  note:
    'Extracted from the key expression part of the "Test Vectors" section of ' +
    'bip-0380.mediawiki by tools/extract-bip380-vectors.mjs. Each expression is ' +
    'copied verbatim from the last <tt> element on its bullet and each ' +
    'description is the text before it; nothing is decoded or re-encoded. ' +
    '"valid" and "invalid" are the two lists the BIP names. The checksum ' +
    'vectors from the same section are in spec/vectors/bip380-checksum.json.',
  source: `https://github.com/bitcoin/bips/blob/${commit}/bip-0380.mediawiki`,
  bipsCommit: commit,
  ...out,
}

writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n')
console.log(
  `wrote ${OUT}: ${String(out.valid.length)} valid, ${String(out.invalid.length)} invalid`
)
