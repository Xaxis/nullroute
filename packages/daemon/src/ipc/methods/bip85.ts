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
     * This returns key material, and it is the SECOND of the three exceptions
     * INV-KEY-1 makes, not the first. This comment used to point at
     * seed.reveal's exception, which is about the one screen that shows a
     * mnemonic so it can be written down; neither of that exception's two
     * gates applies here, and saying it did is how this went unexamined.
     *
     * The feature is legitimate and the material has to be shown: a child seed
     * you cannot write down is a child seed you cannot use. Two things bound
     * it. The derivation is hardened, so the master seed cannot be recovered
     * from a child. And a caller reaching this already holds an unlocked
     * wallet, so it could simply sign with it instead.
     *
     * What it must not be is a harvester. Unlimited derivation turns one
     * compromised moment on the frontend into every child this seed will ever
     * have, including indexes nobody has funded yet. The session caps how many
     * one unlock will produce. See Session.takeChildDerivation.
     *
     * Never persisted here: a child the user wants to keep is imported as a
     * wallet in its own right.
     */
    'bip85.derive': (request) => {
      const application = requireString(request, 'application')
      const index = requireNumber(request, 'index', 0)
      const seed = session.requireSeed()
      // Spent before deriving, so a caller out of budget is refused rather
      // than handed a child it then has to be trusted to forget.
      session.takeChildDerivation()

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
