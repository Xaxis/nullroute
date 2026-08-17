/**
 * The IPC method table.
 *
 * INV-KEY-1 lives here in practice: this is the boundary the frontend talks to,
 * and every method returns public data by construction. There is no method that
 * returns a private key, and no debug flag that enables one.
 *
 * The single exception is `seed.reveal`, which exists because a user has to
 * write their mnemonic down and therefore has to see it. It is gated by session
 * state rather than by a parameter, refused once backup is confirmed, and
 * refused outright for a seed loaded from storage. See packages/daemon/src/session.ts.
 *
 * Methods are deliberately coarse. A fine-grained API ("give me the root key",
 * "now derive") would put the composition of sensitive steps in the untrusted
 * caller. The daemon performs whole operations and returns their results.
 */

import {
  type ScriptType,
  Secret,
  accountPath,
  accountEntropy,
  combineEntropy,
  descriptorChecksum,
  deriveAccountXpub,
  deriveAddresses,
  deriveMultisigAddresses,
  encodePsbt,
  exportBundle,
  importCoordinatorFile,
  formatBtc,
  parsePsbt,
  detectPatterns,
  diceToEntropy,
  entropyToWords,
  isValidMnemonic,
  mnemonicToSeed,
  networkById,
  normalizePath,
  parseDescriptor,
  reviewTransaction,
  rootFromSeed,
  signTransaction,
  validateRolls,
  withChecksum,
} from '@nullroute/core'
import { randomBytes } from 'node:crypto'
import { type BootAttestation, abbreviateHash } from './boot/attestation.js'
import { type IpcHandler, type IpcRequest } from './ipc/socket.js'
import { Session } from './session.js'
import { buildOwnedIndex, changeLookup, signingPathsFor } from './psbt.js'
import { type WalletStore } from './store/store.js'
import {
  MAX_WALLETS,
  WALLET_COLOURS,
  WalletRegistry,
  type WalletColour,
} from './store/registry.js'
import { multisigAccountPath, reviewRegistration } from './multisig.js'
import { createBackup, describeBackup, restoreBackup } from './store/backup.js'

export interface DaemonState {
  readonly attestation: BootAttestation
  readonly session: Session
  /**
   * Where a wallet persists between sessions. Optional so that a daemon can be
   * run with no storage at all, which is what the browser-free unit tests and a
   * throwaway signing session both want.
   */
  readonly store?: WalletStore
  /**
   * Several wallets, each in its own directory.
   *
   * Optional alongside `store` so a daemon can still be run with a single
   * store, which is what the unit tests and a throwaway signing session want.
   * When present it is the only thing that touches persistence.
   */
  readonly registry?: WalletRegistry
}

