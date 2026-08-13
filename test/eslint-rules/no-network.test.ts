/**
 * INV-NET-2 regression suite.
 *
 * The lint rule is the only thing standing between this codebase and a network
 * call, so the rule itself needs tests. A rule that silently stops matching is
 * an invariant that silently stopped being enforced, and nothing else in the
 * build would notice.
 *
 * These cases are the adversarial ones: the forms someone would reach for after
 * a plain `import 'node:net'` got rejected.
 */

import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'
import { noNetwork } from '../../eslint-rules/no-network.js'

RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
})

ruleTester.run('nullroute/no-network (INV-NET-2)', noNetwork, {
  valid: [
    // Builtins that cannot open a socket are unaffected.
    { code: `import { createHash } from "node:crypto";` },
    { code: `import { readFile } from "node:fs/promises";` },
    { code: `import { Buffer } from "node:buffer";` },

    // A local binding named `fetch` shadows the global and is not our concern.
    { code: `const fetch = (k) => k; fetch("local");` },
    { code: `function f(fetch) { return fetch("shadowed"); }` },
    { code: `import { fetch } from "./local-cache.js"; fetch("k");` },

    // A method that happens to be named fetch.
    { code: `cache.fetch("a method named fetch is fine");` },
    { code: `this.fetch("also fine");` },

    // node:net inside the allowlisted IPC layer, where a Unix domain socket
    // legitimately needs it.
    {
      code: `import { createServer } from "node:net";`,
      filename: '/repo/packages/daemon/src/ipc/socket.ts',
      options: [{ allowUnixSocketIn: ['packages/daemon/src/ipc/'] }],
    },

    // fetch inside the allowlisted frontend transport. This is the browser's
    // half of the same loopback IPC layer: it POSTs to a same-origin proxy, and
    // the CSP's connect-src 'self' is what stops it reaching off the machine.
    {
      code: `await fetch("/ipc", { method: "POST" });`,
      filename: '/repo/packages/ui/src/lib/transport.ts',
      options: [{ allowFetchIn: ['packages/ui/src/lib/transport.ts'] }],
    },
    {
      code: `await globalThis.fetch("/ipc");`,
      filename: '/repo/packages/ui/src/lib/transport.ts',
      options: [{ allowFetchIn: ['packages/ui/src/lib/transport.ts'] }],
    },
  ],

  invalid: [
    // Every network-capable builtin, in both bare and node: form.
    { code: `import http from "node:http";`, errors: [{ messageId: 'bannedModule' }] },
    { code: `import https from "node:https";`, errors: [{ messageId: 'bannedModule' }] },
    { code: `import http2 from "node:http2";`, errors: [{ messageId: 'bannedModule' }] },
    { code: `import dgram from "node:dgram";`, errors: [{ messageId: 'bannedModule' }] },
    { code: `import dns from "node:dns";`, errors: [{ messageId: 'bannedModule' }] },
    { code: `import dns from "node:dns/promises";`, errors: [{ messageId: 'bannedModule' }] },
    { code: `import tls from "node:tls";`, errors: [{ messageId: 'bannedModule' }] },
    { code: `import http from "http";`, errors: [{ messageId: 'bannedModule' }] },
    { code: `import dns from "dns";`, errors: [{ messageId: 'bannedModule' }] },

    // Re-export, which is an import that a naive rule misses.
    { code: `export * from "node:http";`, errors: [{ messageId: 'bannedModule' }] },
    { code: `export { get } from "node:https";`, errors: [{ messageId: 'bannedModule' }] },

    // Dynamic import and require, the obvious ways around a static check.
    { code: `const m = await import("node:dns");`, errors: [{ messageId: 'bannedModule' }] },
    { code: `const d = require("node:dgram");`, errors: [{ messageId: 'bannedModule' }] },

    // Global fetch, in every spelling.
    { code: `fetch("https://example.com");`, errors: [{ messageId: 'bannedFetch' }] },
    { code: `globalThis.fetch("https://example.com");`, errors: [{ messageId: 'bannedFetch' }] },
    { code: `window.fetch("https://example.com");`, errors: [{ messageId: 'bannedFetch' }] },
    { code: `self.fetch("https://example.com");`, errors: [{ messageId: 'bannedFetch' }] },

    // node:net OUTSIDE the allowlist. This is the case that matters most: the
    // exemption exists for the IPC layer and must not leak anywhere else.
    {
      code: `import { connect } from "node:net";`,
      filename: '/repo/packages/core/src/entropy/dice.ts',
      options: [{ allowUnixSocketIn: ['packages/daemon/src/ipc/'] }],
      errors: [{ messageId: 'socketOutsideIpc' }],
    },
    {
      // Even inside the daemon, but outside the IPC directory.
      code: `import net from "node:net";`,
      filename: '/repo/packages/daemon/src/storage/store.ts',
      options: [{ allowUnixSocketIn: ['packages/daemon/src/ipc/'] }],
      errors: [{ messageId: 'socketOutsideIpc' }],
    },
    {
      // With no allowlist configured at all, node:net is banned everywhere.
      code: `import net from "node:net";`,
      errors: [{ messageId: 'socketOutsideIpc' }],
    },

    // fetch OUTSIDE the transport allowlist. This is the case that matters:
    // the exemption exists for one file and must not leak into the rest of the
    // frontend, where a component could otherwise call out directly.
    {
      code: `await fetch("https://example.com");`,
      filename: '/repo/packages/ui/src/screens/LockScreen.tsx',
      options: [{ allowFetchIn: ['packages/ui/src/lib/transport.ts'] }],
      errors: [{ messageId: 'bannedFetch' }],
    },
    {
      // An allowlist for fetch must not also permit a socket.
      code: `import net from "node:net";`,
      filename: '/repo/packages/ui/src/lib/transport.ts',
      options: [{ allowFetchIn: ['packages/ui/src/lib/transport.ts'] }],
      errors: [{ messageId: 'socketOutsideIpc' }],
    },
  ],
})
