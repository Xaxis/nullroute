#!/usr/bin/env node
/**
 * Run the profile's assertions against a built root filesystem.
 *
 * This is the tool a build backend has to satisfy. `provisioning/README.md`
 * argues that a backend is supported when the UNCHANGED verifiers pass against
 * its output, which only means anything if the verifiers can be pointed at
 * output. Until now they could not: they existed as a registry of names.
 *
 * IT TAKES BOTH, AND EITHER ALONE. A root filesystem DIRECTORY answers what is
 * in the files: packages, paths, unit directives, kernel command line. An IMAGE
 * FILE answers what is in the bytes between and underneath filesystems:
 * partition tables, verity superblocks, filesystem identifiers. Neither can
 * answer the other's questions, and a verifier pointed at the wrong one says so
 * rather than passing.
 *
 * Neither is mounted. Mounting or loop-mounting needs root, and a verification
 * tool that must run privileged is one people run less often; the backend
 * already has the assembled tree, and the image is read at an offset, which
 * works on any operating system.
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
 * Usage: node tools/verify-image.mjs [--root <dir>] [--image <file>]
 *                                     [--compare <file>] [--profile <id>]
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import {
  VERIFIERS,
  RUNTIME_ONLY,
  NEEDS_IMAGE,
  NEEDS_NOTHING,
} from '../provisioning/checks/registry.mjs'
import { ROOTFS_VERIFIERS } from '../provisioning/checks/rootfs.mjs'
import { IMAGE_VERIFIERS } from '../provisioning/checks/image.mjs'
import { RUNTIME_VERIFIERS, parseFacts } from '../provisioning/checks/runtime.mjs'
import { pinnedIdentifiers, veritySalt } from '../provisioning/checks/identifiers.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

// js-yaml with the spec system's hardened options, resolved from packages/verify
// where it is declared. This imported `yaml`, which no package.json here names
// (it arrived only as an optional peer of vite, and a dependency bump removed
// it) and which packages/verify/src/specs.ts rejects on purpose: it resolves an
// unknown tag to its value with a warning, where js-yaml refuses the file.
const { load, JSON_SCHEMA } = createRequire(join(ROOT, 'packages/verify/package.json'))('js-yaml')
const parse = (text) =>
  load(text, { schema: JSON_SCHEMA, maxAliases: 0, maxDepth: 20, json: false })
const PROFILES = join(ROOT, 'provisioning/profiles')

function argument(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const rootfs = argument('root')
const image = argument('image')
const compare = argument('compare')
// A THIRD KIND OF EVIDENCE, and the only one that comes from a device rather
// than an artifact. See provisioning/checks/runtime.mjs: the guest prints raw
// kernel files to its console and this reads them. Three assertions can be
// answered no other way, and reading them off a rootfs answers them wrongly.
const consoleLog = argument('console')

if (rootfs === undefined && image === undefined && consoleLog === undefined) {
  console.error('verify-image: pass --root <directory>, --image <file>, or both.')
  console.error('')
  console.error('  --root  the assembled root filesystem. Answers what is in the files:')
  console.error('          packages, paths, unit directives, the kernel command line.')
  console.error('  --image the built image. Answers what is in the bytes between and')
  console.error('          underneath filesystems: partitions, the verity superblock,')
  console.error('          filesystem identifiers.')
  console.error('  --compare a second image, for the reproducibility check. One image')
  console.error('          cannot demonstrate that two builds agree.')
  console.error('  --console a boot console log from "make image-boot-test". Answers what')
  console.error('          only a running kernel knows: mount flags in force, swap in use,')
  console.error('          sockets listening. No artifact at rest can stand in for it.')
  console.error('')
  console.error('  Neither is mounted: mounting needs root, and a verification tool that')
  console.error('  must run privileged is one people run less often.')
  process.exit(2)
}
if (rootfs !== undefined && (!existsSync(rootfs) || !statSync(rootfs).isDirectory())) {
  console.error(`verify-image: ${rootfs} is not a directory.`)
  process.exit(2)
}
for (const [flag, path] of [
  ['image', image],
  ['compare', compare],
  ['console', consoleLog],
]) {
  if (path !== undefined && (!existsSync(path) || !statSync(path).isFile())) {
    console.error(`verify-image: --${flag} ${path} is not a file.`)
    process.exit(2)
  }
}

// Parsed once. Every runtime verifier reads the same block, and re-parsing per
// assertion would let two of them disagree about what the device said.
const facts = consoleLog === undefined ? undefined : parseFacts(readFileSync(consoleLog, 'utf8'))

const wanted = argument('profile')
const profiles = readdirSync(PROFILES)
  .filter((name) => name.endsWith('.yaml'))
  .map((name) => ({ file: name, profile: parse(readFileSync(join(PROFILES, name), 'utf8')) }))
  .filter(({ profile }) => wanted === undefined || profile.id === wanted)

if (profiles.length === 0) {
  console.error(`verify-image: no profile matched ${wanted ?? '(any)'}.`)
  process.exit(2)
}

/**
 * The release this image claims to be, for the derived identifiers.
 *
 * Defaults to the version in package.json, because that is what a build of this
 * checkout produces and passing it every time would be a flag people get wrong.
 */
