#!/usr/bin/env node
/**
 * The numbers on the README badges are the ones this tree actually computes.
 *
 * WHY THIS EXISTS. The README is the first page a stranger reads, and its top
 * two badges are the project's headline claim in numeric form: how many specs
 * exist, and how many invariants they declare. Both were typed by hand. The
 * invariants badge said 299 while verification-report.json said 300, and had
 * said 299 since the badge was added, through every commit that added an
 * invariant. Nothing noticed, because nothing looked.
 *
 * The website does not have this problem: apps/web/lib/facts.ts reads the
 * report at build time and fails the build if a field is missing, on the stated
 * grounds that "it would be strange to claim everything here is machine-checked
 * on a page whose own claims were not". Exactly that argument applies to the
 * README, which reaches more people than the site does and is the document a
 * reader lands on from a link. It was simply never extended there, because
 * markdown on GitHub cannot read a JSON file at render time.
 *
 * So the binding is a check rather than a template. The badge stays a literal
 * in the file, and this asserts the literal is current.
 *
 * THE PROPOSAL SUMMARY TOO. research/proposal-summary.md is what a grant
 * reviewer reads, and it prints the output of `make verify` as a table. That
 * table was typed once and then sat still: it said 355 invariants, 39 vector
 * files and a root hash two units old while the tree had 357, 41 and another
 * root. Every row is checked here against the same report, and --write
 * rewrites it.
 *
 * A MISSING BADGE IS A FAILURE, NOT A PASS. The obvious way to write this is to
 * scan whatever badges are present and compare those. That check is defeated by
 * deleting a badge, which is the one edit somebody makes when a badge is
 * inconvenient, and the deletion would read as green. Each entry in KNOWN below
 * must be found, so removing a badge fails here and has to be removed from this
 * file too, which is a visible decision in a diff.
 *
 * A MISSING REPORT IS ALSO A FAILURE. `verification-report.json` is written by
 * `make verify`. If it is not there, this cannot answer the question, and a
 * check that cannot run must not print a reassuring line and exit 0. That is
 * the false pass this repository argues against everywhere else.
 *
 * Run: node tools/checks/check-readme-badges.mjs [--write]
 *   --write updates the badge values in place. It is deliberately NOT called by
 *   any target that `make check` depends on: a checker that repairs the thing it
 *   is checking, in the same run, asserts nothing.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const README = join(ROOT, 'README.md')
const SUMMARY = join(ROOT, 'research/proposal-summary.md')
const REPORT = join(ROOT, 'verification-report.json')
const WRITE = process.argv.includes('--write')

/**
 * Badge label to the report field that defines it.
 *
 * Only fields the verifier computes belong here. A badge whose value is a
 * judgement rather than a measurement (the CI status, the licence) has nothing
 * to compare against and is not listed, which is why this does not object to
 * the other badges in the file.
 */
const KNOWN = [
  {
    label: 'specs',
    field: 'specCount',
    what: 'spec files the verifier loaded',
  },
  {
    label: 'invariants',
    field: 'invariantCount',
    what: 'invariants those specs declare',
  },
]

if (!existsSync(REPORT)) {
  console.error('check-readme-badges: no verification-report.json, so the badges cannot be')
  console.error('  checked against anything. This is a failure rather than a skip: the')
  console.error('  badges are a claim, and "not checked" must not print as "checked".')
  console.error('')
  console.error('      make verify')
  process.exit(1)
}

let report
try {
  report = JSON.parse(readFileSync(REPORT, 'utf8'))
} catch (error) {
  console.error(
    `check-readme-badges: verification-report.json is not readable JSON: ${error.message}`
  )
  process.exit(1)
}

const source = readFileSync(README, 'utf8')
let patched = source
const problems = []
const matched = []

