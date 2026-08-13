#!/usr/bin/env node
/**
 * `make verify`: the five checks from docs/VERIFICATION.md section 3.
 *
 * The daemon refuses to start if verification-report.json is missing, stale, or
 * failing (INV-BUILD-1). That is what makes the specs load-bearing rather than
 * decorative: a spec that stops matching its code stops the device from booting.
 *
 * A note on how failure is reported. Checks that have nothing to do are marked
 * `not-applicable`, never `passed`. A phase-1 build has no BIP vectors and no
 * differential oracle yet, and a report that said those checks passed would be
 * claiming assurance the project has not earned. The distinction is visible in
 * the report and in the summary.
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import { loadAllSpecs, type LoadedSpec } from './specs.js'
import { checkCoverage, enumerateExports } from './coverage.js'
import { checkBindings, loadReport } from './tests.js'
import { checkIntegrity } from './manifest.js'
import { checkVectors, checkDifferential } from './vectors.js'

const REPO_ROOT = process.env['NULLROUTE_ROOT'] ?? fileURLToPath(new URL('../../..', import.meta.url))

const SPEC_DIRS = ['packages']
const SCHEMA = join(REPO_ROOT, 'spec', 'schema.json')

/**
 * Packages whose public API must be fully covered by specs.
 *
 * Coverage is measured against each package's ENTRY POINT rather than every
 * file, so a symbol exported from an internal module but never re-exported is
 * not public API and does not need a spec. Requiring one would push the project
 * toward specifying its own internals.
 */
const COVERED_ENTRIES = [
  'packages/core/src/index.ts',
  'packages/daemon/src/index.ts',
  'packages/ui/src/index.ts',
]
const TEST_REPORT = join(REPO_ROOT, 'test-report.json')
const OUT = join(REPO_ROOT, 'verification-report.json')

type CheckStatus = 'passed' | 'failed' | 'not-applicable'

interface CheckOutcome {
  readonly name: string
  readonly status: CheckStatus
  readonly detail: string
  readonly failures: readonly string[]
}

const GREEN = '[32m'
const RED = '[31m'
const DIM = '[2m'
const RESET = '[0m'

function line(outcome: CheckOutcome): string {
  const mark =
    outcome.status === 'passed'
      ? `${GREEN}ok${RESET}`
      : outcome.status === 'failed'
        ? `${RED}FAIL${RESET}`
        : `${DIM}n/a${RESET}`
  return `  ${mark.padEnd(16)} ${outcome.name.padEnd(22)} ${outcome.detail}`
}

