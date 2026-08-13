/**
 * The IPC method table.
 *
 * INV-KEY-1 lives here in practice: this is the boundary the frontend talks to,
 * and every method returns public data by construction. There is no method that
 * returns a seed, a mnemonic or a private key, and there is no debug flag that
 * enables one.
 *
 * Methods are deliberately coarse. A fine-grained API ("give me the root key",
 * "now derive") would put the composition of sensitive steps in the untrusted
 * caller. The daemon performs whole operations and returns their results.
 */

import {
  type Network,
  deriveAccountXpub,
  masterFingerprint,
  mnemonicToSeed,
  isValidMnemonic,
  networkById,
  normalizePath,
  accountEntropy,
  detectPatterns,
  validateRolls,
} from '@nullroute/core'
import { type BootAttestation, abbreviateHash } from './boot/attestation.js'
import { type IpcHandler, type IpcRequest } from './ipc/socket.js'

export interface DaemonState {
  readonly attestation: BootAttestation
  /** Chosen at wallet creation and locked to the wallet. Never inferred. */
  network: Network
}

function requireString(params: unknown, key: string): string {
  const value = (params as Record<string, unknown> | null)?.[key]
  if (typeof value !== 'string') {
    throw new Error(`Parameter "${key}" is required and must be a string.`)
  }
  return value
}

export function createHandler(state: DaemonState): IpcHandler {
  return async (request: IpcRequest): Promise<unknown> => {
    // Nothing here awaits, but the interface is async so that a future method
    // touching hardware does not change the contract.
    await Promise.resolve()

    switch (request.method) {
      /** What the lock screen renders before unlock. */
      case 'attestation.get':
        return {
          rootHash: state.attestation.rootHash,
          rootHashShort: abbreviateHash(state.attestation.rootHash),
          specCount: state.attestation.specCount,
          invariantCount: state.attestation.invariantCount,
          tier: state.attestation.tier,
          version: state.attestation.version,
          checks: state.attestation.checks,
        }

      case 'network.get':
        return { id: state.network.id, label: state.network.label, isMainnet: state.network.isMainnet }

      case 'network.set': {
        state.network = networkById(requireString(request.params, 'id'))
        return { id: state.network.id, label: state.network.label, isMainnet: state.network.isMainnet }
      }

      /** Live accounting during dice entry. Takes rolls, returns counts only. */
      case 'entropy.account': {
        const rolls = requireString(request.params, 'rolls')
        validateRolls(rolls)
        return {
          accounting: accountEntropy(rolls),
          warnings: detectPatterns(rolls),
        }
      }

      case 'mnemonic.validate':
        return { valid: isValidMnemonic(requireString(request.params, 'mnemonic')) }

      /**
       * The fingerprint of a mnemonic plus passphrase.
       *
       * This is the method the UI calls before anything involving funds. A
       * wrong passphrase produces a valid, different, empty wallet with no
       * error, and this number is the only signal the user gets.
       */
      case 'wallet.fingerprint': {
        const mnemonic = requireString(request.params, 'mnemonic')
        const passphrase = (request.params as { passphrase?: string }).passphrase ?? ''
        using seed = mnemonicToSeed(mnemonic, passphrase)
        return { fingerprint: masterFingerprint(seed, state.network) }
      }

      /** Public material only. The returned object never held a private key. */
      case 'wallet.xpub': {
        const mnemonic = requireString(request.params, 'mnemonic')
        const passphrase = (request.params as { passphrase?: string }).passphrase ?? ''
        const path = normalizePath(requireString(request.params, 'path'))
        using seed = mnemonicToSeed(mnemonic, passphrase)
        const account = deriveAccountXpub(seed, state.network, path)
        return {
          xpub: account.xpub,
          path: account.path,
          masterFingerprint: account.masterFingerprint,
          fingerprint: account.fingerprint,
          depth: account.depth,
          network: account.network.id,
        }
      }

      default:
        throw new Error(`Unknown method "${request.method}".`)
    }
  }
}
