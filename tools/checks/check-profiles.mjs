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
/**
 * A board a document tells somebody to buy is a board the profile claims.
 *
 * THE DRIFT THIS EXISTS FOR. `boards:` said raspberrypi-4 and nothing else,
 * because Debian's bcm2712-rpi-5-b.dtb has fifteen device nodes to the Pi 4's
 * seventy four and describes no DSI at all, so the panel this device is built
 * around has nothing to attach to on a Pi 5. Meanwhile README.md's shopping
 * table led with "Raspberry Pi 5, or Pi 4" and docs/VERIFICATION.md said "Pi 5
 * is preferred", and both threw in a Pi Zero 2 W that has never appeared in any
 * profile. The reason given was a signed boot chain that is phase 7 and does
 * not exist.
 *
 * That is not a stale sentence, it is a purchasing instruction: somebody reads
 * it, buys the wrong board, flashes the image and gets a device with no screen.
 * CLAUDE.md calls overclaiming in the docs a security bug, and a table telling
 * a stranger what hardware to buy is the sharpest end of it.
 *
 * Model names rather than profile ids, because a shopping table says "Raspberry
 * Pi 4" and the profile says "raspberrypi-4". The mapping is written out here
 * so a new board has to be added deliberately in both places.
 */
// Every board any loaded profile claims. The signer profile is the one that
// ships, but a second profile claiming a board is still a board this repository
// says it supports.
const BOARDS = [...new Set(loaded.flatMap(({ profile }) => profile.boards ?? []))]

const BOARD_PROSE = {
  'raspberrypi-4': /Raspberry Pi 4\b/,
  'raspberrypi-5': /Raspberry Pi 5\b/,
  'raspberrypi-cm5': /Compute Module 5\b/,
  'raspberrypi-zero-2-w': /Pi Zero 2 W\b/,
}

for (const where of ['README.md', 'docs/VERIFICATION.md']) {
  const text = readFileSync(join(ROOT, where), 'utf8')
  // The hardware table only. Prose elsewhere may discuss a board it does not
  // tell anybody to buy, which is what the phase 7 paragraphs legitimately do.
  const table = text
    .split('\n')
    .filter((line) => /^\|\s*(Board|Screen|Display)\s*\|/.test(line))
    .join('\n')
  if (table === '') continue

  for (const [id, pattern] of Object.entries(BOARD_PROSE)) {
    const named = pattern.test(table)
    const claimed = BOARDS.includes(id)
    if (named && !claimed) {
      fail(
        where,
        `its hardware table names ${id} and the profile does not claim it. A table ` +
          `telling somebody what to buy is a purchasing instruction, and this one would ` +
          `send them to a board the image does not support.`
      )
    }
    if (claimed && !named) {
      fail(
        where,
        `the profile claims ${id} and its hardware table does not name it, so the one ` +
          `board this image supports is not the one the document tells anybody to get.`
      )
    }
  }
}

// NAMING A BOARD IS NOT THE ONLY WAY A DOCUMENT COMMITS TO HARDWARE. Two other
// kinds of claim say exactly which board this is, and both were prose.
//
// docs/ENTROPY.md sources entropy from the BCM2711's iproc-rng200 block, which
// is a statement about one SoC. And os-signer.yaml puts bcm2711-rpi-4-b.dtb on
// the boot partition under a comment reading "Only the boards `boards:` above
// claims", which is an assertion about the file list that nothing asserted.
// Trading the Pi 4 for a Pi 5 would leave the entropy document describing
// silicon that is not in the device and the card carrying a device tree for a
// board the profile had stopped supporting, with every check still green.
const SOC = {
  BCM2711: ['raspberrypi-4', 'raspberrypi-400', 'raspberrypi-cm4'],
  BCM2712: ['raspberrypi-5', 'raspberrypi-cm5'],
  BCM2710: ['raspberrypi-zero-2-w'],
  BCM2837: ['raspberrypi-3'],
}

const DOCS = [
  'README.md',
  ...readdirSync(join(ROOT, 'docs'))
    .filter((name) => name.endsWith('.md'))
    .map((name) => `docs/${name}`),
]

