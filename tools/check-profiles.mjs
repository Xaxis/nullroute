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
 * Run: node tools/check-profiles.mjs
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PROFILE_DIR = join(ROOT, 'provisioning/profiles')
const SCHEMA = join(ROOT, 'provisioning/schema.json')

const require = createRequire(join(ROOT, 'packages/verify/package.json'))
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

  for (const assertion of profile.assertions) {
    const where = `${rel}  ${assertion.id}`

    // INV-PROV-1. The schema already requires a non-empty array; this catches
    // the subtler form where every entry is missing its implementation name.
    if (!assertion.verify.some((v) => typeof v.check === 'string' && v.check.length > 0)) {
      fail(where, 'has no executable verifier. An assertion that checks nothing is not an assertion.')
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
    if (assertion.does_not_cover.trim().toLowerCase() === assertion.statement.trim().toLowerCase()) {
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
    if (backend.status === 'supported' && !existsSync(join(ROOT, 'provisioning/backends', backend.name))) {
      fail(
        `${rel}  backend "${backend.name}"`,
        `is marked "supported" but provisioning/backends/${backend.name} does not exist. ` +
          `A backend earns that word by passing the unchanged verifier suite, not by being described.`
      )
    }
  }
}

if (problems > 0) {
  console.error(`check-profiles: ${problems} problem${problems === 1 ? '' : 's'} in ${files.length} profile(s)`)
  process.exit(1)
}

console.log(
  `check-profiles: ${files.length} profile(s) valid, ` +
    `${invariantOwner.size} provisioning invariants declared`
)
