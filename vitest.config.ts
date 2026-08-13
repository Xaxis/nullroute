import { defineConfig } from 'vitest/config'

// Vitest 4: the v2/v3 `test.workspace` field is gone and using it is a hard
// startup error. Multi-package setups use `test.projects`.
export default defineConfig({
  test: {
    projects: [
      {
        root: './packages/core',
        test: { name: 'core', environment: 'node', include: ['test/**/*.test.ts'] },
      },
      {
        // The lint rules that enforce the invariants get their own regression
        // suite. A rule that silently stops matching is an invariant that
        // silently stopped being enforced.
        test: { name: 'lint-rules', environment: 'node', include: ['test/eslint-rules/**/*.test.ts'] },
      },
    ],
  },
})
