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
  assembleQuorum,
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
  deriveBip85Hex,
  deriveBip85Mnemonic,
  deriveBip85Password,
  exportLabels,
  importLabels,
  reviewMessage,
  signMessage,
  signLegacyMessage,
  verifyMessage,
  verifyLegacyMessage,
} from '@nullroute/core'
import { randomBytes } from 'node:crypto'
import { checkEntropyHealth } from './entropy/health.js'
import { IdleClock, IDLE_WARN_SECONDS } from './idle.js'
import { DeviceIdentityStore } from './store/identity.js'
import { stripUndisplayable } from './store/registry.js'
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
  /**
   * What this physical device is called.
   *
   * Optional, because a daemon started without storage has nowhere to keep it,
   * and because a device with one wallet and no siblings does not need a name.
   */
  readonly identity?: DeviceIdentityStore
  /**
   * When the wallet closes itself because nobody is at the device.
   *
   * Optional so a daemon can be run without one, which is what a unit test
   * calling a single method wants. Absent means no idle lock, and the status
   * method says so rather than reporting a window that does not exist.
   */
  readonly idle?: IdleClock
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
   * Close the single-wallet surface once this device holds named wallets.
   *
   * The two APIs address different files: store.* works on the blob at the root
   * of the store directory, wallets.* on the per-wallet directories. Leaving
   * both open produced two distinct hazards. One seed could be sealed through
   * each under two passphrases, with the weaker governing the money and nothing
   * showing they were the same wallet, because the registry cannot see a store
   * written behind its back. And store.destroy reported destroyed:true having
   * removed nothing at all, which is the worst possible answer to "did you
   * erase my wallet".
   *
   * store.status is deliberately still allowed: it is read-only, it reports on
   * a file that will not exist, and the lock screen calls it before anything
   * else is known.
   */
  const refuseLegacyStore = (replacement: string): void => {
    if (state.registry === undefined) return
    throw new Error(
      `This device holds named wallets, so that operation would act on a file that is not ` +
        `one of them. Use ${replacement} instead.`
    )
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

    // Checked before dispatch, so a request arriving after the deadline finds
    // a locked wallet rather than being served by one that should already be
    // shut. The daemon also sweeps on a timer, because a frontend that has
    // crashed sends nothing at all and the seed must not outlive it either.
    if (state.idle?.expired() === true && session.hasWallet) {
      session.lock()
    }

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
        // Reported here, not only where it is set, so a screen entered later in
        // the session still knows nothing is being written.
        return {
          hasWallet: session.hasWallet,
          unlocked: session.unlocked,
          backupConfirmed: session.backupConfirmed,
          fingerprint: session.fingerprint ?? null,
          ephemeral: session.ephemeral,
          activeWallet: activeWallet(),
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

      /**
       * The health of this device's machine entropy sources.
       *
       * Asked for before offering a machine-only seed, and returned rather than
       * acted on: the screen has to be able to show the user what was and was
       * not observed. See docs/ENTROPY.md.
       */
      /**
       * What this device is called, and whether it has been named.
       *
       * Safe before unlocking, and deliberately so: "which of my three devices
       * is this" is the question you have at the moment you pick one up, which
       * is before any passphrase. Unauthenticated for the same reason, and the
       * response says so in a field rather than leaving a screen to remember.
       */
      case 'device.identity': {
        const stored = state.identity?.read() ?? null
        return {
          identity: stored,
          named: stored !== null,
          // Stated in the payload so a screen cannot forget it.
          verified: false,
          note:
            'This name is read from a file beside the wallets and is not verified. It decides ' +
            'nothing: it exists so you can tell one device from another.',
        }
      }

      /** Name this device, or rename it. */
      case 'device.setIdentity': {
        if (state.identity === undefined) {
          throw new Error('This daemon was started without storage, so it cannot be named.')
        }
        const colour = requireColour(request)
        return {
          identity: state.identity.write({
            name: requireString(request, 'name'),
            colour,
          }),
        }
      }

      case 'entropy.health':
        return checkEntropyHealth()

      /**
       * Roll a die, or several, using the device's generator.
       *
       * WHAT THIS IS AND IS NOT. The roll string it produces hashes exactly like
       * a hand-rolled one, so the arithmetic downstream stays checkable. What
       * is NOT checkable is the string itself: you did not watch these dice
       * land. A device that wanted to hand you a seed it had chosen would do it
       * exactly here, and the result would be indistinguishable from this.
       *
       * So this is machine entropy wearing a dice costume, and the screen says
       * so. It is offered because rolling 100 dice by hand is ten minutes and
       * some people will otherwise pick the first mode that is quick, and a
       * user who understands the trade is better served than one who does not
       * know there was one.
       *
       * REJECTION SAMPLING, not modulo. 256 is not divisible by 6, so `byte % 6`
       * makes 1 through 4 more likely than 5 and 6 by about 1.6 percent. That is
       * small and it is exactly the kind of quiet bias this project has no
       * business shipping. Bytes above 251 are discarded and re-drawn.
       */
      case 'entropy.rollDice': {
        const count = Math.min(Math.max(requireNumber(request, 'count', 1), 1), 100)
        const rolls: number[] = []
        while (rolls.length < count) {
          for (const byte of randomBytes(64)) {
            if (rolls.length >= count) break
            // 252 = 42 * 6. Anything above is discarded rather than folded in.
            if (byte >= 252) continue
            rolls.push((byte % 6) + 1)
          }
        }
        return {
          rolls: rolls.join(''),
          // Said in the payload so a screen cannot forget it.
          fromDevice: true,
          note:
            'These were generated by this device, not observed by you. The arithmetic that ' +
            'follows is still checkable; the rolls themselves are not.',
        }
      }

      /**
       * Mode C. A seed from the machine's CSPRNG, with no dice at all.
       *
       * This is what every other hardware wallet does by default, and it is the
       * mode whose failure prompted this project. It is not broken. It is
       * UNVERIFIABLE, which is different and, here, worse: nothing about the
       * result can be checked by hand, so the user is trusting the hardware
       * RNG, the kernel, and this code to have combined them honestly.
       *
       * Two things guard it. The health gates must pass, so a stuck generator
       * or an unseeded pool refuses rather than silently producing a weak seed.
       * And the caller has to pass `acknowledged: true`, which the screen only
       * sends after the user has read what they are giving up: this cannot be
       * reached by tapping through.
       */
      case 'entropy.fromMachine': {
        if (params(request)['acknowledged'] !== true) {
          throw new Error(
            'A machine-only seed cannot be checked by hand. Nothing about it is reproducible ' +
              'with a die and a laptop, which is the property that makes this device worth ' +
              'using. Confirm you understand that before it will be generated.'
          )
        }

        const health = checkEntropyHealth()
        if (!health.healthy) {
          const bad = health.checks.filter((check) => check.verdict !== 'ok')
          throw new Error(
            `This device cannot confirm its entropy sources are sound, so it will not generate ` +
              `a seed from them alone: ${bad.map((c) => `${c.name} (${c.verdict}), ${c.detail}`).join('; ')}. ` +
              `Roll dice instead, which does not depend on any of this.`
          )
        }

        // randomBytes, never Math.random, which is banned in this package. The
        // 32 bytes are 256 bits, the same width the dice path produces.
        using entropy = Secret.fromBytes(randomBytes(32), 'urandom')
        const mnemonic = entropyToWords(entropy)
        const seed = mnemonicToSeed(mnemonic, optionalString(request, 'passphrase'))
        session.load(seed, mnemonic, 'generated')
        return {
          fingerprint: session.fingerprint,
          wordCount: mnemonic.split(' ').length,
          // Said in the response so a screen cannot forget it.
          reproducible: false,
          note:
            'This seed came from the device and cannot be reproduced by hand. Your written ' +
            'mnemonic is the only record of it.',
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
        // Ephemeral is opt-in and set here, at load, because the session has no
        // way to turn it off afterwards. See Session.assertPersistable.
        const ephemeral = params(request)['ephemeral'] === true
        const bip39Passphrase = optionalString(request, 'passphrase').length > 0
        session.load(seed, mnemonic, 'imported', { ephemeral, bip39Passphrase })
        return {
          fingerprint: session.fingerprint,
          ephemeral,
          // The fingerprint is the ONLY signal that a passphrase was mistyped.
          // A wrong one produces a valid, different, empty wallet, so this is
          // returned for display rather than left to a caller to ask for.
          passphraseApplied: bip39Passphrase,
        }
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
          // Before signing, not after. A user on the second device of a 2-of-3
          // needs to know they are the last signature, or that they are not,
          // while deciding whether to sign at all.
          signatures: review.signatures,
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
            // The user's own note about this address, if a label file gave one.
            // Attached here rather than in core, because core has no idea what
            // a label is and should not learn: a label decides nothing about
            // whether an output is change, which is decided by re-deriving it.
            label:
              o.address === undefined
                ? null
                : (session.labels.find(
                    (entry) => entry.type === 'addr' && entry.ref === o.address
                  )?.label ?? null),
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
          // The fleet answer: does this signature finish the transaction, or
          // does it have to go to another device? Without this the user cannot
          // tell whether to broadcast or keep walking.
          signatures: result.signatures,
          wasAlreadySigned: result.wasAlreadySigned,
          // Present only when nothing else has to sign. A coordinator wants the
          // PSBT above; a node wants this. Both are returned rather than making
          // the user discover which they needed.
          ...(result.finalised === undefined ? {} : { finalised: result.finalised }),
          activeWallet: activeWallet(),
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
          requireNumber(request, 'account', 0),
          session.cosigners
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
        const next = session.registrations.includes(registration.descriptor)
          ? [...session.registrations]
          : [...session.registrations, registration.descriptor]

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
              colour: active.colour as WalletColour,
              cosigners: session.cosigners,
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
        session.addRegistration(registration.descriptor)
        return { ...registration, persisted }
      }

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
      case 'multisig.labelCosigner': {
        const xpub = requireString(request, 'xpub')
        const label = optionalString(request, 'label')
        // Through the same stripping a wallet name gets, because this string
        // is rendered beside a key on the screen that agrees to a quorum. An
        // empty label clears the name rather than storing a blank one.
        const cleaned = label.trim().length === 0 ? '' : stripUndisplayable(label)
        session.labelCosigner(xpub, cleaned)

        const passphrase = optionalString(request, 'passphrase')
        const active = session.active
        let persisted = false
        if (passphrase.length > 0 && !session.ephemeral && active !== undefined && state.registry !== undefined) {
          state.registry.rename(active.id, {
            seed: session.requireSeed(),
            network: session.network,
            passphrase,
            label: active.label,
            colour: active.colour as WalletColour,
            registrations: session.registrations,
            cosigners: session.cosigners,
          })
          persisted = true
        }

        return {
          cosigners: session.cosigners,
          persisted,
          verified: false,
          note:
            'A cosigner name is yours and is never checked. It says nothing about who controls ' +
            'that key: only the key itself does.',
        }
      }

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
      case 'multisig.forget': {
        const descriptor = requireString(request, 'descriptor')
        const removed = session.forgetRegistration(descriptor)
        if (!removed) {
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
            colour: active.colour as WalletColour,
            registrations: session.registrations,
            cosigners: session.cosigners,
          })
          persisted = true
        }

        return {
          forgotten: true,
          remaining: session.registrations.length,
          persisted,
          note:
            'Forgetting a quorum does not lose money. It means this device stops recognising ' +
            'that quorum\'s change as its own, so change from it will read as a payment to a ' +
            'stranger until you register the descriptor again.',
        }
      }

      case 'multisig.assemble': {
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
      }

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
      case 'multisig.registrations': {
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
      }

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
      }

      /** Erase the wallet from this device. Irreversible without the mnemonic. */
      case 'store.destroy': {
        refuseLegacyStore('wallets.destroy')
        requireStore().destroy()
        session.lock()
        return { destroyed: true }
      }

      // --- Message signing, labels and child seeds ---------------------------
      /**
       * Read a message before anything signs it.
       *
       * The only method in this group today. core.message.bip322 implements the
       * commitment and the review; the transaction pair and the witness
       * encoding are not built, so there is deliberately no `message.sign` here
       * to call. A method that existed and threw would read as a broken feature
       * rather than an absent one.
       */
      case 'message.review': {
        return reviewMessage(requireString(request, 'message'))
      }

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
      case 'message.sign': {
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

        const signed = signMessage(
          session.requireSeed(),
          session.network,
          scriptType,
          path,
          message
        )
        return { ...signed, scheme: 'bip322', activeWallet: activeWallet() }
      }

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
      case 'message.verify': {
        const address = requireString(request, 'address').trim()
        const message = requireString(request, 'message')
        const signature = requireString(request, 'signature')

        const bip322 = verifyMessage(address, message, signature, session.network)
        if (bip322.scriptType !== 'p2pkh') return bip322

        // A legacy address, which BIP-322 explicitly leaves to the older
        // scheme. Checked there rather than reported as unsupported.
        return verifyLegacyMessage(address, message, signature, session.network)
      }

      /**
       * Read a BIP-329 label file.
       *
       * Nothing is stored and nothing is trusted. Labels are text shown beside
       * things this device already recognised by re-deriving them, and the
       * response carries the lines that were dropped so a screen can say the
       * import was partial rather than leaving the user to notice.
       */
      case 'labels.import': {
        const result = importLabels(requireString(request, 'text'))
        // Held for this session when asked, so the review screen can show a
        // label beside an output. Not sealed: a label file can hold thousands
        // of entries about transactions this device has never seen, and
        // growing the encrypted blob without bound for something that decides
        // nothing is a bad trade.
        const load = params(request)['load'] === true
        if (load) session.setLabels(result.labels)
        return {
          labels: result.labels,
          skipped: result.skipped,
          loaded: load ? result.labels.length : 0,
          note:
            'Labels are text. Nothing here decides whether an address is yours: that is ' +
            'decided by re-deriving it from your seed.',
        }
      }

      /** Write a BIP-329 label file, byte identical for the same labels. */
      case 'labels.export': {
        const raw = params(request)['labels']
        if (!Array.isArray(raw)) {
          throw new Error('Parameter "labels" is required and must be an array.')
        }
        return { text: exportLabels(raw as Parameters<typeof exportLabels>[0]) }
      }

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
      case 'bip85.derive': {
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
      }

      /**
       * Save the wallet currently in the session as a new named wallet.
       *
       * Refused before the mnemonic is confirmed written down, for the same
       * reason `store.create` is: a device holding a wallet whose owner cannot
       * recover it is worse than a device holding nothing.
       */
      case 'wallets.create': {
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
          // Carried through. Renaming a wallet reseals it, and forgetting these
          // would erase every cosigner name the user had assigned as a side
          // effect of changing a colour.
          cosigners: session.cosigners,
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

      /**
       * Remove the directory of a wallet whose seed is already gone.
       *
       * Exhausting the attempt counter erases the blob and leaves the
       * directory, which `wallets.destroy` cannot clear because that requires
       * the wallet to be open and an erased wallet cannot be opened. Without
       * this, eight erasures would fill the device permanently.
       */
      case 'wallets.forget': {
        const registry = requireRegistry()
        const id = requireWalletId(request)
        registry.forget(id)
        return { forgotten: true, id }
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

      /**
       * A person touched the screen.
       *
       * The ONLY thing that resets the idle clock. Every other method is a
       * screen doing its work, and counting those would let a screen that
       * refreshes hold a seed in memory indefinitely, which is the exact
       * failure the idle lock exists to end.
       *
       * Returns the window so the frontend counts down from a number the
       * daemon owns rather than a copy of it, and so a change here cannot
       * leave a screen warning at the wrong moment.
       */
      case 'session.heartbeat': {
        state.idle?.touch()
        return {
          idle: state.idle === undefined ? null : { seconds: state.idle.seconds, warnAt: IDLE_WARN_SECONDS },
          unlocked: session.hasWallet,
        }
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
