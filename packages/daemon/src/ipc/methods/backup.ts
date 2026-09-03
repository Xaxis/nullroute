/**
 * Encrypted backups of everything a seed alone cannot recreate.
 *
 * Cosigners, network and labels. Writing one, describing one from the outside,
 * and restoring it.
 *
 * One of thirteen tables that make up the IPC surface. See ipc/context.ts for
 * why they are tables rather than one switch.
 */

import { params, requireString, optionalString } from '../params.js'
import { createBackup, describeBackup, restoreBackup } from '../../store/backup.js'
import { type HandlerContext, type MethodTable } from '../context.js'

export function backupMethods(ctx: HandlerContext): MethodTable {
  const { state, session } = ctx

  return {
    /**
     * Write a backup of this wallet.
     *
     * Seedless unless asked otherwise, and the caller has to ask in so many
     * words. A backup carrying a seed is a second copy of the money under one
     * passphrase, which is a decision rather than a default.
     */
    'backup.create': (request) => {
      // A backup is a file, so an ephemeral seed may not go into one. The
      // seedless case is refused too: a watch-only backup of a wallet the
      // user asked not to record still records that the wallet existed, its
      // network, and its cosigners.
      session.assertPersistable()
      const includeSeed = params(request)['includeSeed'] === true
      const passphrase = requireString(request, 'passphrase')
      return {
        backup: createBackup(
          {
            network: session.network,
            registrations: session.registrations,
            label: optionalString(request, 'label', 'nullroute wallet'),
            ...(includeSeed ? { seed: session.requireSeed() } : {}),
          },
          passphrase,
          state.attestation.version
        ),
        includesSeed: includeSeed,
      }
    },

    /** What a backup says about itself, before anyone types a passphrase. */
    'backup.describe': (request) => {
      return describeBackup(requireString(request, 'backup'))
    },

    /**
     * Restore a backup into this session.
     *
     * A seedless backup restores a device that can derive and verify and
     * cannot sign, which is a legitimate thing to want and is reported back
     * so the UI can say which one happened.
     */
    'backup.restore': (request) => {
      const restored = restoreBackup(
        requireString(request, 'backup'),
        requireString(request, 'passphrase')
      )

      /*
       * THE DECRYPTED SEED IS OWNED FROM HERE, and disposed on every exit.
       *
       * restoreBackup returns a live Secret. The next line used to be an
       * unconditional session.setNetwork, which throws whenever a wallet is
       * already loaded, so restoring a seeded backup with a wallet open threw
       * AFTER the seed had been decrypted and left it un-zeroized. Repeatable,
       * one orphaned seed per call, and the caller saw a message about the
       * network being fixed, which reads as a refusal rather than as "a seed
       * was decrypted and abandoned". That is INV-KEY-2, on exactly the
       * throwing path INV-KEY-2 is about.
       *
       * Every test covering this called session.lock() first, which is why
       * nothing caught it.
       */
      let owned = restored.seed
      try {
        if (owned !== undefined) {
          /*
           * Close the open wallet first, the way wallets.unlock does. A seeded
           * restore REPLACES the wallet, so the network of the one being
           * closed is not a constraint on the one arriving, and leaving it
           * open was what made setNetwork throw.
           */
          session.lock()
          session.setNetwork(restored.network)
          session.loadFromStore(owned)
          // Ownership has passed to the session, which disposes it at the next
          // lock. Cleared so the catch below cannot zeroize a live seed.
          owned = undefined
          session.setRegistrations(restored.registrations)
        } else if (!session.hasWallet) {
          /*
           * A seedless backup carries a network, and may only set one when
           * there is no wallet to contradict it. With a wallet open the
           * network belongs to that wallet, and this restore is handing back
           * descriptors rather than replacing anything.
           */
          session.setNetwork(restored.network)
        }
      } catch (err) {
        owned?.dispose()
        throw err
      }

      // THE DESCRIPTORS, not just how many there were.
      //
      // A seedless restore has no wallet for the session to hold them in, so
      // they were counted and dropped. That made the documented promise of a
      // seedless backup false: it claimed to restore a device that could
      // verify addresses and recognise its quorums, and it restored a number.
      //
      // Returned to the caller instead. A descriptor needs no seed to be
      // useful: multisig.verifyAddress and multisig.addresses both work
      // without one, which is exactly the watch-only capability the format
      // was described as giving. Public by construction, so returning them
      // discloses nothing INV-KEY-1 protects.
      return {
        hasSeed: restored.hasSeed,
        label: restored.label,
        network: restored.network.id,
        registrations: restored.registrations.length,
        descriptors: restored.registrations,
        // Whether they went into the session or are only being shown. A
        // screen that said "your quorums are back" on a seedless restore
        // would be describing something that did not happen.
        loaded: restored.seed !== undefined,
        createdWith: restored.createdWith,
      }
    },
  }
}
