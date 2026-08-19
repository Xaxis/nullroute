import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * The screen gallery build.
 *
 * Separate from packages/ui/vite.config.ts and deliberately so: this output is
 * a test harness and must not be confused with, or land beside, the bundle that
 * ships to the device. It writes to tools/screens/dist, which is gitignored and
 * outside every MANIFEST_ROOT.
 */
export default defineConfig({
  root: new URL('.', import.meta.url).pathname,
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
})
