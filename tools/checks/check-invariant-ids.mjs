#!/usr/bin/env node
/**
 * Every invariant id this tree names is an id this tree declares.
 *
 * WHY THIS EXISTS. CLAUDE.md gives the reason for writing spec ids into code at
 * all: "Security-relevant code names the spec id it implements, so whoever
 * changes it later knows which spec they are about to falsify." That only works
 * in one direction unless something checks the other. `check-invariant-claims`
 * reads the threat model and asserts every id it claims is backed by a spec.
 * Nothing read the code and asked the same question back, so a comment could
 * name an invariant that did not exist and nothing anywhere would say so.
 *
 * Five did, and they had for a long time. Three were the wordlist and BIP-85
 * labels, each pointing one number past the invariant that really binds the
 * test: two specs had been consolidated and the test comments kept the old
 * numbering, so a reader chasing a label found nothing and could reasonably
 * conclude the invariant had been dropped. The other two named real gaps and
 * are declared now, INV-STORE-7 and INV-ADDRV-1.
 *
 * THE THREE ARE DESCRIBED RATHER THAN NAMED, and that is this rule applied to
 * the file that implements it. Writing the retired ids out here would put three
 * more references to nothing into the tree, in the one file guaranteed to be
 * read by somebody chasing exactly that. check-invariant-claims.mjs has the
 * same problem with its worked example and answers it the same way, by using an
 * id that is obviously a placeholder.
 *
 * It caught this on itself, one commit late. The scan walks `git ls-files`, so
 * while this file was untracked it was invisible to its own rule and the run
 * was green. That is the blind spot `make manifest` refuses untracked files
 * over, and it is narrower here: CI reads the committed tree, so the answer
 * arrives at the commit rather than never. Worth knowing when adding a check
 * that a local green run on a new file has not been asked the question yet.
 *
 * And one worse case, which is what makes this a check rather than a cleanup.
 * The rule that every provisioning assertion must say what it does not cover is
 * enforced, and had no declared id at all, so three places invented one:
 * provisioning/schema.json and tools/checks/check-profiles.mjs called it
 * INV-PROV-34, which existed nowhere, while provisioning/checks/meta.mjs called
 * it INV-PROV-13, which exists and means "no wireless or Bluetooth is present
 * in the image". Anyone auditing whether the no-wireless invariant was verified
 * landed on the verifier for a documentation rule.
 *
 * WHAT COUNTS AS A DECLARATION. Three places, because the project declares
 * invariants in three places and they are all equally real:
 *
 *   - a module spec, `packages/**\/*.spec.yaml`, under `invariants:`
 *   - a hardening profile, `provisioning/profiles/*.yaml`, under `assertions:`
 *   - the threat model's own tables, for the ones enforced by lint rules and
 *     build policy rather than by a module
 *
 * WHAT THIS DOES NOT DO. It does not check that the test a comment labels is
 * the test the spec binds. That was tried and it is not a check, it is noise:
 * of 421 comment-and-test pairs in the suite, 48 disagreed, and nearly all of
 * those were a comment citing a related invariant as context rather than
 * claiming the test establishes it, which is legitimate and useful prose. An
 * id that exists nowhere is unambiguous. An id used loosely is not.
 *
 * Run: node tools/checks/check-invariant-ids.mjs
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ID = /\bINV-[A-Z][A-Z0-9]*-[0-9]+\b/g

/**
 * Ids that appear on purpose and name nothing, each with the reason.
 *
 * Meant to stay short, and it is checked rather than trusted: an entry that no
 * longer matches anything fails below. An allowlist that silently keeps
 * forgiving a thing that is gone is the same shape of problem as the one this
 * file exists to catch.
 */
const DELIBERATE = new Map([
  [
    'INV-FOO-1',
    'the worked example in check-invariant-claims.mjs showing the two table shapes it parses',
  ],
  ['INV-PROV-99', 'the fixture in test/provisioning/meta.test.ts that must fail validation'],
])

const tracked = (...globs) =>
  execFileSync('git', ['ls-files', '-z', ...globs], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)

const read = (path) => readFileSync(join(ROOT, path), 'utf8')

// --- what is declared --------------------------------------------------------