function params(request: IpcRequest): Record<string, unknown> {
  const value = request.params
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function requireString(request: IpcRequest, key: string): string {
  const value = params(request)[key]
  if (typeof value !== 'string') {
    throw new Error(`Parameter "${key}" is required and must be a string.`)
  }
  return value
}

function optionalString(request: IpcRequest, key: string, fallback = ''): string {
  const value = params(request)[key]
  return typeof value === 'string' ? value : fallback
}

function requireNumber(request: IpcRequest, key: string, fallback?: number): number {
  const value = params(request)[key]
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  if (fallback !== undefined) return fallback
  throw new Error(`Parameter "${key}" is required and must be an integer.`)
}

const SCRIPT_TYPES: readonly ScriptType[] = ['p2pkh', 'p2sh-p2wpkh', 'p2wpkh', 'p2tr']

function requireScriptType(request: IpcRequest, key = 'scriptType'): ScriptType {
  const value = requireString(request, key)
  const found = SCRIPT_TYPES.find((s) => s === value)
  if (found === undefined) {
    throw new Error(`Unknown script type "${value}". Expected one of: ${SCRIPT_TYPES.join(', ')}.`)
  }
  return found
}

export function createHandler(state: DaemonState): IpcHandler {
  const { session } = state

  const requireStore = (): WalletStore => {
    if (state.store === undefined) {
      throw new Error('This daemon was started without storage, so nothing can be persisted.')
    }
    return state.store
  }

  const requireRegistry = (): WalletRegistry => {
    if (state.registry === undefined) {
      throw new Error('This daemon was started without storage, so nothing can be persisted.')
    }
    return state.registry
  }

  /** A wallet id from a request, validated before it reaches any path. */
  const requireWalletId = (request: IpcRequest): string => {
    const value = params(request)['id']
    if (!WalletRegistry.isId(value)) {
      throw new Error('That is not a wallet id.')
    }
    return value
  }

  const requireColour = (request: IpcRequest): WalletColour => {
    const value = params(request)['colour']
    const found = WALLET_COLOURS.find((colour) => colour === value)
    if (found === undefined) {
      throw new Error(`Unknown colour. Expected one of: ${WALLET_COLOURS.join(', ')}.`)
    }
    return found
  }

  /**
   * What every response naming a wallet says.
   *
   * Read off the session rather than off a request or a hint, so it is the
   * authenticated identity of the seed that is actually loaded.
   */
  const activeWallet = (): Record<string, unknown> | null => {
    const active = session.active
    if (active === undefined) return null
    return { id: active.id, label: active.label, colour: active.colour }
  }

  return async (request: IpcRequest): Promise<unknown> => {
    await Promise.resolve()

    switch (request.method) {
      // --- Attestation and device state --------------------------------
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

      case 'device.status':
        return {
          hasWallet: session.hasWallet,
          unlocked: session.unlocked,
          backupConfirmed: session.backupConfirmed,
          fingerprint: session.fingerprint ?? null,
          network: {
            id: session.network.id,
            label: session.network.label,
            isMainnet: session.network.isMainnet,
          },
        }

      case 'network.get':
        return {
          id: session.network.id,
          label: session.network.label,
          isMainnet: session.network.isMainnet,
        }

      case 'network.set': {
        session.setNetwork(networkById(requireString(request, 'id')))
        return {
          id: session.network.id,
          label: session.network.label,
          isMainnet: session.network.isMainnet,
        }
      }

      // --- Entropy collection -------------------------------------------
      /** Live accounting during dice entry. Takes rolls, returns counts only. */
      case 'entropy.account': {
        const rolls = optionalString(request, 'rolls')
        if (rolls.length > 0) validateRolls(rolls)
        return { accounting: accountEntropy(rolls), warnings: detectPatterns(rolls) }
      }

      /**
       * Turn dice rolls into a wallet.
       *
       * The mnemonic is NOT returned here. It is placed in the session and must
       * be asked for separately, so that the act of revealing a seed is one
       * explicit call rather than a side effect of creating a wallet.
       */
      case 'entropy.fromDice': {
        const rolls = requireString(request, 'rolls')
        const mixMachine = params(request)['mixMachine'] === true

        using diceEntropy = diceToEntropy(rolls)

        let entropy: Secret
        if (mixMachine) {
          // Mode B. The combiner's guarantee is that the result keeps full
          // entropy if ANY single source has it, so a compromised machine RNG
          // cannot weaken good dice. See docs/ENTROPY.md.
          using machine = Secret.fromBytes(randomBytes(32), 'urandom')
          entropy = combineEntropy([
            { id: 'dice', material: diceEntropy },
            { id: 'urandom', material: machine },
          ])
        } else {
          entropy = Secret.copyOf(diceEntropy.bytes, 'dice-entropy')
        }

        try {
          const mnemonic = entropyToWords(entropy)
          const seed = mnemonicToSeed(mnemonic, optionalString(request, 'passphrase'))
          session.load(seed, mnemonic, 'generated')
          return {
            fingerprint: session.fingerprint,
            wordCount: mnemonic.split(' ').length,
            mixedWithMachineEntropy: mixMachine,
          }
        } finally {
          entropy.dispose()
        }
      }

      case 'mnemonic.validate':
        return { valid: isValidMnemonic(requireString(request, 'mnemonic')) }

      /** Import an existing mnemonic. */
      case 'wallet.import': {
        const mnemonic = requireString(request, 'mnemonic')
        if (!isValidMnemonic(mnemonic)) {
          throw new Error(
            'That mnemonic is not valid: a word is not in the BIP-39 list, or the checksum does ' +
              'not match. A single mistyped word usually fails here. A mistyped word that still ' +
              'checksums produces a different wallet, so check the fingerprint.'
          )
        }
        const seed = mnemonicToSeed(mnemonic, optionalString(request, 'passphrase'))
        session.load(seed, mnemonic, 'imported')
        return { fingerprint: session.fingerprint }
      }

      // --- The one exception to INV-KEY-1 --------------------------------
      /**
       * Show the mnemonic so it can be written down.
       *
       * Valid only between generating a seed and confirming the backup. See the
       * note at the top of session.ts.
       */
      case 'seed.reveal': {
        const mnemonic = session.revealMnemonic()
        return {
          words: mnemonic.split(' '),
          fingerprint: session.fingerprint,
        }
      }

      case 'seed.confirmBackup': {
        session.confirmBackup()
        return { backupConfirmed: true }
      }

      /**
       * Check a word the user types back, without ever showing the rest.
       *
       * The verification step asks for a handful of words by position. This
       * compares one and returns a boolean, so the untrusted side never learns
       * a word it did not already have.
       */
      case 'seed.checkWord': {
        const index = requireNumber(request, 'index')
        const word = requireString(request, 'word').trim().toLowerCase()
        const words = session.peekWordsForVerification()
        const expected = words[index]
        if (expected === undefined) throw new Error(`Word index ${String(index)} is out of range.`)
        return { correct: expected === word }
      }

      // --- Wallet -------------------------------------------------------
      case 'wallet.fingerprint':
        return { fingerprint: session.fingerprint }

      /** Account-level extended public key. Public material only. */
      case 'wallet.xpub': {
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
      }

      /**
       * The canonical output descriptor for an account, with its checksum.
       *
       * This is what a user exports to a coordinator, and what makes the wallet
       * recoverable elsewhere (INV-INTEROP-1).
       */
      case 'wallet.descriptor': {
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
      }

      /** A run of addresses, for the explorer and for verification. */
      case 'wallet.addresses': {
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
            })),
            scriptType,
            change,
          }
        } finally {
          root.wipePrivateData()
        }
      }

      /**
       * Confirm that an address belongs to this wallet, and say where.
       *
       * Answers the question a user actually has when a coordinator shows them
       * an address: is this mine? Searching rather than trusting is the point.
       */
      case 'wallet.verifyAddress': {
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
      }

      // --- Descriptors ---------------------------------------------------
      /** Parse a descriptor someone pasted in, and report what it says. */
      case 'descriptor.parse': {
        const parsed = parseDescriptor(requireString(request, 'descriptor'))
        return {
          body: parsed.body,
          checksum: parsed.checksum,
          checksumValid: parsed.checksumValid,
          ranged: parsed.ranged,
          scriptKind: parsed.script.kind,
        }
      }

      // --- PSBT review and signing ---------------------------------------
      /**
       * Review a transaction. Reads nothing, signs nothing, changes nothing.
       *
       * Kept separate from signing on purpose. The user has to be able to look
       * at a transaction and walk away, and a combined method would mean the
       * act of looking carried the risk of signing.
       *
       * Every amount crosses this boundary as a decimal STRING. Satoshi amounts
       * are bigint in core because 21 million BTC in satoshis exceeds what a
       * double holds exactly, and `JSON.stringify` cannot serialise a bigint at
       * all. Converting to Number here would silently reintroduce the very
       * rounding the bigint exists to prevent, on the screen the user checks
       * before approving a payment.
       */
      case 'psbt.review': {
        const tx = parsePsbt(requireString(request, 'psbt'))
        const index = buildOwnedIndex(session.requireSeed(), session.network, {
          gapLimit: requireNumber(request, 'gapLimit', 100),
          registrations: session.registrations,
        })
        const review = reviewTransaction(tx, {
          network: session.network,
          isChange: changeLookup(index),
        })

        return {
          signable: review.signable,
          replaceable: review.replaceable,
          locktime: review.locktime,
          network: {
            id: review.network.id,
            label: review.network.label,
            isMainnet: review.network.isMainnet,
          },
          sighash: {
            type: review.sighash.type,
            name: review.sighash.name,
            meaning: review.sighash.meaning,
            acceptable: review.sighash.acceptable,
          },
          fee: {
            feeSats: review.fee.feeSats.toString(),
            feeBtc: formatBtc(review.fee.feeSats),
            totalInSats: review.fee.totalInSats.toString(),
            totalOutSats: review.fee.totalOutSats.toString(),
            vsize: review.fee.vsize,
            satsPerVbyte: review.fee.satsPerVbyte,
            percentOfSpend: review.fee.percentOfSpend,
          },
          inputs: review.inputs.map((i) => ({
            index: i.index,
            txid: i.txid,
            vout: i.vout,
            amountSats: i.amountSats.toString(),
            amountBtc: formatBtc(i.amountSats),
            sighashType: i.sighashType ?? null,
            derivationPath: i.derivationPath ?? null,
          })),
          outputs: review.outputs.map((o) => ({
            index: o.index,
            address: o.address ?? null,
            amountSats: o.amountSats.toString(),
            amountBtc: formatBtc(o.amountSats),
            kind: o.kind,
            changePath: o.changePath ?? null,
            changeRejectedBecause: o.changeRejectedBecause ?? null,
          })),
          warnings: review.warnings.map((w) => ({
            kind: w.kind,
            message: w.message,
            blocking: w.blocking,
          })),
          /** Which inputs this device can actually sign. Zero is not an error. */
          ownedInputs: signingPathsFor(
            Array.from({ length: tx.inputsLength }, (_, i) => inputScript(tx, i)),
            index,
            session.network
          ).length,
        }
      }

      /**
       * Sign. The irreversible one.
       *
       * The transaction is reviewed again here, from the same bytes, rather
       * than trusting a verdict the caller passed back. A caller that could
       * hand in its own review could sign anything, which would make every
       * check in review.ts advisory.
       */
      case 'psbt.sign': {
        const tx = parsePsbt(requireString(request, 'psbt'))
        const seed = session.requireSeed()
        const index = buildOwnedIndex(seed, session.network, {
          gapLimit: requireNumber(request, 'gapLimit', 100),
          registrations: session.registrations,
        })
        const review = reviewTransaction(tx, {
          network: session.network,
          isChange: changeLookup(index),
        })

        const paths = signingPathsFor(
          Array.from({ length: tx.inputsLength }, (_, i) => inputScript(tx, i)),
          index,
          session.network
        )
        if (paths.length === 0) {
          throw new Error(
            'None of this transaction’s inputs belong to this wallet, so there is ' +
              'nothing here for this device to sign.'
          )
        }

        const result = signTransaction(tx, seed, {
          network: session.network,
          paths,
          review,
          // Requires an explicit, per-call flag from the caller. It is never
          // persisted and there is no setting that turns it on.
          overrideBlockingWarnings: params(request)['overrideBlockingWarnings'] === true,
        })

        return {
          psbt: encodePsbt(result.psbt),
          inputsSigned: result.inputsSigned,
          signedWith: result.signedWith,
        }
      }

      // --- Multisig -------------------------------------------------------
      /**
       * This device's own multisig key, to hand to a coordinator.
       *
       * BIP-48 account, distinct from the single-signature branch so that using
       * one seed both alone and in a quorum does not link the two on chain.
       */
      case 'multisig.ourKey': {
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
      }

      /**
       * Review a quorum before agreeing to it. Registers nothing.
       *
       * Throws when this device holds no key in the descriptor, because there
       * is nothing useful to agree to in a quorum that does not contain you: it
       * would receive funds forever and never be able to spend them.
       */
      case 'multisig.review': {
        return reviewRegistration(
          requireString(request, 'descriptor'),
          session.requireSeed(),
          session.network,
          requireNumber(request, 'account', 0)
        )
      }

      /**
       * Agree to a quorum: verify it, hold it, and persist it if there is a
       * store open.
       *
       * Reviewed again here rather than trusting a verdict the caller passed
       * back. A caller that could register without review could register a
       * quorum this device is not in, which is the exact thing review exists to
       * prevent.
       */
      case 'multisig.register': {
        const registration = reviewRegistration(
          requireString(request, 'descriptor'),
          session.requireSeed(),
          session.network,
          requireNumber(request, 'account', 0)
        )
        session.addRegistration(registration.descriptor)

        // Persisted only when a passphrase is supplied, because re-sealing the
        // store needs one. A registration made without it lives for this
        // session, which is a legitimate choice and is reported back so the UI
        // can say so rather than implying it was saved.
        const passphrase = optionalString(request, 'passphrase')
        let persisted = false
        if (passphrase.length > 0 && state.store !== undefined) {
          state.store.reseal(
            session.requireSeed(),
            session.network,
            passphrase,
            session.registrations
          )
          persisted = true
        }
        return { ...registration, persisted }
      }

      /**
       * Read a coordinator's export and offer what it holds for registration.
       *
       * Reads only. Nothing is registered here, because importing a file and
       * agreeing to a quorum are different acts and the membership check
       * belongs to the second one.
       */
      case 'multisig.importFile': {
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
      }

      /** A bundle for the coordinator, in the shape Core's importdescriptors takes. */
      case 'multisig.exportBundle': {
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
      }

      /** Quorums this device has agreed to. */
      case 'multisig.registrations':
        return { descriptors: session.registrations }

      /** Addresses for a registered quorum. */
      case 'multisig.addresses': {
        const descriptor = parseDescriptor(requireString(request, 'descriptor'))
        const change = params(request)['change'] === true
        const start = requireNumber(request, 'start', 0)
        const count = Math.min(requireNumber(request, 'count', 20), 200)
        const derived = deriveMultisigAddresses(descriptor, {
          network: session.network,
          change,
          start,
          count,
        })
        return {
          addresses: derived.map((a) => ({ address: a.address, index: a.index })),
          change,
        }
      }

      // --- Persistence ----------------------------------------------------
      /**
       * Whether a wallet is stored, and how many attempts remain.
       *
       * Safe to call before unlocking, by design: the lock screen has to know
       * whether to ask for a passphrase or offer to create a wallet, and it has
       * to be able to say how close the device is to erasing itself.
       */
      case 'store.status': {
        const status = requireStore().status()
        return {
          exists: status.exists,
          failedAttempts: status.failedAttempts,
          attemptsRemaining: status.attemptsRemaining,
          destroyed: status.destroyed,
          maxAttempts: status.failedAttempts + status.attemptsRemaining,
        }
      }

      /**
       * Persist the wallet currently in the session.
       *
       * Refused before the mnemonic has been confirmed written down. Storing
       * first would mean a device that has a wallet and a user who does not
       * have the only thing that recovers it, and the failure would not surface
       * until the store was erased or the card died.
       */
      case 'store.create': {
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
      }

      /**
       * Open the store and load the seed into the session.
       *
       * The mnemonic is NOT recovered here and cannot be: only the seed was
       * sealed. That is deliberate. A stored wallet can sign, and it can never
       * be persuaded to show its words again, so the one screen that displays
       * key material is reachable exactly once per wallet.
       */
      case 'store.unlock': {
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
      }

      /** Erase the wallet from this device. Irreversible without the mnemonic. */
      case 'store.destroy': {
        requireStore().destroy()
        session.lock()
        return { destroyed: true }
      }

      // --- Several wallets --------------------------------------------------
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
      case 'wallets.list': {
        const registry = requireRegistry()
        return {
          // Migration happens here rather than at boot so a device that has
          // never been opened is not rewritten by a status poll.
          migrated: registry.hasLegacy() ? registry.migrateLegacy() : null,
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
          })),
          // Stated in the payload so a screen cannot forget to say it.
          verified: false,
          note:
            'Names, colours and networks here are read from files beside each wallet and are ' +
            'not verified until that wallet is unlocked.',
        }
      }

      /**
       * Save the wallet currently in the session as a new named wallet.
       *
       * Refused before the mnemonic is confirmed written down, for the same
       * reason `store.create` is: a device holding a wallet whose owner cannot
       * recover it is worse than a device holding nothing.
       */
      case 'wallets.create': {
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
        })
        session.attachTo({ id: created.id, label: created.label, colour })
        return { id: created.id, active: activeWallet() }
      }

      /**
       * Open one wallet, replacing whatever was open before.
       *
       * Locks first, unconditionally. Two seeds resident at once is the state
       * from which a device signs with the wrong one, and locking first also
       * means a failed unlock leaves nothing loaded rather than leaving the
       * previous wallet open under a header naming the one that failed.
       */
      case 'wallets.unlock': {
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
        session.setRegistrations(opened.registrations)

        return {
          unlocked: true,
          active: activeWallet(),
          fingerprint: session.fingerprint,
          registrations: opened.registrations.length,
          // True when the picker was showing something the ciphertext
          // disagreed with. A screen must tell the user rather than quietly
          // fixing it, because the picker just got caught being wrong.
          hintCorrected: opened.hintCorrected,
          network: {
            id: session.network.id,
            label: session.network.label,
            isMainnet: session.network.isMainnet,
          },
        }
      }

      /**
       * Change the open wallet's name or colour.
       *
       * Requires the passphrase, and deliberately does NOT count a wrong one
       * against the attempt budget. See WalletRegistry.rename: routing a
       * cosmetic change through the counting path would make choosing a
       * different colour a way to erase a wallet.
       */
      case 'wallets.rename': {
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
        })
        session.relabel(hint.label, hint.colour)
        return { active: activeWallet() }
      }

      /**
       * Erase the open wallet from this device.
       *
       * Only the open one. Erasing a wallet the user has not just proved they
       * can open is a way to destroy something they still needed, and requiring
       * it to be unlocked means the confirmation screen can name it from the
       * ciphertext rather than from a hint.
       */
      case 'wallets.destroy': {
        const registry = requireRegistry()
        const active = session.active
        if (active === undefined) {
          throw new Error('No stored wallet is open, so there is nothing to erase.')
        }
        registry.destroy(active.id)
        session.lock()
        return { destroyed: true, id: active.id }
      }

      // --- Backup and restore ---------------------------------------------
      /**
       * Write a backup of this wallet.
       *
       * Seedless unless asked otherwise, and the caller has to ask in so many
       * words. A backup carrying a seed is a second copy of the money under one
       * passphrase, which is a decision rather than a default.
       */
      case 'backup.create': {
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
      }

      /** What a backup says about itself, before anyone types a passphrase. */
      case 'backup.describe':
        return describeBackup(requireString(request, 'backup'))

      /**
       * Restore a backup into this session.
       *
       * A seedless backup restores a device that can derive and verify and
       * cannot sign, which is a legitimate thing to want and is reported back
       * so the UI can say which one happened.
       */
      case 'backup.restore': {
        const restored = restoreBackup(
          requireString(request, 'backup'),
          requireString(request, 'passphrase')
        )
        session.setNetwork(restored.network)
        if (restored.seed !== undefined) {
          session.loadFromStore(restored.seed)
          session.setRegistrations(restored.registrations)
        }
        return {
          hasSeed: restored.hasSeed,
          label: restored.label,
          network: restored.network.id,
          registrations: restored.registrations.length,
          createdWith: restored.createdWith,
        }
      }

      case 'session.lock': {
        session.lock()
        return { unlocked: false }
      }

      default:
        throw new Error(`Unknown method "${request.method}".`)
    }
  }
}