for (const { label, field, what } of KNOWN) {
  const expected = report[field]
  if (typeof expected !== 'number') {
    problems.push(
      `the report has no numeric \`${field}\`, so the ${label} badge has nothing to be checked against.`
    )
    continue
  }

  // shields.io escapes a literal dash in a label as `--`, so the value is read
  // as the last dash-separated field rather than the second. Anchored to the
  // badge URL so a number elsewhere in the prose cannot satisfy this.
  const badge = new RegExp(`(img\\.shields\\.io/badge/${label}-)(\\d+)(-[A-Za-z0-9]+)`, 'gu')
  const found = [...source.matchAll(badge)]

  if (found.length === 0) {
    problems.push(
      `the README has no ${label} badge. It is listed here as one the project publishes, so ` +
        `removing it is a decision that belongs in this file too, not a silent pass.`
    )
    continue
  }

  for (const hit of found) {
    const actual = Number(hit[2])
    if (actual === expected) {
      matched.push(`${label} ${actual}`)
      continue
    }
    problems.push(`the ${label} badge reads ${actual}, this tree has ${expected} ${what}.`)
    patched = patched.replace(hit[0], `${hit[1]}${expected}${hit[3]}`)
  }
}

// The summary's table, row by row, as this report says it. A row is found by
// its label and compared whole, so a reworded row fails rather than passing
// with its number unchecked.
const detail = (name, pattern) => {
  const text = report.checks?.find((check) => check.name === name)?.detail ?? ''
  const hit = pattern.exec(text)
  if (hit === null)
    problems.push(
      `the report's ${name} detail, ${JSON.stringify(text)}, is not in the form this reads.`
    )
  return hit ?? []
}
const [, bound, suite] = detail(
  'invariants',
  /^\d+ invariants bound to (\d+) tests, (\d+) tests in the suite$/u
)
const [, vectorsOk, vectors] = detail('vectors', /^(\d+) of (\d+) vector files/u)
const [, modules] = detail('differential', /^(\d+) modules cross-checked$/u)
const [, files] = detail('integrity', /^(\d+) files, root /u)
// The invariants row says every bound test ran and passed; that is checked,
// not assumed from the report existing.
if (!(report.invariants ?? []).every((binding) => binding.status === 'passed'))
  problems.push('the summary says every bound test passed, and this report has one that did not.')

const rows = [
  [
    '| Coverage |',
    `${report.coverage?.covered} of ${report.coverage?.runtimeExports} runtime exports of \`packages/core\` named by a spec |`,
  ],
  [
    '| Invariants |',
    `${report.invariantCount} invariants bound to ${bound} tests, each of which ran and passed; ${suite} tests in the suite |`,
  ],
  ['| Vectors |', `${vectorsOk} of ${vectors} vector files match their pinned hash |`],
  ['| Differential |', `${modules} modules cross-checked against \`bitcoinjs-lib\` |`],
  [
    '| Integrity |',
    `${files} files, root \`${report.rootHash}\`, and no tracked file under those paths left out |`,
  ],
  [
    'Totals:',
    `${report.specCount} specs, ${report.invariantCount} invariants. The README badges state the same two numbers,`,
  ],
]
const summary = readFileSync(SUMMARY, 'utf8')
const summaryLines = summary.split('\n')
let summaryStale = 0
for (const [label, rest] of rows) {
  const at = summaryLines.findIndex((line) => line.startsWith(label))
  const want = `${label} ${rest}`
  if (at === -1) {
    problems.push(`the proposal summary has no line starting ${JSON.stringify(label)}.`)
    continue
  }
  if (summaryLines[at] === want) {
    matched.push(`summary ${label.replaceAll('|', '').trim()}`)
    continue
  }
  problems.push(
    `the proposal summary reads ${JSON.stringify(summaryLines[at])}, the report says ${JSON.stringify(want)}.`
  )
  summaryLines[at] = want
  summaryStale += 1
}

if (problems.length > 0) {
  if (WRITE && (patched !== source || summaryStale > 0)) {
    if (patched !== source) writeFileSync(README, patched)
    if (summaryStale > 0) writeFileSync(SUMMARY, summaryLines.join('\n'))
    console.log(
      `check-readme-badges: updated ${problems.length} value(s) in README.md and research/proposal-summary.md`
    )
    process.exit(0)
  }
  console.error(
    'check-readme-badges: the README or the proposal summary publishes a number this tree does not compute.'
  )
  for (const problem of problems) console.error(`  ${problem}`)
  console.error('')
  console.error('  The badges are the first claim a reader sees, and a stale one is a claim')
  console.error('  nobody checked. Fix them with:')
  console.error('')
  console.error('      node tools/checks/check-readme-badges.mjs --write')
  process.exit(1)
}

console.log(
  `check-readme-badges: ${matched.length} badges and summary lines match verification-report.json`
)
