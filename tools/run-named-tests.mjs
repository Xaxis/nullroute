#!/usr/bin/env node
/**
 * Run tests by name, and fail unless every name ran and passed.
 *
 * WHY NOT `vitest run -t`. A name filter that matches nothing exits 0 with
 * every test skipped. `make test-repro` filtered on two names, one of them a
 * test since renamed, so for an unknown stretch it ran the hundred-signings
 * self-consistency check and silently skipped the cross-check against
 * libsecp256k1, which its own comment calls the half that means something.
 *
 * Usage: node tools/run-named-tests.mjs <vitest project> <test name>...
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [project, ...names] = process.argv.slice(2)
if (project === undefined || names.length === 0) {
  console.error('usage: node tools/run-named-tests.mjs <project> <test name>...')
  process.exit(2)
}

const dir = mkdtempSync(join(tmpdir(), 'nullroute-named-tests-'))
const report = join(dir, 'report.json')
try {
  const pattern = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const run = spawnSync(
    'npx',
    [
      'vitest',
      'run',
      '--project',
      project,
      '-t',
      `^(?:.* )?(?:${pattern})$`,
      '--reporter=json',
      `--outputFile=${report}`,
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] }
  )
  const results = JSON.parse(readFileSync(report, 'utf8'))
  const passed = new Set(
    results.testResults
      .flatMap((file) => file.assertionResults)
      .filter((test) => test.status === 'passed')
      .map((test) => test.title)
  )
  const missing = names.filter((name) => !passed.has(name))
  if (missing.length > 0 || run.status !== 0) {
    console.error(
      `run-named-tests: did not run and pass: ${missing.join(', ') || '(vitest failed)'}`
    )
    process.exit(1)
  }
  console.log(
    `run-named-tests: ${String(names.length)} named test(s) ran and passed: ${names.join(', ')}`
  )
} finally {
  rmSync(dir, { recursive: true, force: true })
}
