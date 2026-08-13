/**
 * Global test configuration.
 *
 * fast-check defaults to a random seed per run, which means a property test
 * that fails once may pass on the next run and nobody can reproduce the
 * counterexample. That is normally an annoyance. In this repository it
 * contradicts the thing the repository is for: CONTRIBUTING.md says there is no
 * "flaky, re-run it" culture here, because non-determinism is precisely the
 * property nullroute exists to rule out.
 *
 * So the seed is pinned. Runs are reproducible, a failure reported by CI
 * reproduces on a workstation, and the run count is raised since the cost of a
 * fixed seed is less input diversity per run.
 *
 * To hunt for counterexamples the fixed seed misses, override it locally:
 *   FAST_CHECK_SEED=$RANDOM npx vitest run
 */

import fc from 'fast-check'

const seedOverride = process.env['FAST_CHECK_SEED']

fc.configureGlobal({
  seed: seedOverride === undefined ? 0x6e756c6c : Number(seedOverride),
  numRuns: 200,
  // Report the failing input rather than a shrunk-to-nothing summary.
  verbose: 1,
})
