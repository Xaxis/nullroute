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
