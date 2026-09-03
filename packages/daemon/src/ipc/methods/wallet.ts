/**
 * Public material derived from the open wallet.
 *
 * Fingerprints, xpubs, descriptors and addresses. Everything here is safe to
 * put on a screen and to photograph, which is the property that separates it
 * from seed.ts.
 *
 * One of thirteen tables that make up the IPC surface. See ipc/context.ts for
 * why they are tables rather than one switch.
 */

import {
  accountPath,
  descriptorChecksum,
  deriveAccountXpub,
  deriveAddresses,
  normalizePath,
  parseDescriptor,
  rootFromSeed,
  withChecksum,
} from '@nullroute/core'
import { params, requireString, requireNumber, requireScriptType, SCRIPT_TYPES } from '../params.js'
import { type HandlerContext, type MethodTable } from '../context.js'

export function walletMethods(ctx: HandlerContext): MethodTable {
  const { session } = ctx

  return {
    'wallet.fingerprint': () => {
      return { fingerprint: session.fingerprint }
    },

    /** Account-level extended public key. Public material only. */
    'wallet.xpub': (request) => {
      const scriptType = requireScriptType(request)
      const account = requireNumber(request, 'account', 0)
      const path = normalizePath(accountPath(scriptType, session.network, account))
      const derived = deriveAccountXpub(session.requireSeed(), session.network, path)
      return {
        xpub: derived.xpub,
        path: derived.path,
        masterFingerprint: derived.masterFingerprint,
        fingerprint: derived.fingerprint,
        scriptType,
        network: derived.network.id,
      }
    },

    /**
     * The canonical output descriptor for an account, with its checksum.
     *
     * This is what a user exports to a coordinator, and what makes the wallet
     * recoverable elsewhere (INV-INTEROP-1).
     */
    'wallet.descriptor': (request) => {
      const scriptType = requireScriptType(request)
      const account = requireNumber(request, 'account', 0)
      const change = params(request)['change'] === true
      const path = normalizePath(accountPath(scriptType, session.network, account))
      const derived = deriveAccountXpub(session.requireSeed(), session.network, path)

      // The origin records where this key sits under the master key, which is
      // what lets another wallet re-derive and sign.
      const origin = `[${derived.masterFingerprint}${path.slice(1)}]`
      const branch = change ? '1' : '0'
      const inner = `${origin}${derived.xpub}/${branch}/*`

      const body =
        scriptType === 'p2pkh'
          ? `pkh(${inner})`
          : scriptType === 'p2sh-p2wpkh'
            ? `sh(wpkh(${inner}))`
            : scriptType === 'p2wpkh'
              ? `wpkh(${inner})`
              : `tr(${inner})`

      const descriptor = withChecksum(body)
      return {
        descriptor,
        checksum: descriptorChecksum(body),
        scriptType,
        change,
        network: derived.network.id,
      }
    },

    /** A run of addresses, for the explorer and for verification. */
    'wallet.addresses': (request) => {
      const scriptType = requireScriptType(request)
      const account = requireNumber(request, 'account', 0)
      const change = params(request)['change'] === true
      const start = requireNumber(request, 'start', 0)
      const count = Math.min(requireNumber(request, 'count', 20), 200)

      const path = normalizePath(accountPath(scriptType, session.network, account))
      const root = rootFromSeed(session.requireSeed(), session.network)
      try {
        const accountKey = root.derive(path)
        const addresses = deriveAddresses(accountKey, {
          scriptType,
          network: session.network,
          change,
          start,
          count,
        })
        return {
          addresses: addresses.map((a) => ({
            address: a.address,
            path: `${path}/${a.path}`,
            index: Number(a.path.split('/')[1] ?? 0),
            // The user's own note, if a label file gave one for this address.
            // Browsing your own addresses is the other place BIP-329 says a
            // label earns its keep: it is what turns a column of identical
            // bech32 strings into ones you can tell apart.
            label:
              session.labels.find((entry) => entry.type === 'addr' && entry.ref === a.address)
                ?.label ?? null,
          })),
          scriptType,
          change,
        }
      } finally {
        root.wipePrivateData()
      }
    },

    /**
     * Confirm that an address belongs to this wallet, and say where.
     *
     * Answers the question a user actually has when a coordinator shows them
     * an address: is this mine? Searching rather than trusting is the point.
     */
    'wallet.verifyAddress': (request) => {
      const target = requireString(request, 'address').trim()
      const gapLimit = Math.min(requireNumber(request, 'gapLimit', 100), 1000)
      const account = requireNumber(request, 'account', 0)

      const root = rootFromSeed(session.requireSeed(), session.network)
      try {
        for (const scriptType of SCRIPT_TYPES) {
          const path = normalizePath(accountPath(scriptType, session.network, account))
          const accountKey = root.derive(path)
          for (const change of [false, true]) {
            const candidates = deriveAddresses(accountKey, {
              scriptType,
              network: session.network,
              change,
              start: 0,
              count: gapLimit,
            })
            const hit = candidates.find((c) => c.address === target)
            if (hit !== undefined) {
              return {
                found: true,
                address: target,
                path: `${path}/${hit.path}`,
                scriptType,
                change,
                network: session.network.id,
              }
            }
          }
        }
        return { found: false, address: target, searchedTo: gapLimit }
      } finally {
        root.wipePrivateData()
      }
    },

    /** Parse a descriptor someone pasted in, and report what it says. */
    'descriptor.parse': (request) => {
      const parsed = parseDescriptor(requireString(request, 'descriptor'))
      return {
        body: parsed.body,
        checksum: parsed.checksum,
        checksumValid: parsed.checksumValid,
        ranged: parsed.ranged,
        scriptKind: parsed.script.kind,
      }
    },
  }
}
