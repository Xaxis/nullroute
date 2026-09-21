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

if (problems.length > 0) {
  if (WRITE && patched !== source) {
    writeFileSync(README, patched)
    console.log(`check-readme-badges: updated ${problems.length} badge value(s) in README.md`)
    process.exit(0)
  }
  console.error('check-readme-badges: the README publishes a number this tree does not compute.')
  for (const problem of problems) console.error(`  ${problem}`)
  console.error('')
  console.error('  The badges are the first claim a reader sees, and a stale one is a claim')
  console.error('  nobody checked. Fix them with:')
  console.error('')
  console.error('      node tools/checks/check-readme-badges.mjs --write')
  process.exit(1)
}

console.log(`check-readme-badges: ${matched.join(', ')}, matching verification-report.json`)