const release =
  argument('release') ?? JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version

/**
 * Fill in the values a profile deliberately does not write down.
 *
 * A profile states WHICH partitions are pinned. WHAT the pinned value is comes
 * from provisioning/checks/identifiers.mjs, derived from the release version. A
 * profile holding literal hex would need editing every release, and the release
 * where somebody forgot is the release where the assertion silently stops
 * meaning anything.
 */
function resolveParams(check, params) {
  if (check === 'verity-salt-pinned' && params.salt === 'derived') {
    return { ...params, salt: veritySalt(release) }
  }
  if (check === 'identifiers-pinned' && params.derive === true) {
    return pinnedIdentifiers(release, params.partitions ?? [])
  }
  return params
}

const ESC = String.fromCharCode(27)
const GREEN = `${ESC}[32m`
const RED = `${ESC}[31m`
const DIM = `${ESC}[2m`
const OFF = `${ESC}[0m`

let failed = 0
let checked = 0
let unchecked = 0

/**
 * Why each unchecked assertion was not checked, counted by class.
 *
 * A single "8 not checked" is a number somebody has to go and interpret, and
 * the four reasons are not equivalent: one of them is work outstanding in this
 * repository and three of them are not. Needing a booted device is a property
 * of the assertion and will never change here. Not being given an image is a
 * property of the invocation. An unwritten verifier is the only one that is a
 * gap somebody should close.
 *
 * The distinction was already made per assertion, a line at a time. It was not
 * made in the summary, which is the line anybody actually reads.
 */
/** Assertion ids whose verifiers all ran and agreed. See --require-checked. */
const SATISFIED = new Set()

const NOT_CHECKED = new Map()
function notChecked(why) {
  unchecked += 1
  NOT_CHECKED.set(why, (NOT_CHECKED.get(why) ?? 0) + 1)
}

/**
 * The single reason an assertion with no results was not checked.
 *
 * An assertion can name several verifiers. If any of them needs a booted
 * device that is the honest headline, because no invocation here will ever
 * satisfy it; an unwritten verifier is next, because that is the one that is
 * work; and being handed no artifact is last, because it is a property of how
 * the command was run rather than of the repository.
 */
function classify(verifiers) {
  const reasons = verifiers.map((entry) => {
    if (NEEDS_NOTHING.has(entry.check)) return 'checked by "make profiles" instead'
    const declared = VERIFIERS[entry.check]
    // The registry's own status first, then the RUNTIME_ONLY set. Reading the
    // set alone put `daemon-starts-under-mdwe` in the "nobody has written it"
    // pile, and it is written down as needing a device: the same small false
    // statement this breakdown was added to stop, one line further along.
    // WRITTEN, AND NOT POINTED AT A BOOT. This used to read "needs a booted
    // device" for all three unconditionally, which was true while they were
    // unwritten and became a lie the moment they were not: it put finished work
    // in the same bucket as work nobody has done. The distinction is the same
    // one the rest of this function exists to make.
    if (RUNTIME_ONLY.has(entry.check)) {
      return declared?.status === 'implemented'
        ? 'no boot console log was given'
        : 'needs a booted device'
    }
    if (declared?.status === 'needs-device') return 'needs a booted device'
    if (declared === undefined || declared.status !== 'implemented')
      return 'no verifier written yet'
    return NEEDS_IMAGE.has(entry.check) ? 'no image was given' : 'no root filesystem was given'
  })
  for (const rank of [
    'needs a booted device',
    'no verifier written yet',
    'no boot console log was given',
    'checked by "make profiles" instead',
  ]) {
    if (reasons.includes(rank)) return rank
  }
  return reasons[0] ?? 'no verifier ran'
}

