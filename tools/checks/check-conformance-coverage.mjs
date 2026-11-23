#!/usr/bin/env node
/**
 * What the documents say the vectors check is what the vectors check.
 *
 * WHY THIS EXISTS. Two places state which requirements of the signer profile a
 * portable vector checks: the table in conformance/README.md ("Which
 * requirements the vectors check") and the "Check:" line of each requirement in
 * spec/signer-profile.md. Both were typed by hand. On 23 November the table
 * still filed SP-REV-1 under "own tests only" after review-malformed.json had
 * landed, SP-REV-5 under "manual" after review-outputs.json, and had never
 * moved SP-REV-22 or SP-TX-7 out of the rows they started in. A reader choosing
 * which requirements to trust a passing run for was told the wrong set.
 *
 * The vectors are the ground truth: every case names the requirements it
 * checks. This asserts, in both directions:
 *
 *   1. every requirement a case names is in one of the table's vector rows,
 *      and in neither the "own tests only" row nor the "manual" row;
 *   2. every requirement in a vector row is named by some case;
 *   3. every requirement a case names has a "Check:" line in the profile that
 *      names each vector file checking it.
 *
 * Run: node tools/checks/check-conformance-coverage.mjs
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const VECTORS = join(ROOT, 'spec/vectors/signer-profile')
const README = join(ROOT, 'conformance/README.md')
const PROFILE = join(ROOT, 'spec/signer-profile.md')

const problems = []

/** Requirement id to the vector files whose cases name it. */
const named = new Map()
for (const file of readdirSync(VECTORS)
  .filter((f) => f.endsWith('.json'))
  .sort()) {
  const doc = JSON.parse(readFileSync(join(VECTORS, file), 'utf8'))
  for (const testCase of doc.cases ?? []) {
    for (const id of testCase.requirements ?? []) {
      if (!named.has(id)) named.set(id, new Set())
      named.get(id).add(file)
    }
  }
}
if (named.size === 0)
  problems.push(`no case in ${VECTORS} names a requirement, so there is nothing to compare`)

/**
 * The ids in a table cell, written the way the table writes them: "SP-ENT-1,
 * 2, 3" carries the prefix forward, "SP-HW-1 to SP-HW-6" is a range, and
 * anything in parentheses is commentary.
 */
function idsIn(cell) {
  const ids = []
  let prefix = null
  const text = cell.replace(/\([^)]*\)/gu, '')
  for (const match of text.matchAll(/(SP-[A-Z]+-)?(\d+)(?:\s+to\s+(SP-[A-Z]+-)?(\d+))?/gu)) {
    if (match[1] !== undefined) prefix = match[1]
    if (prefix === null) continue
    const from = Number(match[2])
    const to = match[4] === undefined ? from : Number(match[4])
    for (let n = from; n <= to; n += 1) ids.push(`${prefix}${n}`)
  }
  return ids
}

const readme = readFileSync(README, 'utf8')
const section = readme
  .split(/^## /mu)
  .find((part) => part.startsWith('Which requirements the vectors check'))
const rows = new Map()
if (section === undefined) {
  problems.push('conformance/README.md has no "Which requirements the vectors check" section')
} else {
  for (const line of section.split('\n')) {
    const cells = line.split('|').map((cell) => cell.trim())
    if (cells.length < 4 || cells[1] === 'How it is checked' || cells[1].startsWith('---')) continue
    rows.set(cells[1], idsIn(cells[2]))
  }
}
const vectorRows = [...rows].filter(([label]) => label.startsWith('Vector'))
const otherRows = [...rows].filter(([label]) => /own tests only|Manual procedure/u.test(label))
if (rows.size > 0 && (vectorRows.length === 0 || otherRows.length < 2))
  problems.push('the README table no longer has the vector, own-tests and manual rows this reads')

const inVectorRows = new Set(vectorRows.flatMap(([, ids]) => ids))
for (const [id, files] of named) {
  if (!inVectorRows.has(id))
    problems.push(
      `${id} is checked by ${[...files].join(', ')} and is in no vector row of the README table`
    )
  for (const [label, ids] of otherRows)
    if (ids.includes(id))
      problems.push(`${id} is checked by a vector and still listed under "${label}"`)
}
for (const id of inVectorRows)
  if (!named.has(id))
    problems.push(`${id} is in a vector row of the README table and no case names it`)

const profile = readFileSync(PROFILE, 'utf8')
for (const [id, files] of named) {
  const at = profile.indexOf(`**${id}.**`)
  if (at === -1) {
    problems.push(`${id} is named by a vector case and is not a requirement in the profile`)
    continue
  }
  // A requirement runs to the next one or the next heading: some, SP-ATT-2 and
  // SP-SIG-1 among them, span several paragraphs before their Check line.
  const rest = profile.slice(at + 2)
  const next = rest.search(/\n(?:\*\*SP-|#)/u)
  const body = next === -1 ? rest : rest.slice(0, next)
  const checkAt = body.lastIndexOf('Check:')
  const check = checkAt === -1 ? '' : body.slice(checkAt)
  for (const file of files)
    if (!check.includes(file))
      problems.push(`${id}'s Check line in the profile does not name ${file}, whose cases check it`)
}

if (problems.length > 0) {
  console.error(
    'check-conformance-coverage: the documents and the vectors disagree on what is checked.'
  )
  for (const problem of problems) console.error(`  ${problem}`)
  process.exit(1)
}
console.log(
  `check-conformance-coverage: ${named.size} requirements named by vector cases, each in the README's vector rows and its profile Check line`
)
