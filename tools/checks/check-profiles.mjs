#!/usr/bin/env node
/**
 * Validate the hardening profiles against provisioning/schema.json, and enforce
 * the cross-file rules a JSON Schema cannot express.
 *
 * The design rests on one inversion: a profile states what must be true of the
 * BUILT ARTIFACT, and every assertion carries a verifier that inspects the
 * artifact rather than the recipe. That inversion is only real if it is
 * enforced, so this checks the things that would quietly hollow it out:
 *
 *   - an assertion with no verifier (INV-PROV-1), which reads as a guarantee
 *     and checks nothing
 *   - an assertion with no `does_not_cover` (INV-PROV-34), which is how an
 *     overclaim gets into the threat model six months later
 *   - an assertion claiming `image` stage for a fact only observable at
 *     runtime, which is how offline scanning produces confident false passes
 *   - a profile asserting a capability above its declared tier
 *   - duplicate invariant ids across profiles and code specs
 *
 * Run: node tools/checks/check-profiles.mjs
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const PROFILE_DIR = join(ROOT, 'provisioning/profiles')
const CHECKS_DIR = join(ROOT, 'provisioning/checks')
const SCHEMA = join(ROOT, 'provisioning/schema.json')

const require = createRequire(join(ROOT, 'packages/verify/package.json'))

const { VERIFIERS, implemented, NEEDS_ROOTFS } = await import(
  join(ROOT, 'provisioning/checks/registry.mjs')
)
const { NEEDS_IMAGE, NEEDS_NOTHING, RUNTIME_ONLY } = await import(
  join(ROOT, 'provisioning/checks/registry.mjs')
)
const { profileSelfCheck, verifierIgnoresBackends, documentedWeakness } = await import(
  join(ROOT, 'provisioning/checks/meta.mjs')
)
const { load: loadYaml, JSON_SCHEMA } = require('js-yaml')
const { Ajv2020 } = require('ajv/dist/2020.js')

const YAML_OPTIONS = { schema: JSON_SCHEMA, maxAliases: 0, maxDepth: 20, json: false }

/**
 * Facts that cannot be read from an unbooted image, whatever a scanner claims.
 *
 * This list is the mechanism behind the most important rule here. Offline
 * compliance scanning of a built rootfs reports mount options as passing while
 * simultaneously reporting that the partition does not exist: the checks pass
 * vacuously because /proc/mounts is absent. An assertion that claims to verify
 * one of these at `image` stage is asserting something it cannot see.
 */
const RUNTIME_ONLY_CHECKS = new Set([
  'mount-options',
  'no-listening-sockets',
  'no-swap',
  'sysctl-values',
  'unit-state',
  'no-unit-ordering',
  'kernel-modules-disabled',
])

let problems = 0
const fail = (where, message) => {
  problems += 1
  console.error(`${where}\n    ${message}\n`)
}

if (!existsSync(PROFILE_DIR)) {
  console.log('check-profiles: no profiles yet')
  process.exit(0)
}

const schema = JSON.parse(readFileSync(SCHEMA, 'utf8'))
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false })
const validate = ajv.compile(schema)

const files = readdirSync(PROFILE_DIR)
  .filter((f) => f.endsWith('.yaml'))
  .sort()

/** id -> the file that declared it, across every profile. */
const invariantOwner = new Map()

/** Every profile that parsed, for the meta verifiers to inspect as a set. */
const loaded = []
/** Verifier name -> the first assertion that asks for it. */
const named = new Map()

