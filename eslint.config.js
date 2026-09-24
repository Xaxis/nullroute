// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import nullroute from './eslint-rules/index.js'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.d.ts',
      '**/coverage/**',
      // Parallel sessions work in git worktrees under .claude/worktrees, each a
      // full second copy of this tree. Linted from here they have no type
      // information and report every file twice.
      '.claude/**',
      'apps/web/.next/**',
      'apps/web/.next-dev/**',
      'apps/web/out/**',
      'packages/ui/dist-app/**',
      // Build artifacts from `make image-system`: an exported Debian root
      // filesystem, which now contains the daemon's own compiled output and the
      // frontend bundle. Linting a copy of dist/ that happens to live inside an
      // image is 1,236 findings about minified vendor code and nothing about
      // this repository. Gitignored, and outside MANIFEST.lock.
      'out/**',
      // Generated deploy bundle: a copy of apps/web/out plus a config, emitted
      // by tools/build-vercel-output.mjs. Minified vendor code, not ours.
      '.vercel/**',
      // Fixtures that violate the rules on purpose. `npm run lint:prove` lints
      // them with --no-ignore and asserts the rules actually report. Permanent
      // coverage lives in test/eslint-rules/.
      'test/fixtures/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        // projectService resolves each file to its owning tsconfig, which is
        // what makes composite project references work without enumerating them.
        projectService: {
          allowDefaultProject: [
            '*.js',
            '*.mjs',
            'eslint-rules/*.js',
            'tools/*.mjs',
            // The provisioning verifiers. Plain ESM rather than TypeScript
            // because they are pointed at a build artifact by a build machine
            // that has node and nothing else, and the typed tests that exercise
            // them import from here.
            'provisioning/checks/*.mjs',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // ---------------------------------------------------------------------------
  // The device. Every rule below is an invariant from docs/THREAT-MODEL.md.
  // ---------------------------------------------------------------------------
  {
    files: ['packages/**/*.{ts,tsx}'],
    plugins: { nullroute },
    rules: {
      // INV-NET-2. node:net is allowed only in the daemon's IPC layer, because
      // a Unix domain socket is not a network socket but comes from the same
      // module. Widening this list is a reviewable change, which is the point.
      'nullroute/no-network': [
        'error',
        {
          allowUnixSocketIn: [
            'packages/daemon/src/ipc/',
            // The IPC layer's own test has to connect to the socket it is
            // testing. Listed here rather than disabled inline so the exemption
            // is one place, reviewable, and greppable.
            'packages/daemon/test/ipc.test.ts',
            // The bridge is the socket's only client on a device.
            'packages/daemon/src/bridge/',
            'packages/daemon/test/bridge.test.ts',
          ],
          // The browser's half of the same IPC layer. It POSTs to a same-origin
          // loopback proxy, which is the only channel the page has: the CSP
          // sets connect-src 'self', so this fetch cannot reach off the machine
          // even if the path were widened by accident.
          // The device's answer to `fetch('/ipc')`. A browser cannot open a
          // Unix socket, so one process has to speak both; it binds 127.0.0.1
          // as a module constant and its own spec is daemon.bridge.
          allowLoopbackHttpIn: [
            'packages/daemon/src/bridge/',
            'packages/daemon/test/bridge.test.ts',
          ],
          allowFetchIn: [
            'packages/ui/src/lib/transport.ts',
            // The bridge's own test has to be an HTTP client to the server it
            // is testing, the same exemption ipc.test.ts has for node:net.
            'packages/daemon/test/bridge.test.ts',
          ],
        },
      ],

      // INV-WALLET-1: dependency direction between assurance tiers.
      'nullroute/no-cross-tier-import': 'error',

      // No feature of this codebase needs a non-cryptographic RNG.
      'nullroute/no-weak-randomness': 'error',

      // A swallowed exception in a signing path is how someone signs a
      // transaction they did not review.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      // Silent coercions in byte-handling code hide real defects.
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',

      // `any` in code that handles key material defeats the type system exactly
      // where it is load-bearing.
      '@typescript-eslint/no-explicit-any': 'error',

      // Default exports make it harder to grep for who uses what, which matters
      // when auditing which call sites touch a secret.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportDefaultDeclaration',
          message: 'No default exports. Named exports keep call sites greppable.',
        },
      ],
    },
  },

  // The UI additionally must not generate its own entropy. See docs/ENTROPY.md.
  {
    files: ['packages/ui/**/*.{ts,tsx}'],
    plugins: { nullroute },
    rules: {
      'nullroute/no-weak-randomness': ['error', { banGetRandomValues: true }],

      // INV-UI-53. A verdict from the daemon is compared to true, never tested
      // for truthiness. This exact bug shipped three times, in three different
      // screens here, and every one failed open: a device failing verification
      // would have unlocked, a refused transaction would have been signable,
      // and an invalid proof would have read as checking out.
      //
      // THE FRONTEND ONLY, and the reason is worth stating rather than leaving
      // to the file list. `call<T>()` CASTS parsed JSON to an interface without
      // checking a single field, so every boolean here is the daemon's word
      // for it. The daemon does not have this problem because it validates at
      // its parse boundary instead: asReport in boot/attestation.ts refuses a
      // report whose `passed` is not typeof boolean, and by the time anything
      // reads it, it is one. Validating is the stronger fix and this rule is
      // the cheaper one, applied where the stronger one is not.
      'nullroute/no-truthy-verdict': 'error',

      // AND THEREFORE THIS ONE IS OFF, here and nowhere else. The two rules
      // disagree, and the disagreement is the point: `=== true` on something
      // TypeScript KNOWS is a boolean is redundant, and across this boundary
      // TypeScript does not know. The comparison is redundant exactly to the
      // extent that the type is trusted, which here is not at all.
      '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'off',
    },
  },

  // ---------------------------------------------------------------------------
  // nullroute.diy. A networked Next.js site that never ships to the device,
  // so the no-network rule does not apply. The tier rule still does: the site
  // must never import device code.
  // ---------------------------------------------------------------------------
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { nullroute },
    rules: {
      'nullroute/no-cross-tier-import': 'error',
    },
  },

  // Tests may reach for shapes the production rules forbid.
  {
    files: ['**/test/**/*.ts', '**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },

  // Build configuration, not device code. Vite requires a default export, and
  // the dev-server proxy legitimately opens the daemon's Unix socket: it is the
  // development stand-in for the local forwarder that runs beside the kiosk.
  {
    files: ['**/vite.config.ts', '**/vitest.config.ts'],
    rules: {
      'no-restricted-syntax': 'off',
      'nullroute/no-network': 'off',
    },
  },

  // Plain JS (the lint rules themselves, build tools): no type information.
  // These run under Node at build time, so they get Node's globals. Declared
  // explicitly rather than pulled from the `globals` package: it is one more
  // dependency for a list of six names.
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        // tools/ may use fetch and WebSocket: check-responsive.mjs drives a
        // local headless browser over the DevTools protocol. Note that the
        // no-network rule is scoped to packages/ and apps/, so this permission
        // stops at the build tooling and never reaches the device.
        fetch: 'readonly',
        WebSocket: 'readonly',
      },
    },
  }
)