for (const where of DOCS) {
  const text = readFileSync(join(ROOT, where), 'utf8')
  for (const [soc, boards] of Object.entries(SOC)) {
    if (!new RegExp(`\\b${soc}\\b`, 'u').test(text)) continue
    if (boards.some((id) => BOARDS.includes(id))) continue
    fail(
      where,
      `it names the ${soc} and no board any profile claims uses that silicon. The ` +
        `profiles claim ${BOARDS.join(', ') || 'no board at all'}, so this describes ` +
        `hardware the image does not run on.`
    )
  }
}

// Debian trixie's 6.12 kernel ships these four and no more, which is the same
// fact that took raspberrypi-cm5 out of `boards:`.
const BOARD_DTB = {
  'raspberrypi-4': 'bcm2711-rpi-4-b.dtb',
  'raspberrypi-400': 'bcm2711-rpi-400.dtb',
  'raspberrypi-cm4': 'bcm2711-rpi-cm4-io.dtb',
  'raspberrypi-5': 'bcm2712-rpi-5-b.dtb',
}

for (const { file, profile } of loaded) {
  const claims = profile.boards ?? []
  for (const assertion of profile.assertions ?? []) {
    for (const v of assertion.verify ?? []) {
      if (v.check !== 'boot-files-exact') continue
      const files = (v.params?.files ?? []).map(String)
      const trees = files.filter((name) => /^bcm\d+-rpi-[\w-]+\.dtb$/u.test(name))
      const where = `${file}  ${assertion.id}`

      for (const [id, dtb] of Object.entries(BOARD_DTB)) {
        if (trees.includes(dtb) && !claims.includes(id)) {
          fail(
            where,
            `the boot partition carries ${dtb} and the profile does not claim ${id}. ` +
              `A device tree for a board this image does not support is either dead ` +
              `weight on the one partition dm-verity cannot cover, or the board list ` +
              `is wrong.`
          )
        }
        if (claims.includes(id) && !trees.includes(dtb)) {
          fail(
            where,
            `the profile claims ${id} and the boot partition carries no ${dtb}, so the ` +
              `firmware has no device tree for a board this profile says it supports.`
          )
        }
      }

      for (const tree of trees) {
        if (Object.values(BOARD_DTB).includes(tree)) continue
        fail(
          where,
          `the boot partition carries ${tree}, which belongs to no board this check ` +
            `knows. Add it to BOARD_DTB with the board it serves, so the file list and ` +
            `\`boards:\` keep having to agree.`
        )
      }
    }
  }
}

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

// COUNTED, NOT SUBTRACTED. This line used to be
//   built.length - needRootfs.length - needImage.length - needConsole.length
// which silently absorbed any verifier that was in no set into "runs on every
// commit". Two were: documented-weakness, which does, and boot-config-display,
// which needs a root filesystem and was being reported as running on every
// commit for months. The arithmetic always summed to the right total, so the
// only symptom was the two numbers either side of it being wrong.
//
// Adding a verifier and forgetting to place it produces exactly that, and this
// file has just had one added, so the omission is refused rather than counted.
const needNothing = built.filter((name) => NEEDS_NOTHING.has(name))
const unplaced = built.filter(
  (name) =>
    !NEEDS_NOTHING.has(name) &&
    !NEEDS_ROOTFS.has(name) &&
    !NEEDS_IMAGE.has(name) &&
    !RUNTIME_ONLY.has(name)
)
for (const name of unplaced) {
  fail(
    'provisioning/checks/registry.mjs',
    `the verifier "${name}" is implemented and is in none of NEEDS_NOTHING, NEEDS_ROOTFS, ` +
      `NEEDS_IMAGE or RUNTIME_ONLY. The status line would report it as running on every ` +
      `commit, which is a claim about coverage, and it is the claim most people read.`
  )
}
const runNow = needNothing.length

