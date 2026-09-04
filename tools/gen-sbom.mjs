#!/usr/bin/env node
/**
 * Emit a CycloneDX SBOM for the dependency tree.
 *
 * Uses npm's built-in `npm sbom` rather than adding @cyclonedx/cyclonedx-npm.
 * A project whose dependency policy requires written justification for every
 * package should not add one to describe its own packages.
 *
 * The output is normalised for determinism. npm stamps a fresh `serialNumber`
 * (a random UUID) and a `metadata.timestamp` into every run, so two SBOMs of an
 * identical tree differ in ways that mean nothing. Both are stripped, and the
 * remaining keys are sorted, so a diff between two SBOMs shows only real
 * dependency changes. That matters because the SBOM is published alongside a
 * release, and a reviewer comparing two of them needs the diff to be signal.
 *
 * Run: node tools/gen-sbom.mjs [--check]
 */

import { execFileSync } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT = join(ROOT, 'sbom.cdx.json')
const check = process.argv.includes('--check')

/** Recursively sort object keys so serialisation is stable. */
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((k) => [k, sortKeys(value[k])])
  )
}

/**
 * Every package name the lockfile resolves, workspaces included.
 *
 * WHY THE LOCKFILE AND NOT `npm ls`. `npm sbom` reports what is INSTALLED, and
 * an installed tree drifts from the lockfile: ten packages here were left
 * behind when the WebGL hero was deleted, `three` and `@dimforge/rapier3d-compat`
 * among them, and every one appeared in the published bill of materials. A
 * reader deciding how much attack surface they are taking on was being told a
 * Bitcoin signer's site shipped a 3D engine and a physics library. Overstating
 * what is in a build is the same defect as understating it.
 *
 * The first attempt asked `npm ls` which packages were extraneous, and that was
 * wrong in a way worth recording. `extraneous` is a property of the tree as
 * npm currently sees it, and it MOVES: `next build` reshapes node_modules
 * partway through `make check`, after which npm calls `@img/sharp-wasm32` and
 * `@emnapi/runtime` extraneous even though a clean `npm ci` installs both and
 * the lockfile lists both. Filtering on it removed two real packages, so the
 * document then understated the tree. A signal that flips depending on what has
 * been built cannot decide what a bill of materials says.
 *
 * package-lock.json does not move. A name absent from it is a name no install
 * of this commit produces, which is exactly the question being asked.
 *
 * THE LIMIT, stated because it is not obvious: this matches on name, not on
 * name and version, so a stale VERSION of a package the lockfile does know
 * about is not caught here. Dropping on a version mismatch would risk deleting
 * legitimate components, and deleting a real one is worse than keeping a stale
 * one. `npm ci` is what rules that out, and CI runs it immediately before this.
 */
function lockfileNames() {
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'))
  const names = new Set()
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    const at = path.lastIndexOf('node_modules/')
    if (at !== -1) names.add(path.slice(at + 'node_modules/'.length))
    // The root and each workspace are keyed by directory, so their name is only
    // in the entry. Without these, every @nullroute/* component looks unknown.
    else if (typeof entry.name === 'string') names.add(entry.name)
  }
  if (names.size < 100) {
    console.error(
      `gen-sbom: only ${String(names.size)} names were read out of package-lock.json, ` +
        `so this filter is blind. The lockfile shape has changed.`
    )
    process.exit(1)
  }
  return names
}

/**
 * Drop components the lockfile does not know, edges included.
 *
 * A component left dangling in the dependency graph is worse than one listed
 * twice: tooling that walks `dependsOn` resolves a ref to nothing. `bom-ref`,
 * `ref` and every entry in `dependsOn` are all the same string, so one set of
 * refs covers all three.
 */
function excludeUnlocked(sbom, known) {
  /*
   * The name comes off `bom-ref`, not off `name`. npm writes the UNSCOPED name
   * into `name` and no `group` beside it, so a scoped package reads as `web`
   * where the lockfile knows it as `@nullroute/web`, and matching on `name`
   * dropped all five workspace packages on the first run. `bom-ref` is the only
   * field carrying the whole thing, and the last `@` in it starts the version
   * for scoped and unscoped names alike.
   */
  const fullName = (c) => {
    const ref = c['bom-ref']
    if (typeof ref !== 'string') return c.name
    const at = ref.lastIndexOf('@')
    return at > 0 ? ref.slice(0, at) : ref
  }

  const dropped = []
  const refs = new Set()
  for (const c of sbom.components ?? []) {
    if (known.has(fullName(c))) continue
    refs.add(c['bom-ref'])
    dropped.push(`${fullName(c)}@${c.version ?? '?'}`)
  }
  if (refs.size === 0) return dropped

  sbom.components = (sbom.components ?? []).filter((c) => !refs.has(c['bom-ref']))
  if (Array.isArray(sbom.dependencies)) {
    sbom.dependencies = sbom.dependencies
      .filter((d) => !refs.has(d.ref))
      .map((d) =>
        Array.isArray(d.dependsOn)
          ? { ...d, dependsOn: d.dependsOn.filter((ref) => !refs.has(ref)) }
          : d
      )
  }
  return dropped.sort()
}

let raw
try {
  raw = execFileSync('npm', ['sbom', '--sbom-format', 'cyclonedx', '--sbom-type', 'application'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
} catch (err) {
  console.error(`gen-sbom: npm sbom failed: ${err.message}`)
  process.exit(1)
}

const sbom = JSON.parse(raw)

// Non-deterministic per run and carrying no information about the tree.
delete sbom.serialNumber
if (sbom.metadata) delete sbom.metadata.timestamp
// npm records its own invocation, which embeds the absolute path of the runner.
if (sbom.metadata?.tools?.components) {
  for (const tool of sbom.metadata.tools.components) delete tool.version
}

const dropped = excludeUnlocked(sbom, lockfileNames())

const normalised = `${JSON.stringify(sortKeys(sbom), null, 2)}\n`
const digest = createHash('sha256').update(normalised).digest('hex')
const componentCount = Array.isArray(sbom.components) ? sbom.components.length : 0

if (check) {
  if (!existsSync(OUT)) {
    console.error('gen-sbom: sbom.cdx.json is missing. Run "make sbom".')
    process.exit(1)
  }
  if (readFileSync(OUT, 'utf8') !== normalised) {
    console.error('gen-sbom: sbom.cdx.json does not match the installed tree.')
    console.error('  The dependency tree changed. Regenerate with "make sbom" and review the diff.')
    process.exit(1)
  }
  console.log(`gen-sbom: sbom.cdx.json matches (${componentCount} components)`)
} else {
  writeFileSync(OUT, normalised)
  console.log(`gen-sbom: ${componentCount} components, sha256 ${digest.slice(0, 16)}...`)
}

if (dropped.length > 0) {
  console.log(`  ${String(dropped.length)} installed package(s) the lockfile does not list:`)
  for (const name of dropped) console.log(`    ${name}`)
  console.log(
    `  Left out, because no install of this commit produces them. Run "npm ci"\n` +
      `  for a tree without them. If one belongs in the build, it belongs in a\n` +
      `  package.json.`
  )
}