for (const file of files) {
  const rel = `provisioning/profiles/${file}`
  let profile
  try {
    profile = loadYaml(readFileSync(join(PROFILE_DIR, file), 'utf8'), YAML_OPTIONS)
  } catch (err) {
    fail(rel, `YAML did not parse: ${err.message}`)
    continue
  }

  if (!validate(profile)) {
    for (const e of validate.errors ?? []) {
      fail(rel, `${e.instancePath || '/'} ${e.message ?? ''}`)
    }
    continue
  }

  loaded.push({ file: rel, profile })

  for (const assertion of profile.assertions) {
    const where = `${rel}  ${assertion.id}`

    for (const v of assertion.verify) {
      if (typeof v.check === 'string' && !named.has(v.check)) named.set(v.check, where)
    }

    // INV-PROV-1. The schema already requires a non-empty array; this catches
    // the subtler form where every entry is missing its implementation name.
    if (!assertion.verify.some((v) => typeof v.check === 'string' && v.check.length > 0)) {
      fail(
        where,
        'has no executable verifier. An assertion that checks nothing is not an assertion.'
      )
    }

    // The stage rule. This is the one that keeps the build gate honest.
    if (assertion.stage === 'image') {
      for (const v of assertion.verify) {
        if (RUNTIME_ONLY_CHECKS.has(v.check)) {
          fail(
            where,
            `claims stage "image" but uses the runtime-only verifier "${v.check}".\n` +
              `    This fact is not observable in an unbooted artifact. Offline inspection of it\n` +
              `    passes vacuously, which is worse than not checking it at all. Use stage "boot".`
          )
        }
      }
    }

    // A profile must not assert a capability above the tier it declares.
    const assertionTier = assertion.tier ?? profile.tier
    if (assertionTier > profile.tier) {
      fail(
        where,
        `requires tier ${assertionTier} but the profile declares tier ${profile.tier}. ` +
          `A profile must not claim a capability it does not have.`
      )
    }

    // A does_not_cover that merely restates the statement is not a limit.
    if (
      assertion.does_not_cover.trim().toLowerCase() === assertion.statement.trim().toLowerCase()
    ) {
      fail(where, 'does_not_cover repeats the statement rather than naming a limit.')
    }

    const owner = invariantOwner.get(assertion.id)
    if (owner !== undefined) {
      fail(where, `duplicate invariant id, already declared in ${owner}`)
    }
    invariantOwner.set(assertion.id, rel)
  }

  // A backend may only be called supported once the verifiers have actually run
  // against something it built. Until then the word means nothing.
  for (const backend of profile.backends ?? []) {
    if (
      backend.status === 'supported' &&
      !existsSync(join(ROOT, 'provisioning/backends', backend.name))
    ) {
      fail(
        `${rel}  backend "${backend.name}"`,
        `is marked "supported" but provisioning/backends/${backend.name} does not exist. ` +
          `A backend earns that word by passing the unchanged verifier suite, not by being described.`
      )
    }
  }
}

/**
 * Run the verifiers that inspect the profiles themselves.
 *
 * These are the three that need no built image, and they are the ones that keep
 * the abstraction falsifiable. Before they existed, every assertion named a
 * verifier and none of those verifiers were anywhere: INV-PROV-1 was false
 * about itself in the document whose whole thesis is that unfalsifiable
 * abstractions are worthless.
 */
/**
 * Every verifier in the registry has to be named by some assertion.
 *
 * profileSelfCheck already runs the other direction, catching an assertion that
 * names a verifier the registry does not have. This is the residue case: a
 * control gets dropped or reworded and its verifier stays behind. That is how
 * "daemon-starts-under-mdwe" came to sit in the registry describing "the daemon
 * starts under MemoryDenyWriteExecute, which it currently does not", a verifier
 * whose own description says it would fail if anything ever ran it.
 *
 * Nothing was broken enough to notice, and that is the problem. An unused entry
 * inflates the denominator of the coverage line below, so retiring a control
 * correctly made the ratio this project publishes as its status look worse.
 * Removing that one entry moved it from 12 of 16 to 12 of 15 without a single
 * verifier being written.
 */
for (const name of Object.keys(VERIFIERS)) {
  if (!named.has(name) && !NEEDS_NOTHING.has(name)) {
    fail(
      'provisioning/checks/registry.mjs',
      `declares the verifier "${name}", which no assertion names. Either an assertion should use ` +
        `it, or it is left over from one that was removed and belongs in excluded_controls instead.`
    )
  }
}

for (const problem of profileSelfCheck(loaded)) fail('provisioning/checks', problem)
for (const problem of verifierIgnoresBackends(CHECKS_DIR)) fail('provisioning/checks', problem)
for (const problem of documentedWeakness(loaded)) fail('provisioning/checks', problem)

