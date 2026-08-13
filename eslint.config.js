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
      'apps/web/.next/**',
      'apps/web/.next-dev/**',
      'apps/web/out/**',
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
          allowDefaultProject: ['*.js', '*.mjs', 'eslint-rules/*.js', 'tools/*.mjs'],
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
    },
  },

  // ---------------------------------------------------------------------------
  // nullroute.space. A networked Next.js site that never ships to the device,
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
