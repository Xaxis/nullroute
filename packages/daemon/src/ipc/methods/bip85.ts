/**
 * Child seeds, derived from this wallet.
 *
 * BIP-85. Makes another wallet from this one, recoverable from these words and
 * nothing else.
 *
 * One of thirteen tables that make up the IPC surface. See ipc/context.ts for
 * why they are tables rather than one switch.
 */

import { deriveBip85Hex, deriveBip85Mnemonic, deriveBip85Password } from '@nullroute/core'
import { requireString, requireNumber } from '../params.js'
import { type HandlerContext, type MethodTable } from '../context.js'

export function bip85Methods(ctx: HandlerContext): MethodTable {
  const { session } = ctx

  return {
    /**
     * A BIP-85 child.
     *
     * Returns the path with the child, always. The child is unrecoverable
     * without it, and a user who records only the words has recorded the half
     * their master mnemonic already implies.
     *
     * This returns key material, which is the exception INV-KEY-1 makes for
     * the one screen that has to show a mnemonic so it can be written down.
     * It is gated on an unlocked wallet and is never persisted here: a child
     * the user wants to keep is imported as a wallet in its own right.
     */
    'bip85.derive': (request) => {
      const application = requireString(request, 'application')
      const index = requireNumber(request, 'index', 0)
      const seed = session.requireSeed()

      switch (application) {
        case 'mnemonic':
          return deriveBip85Mnemonic(seed, requireNumber(request, 'wordCount', 24), index)
        case 'hex':
          return deriveBip85Hex(seed, requireNumber(request, 'bytes', 32), index)
        case 'password':
          return deriveBip85Password(seed, requireNumber(request, 'length', 32), index)
        default:
          throw new Error(
            `Unknown BIP-85 application "${application}". Expected mnemonic, hex or password.`
          )
      }
    },
  }
}