const built = implemented()

/**
 * Both READMEs state this count in prose, and prose goes stale the first time
 * somebody writes a verifier and does not think to count again. "Eight of the
 * sixteen verifiers are written" survived in provisioning/README.md until
 * twelve of fifteen were, and the root README said "twelve of the sixteen"
 * after retiring an assertion took it to fifteen.
 *
 * The root README is checked too because guarding one file and not the other is
 * how the second one drifts: the fix for the first drift was written, and the
 * same sentence three directories up went stale anyway, in the most read
 * document in the repository.
 *
 * Only this total is checked. Pinning every sentence would make the documents
 * unwritable, and this is the one that carries the claim.
 */
for (const where of ['provisioning/README.md', 'README.md']) {
  const readme = readFileSync(join(ROOT, where), 'utf8')
  const WORDS = [
    'zero',
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
    'eleven',
    'twelve',
    'thirteen',
    'fourteen',
    'fifteen',
    'sixteen',
    'seventeen',
    'eighteen',
    'nineteen',
    'twenty',
  ]
  const spell = (n) => WORDS[n] ?? String(n)
  // Whitespace-tolerant, because prose wraps. With literal spaces this failed
  // on a README that said exactly the right thing with a line break inside it,
  // and the message read "does not say X" about a document that says X. A check
  // whose failure text is false is worse than one that is merely strict.
  const stated = new RegExp(
    `${spell(built.length)}\\s+of\\s+the\\s+${spell(Object.keys(VERIFIERS).length)}\\s+verifiers\\s+are\\s+written`,
    'i'
  )
  if (!stated.test(readme)) {
    fail(
      where,
      `does not say "${spell(built.length)} of the ${spell(Object.keys(VERIFIERS).length)} ` +
        `verifiers are written", which is what the registry now holds. The status paragraph ` +
        `is a claim about how much of this directory is real, so it is checked rather than ` +
        `remembered.`
    )
  }
}

if (problems > 0) {
  console.error(
    `check-profiles: ${problems} problem${problems === 1 ? '' : 's'} in ${files.length} profile(s)`
  )
  process.exit(1)
}

// The counts are printed rather than kept, because the gap between what these
// profiles assert and what can currently be checked IS the status of this work.
// A run that said only "valid" would be hiding the number that matters.
const declared = Object.keys(VERIFIERS).length
// Split, because "implemented" and "running in CI right now" are different
// numbers and reporting only the first would claim four verifiers are checking
// an image that does not exist yet.
const needRootfs = built.filter((name) => NEEDS_ROOTFS.has(name))
const needImage = built.filter((name) => NEEDS_IMAGE.has(name))
// A FOURTH BUCKET, because three verifiers moved into a state this line could
// not express. It reported "run on every commit" for anything implemented that
// was neither rootfs nor image, and the runtime three are implemented and are
// neither: the summary went straight from "3 need a booted device" to "0 need a
// booted device, 6 run on every commit" the moment they were written. Both
// halves of that were false, and it is the line most people read.
// THE REGISTRY'S SET, NOT THE ONE ABOVE. RUNTIME_ONLY_CHECKS is a wider list
// used for stage validation and includes no-unit-ordering, which is a rootfs
// verifier: counting with it subtracts that one twice and reported "2 run on
// every commit" where the answer is 3. Two sets that mean different things,
// and only one of them is the authority on this question.
const needConsole = built.filter((name) => RUNTIME_ONLY.has(name))
const runNow = built.length - needRootfs.length - needImage.length - needConsole.length
console.log(
  `check-profiles: ${files.length} profile(s) valid, ` +
    `${invariantOwner.size} provisioning invariants declared, ` +
    `${String(built.length)} of ${declared} verifiers written ` +
    `(${String(runNow)} run on every commit, ` +
    `${String(needRootfs.length)} run against a root filesystem via "make verify-image ROOT=...", ` +
    `${String(needImage.length)} against an image via "make verify-image IMAGE=...", ` +
    `${String(needConsole.length)} against a boot console log via "make verify-runtime", ` +
    `${String(declared - built.length)} with no verifier yet)`
)
