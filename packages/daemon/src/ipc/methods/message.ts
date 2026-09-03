/**
 * Signing and verifying a message with a wallet key.
 *
 * Proving control of an address without spending from it.
 *
 * One of thirteen tables that make up the IPC surface. See ipc/context.ts for
 * why they are tables rather than one switch.
 */

import { requireString, requireScriptType } from '../params.js'
import {
  reviewMessage,
  signMessage,
  signLegacyMessage,
  verifyMessage,
  verifyLegacyMessage,
} from '@nullroute/core'
import { type HandlerContext, type MethodTable } from '../context.js'

export function messageMethods(ctx: HandlerContext): MethodTable {
  const { session, activeWallet } = ctx

  return {
    /**
     * Read a message before anything signs it.
     *
     * The only method in this group today. core.message.bip322 implements the
     * commitment and the review; the transaction pair and the witness
     * encoding are not built, so there is deliberately no `message.sign` here
     * to call. A method that existed and threw would read as a broken feature
     * rather than an absent one.
     */
    'message.review': (request) => {
      return reviewMessage(requireString(request, 'message'))
    },

    /**
     * Prove control of an address by signing a message with it.
     *
     * Returns the address with the signature, because a BIP-322 signature is
     * meaningless without one: a verifier takes the address, the message and
     * the signature, and this device is the only thing that knows which
     * address a path produced.
     *
     * The review is run again here rather than trusted from an earlier call.
     * A caller that reviewed one message and signed another would produce a
     * proof over text nobody read, which is the entire risk on this path.
     */
    'message.sign': (request) => {
      const message = requireString(request, 'message')
      const scriptType = requireScriptType(request)
      const path = requireString(request, 'path')

      // Legacy is a DIFFERENT SCHEME, not a different encoding. It commits
      // to a magic string and the message rather than to a pair of
      // transactions, and a signature under one means nothing under the
      // other. Routed by script type here rather than by a flag the caller
      // passes, so there is no way to ask for one and receive the other.
      if (scriptType === 'p2pkh') {
        const signed = signLegacyMessage(session.requireSeed(), session.network, path, message)
        return { ...signed, scriptType, scheme: 'signmessage', activeWallet: activeWallet() }
      }

      const signed = signMessage(session.requireSeed(), session.network, scriptType, path, message)
      return { ...signed, scheme: 'bip322', activeWallet: activeWallet() }
    },

    /**
     * Check somebody else's proof that they control an address.
     *
     * NO SEED, and deliberately reachable with the wallet locked. The
     * question this answers arrives exactly where this device is useful and
     * a networked machine is not: a counterparty hands over an address and a
     * signature, and the laptop you would otherwise check it on is the one
     * you do not trust with the answer. Requiring an unlocked wallet would
     * mean typing a passphrase to perform a public computation.
     *
     * The scheme is chosen from the ADDRESS, never from a parameter. A
     * caller that could say "check this as legacy" could get a pass out of
     * the wrong verifier.
     */
    'message.verify': (request) => {
      const address = requireString(request, 'address').trim()
      const message = requireString(request, 'message')
      const signature = requireString(request, 'signature')

      const bip322 = verifyMessage(address, message, signature, session.network)
      if (bip322.scriptType !== 'p2pkh') return bip322

      // A legacy address, which BIP-322 explicitly leaves to the older
      // scheme. Checked there rather than reported as unsupported.
      return verifyLegacyMessage(address, message, signature, session.network)
    },
  }
}
