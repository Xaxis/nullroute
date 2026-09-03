#!/usr/bin/env node
/**
 * What `make check` runs, CI runs.
 *
 * The Makefile opens by saying so: "Every target here is also run by CI, so
 * what a contributor runs locally and what the build runs cannot drift apart."
 * The workflow says the same thing from its side. Neither was true. CI never
 * invoked `make check`; it ran a hand-curated list, and eighteen targets were
 * missing from it, among them the threat-model honesty gate, the frontend CSP
 * that is INV-NET-3, the QR readback set, and every visual guarantee this
 * project makes about the panel.
 *
 * The two comments read as though they covered each other. Only one direction
 * was ever true, and nothing checked either: check-make-targets asserts that a
 * script the Makefile names exists on disk, which is a different question from
 * whether anything runs it.
 *
 * WHAT THIS ASSERTS. Every prerequisite of `check` and `check-fast`, expanded
 * through any that are themselves aggregates, appears in a `run:` line of the
 * workflow as `make <target>`. Nothing else: it does not check that the target
 * passes there, only that CI asks. A green local run and a green CI run are
 * then answering the same question.
 *
 * Run: node tools/checks/check-ci-parity.mjs
 */

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const MAKEFILE = join(ROOT, 'Makefile')
const WORKFLOW = join(ROOT, '.github/workflows/ci.yml')

const makefile = readFileSync(MAKEFILE, 'utf8')
const workflow = readFileSync(WORKFLOW, 'utf8')

/**
 * Targets that are deliberately not run by CI, each with the reason.
 *
 * Empty, and meant to stay short. An entry here is a decision that a guarantee
 * is checked on a workstation and nowhere else, which is worth writing down
 * rather than discovering.
 */
const LOCAL_ONLY = new Map()

/** The prerequisites of one target, as written on its rule line. */
function prerequisites(target) {
  const line = new RegExp(`^${target}:([^\\n#]*)`, 'm').exec(makefile)
  return line === null ? [] : line[1].trim().split(/\s+/).filter(Boolean)
}

/**
 * Whether a target does work of its own, as opposed to only naming others.
 *
 * A recipe is a tab-indented line under the rule. This is what separates
 * `check-fast`, which is a list, from `contrast`, which runs a script and
 * happens to depend on a build step. Only the first kind may be expanded: a
 * target with a recipe that CI does not run is missing, whatever its
 * prerequisites are, and descending into it would report the gallery build as
 * the thing CI forgot rather than the check that measures it.
 */
function hasRecipe(target) {
  const at = new RegExp(`^${target}:`, 'm').exec(makefile)
  if (at === null) return false
  for (const line of makefile.slice(at.index).split('\n').slice(1)) {
    if (line.startsWith('\t')) return true
    if (line.trim() === '' || line.startsWith('#')) continue
    return false
  }
  return false
}

/**
 * Whether CI covers a target, directly or through every part of it.
 *
 * Not a flat expansion. `check` depends on `check-fast` and `web-check`, which
 * are aggregates whose parts CI does run, so those are covered. But
 * `screen-fit` depends on `screens`, which builds the gallery it measures, and
 * descending into that would report the build step as a check CI forgot. The
 * question is only ever "does CI ask for this, or for something that implies
 * it", so a target CI invokes stops the descent.
 */
function covered(target, ci, gaps, depth = 0) {
  if (ci.has(target) || LOCAL_ONLY.has(target)) return true
  if (depth > 4) return false
  const parts = hasRecipe(target) ? [] : prerequisites(target)
  if (parts.length === 0) {
    // A leaf CI never asks for. Named here rather than at the top, so the
    // failure says `make qr-readback` instead of `make check-fast`, which is
    // the difference between a message somebody can act on and one they have
    // to go digging behind.
    gaps.add(target)
    return false
  }
  // Every part evaluated, not short-circuited, so one missing target does not
  // hide the three beside it.
  return parts.map((part) => covered(part, ci, gaps, depth + 1)).every(Boolean)
}

/** The targets `make check` and `make check-fast` name directly. */
function reached() {
  const out = []
  for (const root of ['check', 'check-fast']) {
    for (const target of prerequisites(root)) {
      if (!out.includes(target)) out.push(target)
    }
  }
  return out
}

/** Targets CI actually invokes, from its `run:` lines only. */
function invoked() {
  const found = new Set()
  for (const line of workflow.split('\n')) {
    // A `run:` may be a one-liner or the first line of a block; both are
    // scanned the same way, and a `make` inside a comment is not a run line.
    const body = /^\s*(?:-\s*)?(?:run:\s*)?(.*)$/.exec(line)?.[1] ?? ''
    if (/^\s*#/.test(body)) continue
    for (const match of body.matchAll(/\bmake\s+([a-z][a-z0-9-]*)/g)) {
      if (match[1] !== undefined) found.add(match[1])
    }
  }
  return found
}

const targets = reached()
if (targets.length < 20) {
  console.error(
    `check-ci-parity: only ${String(targets.length)} targets were read out of the Makefile, ` +
      `so this check is blind. The shape of the check or check-fast rule has changed.`
  )
  process.exit(1)
}

const ci = invoked()
const gaps = new Set()
for (const target of targets) covered(target, ci, gaps)
const missing = [...gaps].sort()

if (missing.length > 0) {
  console.error(
    `\ncheck-ci-parity: ${String(missing.length)} target(s) that make check runs and CI does not:\n`
  )
  for (const target of missing) console.error(`    make ${target}`)
  console.error(
    `\n  The Makefile's header says every target here is also run by CI, and the\n` +
      `  workflow says the same from its side, so the two read as though they\n` +
      `  covered each other. A guarantee enforced only on a workstation is a\n` +
      `  guarantee that holds until somebody with a different workstation opens a\n` +
      `  pull request. Add it to .github/workflows/ci.yml, or add it to LOCAL_ONLY\n` +
      `  in this file with the reason it cannot run there.\n`
  )
  process.exit(1)
}

const noted = LOCAL_ONLY.size === 0 ? '' : `, ${String(LOCAL_ONLY.size)} deliberately local`
console.log(
  `check-ci-parity: ${String(targets.length)} targets reached by make check, all run by CI${noted}`
)
