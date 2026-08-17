import { defineConfig } from 'vitest/config'

/**
 * Fifteen seconds, not vitest's five.
 *
 * This suite signs, derives thousands of addresses and runs Argon2id, on
 * whatever machine happens to be free. Several tests sit comfortably under a
 * second on their own and cross five seconds when the whole suite is competing
 * for cores. That produced three separate failures that were nothing but
 * timeouts on correct code.
 *
 * A test that flakes is worse than a slow one. People learn to re-run it, and
 * then they re-run a real failure too. Fifteen seconds is still far below
 * anything that would let a genuine hang go unreported, and the few tests that
 * legitimately need longer say so individually.
 *
 * Set on every project rather than once at the root: with `projects`, root
 * `test` options do NOT cascade, so a single value at the top silently does
 * nothing. Confirmed by watching a test keep failing at six seconds with a
 * fifteen second value sitting in this file.
 */
const TEST_TIMEOUT = 15_000

// Vitest 4: the v2/v3 `test.workspace` field is gone and using it is a hard
// startup error. Multi-package setups use `test.projects`.
export default defineConfig({
  test: {
    // Records {line, column} for every test in the JSON report, so
    // verification-report.json can point at the exact test backing an invariant
    // rather than just naming it.
    includeTaskLocation: true,

    projects: [
      {
        root: './packages/core',
        test: {
          name: 'core',
          environment: 'node',
          include: ['test/**/*.test.ts'],
          setupFiles: ['../../vitest.setup.ts'],
          testTimeout: TEST_TIMEOUT,
        },
      },
      {
        root: './packages/daemon',
        test: {
          name: 'daemon',
          environment: 'node',
          include: ['test/**/*.test.ts'],
          setupFiles: ['../../vitest.setup.ts'],
          testTimeout: TEST_TIMEOUT,
        },
      },
      {
        root: './packages/ui',
        test: {
          name: 'ui',
          // The lock screen is a rendered surface, so it is tested by rendering
          // it. Asserting on props would test the test.
          environment: 'happy-dom',
          include: ['test/**/*.test.tsx'],
          testTimeout: TEST_TIMEOUT,
        },
      },
      {
        // The lint rules that enforce the invariants get their own regression
        // suite. A rule that silently stops matching is an invariant that
        // silently stopped being enforced.
        test: {
          name: 'lint-rules',
          environment: 'node',
          include: ['test/eslint-rules/**/*.test.ts'],
          testTimeout: TEST_TIMEOUT,
        },
      },
    ],
  },
})
