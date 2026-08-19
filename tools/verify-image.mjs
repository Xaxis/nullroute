#!/usr/bin/env node
/**
 * Run the profile's assertions against a built root filesystem.
 *
 * This is the tool a build backend has to satisfy. `provisioning/README.md`
 * argues that a backend is supported when the UNCHANGED verifiers pass against
 * its output, which only means anything if the verifiers can be pointed at
 * output. Until now they could not: they existed as a registry of names.
 *
 * It takes a DIRECTORY rather than an image. Mounting or loop-mounting an image
 * needs root, and a verification tool that must run privileged is one people
 * run less often; the backend already has the assembled tree and can hand it
 * over. The verifiers that genuinely need the whole artifact, comparing two
 * builds, reading a partition table, reading a verity superblock, are still
 * unwritten and are reported as such rather than skipped quietly.
 *
 * WHAT IT REFUSES TO DO. Report a pass for an assertion it did not check. An
 * assertion whose verifiers are all unwritten prints as "not checked" and the
 * run does not claim success, because a summary that counted unwritten
 * verifiers as satisfied would be the exact failure this profile system exists
 * to prevent.
 *
 * THREE STATES, NOT TWO. Satisfied, failed, and could-not-run. Collapsing the
 * third into the second prints a red FAIL because systemd-analyze is not
 * installed, which trains a reader to ignore red, and the pressure to clear
 * that red is pressure to make a missing tool return true. An assertion where
 * one verifier agreed and another could not run is NOT satisfied: it is only as
 * strong as its weakest verifier, and one of them was blind.
 *
 * Usage: node tools/verify-image.mjs --root <dir> [--profile <id>]
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { VERIFIERS, RUNTIME_ONLY } from '../provisioning/checks/registry.mjs'
import { ROOTFS_VERIFIERS } from '../provisioning/checks/rootfs.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PROFILES = join(ROOT, 'provisioning/profiles')

function argument(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const rootfs = argument('root')
if (rootfs === undefined) {
  console.error('verify-image: pass --root <directory>, the assembled root filesystem.')
  console.error('')
  console.error('  It takes a directory rather than an image on purpose: mounting an image')
  console.error('  needs root, and a verification tool that must run privileged is one')
  console.error('  people run less often.')
  process.exit(2)
}
if (!existsSync(rootfs) || !statSync(rootfs).isDirectory()) {
  console.error(`verify-image: ${rootfs} is not a directory.`)
  process.exit(2)
}

const wanted = argument('profile')
const profiles = readdirSync(PROFILES)
  .filter((name) => name.endsWith('.yaml'))
  .map((name) => ({ file: name, profile: parse(readFileSync(join(PROFILES, name), 'utf8')) }))
  .filter(({ profile }) => wanted === undefined || profile.id === wanted)

if (profiles.length === 0) {
  console.error(`verify-image: no profile matched ${wanted ?? '(any)'}.`)
  process.exit(2)
}

const ESC = String.fromCharCode(27)
const GREEN = `${ESC}[32m`
const RED = `${ESC}[31m`
const DIM = `${ESC}[2m`
const OFF = `${ESC}[0m`

let failed = 0
let checked = 0
let unchecked = 0

for (const { file, profile } of profiles) {
  console.log(`\n${profile.id}  ${DIM}${file}${OFF}`)
  console.log(`  root  ${rootfs}\n`)

  for (const assertion of profile.assertions ?? []) {
    const verifiers = assertion.verify ?? []
    const results = []

    for (const entry of verifiers) {
      const run = ROOTFS_VERIFIERS[entry.check]
      if (run === undefined) continue
      results.push(run(rootfs, entry.params ?? {}))
    }

    if (results.length === 0) {
      // Why it was not checked, rather than a bare skip. "Needs a booted
      // device" and "nobody has written it" are different states and only one
      // of them is work outstanding here.
      const reasons = verifiers.map((entry) => {
        if (RUNTIME_ONLY.has(entry.check)) return `${entry.check}: needs a booted device`
        const declared = VERIFIERS[entry.check]
        if (declared === undefined) return `${entry.check}: not declared`
        return `${entry.check}: ${declared.status}`
      })
      unchecked += 1
      console.log(`  ${DIM}--${OFF}  ${assertion.id}  ${DIM}${reasons.join(', ')}${OFF}`)
      continue
    }

    // Could not run is not the same as failed. A missing tool printed in red
    // beside a genuinely over-exposed unit trains a reader to ignore red, and
    // the pressure to clear it is pressure to make a missing tool return true.
    const blind = results.filter((r) => r.unavailable === true)
    if (blind.length === results.length) {
      unchecked += 1
      console.log(`  ${DIM}--${OFF}  ${assertion.id}`)
      for (const result of blind) console.log(`        ${DIM}${result.check}: ${result.detail}${OFF}`)
      continue
    }

    checked += 1
    const bad = results.filter((r) => !r.ok && r.unavailable !== true)
    if (bad.length > 0) {
      failed += 1
      console.log(`  ${RED}FAIL${OFF}  ${assertion.id}`)
      for (const result of bad) console.log(`        ${result.check}: ${result.detail}`)
    } else if (blind.length > 0) {
      // Some ran and agreed, some could not run. Not satisfied: the assertion
      // is only as strong as its weakest verifier and one of them was blind.
      checked -= 1
      unchecked += 1
      console.log(`  ${DIM}--${OFF}  ${assertion.id}  ${DIM}partly checked${OFF}`)
      for (const result of results) {
        const mark = result.unavailable === true ? 'could not run' : 'agreed'
        console.log(`        ${DIM}${result.check}: ${mark}, ${result.detail}${OFF}`)
      }
    } else {
      console.log(`  ${GREEN}ok${OFF}    ${assertion.id}`)
      for (const result of results) {
        console.log(`        ${DIM}${result.check}: ${result.detail}${OFF}`)
        // Printed on a PASS, which is the only place it matters. A limit
        // beside a failure is noise; a limit beside a pass is the difference
        // between what was measured and what a reader will assume.
        for (const limit of result.limits ?? []) {
          console.log(`        ${DIM}limit: ${limit}${OFF}`)
        }
      }
    }
  }
}

console.log('')
if (failed > 0) {
  console.log(
    `${RED}verify-image: ${String(failed)} of ${String(checked)} checkable assertion(s) failed${OFF}`
  )
  process.exit(1)
}

// Deliberately not the word "passed" on its own. Nine verifiers are unwritten,
// and a summary that read as a clean bill of health would be this tool making
// the claim the profile system was built to stop anyone making.
console.log(
  `verify-image: ${String(checked)} assertion(s) checked and satisfied, ` +
    `${String(unchecked)} not checked (no verifier that runs here yet, or one that could not run).`
)
console.log(
  `${DIM}  A satisfied assertion is one whose verifiers ran and agreed. An unchecked` +
    ` one is not a passing one.${OFF}`
)
