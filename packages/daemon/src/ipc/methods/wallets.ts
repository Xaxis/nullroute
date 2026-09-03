/**
 * Several wallets, each in its own directory.
 *
 * The registry, which is what a device with more than one wallet actually uses.
 * Creating, opening, renaming, re-keying and erasing.
 *
 * One of thirteen tables that make up the IPC surface. See ipc/context.ts for
 * why they are tables rather than one switch.
 */

import { MAX_WALLETS } from '../../store/registry.js'
import { requireString } from '../params.js'
import { type HandlerContext, type MethodTable } from '../context.js'

export function walletsMethods(ctx: HandlerContext): MethodTable {
  const { session, requireRegistry, requireWalletId, requireColour, activeWallet } = ctx

  return {
    /**
     * Every wallet this device holds.
     *
     * Safe before unlocking, and that is the whole difficulty: everything
     * here comes from the unsealed hint beside each blob, which anyone
     * holding the card can edit. The response says so in a field rather than
     * leaving a screen to remember, and no fingerprint is returned, because a
     * fingerprint nobody has verified displayed next to a name is the exact
     * shape of the mistake INV-UI-20 exists to prevent.
     */
    'wallets.list': () => {
      const registry = requireRegistry()
      // Migration happens here rather than at boot so a device that has never
      // been opened is not rewritten by a status poll.
      //
      // A failure must NOT take the listing with it. A legacy blob that
      // cannot be read (bad permissions, a truncated file, a card going bad)
      // would otherwise make every OTHER wallet on the device unreachable,
      // because the picker is the only way to any of them. So the failure is
      // reported alongside the list rather than instead of it. Not swallowed:
      // the message is returned and the screen shows it.
      let migrated: string | null = null
      let migrationError: string | null = null
      if (registry.hasLegacy()) {
        try {
          migrated = registry.migrateLegacy() ?? null
        } catch (err) {
          migrationError = (err as Error).message
        }
      }

      return {
        migrated,
        migrationError,
        max: MAX_WALLETS,
        active: activeWallet(),
        wallets: registry.list().map((entry) => ({
          id: entry.id,
          label: entry.hint.label,
          colour: entry.hint.colour,
          network: entry.hint.network,
          exists: entry.exists,
          attemptsRemaining: entry.attemptsRemaining,
          destroyed: entry.destroyed,
          // So a row can say this wallet needs its BIP-39 passphrase as well
          // as its store passphrase. Unverified like everything else here.
          bip39Passphrase: entry.hint.bip39Passphrase === true,
        })),
        // Stated in the payload so a screen cannot forget to say it.
        verified: false,
        note:
          'Names, colours and networks here are read from files beside each wallet and are ' +
          'not verified until that wallet is unlocked.',
      }
    },

    /**
     * Save the wallet currently in the session as a new named wallet.
     *
     * Refused before the mnemonic is confirmed written down, for the same
     * reason `store.create` is: a device holding a wallet whose owner cannot
     * recover it is worse than a device holding nothing.
     */
    'wallets.create': (request) => {
      session.assertPersistable()
      if (!session.backupConfirmed) {
        throw new Error(
          'Confirm you have written the mnemonic down before saving this wallet. It is the ' +
            'only thing that recovers it.'
        )
      }
      const registry = requireRegistry()
      const colour = requireColour(request)
      // The label that comes back is the one that was sealed, which may
      // differ from what was sent: the registry trims it and strips
      // characters that do not display. The session takes the sealed one, so
      // the chip on every screen and the ciphertext agree.
      const created = registry.create({
        seed: session.requireSeed(),
        network: session.network,
        passphrase: requireString(request, 'passphrase'),
        label: requireString(request, 'label'),
        colour,
        registrations: session.registrations,
        cosigners: session.cosigners,
        bip39Passphrase: session.bip39Passphrase,
      })
      session.attachTo({ id: created.id, label: created.label, colour })
      return { id: created.id, active: activeWallet() }
    },

    /**
     * Open one wallet, replacing whatever was open before.
     *
     * Locks first, unconditionally. Two seeds resident at once is the state
     * from which a device signs with the wrong one, and locking first also
     * means a failed unlock leaves nothing loaded rather than leaving the
     * previous wallet open under a header naming the one that failed.
     */
    'wallets.unlock': (request) => {
      const registry = requireRegistry()
      const id = requireWalletId(request)

      session.lock()

      const opened = registry.unlock(id, requireString(request, 'passphrase'))
      // Network first. Every derivation and the fingerprint depend on it.
      session.setNetwork(opened.network)
      session.loadFromStore(opened.seed, {
        id: opened.id,
        label: opened.label,
        colour: opened.colour,
      })
      // Whether this wallet needs a BIP-39 passphrase is a property of the
      // wallet, recorded when it was made, and the session has just been
      // cleared. Restored from the registry so the screen after this one can
      // say which kind of wallet just opened.
      session.setBip39Passphrase(
        registry.list().find((entry) => entry.id === id)?.hint.bip39Passphrase === true
      )
      session.setRegistrations(opened.registrations)
      // Sealed with the wallet, so they arrive with it. Dropping them here
      // would lose every cosigner name on the next reseal.
      session.setCosigners(opened.cosigners)

      return {
        unlocked: true,
        active: activeWallet(),
        // THE fingerprint, derived from the seed just loaded, and the only
        // signal a user gets that a BIP-39 passphrase was mistyped. A wrong
        // one opens a valid, different, empty wallet with no error anywhere,
        // so this is returned for prominent display rather than on request.
        fingerprint: session.fingerprint,
        registrations: opened.registrations.length,
        // True when the picker was showing something the ciphertext
        // disagreed with. A screen must tell the user rather than quietly
        // fixing it, because the picker just got caught being wrong.
        hintCorrected: opened.hintCorrected,
        // False for a wallet migrated from a v1 store, which sealed no name.
        // The screen must present the name as unconfirmed rather than as one.
        labelVerified: opened.labelVerified,
        bip39Passphrase: session.bip39Passphrase,
        network: {
          id: session.network.id,
          label: session.network.label,
          isMainnet: session.network.isMainnet,
        },
      }
    },

    /**
     * Change the open wallet's name or colour.
     *
     * Requires the passphrase, and deliberately does NOT count a wrong one
     * against the attempt budget. See WalletRegistry.rename: routing a
     * cosmetic change through the counting path would make choosing a
     * different colour a way to erase a wallet.
     */
    'wallets.rename': (request) => {
      const registry = requireRegistry()
      const active = session.active
      if (active === undefined) {
        throw new Error('No stored wallet is open, so there is nothing to rename.')
      }
      const label = requireString(request, 'label')
      const colour = requireColour(request)

      // Again the sealed label, not the requested one.
      const hint = registry.rename(active.id, {
        seed: session.requireSeed(),
        network: session.network,
        passphrase: requireString(request, 'passphrase'),
        label,
        colour,
        registrations: session.registrations,
        // Carried through. Renaming a wallet reseals it, and forgetting these
        // would erase every cosigner name the user had assigned as a side
        // effect of changing a colour.
        cosigners: session.cosigners,
      })
      session.relabel(hint.label, hint.colour)
      return { active: activeWallet() }
    },

    /**
     * Change the passphrase the open wallet is sealed under.
     *
     * WHAT IT CHANGES is what unlocks the file. The seed is untouched, so
     * every address, xpub and descriptor stays what it was and the mnemonic
     * still produces them. A BIP-39 passphrase is a different thing: it
     * feeds the seed derivation, so changing one produces a different
     * wallet. Nothing here can change that, and the screen says so, because
     * confusing the two would be catastrophic and irreversible.
     *
     * THE OLD ONE IS STILL REQUIRED even though the wallet is open, for the
     * reason renaming requires it: an open wallet is not proof that the
     * person at the device is the one who opened it.
     *
     * The session is NOT relocked afterwards. The seed did not change, so
     * relocking would be theatre that costs the user their place, and the
     * next lock uses the new passphrase like any other.
     */
    'wallets.passphrase': (request) => {
      const registry = requireRegistry()
      const active = session.active
      if (active === undefined) {
        throw new Error('No stored wallet is open, so there is nothing to change.')
      }

      registry.changePassphrase(active.id, {
        seed: session.requireSeed(),
        network: session.network,
        oldPassphrase: requireString(request, 'oldPassphrase'),
        newPassphrase: requireString(request, 'newPassphrase'),
        registrations: session.registrations,
        // Carried through, for the reason renaming carries them: this
        // reseals, and forgetting them would erase every cosigner name as a
        // side effect of changing a passphrase.
        cosigners: session.cosigners,
      })

      return { changed: true, active: activeWallet() }
    },

    /**
     * Erase the open wallet from this device.
     *
     * Only the open one. Erasing a wallet the user has not just proved they
     * can open is a way to destroy something they still needed, and requiring
     * it to be unlocked means the confirmation screen can name it from the
     * ciphertext rather than from a hint.
     */
    'wallets.destroy': () => {
      const registry = requireRegistry()
      const active = session.active
      if (active === undefined) {
        throw new Error('No stored wallet is open, so there is nothing to erase.')
      }
      registry.destroy(active.id)
      session.lock()
      return { destroyed: true, id: active.id }
    },

    /**
     * Remove the directory of a wallet whose seed is already gone.
     *
     * Exhausting the attempt counter erases the blob and leaves the
     * directory, which `wallets.destroy` cannot clear because that requires
     * the wallet to be open and an erased wallet cannot be opened. Without
     * this, eight erasures would fill the device permanently.
     */
    'wallets.forget': (request) => {
      const registry = requireRegistry()
      const id = requireWalletId(request)
      registry.forget(id)
      return { forgotten: true, id }
    },
  }
}