for (const { file, profile } of profiles) {
  console.log(`\n${profile.id}  ${DIM}${file}${OFF}`)
  if (rootfs !== undefined) console.log(`  root     ${rootfs}`)
  if (image !== undefined) console.log(`  image    ${image}`)
  if (compare !== undefined) console.log(`  compare  ${compare}`)
  if (image !== undefined)
    console.log(`  release  ${release}  ${DIM}(pinned identifiers derive from this)${OFF}`)
  console.log('')

  for (const assertion of profile.assertions ?? []) {
    const verifiers = assertion.verify ?? []
    const results = []

    for (const entry of verifiers) {
      const params = entry.params ?? {}

      if (NEEDS_IMAGE.has(entry.check)) {
        const run = IMAGE_VERIFIERS[entry.check]
        // No image given is could-not-run, never a pass, and never a failure
        // either: the verifier exists and was not pointed at anything.
        if (run === undefined || image === undefined) continue
        results.push(await run({ image, compare }, resolveParams(entry.check, params)))
        continue
      }

      if (RUNTIME_ONLY.has(entry.check)) {
        const run = RUNTIME_VERIFIERS[entry.check]
        if (run === undefined || facts === undefined) continue
        results.push(run(facts, params))
        continue
      }

      const run = ROOTFS_VERIFIERS[entry.check]
      if (run === undefined || rootfs === undefined) continue
      results.push(run(rootfs, params))
    }

    if (results.length === 0) {
      // Why it was not checked, rather than a bare skip. "Needs a booted
      // device" and "nobody has written it" are different states and only one
      // of them is work outstanding here.
      const reasons = verifiers.map((entry) => {
        // Checked, just not here. See NEEDS_NOTHING in the registry.
        if (NEEDS_NOTHING.has(entry.check)) {
          return `${entry.check}: checked by "make profiles", which needs no artifact`
        }
        if (RUNTIME_ONLY.has(entry.check)) {
          return VERIFIERS[entry.check]?.status === 'implemented'
            ? `${entry.check}: no --console given (needs a boot log)`
            : `${entry.check}: needs a booted device`
        }
        const declared = VERIFIERS[entry.check]
        if (declared === undefined) return `${entry.check}: not declared`
        // Written and not pointed at anything is a different state from not
        // written, and conflating them would hide work that is finished.
        if (declared.status === 'implemented') {
          return NEEDS_IMAGE.has(entry.check)
            ? `${entry.check}: no --image given`
            : `${entry.check}: no --root given`
        }
        return `${entry.check}: ${declared.status}`
      })
      notChecked(classify(verifiers))
      console.log(`  ${DIM}--${OFF}  ${assertion.id}  ${DIM}${reasons.join(', ')}${OFF}`)
      continue
    }

    // Could not run is not the same as failed. A missing tool printed in red
    // beside a genuinely over-exposed unit trains a reader to ignore red, and
    // the pressure to clear it is pressure to make a missing tool return true.
    const blind = results.filter((r) => r.unavailable === true)
    if (blind.length === results.length) {
      notChecked('a verifier could not run on this machine')
      console.log(`  ${DIM}--${OFF}  ${assertion.id}`)
      for (const result of blind)
        console.log(`        ${DIM}${result.check}: ${result.detail}${OFF}`)
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
      notChecked('only some of its verifiers could run')
      console.log(`  ${DIM}--${OFF}  ${assertion.id}  ${DIM}partly checked${OFF}`)
      for (const result of results) {
        const mark = result.unavailable === true ? 'could not run' : 'agreed'
        console.log(`        ${DIM}${result.check}: ${mark}, ${result.detail}${OFF}`)
      }
    } else {
      SATISFIED.add(assertion.id)
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

/**
 * --require-checked INV-PROV-18,INV-PROV-19
 *
 * Assertions the caller is running this command in order to check, which must
 * therefore end up checked and satisfied rather than merely not failing.
 *
 * Without this the tool is unusable as a build gate, because its normal and
 * correct behaviour is to report could-not-run and exit zero. A CI job that
 * exists to verify unit exposure would go green on a runner where
 * systemd-analyze is missing, having verified nothing, and print a reassuring
 * summary while doing it. That is the exact false pass this whole directory
 * argues against, and it would be this tool producing it.
 *
 * The caller names the ids rather than the tool guessing, because only the
 * caller knows what its machine was supposed to be able to see.
 */
const required = (argument('require-checked') ?? '')
  .split(',')
  .map((id) => id.trim())
  .filter((id) => id.length > 0)

const missing = required.filter((id) => !SATISFIED.has(id))
if (missing.length > 0) {
  console.log('')
  console.log(
    `${RED}verify-image: ${String(missing.length)} assertion(s) were required to be checked ` +
      `here and were not: ${missing.join(', ')}${OFF}`
  )
  console.log(
    `  Each is listed above with the reason. This is a failure of the machine or the
` +
      `  invocation, not of the artifact: something that was supposed to be able to look
` +
      `  at it could not, and a green result would have meant nothing.`
  )
  process.exit(1)
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
if (NOT_CHECKED.size > 0) {
  console.log('')
  // Sorted by count so the largest class of missing coverage is the first
  // thing read, rather than whichever profile happened to be parsed first.
  for (const [why, count] of [...NOT_CHECKED.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${DIM}    ${String(count).padStart(2)}  ${why}${OFF}`)
  }
}