function main(): number {
  const outcomes: CheckOutcome[] = []
  let specs: LoadedSpec[] = []

  // Specs must load before anything can be checked against them. A malformed
  // spec is a hard stop rather than a failed check, because every later check
  // would be reporting against an unknown baseline.
  try {
    specs = loadAllSpecs(REPO_ROOT, SPEC_DIRS, SCHEMA)
  } catch (err) {
    console.error(`${RED}verify: specs did not load${RESET}\n${(err as Error).message}`)
    return 1
  }

  const allInvariants = specs.flatMap((s) => s.spec.invariants)

  // --- 1. Coverage --------------------------------------------------------
  let coverage: ReturnType<typeof checkCoverage> | undefined
  try {
    const exports = COVERED_ENTRIES.flatMap((entry) => enumerateExports(REPO_ROOT, entry))
    coverage = checkCoverage(
      exports,
      specs.map((s) => s.spec.covers)
    )
    outcomes.push({
      name: 'coverage',
      status: coverage.ok ? 'passed' : 'failed',
      detail: `${String(coverage.covered.length)} of ${String(exports.filter((e) => !e.typeOnly).length)} runtime exports covered`,
      failures: [
        ...coverage.uncovered.map((s) => `uncovered export: ${s}`),
        ...coverage.dangling.map((s) => `spec covers a symbol that does not exist: ${s}`),
      ],
    })
  } catch (err) {
    outcomes.push({
      name: 'coverage',
      status: 'failed',
      detail: 'could not enumerate exports',
      failures: [(err as Error).message],
    })
  }

  // --- 2. Invariant binding ----------------------------------------------
  let bindings: ReturnType<typeof checkBindings> | undefined
  try {
    const report = loadReport(TEST_REPORT)
    bindings = checkBindings(REPO_ROOT, report, allInvariants)
    outcomes.push({
      name: 'invariants',
      status: bindings.ok ? 'passed' : 'failed',
      detail: `${String(allInvariants.length)} invariants bound to ${String(bindings.bindings.length)} tests, ${String(bindings.totalTests)} tests in the suite`,
      failures: bindings.bindings
        .filter((b) => !b.ok)
        .map((b) => `${b.invariantId} -> ${b.selector}: ${b.detail ?? b.status}`),
    })
  } catch (err) {
    outcomes.push({
      name: 'invariants',
      status: 'failed',
      detail: 'no usable test report',
      failures: [(err as Error).message],
    })
  }

  // --- 3. Vectors ---------------------------------------------------------
  const vectors = checkVectors(REPO_ROOT, specs)
  outcomes.push({
    name: 'vectors',
    status: vectors.declared === 0 ? 'not-applicable' : vectors.ok ? 'passed' : 'failed',
    detail:
      vectors.declared === 0
        ? 'no official vectors declared yet'
        : `${String(vectors.verified)} of ${String(vectors.declared)} vector files match their pinned hash`,
    failures: vectors.failures,
  })

  // --- 4. Differential ----------------------------------------------------
  const differential = checkDifferential(specs)
  outcomes.push({
    name: 'differential',
    status:
      differential.declared === 0 ? 'not-applicable' : differential.ok ? 'passed' : 'failed',
    detail:
      differential.declared === 0
        ? 'no differential oracle declared yet (cross-check against bitcoinjs-lib lands with phase 2)'
        : `${String(differential.declared)} modules cross-checked`,
    failures: differential.failures,
  })

  // --- 5. Integrity -------------------------------------------------------
  let rootHash = ''
  try {
    const integrity = checkIntegrity(REPO_ROOT)
    rootHash = integrity.rootHash
    outcomes.push({
      name: 'integrity',
      status: integrity.ok ? 'passed' : 'failed',
      detail: `${String(integrity.entries.length)} files, root ${integrity.rootHash.slice(0, 8)}...${integrity.rootHash.slice(-8)}`,
      failures: [
        ...integrity.missing.map((p) => `file in manifest is missing: ${p}`),
        ...integrity.mismatched.map(
          (m) => `hash mismatch: ${m.path}\n      expected ${m.expected}\n      actual   ${m.actual}`
        ),
      ],
    })
  } catch (err) {
    outcomes.push({
      name: 'integrity',
      status: 'failed',
      detail: 'manifest unreadable',
      failures: [(err as Error).message],
    })
  }

  // --- 6. Emit the report -------------------------------------------------
  const tiers = specs.reduce<Record<string, number>>((acc, s) => {
    acc[s.spec.assurance_tier] = (acc[s.spec.assurance_tier] ?? 0) + 1
    return acc
  }, {})

  const failed = outcomes.filter((o) => o.status === 'failed')

  const report = {
    schema: 1,
    generatedBy: '@nullroute/verify',
    // The build tier. A signer-only build and a full build differ here and in
    // the root hash, so a user can prove from the lock screen which they hold.
    tier: 'signer',
    rootHash,
    specCount: specs.length,
    invariantCount: allInvariants.length,
    tiers,
    checks: outcomes.map((o) => ({
      name: o.name,
      status: o.status,
      detail: o.detail,
      failures: o.failures,
    })),
    coverage: coverage
      ? {
          runtimeExports: coverage.exports.filter((e) => !e.typeOnly).length,
          covered: coverage.covered.length,
          uncovered: coverage.uncovered,
          dangling: coverage.dangling,
        }
      : null,
    invariants: (bindings?.bindings ?? []).map((b) => ({
      id: b.invariantId,
      test: b.selector,
      status: b.status,
    })),
    specs: specs.map((s) => ({
      id: s.spec.id,
      path: s.path,
      version: s.spec.version,
      tier: s.spec.assurance_tier,
      status: s.spec.status,
      invariants: s.spec.invariants.map((i) => i.id),
    })),
    passed: failed.length === 0,
  }

  const serialized = `${JSON.stringify(report, null, 2)}\n`
  writeFileSync(OUT, serialized)

  console.log('\nnullroute verification\n')
  for (const outcome of outcomes) console.log(line(outcome))

  if (failed.length > 0) {
    console.log('')
    for (const outcome of failed) {
      console.error(`${RED}${outcome.name} failed:${RESET}`)
      for (const f of outcome.failures) console.error(`    ${f}`)
    }
  }

  const reportHash = bytesToHex(sha256(utf8ToBytes(serialized)))
  console.log(
    `\n  ${String(specs.length)} specs, ${String(allInvariants.length)} invariants` +
      `\n  manifest root  ${rootHash || '(unavailable)'}` +
      `\n  report written to verification-report.json (sha256 ${reportHash.slice(0, 16)}...)\n`
  )

  if (failed.length > 0) {
    console.error(`${RED}verification FAILED${RESET}\n`)
    return 1
  }
  console.log(`${GREEN}verification passed${RESET}\n`)
  return 0
}

process.exitCode = main()
