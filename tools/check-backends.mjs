#!/usr/bin/env node
/**
 * A backend recipe that has never been run must say so, and must not drift.
 *
 * THE FAILURE THIS PREVENTS. `provisioning/backends/` holds build recipes that
 * nothing in CI executes, because executing them needs Linux and an hour. A
 * directory of plausible-looking configuration that nobody runs is the exact
 * shape of the problem `provisioning/README.md` was written about: it reads as
 * a working build and checks nothing.
 *
 * So three things are enforced, and each is a way the directory could quietly
 * start lying.
 *
 *   A backend on disk is declared in a profile, and a backend declared in a
 *   profile is on disk. Either half missing means somebody added one and
 *   forgot the other, and the profile is what a reader believes.
 *
 *   A backend whose profile says `status: planned` says so in its own README
 *   too. Somebody reading the recipe is not reading the profile, and the
 *   sentence that matters most is the one saying this has never been run.
 *
 *   Every patch a backend's config requires exists. A config listing a patch
 *   file that is not there would fail at build time on a Linux machine an hour
 *   into a run, which is the worst possible moment to discover a typo.
 *
 * WHAT IT DELIBERATELY DOES NOT DO is check that the recipe works. It cannot,
 * and pretending otherwise would be the false pass this project treats as a
 * security bug. `make verify-image` against real output is the only thing that
 * answers that, and until somebody runs it the honest status is `planned`.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BACKENDS = join(ROOT, 'provisioning/backends')
const PROFILES = join(ROOT, 'provisioning/profiles')

const problems = []

const profiles = readdirSync(PROFILES)
  .filter((name) => name.endsWith('.yaml'))
  .map((name) => ({ file: name, profile: parse(readFileSync(join(PROFILES, name), 'utf8')) }))

/** Every backend any profile names, and the status it claims. */
const declared = new Map()
for (const { file, profile } of profiles) {
  for (const backend of profile.backends ?? []) {
    const existing = declared.get(backend.name)
    // Two profiles may name the same backend, and they must agree about its
    // status: a reader who saw `supported` in one would not go looking for
    // `planned` in the other.
    if (existing !== undefined && existing.status !== backend.status) {
      problems.push(
        `${backend.name} is "${existing.status}" in ${existing.file} and ` +
          `"${backend.status}" in ${file}. One of them is wrong and a reader believes whichever they saw first.`
      )
    }
    declared.set(backend.name, { status: backend.status, file })
  }
}

const onDisk = existsSync(BACKENDS)
  ? readdirSync(BACKENDS).filter((name) => statSync(join(BACKENDS, name)).isDirectory())
  : []

for (const name of onDisk) {
  const claim = declared.get(name)
  if (claim === undefined) {
    problems.push(
      `provisioning/backends/${name}/ exists and no profile declares it. A recipe nobody ` +
        `declared is a recipe nobody reviews.`
    )
    continue
  }

  const readme = join(BACKENDS, name, 'README.md')
  if (!existsSync(readme)) {
    problems.push(`provisioning/backends/${name}/ has no README.md saying what it is and is not.`)
    continue
  }

  // The status sentence, in the recipe as well as in the profile. Somebody
  // reading the recipe is not reading the profile.
  //
  // Two phrasings, listed rather than generalised. A regex loose enough to
  // accept any sentence about running would accept "run it like this", and a
  // guard that accepts the instructions as the disclaimer is worse than none.
  const text = readFileSync(readme, 'utf8')
  const disclaims = /(has )?never been run|nothing here has ever been run/i.test(text)
  if (claim.status === 'planned' && !disclaims) {
    problems.push(
      `provisioning/backends/${name}/README.md does not say the recipe has never been run, ` +
        `and ${claim.file} declares it as planned. The sentence that matters most is missing ` +
        `from the file somebody actually reads.`
    )
  }

  // Every patch a config requires is on disk.
  for (const entry of readdirSync(join(BACKENDS, name)).filter((f) => f.endsWith('.yaml'))) {
    const config = parse(readFileSync(join(BACKENDS, name, entry), 'utf8'))
    for (const patch of config?.nullroute?.requires_patches ?? []) {
      if (!existsSync(join(BACKENDS, name, patch))) {
        problems.push(
          `${name}/${entry} requires ${patch}, which is not there. That fails an hour into a ` +
            `build on a machine this repository is not developed on.`
        )
      }
    }
  }
}

for (const [name, claim] of declared) {
  if (!onDisk.includes(name)) {
    // Not a failure. A profile may name a backend as a candidate long before
    // anybody writes it, which is exactly what the mkosi entry is, and refusing
    // that would push the honest "we are considering this" out of the profile.
    console.log(`  ${name}: declared in ${claim.file} as ${claim.status}, no recipe written yet`)
  }
}

if (problems.length > 0) {
  console.error('check-backends: a build recipe and the profile that declares it disagree.\n')
  for (const problem of problems) console.error(`  ${problem}`)
  console.error('')
  console.error('  A directory of plausible-looking configuration that nobody runs reads as a')
  console.error('  working build and checks nothing. That is the failure provisioning/README.md')
  console.error('  was written about, occurring in the design.')
  process.exit(1)
}

const written = onDisk.length
const planned = [...declared.values()].filter((c) => c.status === 'planned').length
console.log(
  `check-backends: ${String(declared.size)} backend(s) declared, ${String(written)} written, ` +
    `${String(planned)} still planned and saying so. None is executed here: that needs Linux, ` +
    `and "make verify-image" against its output is what would change the status.`
)
