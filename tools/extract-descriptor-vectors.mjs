#!/usr/bin/env node
/**
 * Extract the test vectors of one descriptor BIP, 381 to 386, into JSON.
 *
 * Each of BIP-381 (pk, pkh, sh), 382 (wpkh, wsh), 383 (multi, sortedmulti),
 * 384 (combo), 385 (raw, addr) and 386 (tr) prints its vectors inside the BIP
 * text: valid descriptors with the scripts they produce, and invalid
 * descriptors with the reason. The files under spec/vectors/ are therefore
 * extractions, and an extraction nobody can repeat is a claim rather than a
 * vector. This is the extraction, one tool for the six because they share one
 * layout. Run it on a BIP at the same bips commit and the output is
 * byte-identical to spec/vectors/bip<N>-descriptors.json, whose hash is pinned
 * in descriptor/quorum-addresses.spec.yaml. The BIP number, and so the output
 * file, comes from the BIP's own header.
 *
 * It reads a local copy and never fetches, because the point is that the
 * reviewer chooses where the BIP text comes from.
 *
 * WHAT IT TAKES, and nothing else, from the "Test Vectors" section:
 *
 *   - After "Valid descriptors followed by the scripts they produce.": each
 *     "* <tt>DESCRIPTOR</tt>" into `valid`, with the "** <tt>SCRIPT</tt>"
 *     bullets under it in `scripts`, in order. What several scripts mean is the
 *     BIP's to say and is not interpreted here: BIP-384 lists the several
 *     scripts combo() produces for one key, the others list children 0, 1
 *     and 2 of a ranged descriptor.
 *   - Where a descriptor's sub-bullets are "** Child N" labels (BIP-384), the
 *     "*** <tt>SCRIPT</tt>" bullets under each label go into `children`, as
 *     { label, scripts }, instead of `scripts`.
 *   - After the "Invalid descriptors" heading, in whichever of its three
 *     spellings: each bullet into `invalid`, the descriptor being the last
 *     <tt> element and the description the text before it, with the separating
 *     colon removed and the description's own <tt> markup kept.
 *
 * One irregularity is carried rather than corrected: BIP-386 lists a last
 * valid descriptor with no script under it, so it is recorded with an empty
 * `scripts` rather than given one the BIP does not print.
 *
 * Strings are copied verbatim. Nothing is decoded or re-encoded.
 *
 * Run: node tools/extract-descriptor-vectors.mjs <bip-038N.mediawiki> <bips-commit>
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SUPPORTED = new Set([381, 382, 383, 384, 385, 386])

const [source, commit] = process.argv.slice(2)
if (source === undefined || commit === undefined || !/^[0-9a-f]{40}$/.test(commit)) {
  console.error(
    'usage: node tools/extract-descriptor-vectors.mjs <bip-038N.mediawiki> <bips-commit>'
  )
  process.exit(2)
}

const text = readFileSync(source, 'utf8')
const header = /^ {2}BIP: (\d+)$/m.exec(text)
const bip = header === null ? undefined : Number(header[1])
if (bip === undefined || !SUPPORTED.has(bip)) {
  throw new Error(`Expected one of BIPs 381 to 386, found BIP ${String(bip)}.`)
}
const name = `bip-0${String(bip)}.mediawiki`
const OUT = join(ROOT, `spec/vectors/bip${String(bip)}-descriptors.json`)

const start = text.indexOf('\n==Test Vectors==\n')
if (start < 0) throw new Error('No "Test Vectors" section found.')
const after = text.indexOf('\n==', start + 1)
const lines = text.slice(start, after < 0 ? undefined : after).split('\n')

const TT = /^<tt>(.*)<\/tt>$/
const out = { valid: [], invalid: [] }
let bucket = undefined
let current = undefined
let child = undefined

for (const line of lines) {
  if (line.startsWith('Valid descriptors followed by the scripts they produce')) {
    bucket = out.valid
    continue
  }
  if (/^Invalid [Dd]escriptors/.test(line)) {
    bucket = out.invalid
    current = undefined
    continue
  }
  if (bucket === undefined) continue

  if (bucket === out.invalid) {
    if (line.startsWith('* ')) out.invalid.push(split(line))
    continue
  }

  if (line.startsWith('* ')) {
    current = { descriptor: tt(line.slice(2), line) }
    child = undefined
    out.valid.push(current)
  } else if (line.startsWith('** ') && current !== undefined) {
    const rest = line.slice(3)
    if (TT.test(rest)) {
      if (current.children !== undefined) throw new Error(`Script after a child label: ${line}`)
      current.scripts ??= []
      current.scripts.push(tt(rest, line))
    } else {
      if (current.scripts !== undefined) throw new Error(`Child label after a script: ${line}`)
      child = { label: rest, scripts: [] }
      current.children ??= []
      current.children.push(child)
    }
  } else if (line.startsWith('*** ') && child !== undefined) {
    child.scripts.push(tt(line.slice(4), line))
  } else if (line.startsWith('*')) {
    throw new Error(`Unrecognised bullet in the valid list: ${line}`)
  }
}

function tt(value, line) {
  const found = TT.exec(value)
  if (found === null || found[1] === undefined || found[1].length === 0) {
    throw new Error(`Expected a single <tt> element in: ${line}`)
  }
  return found[1]
}

/** "* DESCRIPTION[:] <tt>DESCRIPTOR</tt>" into its two parts. */
function split(line) {
  const open = line.lastIndexOf('<tt>')
  if (open < 0 || !line.endsWith('</tt>')) throw new Error(`No <tt> descriptor in: ${line}`)
  const descriptor = line.slice(open + '<tt>'.length, -'</tt>'.length)
  const description = line.slice(2, open).trim().replace(/:$/, '').trim()
  if (descriptor.length === 0 || description.length === 0) {
    throw new Error(`Empty description or descriptor in: ${line}`)
  }
  return { description, descriptor }
}

for (const [list, cases] of Object.entries(out)) {
  if (cases.length === 0) throw new Error(`BIP ${String(bip)} produced no ${list} descriptors.`)
}
// The one descriptor printed with no script, kept as an empty list so that
// what the BIP left out is visible in the file rather than silently absent.
for (const c of out.valid) {
  if (c.scripts === undefined && c.children === undefined) c.scripts = []
}

const result = {
  note:
    `Extracted from the "Test Vectors" section of ${name} by ` +
    'tools/extract-descriptor-vectors.mjs. Descriptors and scripts are copied ' +
    'verbatim from their <tt> elements; nothing is decoded or re-encoded. ' +
    '"valid" holds each valid descriptor with the scripts listed under it in ' +
    'order, or, where the BIP groups them under child labels, with "children". ' +
    '"invalid" holds each invalid descriptor with the description before it.',
  source: `https://github.com/bitcoin/bips/blob/${commit}/${name}`,
  bipsCommit: commit,
  bip,
  ...out,
}

writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n')
console.log(
  `wrote ${OUT}: ${String(out.valid.length)} valid, ${String(out.invalid.length)} invalid`
)
