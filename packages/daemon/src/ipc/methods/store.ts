/**
 * The single-wallet store, which predates the registry.
 *
 * Kept because a daemon can still be run with one store and no registry, which
 * is what a throwaway signing session and most unit tests want.
 *
 * One of thirteen tables that make up the IPC surface. See ipc/context.ts for
 * why they are tables rather than one switch.
 */

import { requireString } from '../params.js'
import { type HandlerContext, type MethodTable } from '../context.js'

export function storeMethods(ctx: HandlerContext): MethodTable {
  const { session, requireStore, refuseLegacyStore } = ctx

  return {
    /**
     * Whether a wallet is stored, and how many attempts remain.
     *
     * Safe to call before unlocking, by design: the lock screen has to know
     * whether to ask for a passphrase or offer to create a wallet, and it has
     * to be able to say how close the device is to erasing itself.
     */
    'store.status': () => {
      const status = requireStore().status()
      return {
        exists: status.exists,
        failedAttempts: status.failedAttempts,
        attemptsRemaining: status.attemptsRemaining,
        destroyed: status.destroyed,
        maxAttempts: status.failedAttempts + status.attemptsRemaining,
      }
    },

    /**
     * Persist the wallet currently in the session.
     *
     * Refused before the mnemonic has been confirmed written down. Storing
     * first would mean a device that has a wallet and a user who does not
     * have the only thing that recovers it, and the failure would not surface
     * until the store was erased or the card died.
     */
    'store.create': (request) => {
      refuseLegacyStore('wallets.create')
      session.assertPersistable()
      if (!session.backupConfirmed) {
        throw new Error(
          'Confirm you have written the mnemonic down before saving the wallet to this device. ' +
            'It is the only thing that recovers it.'
        )
      }
      // The network is sealed with the seed. It is chosen once per wallet
      // and cannot be changed afterwards, and a stored wallet that came back
      // on the wrong one would show addresses that are not the user's.
      requireStore().create(
        session.requireSeed(),
        session.network,
        requireString(request, 'passphrase'),
        session.registrations
      )
      return { stored: true, network: session.network.id }
    },

    /**
     * Open the store and load the seed into the session.
     *
     * The mnemonic is NOT recovered here and cannot be: only the seed was
     * sealed. That is deliberate. A stored wallet can sign, and it can never
     * be persuaded to show its words again, so the one screen that displays
     * key material is reachable exactly once per wallet.
     */
    'store.unlock': (request) => {
      refuseLegacyStore('wallets.unlock')
      const wallet = requireStore().unlock(requireString(request, 'passphrase'))
      // Network first. `masterFingerprint` and every later derivation depend
      // on it, so loading the seed under the session's default and fixing the
      // network afterwards would produce a fingerprint for the wrong chain.
      session.setNetwork(wallet.network)
      session.loadFromStore(wallet.seed)
      session.setRegistrations(wallet.registrations)
      return {
        unlocked: true,
        registrations: wallet.registrations.length,
        fingerprint: session.fingerprint,
        network: {
          id: session.network.id,
          label: session.network.label,
          isMainnet: session.network.isMainnet,
        },
      }
    },

    /** Erase the wallet from this device. Irreversible without the mnemonic. */
    'store.destroy': () => {
      refuseLegacyStore('wallets.destroy')
      requireStore().destroy()
      session.lock()
      return { destroyed: true }
    },
  }
}