// INV-PROV-1 SAYS "VERIFIER CORRECTNESS IS COVERED BY THE VERIFIER SUITE'S OWN
// TESTS" IN ITS does_not_cover, and for half of them that was not true. The
// rootfs verifiers were tested against a fixture tree; the image verifiers were
// tested by whatever `make image` happened to produce, so their edge cases ran
// never. An assertion that hands its uncovered half to a suite which does not
// cover it is the same shape of claim as a hardening rule nobody applies.
//
// The exemptions below are the ones still uncovered. The list may shrink and
// must not grow: a new verifier arrives with a test, or it arrives with a line
// here and a reason. A name that IS tested and still listed fails too, so the
// list cannot rot into a permanent excuse.
const UNTESTED_VERIFIERS = new Set([
  // Take parsed profiles rather than an artifact. Testable with fixture
  // profile objects, which is a different shape from the two suites that exist.
  'profile-self-check',
  'verifier-ignores-backends',
  'documented-weakness',
  // Image verifiers. The fixture builder in test/provisioning/image.test.ts now
  // makes these reachable, which is what took boot-files-exact off this list.
  'rebuild-identical',
  'identifiers-pinned',
  'partition-present',
  'verity-salt-pinned',
  // Rootfs verifiers, straightforwardly testable beside the eight already there.
  'file-modes',
  'unit-executables',
  // Reads a boot console log, like the two runtime verifiers that are tested.
  'mount-options',
])

// THE HAND-WRITTEN DECLARATIONS AND THE MODULE THEY DESCRIBE HAVE TO AGREE.
// provisioning/checks/*.d.mts exist so a typed test can import these modules,
// and TypeScript reads them INSTEAD OF the .mjs, so an export missing from one
// is an export that does not exist as far as any test is concerned. image.d.mts
// had drifted: it declared neither readFatRootEntries nor half the keys of
// IMAGE_VERIFIERS, which is not a typing inconvenience, it is the reason those
// six verifiers had no tests while the rootfs ones had a suite from the start.
// The failure is silent in both directions, so both are checked.
for (const declaration of readdirSync(join(ROOT, 'provisioning/checks')).filter((name) =>
  name.endsWith('.d.mts')
)) {
  const where = `provisioning/checks/${declaration}`
  const module = declaration.replace(/\.d\.mts$/u, '.mjs')
  const modulePath = join(ROOT, 'provisioning/checks', module)
  if (!existsSync(modulePath)) {
    fail(where, `declares types for ${module}, which is not there.`)
    continue
  }

  const names = (text, pattern) => new Set([...text.matchAll(pattern)].map((m) => m[1]))
  const implemented = names(
    readFileSync(modulePath, 'utf8'),
    /^export\s+(?:async\s+)?(?:function|const)\s+(\w+)/gmu
  )
  const declared = names(
    readFileSync(join(ROOT, where), 'utf8'),
    /^export\s+declare\s+(?:async\s+)?(?:function|const)\s+(\w+)/gmu
  )

  for (const name of implemented) {
    if (!declared.has(name)) {
      fail(
        where,
        `${module} exports "${name}" and this file does not declare it, so TypeScript ` +
          `cannot see it and no typed test can import it.`
      )
    }
  }
  for (const name of declared) {
    if (!implemented.has(name)) {
      fail(where, `declares "${name}", which ${module} does not export.`)
    }
  }
}

const suite = readdirSync(join(ROOT, 'test/provisioning'))
  .filter((name) => name.endsWith('.test.ts'))
  .map((name) => readFileSync(join(ROOT, 'test/provisioning', name), 'utf8'))
  .join('\n')

for (const name of built) {
  const tested = suite.includes(name)
  if (!tested && !UNTESTED_VERIFIERS.has(name)) {
    fail(
      'test/provisioning',
      `the verifier "${name}" has no test naming it, and INV-PROV-1 hands verifier ` +
        `correctness to this suite. Write one, or add it to UNTESTED_VERIFIERS in ` +
        `tools/checks/check-profiles.mjs with the reason it is not covered yet.`
    )
  }
  if (tested && UNTESTED_VERIFIERS.has(name)) {
    fail(
      'tools/checks/check-profiles.mjs',
      `the verifier "${name}" is listed in UNTESTED_VERIFIERS and the suite tests it. ` +
        `Remove the exemption, so the list keeps meaning what it says.`
    )
  }
}
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
