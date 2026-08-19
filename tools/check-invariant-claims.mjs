#!/usr/bin/env node
/**
 * The threat model and the specs must agree about which invariants are real.
 *
 * docs/THREAT-MODEL.md carries a table of security-critical invariants, and the
 * website renders it. Every row is a claim about what this device does. A row
 * whose invariant no spec declares is a promise nothing keeps, which is the
 * exact failure mode CLAUDE.md calls a security bug rather than a documentation
 * chore.
 *
 * This existed as a convention and drifted anyway: INV-DURESS-1 and
 * INV-DURESS-2 sat in that table in the present tense for the life of the
 * project, describing a feature with no code, no spec and no tests, under a
 * heading saying the list is checked by `make verify`. A reader deciding whether
 * to carry this device somewhere dangerous would have been reading a promise.
 *
 * So the rule is now checked rather than remembered. Every invariant id in the
 * table must either be traceable to something that RUNS, or be marked *Planned*
 * in the row itself. Nothing else passes.
 *
 * "Something that runs" is deliberately broader than "a spec file". Several real
 * invariants here are enforced by a custom lint rule and its test (INV-NET-2,
 * INV-WALLET-1), by a build tool (INV-BUILD-1, INV-NET-3), or by a CI drill
 * against real third-party software (INV-INTEROP-1). Demanding a spec entry for
 * those would push people to write a spec that asserts nothing, which is worse
 * than the honest situation.
 *
 * What this cannot check is whether the thing that mentions the id actually
 * tests it. It catches the failure that happened, which is a claim with nothing
 * behind it anywhere, and it does not catch a lazy reference. That limit is
 * stated rather than papered over.
 *
 * The reverse direction is deliberately NOT checked. Specs declare many more
 * invariants than the threat model summarises, and requiring every one to appear
 * would turn a curated page into a dump.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const THREAT_MODEL = join(ROOT, 'docs/THREAT-MODEL.md')

const SEARCHED = ['packages', 'tools', 'test', '.github']
const EXTENSIONS = ['.spec.yaml', '.ts', '.tsx', '.mjs', '.js', '.yml', '.yaml']

/** Files that are part of the checked build, at any depth. */
function sourceFiles(directory, found = []) {
  let entries
  try {
    entries = readdirSync(directory)
  } catch {
    return found
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'dist-app') continue
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) sourceFiles(path, found)
    else if (EXTENSIONS.some((extension) => entry.endsWith(extension))) found.push(path)
  }
  return found
}

/**
 * Where each invariant id is mentioned by something executable.
 *
 * Matched textually rather than by parsing YAML, because this tool must not
 * depend on the spec loader it is cross-checking. A parser bug that hid an
 * invariant from `make verify` would otherwise hide it from here too, and the
 * two checks would fail together while agreeing with each other.
 *
 * This file is excluded from its own search, or every id it names in an example
 * or an error message would count as its own evidence.
 */
function enforcedInvariants() {
  const enforced = new Map()
  const self = fileURLToPath(import.meta.url)

  for (const directory of SEARCHED) {
    for (const file of sourceFiles(join(ROOT, directory))) {
      if (file === self) continue
      const text = readFileSync(file, 'utf8')
      // `[A-Z][A-Z0-9]*`, which is the id format the project actually uses.
      // This read `[A-Z]+` and was therefore blind to every family with a
      // digit in its name: INV-BIP32, INV-BIP39 and INV-BIP85, three of the
      // most load-bearing families in the repository. Nothing noticed, because
      // a guard that cannot see an invariant reports no problem with it.
      for (const match of text.matchAll(/\b(INV-[A-Z][A-Z0-9]*-\d+)\b/g)) {
        const id = match[1]
        if (!enforced.has(id)) enforced.set(id, file.slice(ROOT.length))
      }
    }
  }
  return enforced
}

/** Rows of the threat model's invariant table: id, and whether marked planned. */
function claimedInvariants() {
  const claimed = []
  const lines = readFileSync(THREAT_MODEL, 'utf8').split('\n')

  lines.forEach((line, index) => {
    // A table row, not prose. Two shapes carry a claim:
    //
    //   | INV-FOO-1 | statement |            the invariant reference table
    //   | Threat | Mitigation | INV-FOO-1 |  the in-scope table
    //
    // Only the first was read for a long time, so the Invariant column of the
    // mitigation table, which is where a reader actually looks to see what
    // backs a defence, was never checked at all. An id invented there, or one
    // left behind after a rename, sat in the table looking like evidence.
    if (!line.startsWith('|')) return

    const first = /^\|\s*(INV-[A-Z0-9-]+)\s*\|(.*)\|\s*$/.exec(line)
    if (first !== null) {
      claimed.push({
        id: first[1],
        // The marker is deliberately a visible word in the rendered page rather
        // than an HTML comment, so a reader sees it too.
        planned: /\*Planned\b/i.test(first[2] ?? ''),
        line: index + 1,
      })
      return
    }

    // Every id mentioned anywhere else in a row. A mitigation cites several
    // when several hold it up, and each of those is its own claim.
    const planned = /\*Planned\b/i.test(line)
    for (const match of line.matchAll(/(INV-[A-Z][A-Z0-9]*-[0-9]+)/g)) {
      claimed.push({ id: match[1], planned, line: index + 1 })
    }
  })
  return claimed
}

const declared = enforcedInvariants()
const claimed = claimedInvariants()

if (claimed.length === 0) {
  console.error('check-invariant-claims: found no invariant table in docs/THREAT-MODEL.md.')
  console.error('  Either the table moved or the row format changed. This check is now blind.')
  process.exit(1)
}

const problems = []
for (const row of claimed) {
  const spec = declared.get(row.id)
  if (spec !== undefined && row.planned) {
    problems.push(
      `${row.id} (THREAT-MODEL.md:${row.line}) is marked *Planned* but ` +
        `${spec} references it. Drop the marker, or remove the reference if it is aspirational.`
    )
    continue
  }
  if (spec === undefined && !row.planned) {
    problems.push(
      `${row.id} (THREAT-MODEL.md:${row.line}) is stated as though it holds, and nothing ` +
        `under ${SEARCHED.join(', ')} mentions it. Either implement and test it, or mark ` +
        `the row *Planned*.`
    )
  }
}

if (problems.length > 0) {
  console.error('check-invariant-claims: the threat model and the specs disagree.\n')
  for (const problem of problems) console.error(`  ${problem}`)
  console.error(
    '\n  A row in that table is a claim about what this device protects. Overclaiming\n' +
      '  there is a security bug, not a typo.'
  )
  process.exit(1)
}

const planned = claimed.filter((row) => row.planned).length
console.log(
  `check-invariant-claims: ${String(claimed.length)} invariants claimed, ` +
    `${String(claimed.length - planned)} traceable to code, ${String(planned)} marked planned`
)