/**
 * An input's locking script, from whichever UTXO field the PSBT carries it in.
 *
 * A segwit input states its own script in `witnessUtxo`. A legacy input instead
 * carries the whole previous transaction, and the script is the one on the
 * output being spent. Undefined means the PSBT did not say, in which case the
 * device cannot tell whose input it is and treats it as not ours. That is the
 * safe direction: refusing to sign something unidentifiable beats guessing.
 */
function inputScript(tx: import('@scure/btc-signer').Transaction, i: number): Uint8Array | undefined {
  const input = tx.getInput(i)
  const witnessUtxo: unknown = input.witnessUtxo
  if (witnessUtxo !== undefined && witnessUtxo !== null) {
    const script: unknown = (witnessUtxo as { script?: unknown }).script
    if (script instanceof Uint8Array) return script
  }
  const nonWitness: unknown = input.nonWitnessUtxo
  if (nonWitness !== undefined && nonWitness !== null) {
    const outputs: unknown = (nonWitness as { outputs?: unknown }).outputs
    const vout: unknown = input.index
    if (Array.isArray(outputs) && typeof vout === 'number') {
      const out: unknown = outputs[vout]
      const script: unknown = (out as { script?: unknown } | undefined)?.script
      if (script instanceof Uint8Array) return script
    }
  }
  return undefined
}
