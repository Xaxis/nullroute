/**
 * INV-WALLET-1: the assurance tier boundary, enforced rather than promised.
 *
 * `packages/wallet` may import from `packages/core`. Never the reverse.
 *
 * The reason this matters is in docs/THREAT-MODEL.md: the wallet layer roughly
 * doubles the code on the device and most of that code parses data that arrived
 * from a machine on the internet. That is only an acceptable trade if removing
 * the wallet layer leaves a working signer, which is only true if nothing in
 * core or daemon ever reaches into it.
 *
 * A single import in the wrong direction silently converts the optional tier
 * into a required one, and nothing else in the build would notice.
 *
 * BY PATH AS WELL AS BY NAME. For most of this rule's life it compared the
 * specifier against the workspace's npm name and nothing else, so
 * `import ... from '@nullroute/daemon'` was refused and
 * `import ... from '../../../../packages/daemon/src/store/store.js'` was not.
 * The second resolves, type-checks and bundles: apps/web sets moduleResolution
 * "bundler" with no rootDir, and Next follows a relative path wherever it goes.
 * The regression suite did not catch it because every forbidden case in it was
 * written as a bare specifier, so the rule looked thoroughly tested for exactly
 * the half it implemented. A boundary this file calls "enforced rather than
 * promised" was one `../` away from not being enforced at all.
 *
 * The same rule covers two related boundaries:
 *   - `packages/core` must stay pure: no daemon, no ui, no bridge.
 *   - `apps/web` (the public website) must never import device code, so a
 *     change to a marketing page cannot alter what runs on the Pi.
 */

import { dirname, resolve } from 'node:path'

/**
 * Where each workspace lives, so a relative specifier can be judged by where it
 * lands rather than by how it is spelled.
 *
 * Written out rather than derived from the package name, because a workspace
 * that is ever renamed or moved must break this map loudly instead of quietly
 * resolving to a directory that is not there. wallet and bridge are phases 5
 * and 6 and do not exist yet; they are listed because the boundary has to be
 * enforced from the first commit that creates them, not from the one that
 * remembers to come back here.
 */
const WORKSPACE_DIR = {
  '@nullroute/core': 'packages/core',
  '@nullroute/daemon': 'packages/daemon',
  '@nullroute/ui': 'packages/ui',
  '@nullroute/verify': 'packages/verify',
  '@nullroute/wallet': 'packages/wallet',
  '@nullroute/bridge': 'packages/bridge',
}

/**
 * Which workspaces each area is forbidden to import from.
 * Keyed by a path fragment matched against the importing file.
 */
const FORBIDDEN = [
  {
    from: 'packages/core/',
    deny: ['@nullroute/wallet', '@nullroute/daemon', '@nullroute/ui', '@nullroute/bridge'],
    why: 'packages/core is the pure, lowest layer. It must run identically in Node and a browser, with zero I/O, so a reviewer can load it standalone and reproduce results.',
  },
  {
    from: 'packages/daemon/',
    deny: ['@nullroute/ui', '@nullroute/bridge'],
    why: 'The daemon is the trusted process. The UI is a rendering layer and the bridge runs on a networked machine.',
  },
  {
    from: 'packages/verify/',
    deny: ['@nullroute/wallet', '@nullroute/daemon', '@nullroute/ui', '@nullroute/bridge'],
    why: 'The verification CLI checks the tree. It must not depend on the things it checks.',
  },
  {
    from: 'apps/web/',
    deny: ['@nullroute/daemon', '@nullroute/wallet', '@nullroute/bridge', '@nullroute/ui'],
    why: 'nullroute.diy is a networked Next.js site that never ships to the device. Importing device code would fold the website into the artifact whose hash users check before entering a PIN. Render docs/ instead, or generate a static artifact.',
  },
]

/** @type {import('eslint').Rule.RuleModule} */
export const noCrossTierImport = {
  meta: {
    type: 'problem',
    docs: {
      description: 'INV-WALLET-1: enforce the direction of dependencies between assurance tiers.',
    },
    schema: [],
    messages: {
      wrongDirection: "INV-WALLET-1: '{{from}}' must not import '{{target}}'. {{why}}",
    },
  },

  create(context) {
    const filename = (context.filename ?? context.getFilename()).replaceAll('\\', '/')
    const area = FORBIDDEN.find((entry) => filename.includes(entry.from))
    if (!area) return {}

    /**
     * @param {unknown} raw
     * @param {import('estree').Node} node
     */
    function check(raw, node) {
      if (typeof raw !== 'string') return
      const target = raw.trim()
      // Match the package root and any subpath export of it.
      let hit = area.deny.find((pkg) => target === pkg || target.startsWith(`${pkg}/`))

      // And the same workspace reached by path. Resolved against the importing
      // file rather than matched as text, so `../../packages/daemon` and
      // `../x/../../packages/daemon` are the same import, which is what the
      // bundler thinks too.
      if (!hit && (target.startsWith('.') || target.startsWith('/'))) {
        const landed = resolve(dirname(filename), target).replaceAll('\\', '/')
        hit = area.deny.find((pkg) => {
          const dir = WORKSPACE_DIR[pkg]
          return dir !== undefined && (landed.includes(`/${dir}/`) || landed.endsWith(`/${dir}`))
        })
      }

      if (hit) {
        context.report({
          node,
          messageId: 'wrongDirection',
          data: { from: area.from.replace(/\/$/, ''), target: hit, why: area.why },
        })
      }
    }

    return {
      ImportDeclaration: (node) => check(node.source.value, node.source),
      ExportNamedDeclaration: (node) => {
        if (node.source) check(node.source.value, node.source)
      },
      ExportAllDeclaration: (node) => {
        if (node.source) check(node.source.value, node.source)
      },
      ImportExpression: (node) => {
        if (node.source.type === 'Literal') check(node.source.value, node.source)
      },
    }
  },
}
