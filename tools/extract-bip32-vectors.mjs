#!/usr/bin/env node
/**
 * Extract BIP-32 test vector 5, the invalid extended keys, into JSON.
 *
 * Vectors 1 to 4 are vendored in spec/vectors/bip32.json: a seed and a chain
 * of keys that derivation has to reproduce. Vector 5 is a different kind of
 * vector, a list of extended keys that every importer has to refuse, each with
 * the reason the BIP gives, so it gets its own file rather than being forced
 * into the shape of the other four. BIP-32 prints it inside the BIP text, so the
 * file is an extraction, and an extraction nobody can repeat is a claim rather
 * than a vector. This is the extraction. Run it on the same bips commit and the
 * output is byte-identical to spec/vectors/bip32-invalid-keys.json, whose hash
 * is pinned in derive.spec.yaml and descriptor/parse.spec.yaml.
 *
 * It reads a local copy and never fetches, because the point is that the
 * reviewer chooses where the BIP text comes from.
 *
 * WHAT IT TAKES, and nothing else: every bullet under "===Test vector 5===" up
 * to the next heading. A bullet is "* KEY (REASON)": the key goes into `key`
 * and the text inside the final parentheses into `description`.
 *
 * Strings are copied verbatim. Nothing is decoded or re-encoded, so a
 * transcription error cannot hide behind a round trip.
 *
 * Run: node tools/extract-bip32-vectors.mjs <bip-0032.mediawiki> <bips-commit>
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT = join(ROOT, 'spec/vectors/bip32-invalid-keys.json')

const [source, commit] = process.argv.slice(2)
if (source === undefined || commit === undefined || !/^[0-9a-f]{40}$/.test(commit)) {
  console.error('usage: node tools/extract-bip32-vectors.mjs <bip-0032.mediawiki> <bips-commit>')
  process.exit(2)
}

const text = readFileSync(source, 'utf8')
const start = text.indexOf('\n===Test vector 5===\n')
if (start < 0) throw new Error('No "Test vector 5" section found.')
const after = text.indexOf('\n==', start + 1)
const lines = text.slice(start, after < 0 ? undefined : after).split('\n')

const BULLET = /^\* (\S+) \((.*)\)$/
const invalid = []
for (const line of lines) {
  if (!line.startsWith('* ')) continue
  const found = BULLET.exec(line)
  if (found === null || found[1] === undefined || found[2] === undefined) {
    throw new Error(`A bullet in test vector 5 is not "* KEY (REASON)": ${line}`)
  }
  invalid.push({ description: found[2], key: found[1] })
}
if (invalid.length === 0) throw new Error('Test vector 5 produced no keys.')

const result = {
  note:
    'Extracted from "Test vector 5" of bip-0032.mediawiki by ' +
    'tools/extract-bip32-vectors.mjs. Each key is copied verbatim from its ' +
    'bullet and each description is the text in the parentheses after it; ' +
    'nothing is decoded or re-encoded. Every key here is one the BIP says ' +
    'must be recognised as invalid. Vectors 1 to 4 are in spec/vectors/bip32.json.',
  source: `https://github.com/bitcoin/bips/blob/${commit}/bip-0032.mediawiki`,
  bipsCommit: commit,
  invalid,
}

writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n')
console.log(`wrote ${OUT}: ${String(invalid.length)} invalid extended keys`)
