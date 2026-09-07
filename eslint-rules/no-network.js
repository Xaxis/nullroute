/**
 * INV-NET-2: no source file may reach the network.
 *
 * The device must have no code path that can open a socket to a non-loopback
 * address. That is a claim in docs/THREAT-MODEL.md, and a claim enforced by
 * convention is a claim that lasts until the first person in a hurry. So it is
 * enforced here instead.
 *
 * Deliberately written with pure AST and scope analysis rather than type
 * information, so the rule keeps working if type-aware linting is ever disabled
 * or the TypeScript version drifts out of typescript-eslint's supported range.
 *
 * `node:net` is handled separately from the rest. A Unix domain socket is not a
 * network socket, but it comes from the same module, and the daemon genuinely
 * needs it for IPC. Rather than let that blanket-exempt the module, the rule
 * takes an explicit path allowlist so the exemption is visible in
 * eslint.config.js and shows up in a diff when someone widens it.
 */

/** Modules whose only purpose is to talk to a network. Never allowed. */
const BANNED_MODULES = new Set([
  'node:https',
  'node:http2',
  'node:dgram',
  'node:dns',
  'node:dns/promises',
  'node:tls',
  // Bare specifiers resolve to the same builtins.
  'https',
  'http2',
  'dgram',
  'dns',
  'dns/promises',
  'tls',
])

/** Allowed only inside the paths named by the `allowUnixSocketIn` option. */
const SOCKET_MODULES = new Set(['node:net', 'net'])

/**
 * Allowed only inside the paths named by `allowLoopbackHttpIn`.
 *
 * `node:http` used to be in BANNED_MODULES with no way out, and that was right
 * until the device needed the one thing it could not do without: the frontend
 * is a page in a browser, a browser speaks HTTP and cannot open a Unix socket,
 * so something has to answer `fetch('/ipc')`. In development that is Vite. On
 * the device it is packages/daemon/src/bridge, which binds 127.0.0.1 as a
 * module constant.
 *
 * Gated by path rather than removed from the rule, and separately from
 * `node:net`, so the two exemptions cannot be widened by one edit. `node:https`
 * stays banned outright: a TLS client has no use on a machine with no route.
 */
const LOOPBACK_HTTP_MODULES = new Set(['node:http', 'http'])

/** @type {import('eslint').Rule.RuleModule} */
export const noNetwork = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'INV-NET-2: forbid network-capable node builtins and global fetch. ' +
        'node:net is permitted only in the allowlisted loopback IPC layer.',
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          allowUnixSocketIn: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Path substrings where node:net may be imported for Unix domain socket IPC.',
          },
          allowLoopbackHttpIn: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Path substrings where node:http may be imported, for the loopback bridge that ' +
              'serves the kiosk browser. The host it binds is a constant in that module, not ' +
              'something this rule can check, which is why the path list is short.',
          },
          allowFetchIn: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Path substrings where fetch may be called, for the frontend transport that ' +
              'reaches the loopback proxy. Same-origin only; the CSP is what constrains where ' +
              'it can actually reach.',
          },
        },
      },
    ],
    messages: {
      bannedModule:
        "INV-NET-2: importing '{{name}}' is forbidden. nullroute must not open sockets.",
      socketOutsideIpc:
        "INV-NET-2: '{{name}}' may only be imported in the loopback IPC layer. " +
        'If this file genuinely needs a Unix domain socket, add it to allowUnixSocketIn ' +
        'in eslint.config.js so the exemption is reviewable.',
      httpOutsideBridge:
        "INV-NET-2: '{{name}}' may only be imported in the loopback bridge. " +
        'If this file genuinely has to answer a browser on 127.0.0.1, add it to ' +
        'allowLoopbackHttpIn in eslint.config.js so the exemption is reviewable.',
      bannedFetch:
        'INV-NET-2: calling global fetch() is forbidden. nullroute must not perform network I/O.',
    },
  },

  create(context) {
    const options = context.options[0] ?? {}
    const allowUnixSocketIn = options.allowUnixSocketIn ?? []
    const allowLoopbackHttpIn = options.allowLoopbackHttpIn ?? []
    const allowFetchIn = options.allowFetchIn ?? []
    const filename = context.filename ?? context.getFilename()
    // Normalise so the allowlist can be written with forward slashes on any OS.
    const normalised = filename.replaceAll('\\', '/')
    const ipcAllowed = allowUnixSocketIn.some((frag) => normalised.includes(frag))
    const httpAllowed = allowLoopbackHttpIn.some((frag) => normalised.includes(frag))
    // The frontend's transport reaches a same-origin loopback proxy. INV-NET-2
    // permits an allowlisted IPC layer, and this is the browser's half of it.
    // Listed by path so the exemption is one place and shows up in a diff.
    const fetchAllowed = allowFetchIn.some((frag) => normalised.includes(frag))

    /**
     * @param {unknown} raw
     * @param {import('estree').Node} node
     */
    function checkSpecifier(raw, node) {
      if (typeof raw !== 'string') return
      const name = raw.trim()
      if (BANNED_MODULES.has(name)) {
        context.report({ node, messageId: 'bannedModule', data: { name } })
        return
      }
      if (SOCKET_MODULES.has(name) && !ipcAllowed) {
        context.report({ node, messageId: 'socketOutsideIpc', data: { name } })
      }
      if (LOOPBACK_HTTP_MODULES.has(name) && !httpAllowed) {
        context.report({ node, messageId: 'httpOutsideBridge', data: { name } })
      }
    }

    /**
     * True when `fetch` resolves to the global rather than a local binding.
     * A function parameter or local const named `fetch` is not our concern.
     * @param {import('estree').Node} node
     */
    function isGlobalFetch(node) {
      let scope = context.sourceCode.getScope(node)
      while (scope) {
        const variable = scope.variables.find((v) => v.name === 'fetch')
        if (variable) return variable.defs.length === 0
        scope = scope.upper
      }
      return true
    }

    return {
      ImportDeclaration(node) {
        checkSpecifier(node.source.value, node.source)
      },
      ExportNamedDeclaration(node) {
        if (node.source) checkSpecifier(node.source.value, node.source)
      },
      ExportAllDeclaration(node) {
        if (node.source) checkSpecifier(node.source.value, node.source)
      },
      ImportExpression(node) {
        if (node.source.type === 'Literal') checkSpecifier(node.source.value, node.source)
      },

      CallExpression(node) {
        const callee = node.callee

        // require("node:dgram")
        if (
          callee.type === 'Identifier' &&
          callee.name === 'require' &&
          node.arguments.length > 0 &&
          node.arguments[0]?.type === 'Literal'
        ) {
          checkSpecifier(node.arguments[0].value, node.arguments[0])
          return
        }

        // fetch(...)
        if (
          !fetchAllowed &&
          callee.type === 'Identifier' &&
          callee.name === 'fetch' &&
          isGlobalFetch(callee)
        ) {
          context.report({ node, messageId: 'bannedFetch' })
          return
        }

        // globalThis.fetch(...) / window.fetch(...) / self.fetch(...)
        if (
          !fetchAllowed &&
          callee.type === 'MemberExpression' &&
          !callee.computed &&
          callee.property.type === 'Identifier' &&
          callee.property.name === 'fetch' &&
          callee.object.type === 'Identifier' &&
          ['globalThis', 'window', 'self'].includes(callee.object.name)
        ) {
          context.report({ node, messageId: 'bannedFetch' })
        }
      },
    }
  },
}
