import { defineConfig } from 'vitest/config'

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
        },
      },
      {
        root: './packages/daemon',
        test: {
          name: 'daemon',
          environment: 'node',
          include: ['test/**/*.test.ts'],
          setupFiles: ['../../vitest.setup.ts'],
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
        },
      },
    ],
  },
})
