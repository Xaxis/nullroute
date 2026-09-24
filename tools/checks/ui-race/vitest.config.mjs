import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// The UI suite, with @testing-library/react swapped for the delaying shim.
// See rtl-delay-shim.mjs for why. `make ui-race` runs it.
const shim = fileURLToPath(new URL('./rtl-delay-shim.mjs', import.meta.url))

export default defineConfig({
  resolve: { alias: [{ find: /^@testing-library\/react$/, replacement: shim }] },
  test: {
    root: fileURLToPath(new URL('../../../packages/ui', import.meta.url)),
    environment: 'happy-dom',
    include: ['test/**/*.test.tsx'],
    testTimeout: 15_000,
  },
})