/** id -> the file that declares it. */
const declared = new Map()
const declare = (id, where) => {
  if (!declared.has(id)) declared.set(id, where)
}

const specFiles = tracked('*.spec.yaml')
for (const file of specFiles)
  for (const match of read(file).matchAll(/^\s*-\s*id:\s*(INV-[A-Z][A-Z0-9]*-[0-9]+)/gmu))
    declare(match[1], file)

const profileFiles = tracked('provisioning/profiles/*.yaml')
for (const file of profileFiles)
  for (const match of read(file).matchAll(/^\s*-\s*id:\s*(INV-[A-Z][A-Z0-9]*-[0-9]+)/gmu))
    declare(match[1], file)

const THREAT_MODEL = 'docs/THREAT-MODEL.md'
for (const line of read(THREAT_MODEL).split('\n')) {
  if (!line.startsWith('|')) continue
  const row = /^\|\s*(INV-[A-Z][A-Z0-9]*-[0-9]+)\s*\|/u.exec(line)
  if (row !== null) declare(row[1], THREAT_MODEL)
}

// A scraper that quietly stopped matching would make every reference below look
// undeclared, which fails loudly and is the right direction to fail in. The
// reverse, a reference scan that found nothing and passed, is the one worth
// guarding, and it is guarded after the scan.
if (specFiles.length === 0 || profileFiles.length === 0) {
  console.error('check-invariant-ids: found no spec or profile files at all. Refusing to judge.')
  process.exit(1)
}

// --- what is referenced ------------------------------------------------------

const DECLARATION_SOURCES = (file) =>
  file.endsWith('.spec.yaml') || file.startsWith('provisioning/profiles/') || file === THREAT_MODEL

const undeclared = new Map()
const seen = new Set()
let references = 0

for (const file of tracked()) {
  if (DECLARATION_SOURCES(file)) continue
  let text
  try {
    text = read(file)
  } catch {
    // A binary or unreadable path carries no comment naming an invariant.
    continue
  }
  if (!text.includes('INV-')) continue

  for (const match of text.matchAll(ID)) {
    references += 1
    seen.add(match[0])
    if (declared.has(match[0]) || DELIBERATE.has(match[0])) continue
    const line = text.slice(0, match.index).split('\n').length
    if (!undeclared.has(match[0])) undeclared.set(match[0], [])
    undeclared.get(match[0]).push(`${file}:${line}`)
  }
}

// The vacuity guard. This project names invariants everywhere, so a scan that
// came back with a handful means the walk broke, not that the habit stopped.
const FLOOR = 200
if (references < FLOOR) {
  console.error(
    `check-invariant-ids: only ${references} invariant references found across the tree, ` +
      `which is below the floor of ${FLOOR}.`
  )
  console.error('  That is a broken scan reporting a clean tree, so it fails instead.')
  process.exit(1)
}

// --- verdict -----------------------------------------------------------------

const problems = []

for (const [id, where] of [...undeclared].sort())
  problems.push(
    `${id} is named at ${[...new Set(where)].join(', ')} and declared by no spec, ` +
      `no profile and no row of the threat model.`
  )

for (const [id, reason] of DELIBERATE)
  if (!seen.has(id))
    problems.push(
      `${id} is allowed here as "${reason}" and no longer appears anywhere. ` +
        `Remove it from DELIBERATE rather than leaving a standing exemption.`
    )

if (problems.length > 0) {
  console.error('check-invariant-ids: an invariant id names something that does not exist.')
  for (const problem of problems) console.error(`  ${problem}`)
  console.error('')
  console.error('  A comment naming a spec id is how the next person learns which spec they')
  console.error('  are about to falsify. One that resolves to nothing teaches them the')
  console.error('  invariant was dropped. Either declare it, or point the comment at the')
  console.error('  invariant that really covers the code.')
  process.exit(1)
}

console.log(
  `check-invariant-ids: ${references} references to ${seen.size} ids, ` +
    `all declared by ${declared.size} invariants across ${specFiles.length} specs, ` +
    `${profileFiles.length} profiles and the threat model` +
    (DELIBERATE.size > 0 ? `, ${DELIBERATE.size} deliberate non-ids allowed by name` : '')
)
