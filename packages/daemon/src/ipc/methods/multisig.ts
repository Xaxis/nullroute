/**
 * Quorums: assembling them, registering them, and spending from them.
 *
 * The largest of these tables, because a quorum has more states than a single
 * signature does: it is assembled, reviewed, registered, labelled, exported and
 * forgotten, and each of those is a separate act.
 *
 * One of thirteen tables that make up the IPC surface. See ipc/context.ts for
 * why they are tables rather than one switch.
 */

import {
  deriveAccountXpub,
  assembleQuorum,
  exportBundle,
  importCoordinatorFile,
  parseDescriptor,
} from '@nullroute/core'
import { multisigAccountPath, reviewRegistration } from '../../multisig.js'
import { params, requireString, optionalString, requireNumber } from '../params.js'
import { stripUndisplayable, type WalletColour } from '../../store/registry.js'
import { type HandlerContext, type MethodTable } from '../context.js'

export function multisigMethods(ctx: HandlerContext): MethodTable {
  const { state, session, quorumAddresses } = ctx

  return {
    /**
     * This device's own multisig key, to hand to a coordinator.
     *
     * BIP-48 account, distinct from the single-signature branch so that using
     * one seed both alone and in a quorum does not link the two on chain.
     */
    'multisig.ourKey': (request) => {
      const account = requireNumber(request, 'account', 0)
      const path = multisigAccountPath(session.network, account)
      const derived = deriveAccountXpub(session.requireSeed(), session.network, path)
      return {
        xpub: derived.xpub,
        path: derived.path,
        masterFingerprint: derived.masterFingerprint,
        // The form a coordinator actually wants to paste.
        keyExpression: `[${derived.masterFingerprint}/${derived.path.replace(/^m\//, '')}]${derived.xpub}`,
      }
    },

    /**
     * Review a quorum before agreeing to it. Registers nothing.
     *
     * Throws when this device holds no key in the descriptor, because there
     * is nothing useful to agree to in a quorum that does not contain you: it
     * would receive funds forever and never be able to spend them.
     */
    'multisig.review': (request) => {
      return reviewRegistration(
        requireString(request, 'descriptor'),
        session.requireSeed(),
        session.network,
        requireNumber(request, 'account', 0),
        session.cosigners
      )
    },

    /**
     * Agree to a quorum: verify it, hold it, and persist it if there is a
     * store open.
     *
     * Reviewed again here rather than trusting a verdict the caller passed
     * back. A caller that could register without review could register a
     * quorum this device is not in, which is the exact thing review exists to
     * prevent.
     */
    'multisig.register': (request) => {
      const registration = reviewRegistration(
        requireString(request, 'descriptor'),
        session.requireSeed(),
        session.network,
        requireNumber(request, 'account', 0),
        session.cosigners
      )
      // Persisted only when a passphrase is supplied, because re-sealing
      // needs one. A registration made without it lives for this session,
      // which is a legitimate choice and is reported back so the UI can say
      // so rather than implying it was saved.
      //
      // An ephemeral session registers for this session and never writes,
      // which is the same shape as omitting the passphrase and is reported
      // the same way. Checked rather than assumed: a registration names
      // cosigners, and a device asked to record nothing must record nothing.
      const passphrase = optionalString(request, 'passphrase')
      const active = session.active

      // The list that WOULD be sealed, built without touching the session.
      // Persisting must be able to fail without leaving a registration live
      // for signing that the user was told had not been saved.
      //
      // FROM THE SEALED LIST, not the live one. A quorum registered earlier
      // for this session only is in the live list and must not ride along
      // into the ciphertext because a different one was saved.
      const sealed = session.sealedRegistrations
      const next = sealed.includes(registration.descriptor)
        ? [...sealed]
        : [...sealed, registration.descriptor]
      const sealedCosigners = session.sealedCosigners

      let persisted = false
      if (passphrase.length > 0 && !session.ephemeral) {
        if (active !== undefined && state.registry !== undefined) {
          // The OPEN wallet, through the registry. Writing to state.store
          // addresses the legacy blob at the ROOT of the store directory,
          // which is not this wallet: on a migrated device that is a
          // different wallet's file, and re-sealing it would overwrite its
          // seed and spend its ten-attempt budget.
          //
          // Through rename, so the sealed identity is carried through. A
          // bare reseal writes no label, which would strip the wallet's name
          // out of the ciphertext and hand it back to the editable hint. It
          // also does not count a wrong passphrase, which is right here: the
          // wallet is already open, so there is nothing left to slow down.
          state.registry.rename(active.id, {
            seed: session.requireSeed(),
            network: session.network,
            passphrase,
            label: active.label,
            // Saving a quorum is not naming the wallet.
            sealLabel: active.labelVerified !== false,
            colour: active.colour as WalletColour,
            cosigners: sealedCosigners,
            registrations: next,
          })
          persisted = true
        } else if (state.registry === undefined && state.store !== undefined) {
          state.store.reseal(session.requireSeed(), session.network, passphrase, next)
          persisted = true
        } else {
          throw new Error(
            'No wallet is open, so there is nothing to save this registration to. Open a ' +
              'wallet first, or register without a passphrase to use it for this session only.'
          )
        }
      }

      // Only now. A registration reported as not saved must not be live.
      if (!persisted) session.holdUnsaved()
      session.addRegistration(registration.descriptor)
      if (persisted) session.recordSealed(next, sealedCosigners)
      return { ...registration, persisted }
    },

    /**
     * Read a coordinator's export and offer what it holds for registration.
     *
     * Reads only. Nothing is registered here, because importing a file and
     * agreeing to a quorum are different acts and the membership check
     * belongs to the second one.
     */
    /**
     * Build a quorum descriptor from a set of keys, here on the device.
     *
     * The piece that makes coordinator software optional. Until this existed
     * the device could hand out its own key and swallow a finished
     * descriptor, and nothing in between, so a fleet of air-gapped devices
     * needed a networked machine to CREATE the wallet they would then use
     * without one.
     *
     * Registers nothing. It returns a descriptor, and that descriptor still
     * goes through the same review as one from a coordinator, which is what
     * refuses a quorum this device holds no key in.
     */
    /**
     * Give one of the other keys in a quorum a name.
     *
     * A quorum screen otherwise lists anonymous extended keys, so on the
     * second device of three you are looking at two strings and trying to
     * remember which physical object each one is. The name is the user's own
     * and is never verified: it says nothing about who controls that key, and
     * both the response and every screen say so.
     *
     * Keyed by extended key, because position belongs to one descriptor and
     * the same device is the same device across every quorum it is in.
     *
     * Persisted only when a passphrase is supplied, because sealing needs
     * one, and reported either way so a screen can say whether it will
     * survive a reboot.
     */
    'multisig.labelCosigner': (request) => {
      const xpub = requireString(request, 'xpub')
      const label = optionalString(request, 'label')
      // Through the same stripping a wallet name gets, because this string
      // is rendered beside a key on the screen that agrees to a quorum. An
      // empty label clears the name rather than storing a blank one.
      const cleaned = label.trim().length === 0 ? '' : stripUndisplayable(label)
      // Kept explicit. session.labelCosigner threw this, and building the list
      // by hand below reads through a getter that answers [] with no wallet,
      // so the refusal has to be stated rather than fall out of a mutator.
      if (!session.hasWallet) {
        throw new Error('No wallet is loaded.')
      }

      /*
       * THE LIST THAT WOULD BE SEALED, BUILT WITHOUT TOUCHING THE SESSION.
       *
       * The third method in this file to need saying so. multisig.register says
       * it a hundred lines above, in these words: persisting must be able to
       * fail without leaving a change live that the user was told had not been
       * saved. This one named the cosigner in the session first and then called
       * rename, which verifies the passphrase and throws on a wrong one.
       *
       * So a typo threw, the user was told nothing was saved, and the name
       * stayed in the live session. The next write that DID succeed, for any
       * unrelated reason, carried session.cosigners into the ciphertext and
       * sealed it. Measured: label a cosigner with a wrong passphrase, watch it
       * throw, then rename the wallet correctly, and the name is in the
       * ciphertext having never been saved on purpose.
       *
       * Clearing a name has the same shape in the other direction: a failed
       * clear stays cleared in the session and the next successful write makes
       * the clearing permanent.
       */
      const rename = (
        list: readonly { readonly xpub: string; readonly label: string }[]
      ): { xpub: string; label: string }[] => {
        const without = list.filter((entry) => entry.xpub !== xpub)
        return cleaned.length === 0 ? without : [...without, { xpub, label: cleaned }]
      }
      const next = rename(session.cosigners)
      // What a save writes: this one name changed on top of what is SEALED,
      // not on top of unsaved names made earlier this session.
      const sealedNext = rename(session.sealedCosigners)
      const sealedRegistrations = session.sealedRegistrations

      const passphrase = optionalString(request, 'passphrase')
      const active = session.active
      let persisted = false
      if (
        passphrase.length > 0 &&
        !session.ephemeral &&
        active !== undefined &&
        state.registry !== undefined
      ) {
        state.registry.rename(active.id, {
          seed: session.requireSeed(),
          network: session.network,
          passphrase,
          label: active.label,
          // Saving a change is not naming the wallet.
          sealLabel: active.labelVerified !== false,
          colour: active.colour as WalletColour,
          registrations: [...sealedRegistrations],
          cosigners: sealedNext,
        })
        persisted = true
      }

      // Only now. A name reported as not saved must not be live for the next
      // write to pick up, and the next write reads the sealed view.
      if (!persisted) session.holdUnsaved()
      session.setCosigners(next)
      if (persisted) session.recordSealed(sealedRegistrations, sealedNext)

      return {
        cosigners: session.cosigners,
        persisted,
        verified: false,
        note:
          'A cosigner name is yours and is never checked. It says nothing about who controls ' +
          'that key: only the key itself does.',
      }
    },

    /**
     * Forget a registered quorum.
     *
     * A quorum registered by mistake was permanent, which is a strange thing
     * to be true of the step the documentation calls the dangerous one. A
     * descriptor with a typo in it, or one for a wallet somebody has stopped
     * using, sat there deciding which outputs this device calls change.
     *
     * WHAT THIS DOES NOT DO is lose money. A registration is not a key. What
     * it costs is that the device stops recognising that quorum's change as
     * its own, so change coming back from it reads on the review screen as a
     * payment to a stranger, which is alarming rather than dangerous and is
     * fixed by registering the descriptor again.
     *
     * Persisted only with a passphrase, like every other change to a sealed
     * wallet, and reported either way.
     */
    'multisig.forget': (request) => {
      const descriptor = requireString(request, 'descriptor')
      if (!session.hasWallet) {
        throw new Error('No wallet is loaded.')
      }

      /*
       * THE LIST THAT WOULD BE SEALED, BUILT WITHOUT TOUCHING THE SESSION, for
       * the reason multisig.register gives in the same words a hundred lines
       * above: persisting must be able to fail without leaving the session
       * disagreeing with the ciphertext.
       *
       * This method did the opposite. It removed the registration from the
       * session first and then called rename, which verifies the passphrase and
       * throws on a wrong one. So one mistyped passphrase took the quorum out of
       * the live session, left it in the sealed wallet, and made the removal
       * unretryable: the next attempt finds nothing to forget and says so. The
       * user has to lock and unlock to get back to a state where they can try
       * again, and until they do, the device does not recognise that quorum's
       * change as its own while the wallet on disk says it should.
       *
       * The register side is careful about exactly this and says "only now, a
       * registration reported as not saved must not be live". The same sentence
       * applies here with the words swapped.
       */
      const next = session.registrations.filter((entry) => entry !== descriptor)
      // What a save writes: the sealed list without this quorum, so an
      // unsaved registration made earlier is not sealed by forgetting another.
      const sealedNext = session.sealedRegistrations.filter((entry) => entry !== descriptor)
      const sealedCosigners = session.sealedCosigners
      if (next.length === session.registrations.length) {
        throw new Error(
          'This device has no registration matching that descriptor, so there is nothing to ' +
            'forget. A descriptor differing by one character is a different quorum.'
        )
      }

      const passphrase = optionalString(request, 'passphrase')
      const active = session.active
      let persisted = false
      if (
        passphrase.length > 0 &&
        !session.ephemeral &&
        active !== undefined &&
        state.registry !== undefined
      ) {
        state.registry.rename(active.id, {
          seed: session.requireSeed(),
          network: session.network,
          passphrase,
          label: active.label,
          // Saving a change is not naming the wallet.
          sealLabel: active.labelVerified !== false,
          colour: active.colour as WalletColour,
          registrations: sealedNext,
          cosigners: [...sealedCosigners],
        })
        persisted = true
      }

      // Only now. A removal that failed to persist must not have happened.
      if (!persisted) session.holdUnsaved()
      session.setRegistrations(next)
      if (persisted) session.recordSealed(sealedNext, sealedCosigners)

      return {
        forgotten: true,
        remaining: session.registrations.length,
        persisted,
        note:
          'Forgetting a quorum does not lose money. It means this device stops recognising ' +
          "that quorum's change as its own, so change from it will read as a payment to a " +
          'stranger until you register the descriptor again.',
      }
    },

    'multisig.assemble': (request) => {
      const raw = params(request)['keys']
      if (!Array.isArray(raw) || raw.some((key) => typeof key !== 'string')) {
        throw new Error('Parameter "keys" is required and must be an array of key expressions.')
      }
      const script = params(request)['script']
      return assembleQuorum({
        threshold: requireNumber(request, 'threshold', 2),
        keys: raw as string[],
        ...(script === 'sh-wsh' ? { script: 'sh-wsh' as const } : {}),
      })
    },

    'multisig.importFile': (request) => {
      const imported = importCoordinatorFile(requireString(request, 'contents'))
      return {
        format: imported.format,
        name: imported.name ?? null,
        unverifiedClaims: imported.unverifiedClaims,
        descriptors: imported.descriptors.map((entry) => ({
          descriptor: entry.descriptor,
          change: entry.change ?? null,
        })),
      }
    },

    /** A bundle for the coordinator, in the shape Core's importdescriptors takes. */
    'multisig.exportBundle': (request) => {
      const account = requireNumber(request, 'account', 0)
      const derived = deriveAccountXpub(
        session.requireSeed(),
        session.network,
        multisigAccountPath(session.network, account)
      )
      return {
        bundle: exportBundle({
          name: optionalString(request, 'name', 'nullroute'),
          network: session.network.id,
          descriptors: session.registrations.map((descriptor) => ({
            descriptor,
            // A registration covers both branches through its multipath, so
            // it is exported once rather than split into a claim about which
            // side it is.
            change: false,
          })),
          ourKey: {
            fingerprint: derived.masterFingerprint,
            path: derived.path,
            xpub: derived.xpub,
          },
        }),
      }
    },

    /** Quorums this device has agreed to. */
    /**
     * The registered quorums, and where this device sits in each.
     *
     * The position is the fleet answer to a question three identical Pis make
     * unavoidable: they all hold the same wallet, so they all show the same
     * wallet name, and nothing else on screen says which cosigner you are
     * holding. Recomputed from the seed rather than stored, because a stored
     * position is a number that can be wrong about the keys beside it.
     *
     * A descriptor that no longer resolves is listed with a null position and
     * the reason, rather than omitted. A quorum the device cannot place itself
     * in is exactly the thing a user needs to see.
     */
    'multisig.registrations': () => {
      const seed = session.requireSeed()
      return {
        descriptors: session.registrations,
        // The user's own names for the other keys, so a quorum stops being a
        // list of anonymous extended keys. Never verified: see
        // multisig.labelCosigner.
        cosignerLabels: session.cosigners,
        quorums: session.registrations.map((descriptor) => {
          try {
            const review = reviewRegistration(
              descriptor,
              seed,
              session.network,
              0,
              session.cosigners
            )
            return {
              descriptor,
              // The eight characters every device in this quorum compares.
              // Split out so a screen does not have to slice them out of a
              // 300 character line, which is a screen that gets it wrong once.
              checksum: descriptor.slice(descriptor.lastIndexOf('#') + 1),
              cosigners: review.cosigners,
              threshold: review.threshold,
              total: review.total,
              // One-based for display. Every screen that shows this says
              // "cosigner 2 of 3", and a zero-based number there would be a
              // number nobody could compare with anybody else out loud.
              ourPosition: review.ourPosition + 1,
              kind: review.kind,
              sorted: review.sorted,
              unreadable: null,
            }
          } catch (err) {
            return {
              descriptor,
              checksum: descriptor.slice(descriptor.lastIndexOf('#') + 1),
              cosigners: [],
              threshold: null,
              total: null,
              ourPosition: null,
              kind: null,
              sorted: null,
              unreadable: (err as Error).message,
            }
          }
        }),
      }
    },

    /** Addresses for a registered quorum. */
    'multisig.addresses': (request) => {
      const descriptor = parseDescriptor(requireString(request, 'descriptor'))
      const change = params(request)['change'] === true
      const start = requireNumber(request, 'start', 0)
      const count = Math.min(requireNumber(request, 'count', 20), 200)
      const derived = quorumAddresses(descriptor, change, start, count)
      return {
        addresses: derived.map((a) => ({ address: a.address, index: a.index })),
        change,
      }
    },

    /**
     * Does this address come out of that descriptor.
     *
     * The multisig counterpart to `wallet.verifyAddress`, and a separate
     * method rather than a flag on it, because the two answer genuinely
     * different questions. A quorum address does not derive from this device
     * alone by construction, so asking the single-signature verifier about
     * one answers no about something that is perfectly correct, and a screen
     * reporting that would teach somebody to ignore its only alarm.
     *
     * Both branches are searched, and the gap limit bounds the work. Not
     * found is not proof the address is wrong: it may simply be beyond the
     * limit, and the response says which was searched so a screen can say so
     * rather than implying a verdict.
     */
    'multisig.verifyAddress': (request) => {
      const descriptor = parseDescriptor(requireString(request, 'descriptor'))
      const target = requireString(request, 'address').trim()
      const gapLimit = Math.min(requireNumber(request, 'gapLimit', 100), 500)

      for (const change of [false, true]) {
        const derived = quorumAddresses(descriptor, change, 0, gapLimit)
        const hit = derived.find((entry) => entry.address === target)
        if (hit !== undefined) {
          return {
            found: true,
            address: target,
            index: hit.index,
            change,
            network: session.network.id,
          }
        }
      }

      return { found: false, address: target, searchedTo: gapLimit }
    },
  }
}
