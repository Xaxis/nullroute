/**
 * Session state: the seed, and the narrow window in which it may be shown.
 *
 * Spec: daemon.session
 *
 * INV-KEY-1 says key material never leaves this process. There is exactly one
 * exception, and it is unavoidable: during wallet creation the user has to
 * write the mnemonic down, which means seeing it. A device that never displayed
 * a seed would be a device from which no backup could be made.
 *
 * So the exception is made narrow, explicit, and stateful rather than being a
 * flag someone can pass:
 *
 *   - A mnemonic is revealable ONLY between generation and confirmation.
 *   - `seed.reveal` is refused once the user has confirmed they wrote it down.
 *   - It is refused outright for a seed that was loaded from storage rather
 *     than generated in this session. Once a wallet exists, its seed is never
 *     displayed again, and recovering it is a matter of the backup rather than
 *     of asking the device.
 *
 * Everything else on the IPC surface returns public material only. The test in
 * packages/daemon/test/ipc.test.ts asserts that by searching responses, and it
 * is written so this exception has to be deliberately granted before the seed
 * appears anywhere.
 */

import { type Network, type Secret, MAINNET, masterFingerprint } from '@nullroute/core'

/** Where the current seed came from, which decides whether it may be shown. */
export type SeedProvenance = 'generated' | 'imported' | 'loaded'

export interface WalletSession {
  readonly seed: Secret
  /**
   * Absent for a wallet loaded from the encrypted store, because only the seed
   * was ever sealed. Optional rather than an empty string so that every reader
   * has to decide what to do about it instead of silently handling '' as a
   * mnemonic with no words in it.
   */
  readonly mnemonic: string | undefined
  /** Registered multisig descriptors. Empty for a single-signature wallet. */
  registrations: string[]
  readonly provenance: SeedProvenance
  readonly fingerprint: string
  /** True until the user confirms they have written the mnemonic down. */
  confirmedBackup: boolean
}

export class SessionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SessionError'
  }
}

export class Session {
  #wallet: WalletSession | undefined
  #network: Network = MAINNET
  #unlocked = false

  get network(): Network {
    return this.#network
  }

  setNetwork(network: Network): void {
    if (this.#wallet !== undefined) {
      // The network is chosen at wallet creation and locked to the wallet. It
      // cannot be changed afterwards, because the same seed on a different
      // network is a different wallet, and switching would silently show
      // addresses nobody funded.
      throw new SessionError(
        'The network is fixed at wallet creation and cannot be changed afterwards. ' +
          'A different network derives different addresses from the same seed.'
      )
    }
    this.#network = network
  }

  get hasWallet(): boolean {
    return this.#wallet !== undefined
  }

  get unlocked(): boolean {
    return this.#unlocked
  }

  /** Fingerprint of the loaded wallet, or undefined when there is none. */
  get fingerprint(): string | undefined {
    return this.#wallet?.fingerprint
  }

  get backupConfirmed(): boolean {
    return this.#wallet?.confirmedBackup ?? false
  }

  /**
   * Load a seed into the session.
   *
   * Takes ownership: the previous seed, if any, is disposed here so that a
   * second wallet creation cannot leave the first one's bytes in memory.
   */
  load(seed: Secret, mnemonic: string, provenance: SeedProvenance): void {
    this.#wallet?.seed.dispose()
    this.#wallet = {
      seed,
      mnemonic,
      provenance,
      registrations: [],
      fingerprint: masterFingerprint(seed, this.#network),
      // A generated seed has not been written down yet. An imported one, by
      // definition, already exists on paper somewhere.
      confirmedBackup: provenance !== 'generated',
    }
    this.#unlocked = true
  }

  /**
   * Load a seed that came out of the encrypted store.
   *
   * Separate from `load` because there is no mnemonic to pass. Only the seed
   * was ever sealed, so a stored wallet can sign and can never be persuaded to
   * display its words again. That is the point rather than a limitation: it
   * means the one screen in this device that shows key material is reachable
   * exactly once in a wallet's life, at creation, and the `loaded` provenance
   * is what `revealMnemonic` refuses on.
   */
  loadFromStore(seed: Secret): void {
    this.#wallet?.seed.dispose()
    this.#wallet = {
      seed,
      mnemonic: undefined,
      provenance: 'loaded',
      registrations: [],
      fingerprint: masterFingerprint(seed, this.#network),
      // It came off disk, so it existed before this session and its backup is
      // not this session's business to assert either way.
      confirmedBackup: true,
    }
    this.#unlocked = true
  }

  /** Registered quorums, in registration order. */
  get registrations(): readonly string[] {
    return this.#wallet?.registrations ?? []
  }

  /**
   * Record a quorum, or replace an existing registration of the same one.
   *
   * Matching on the descriptor text is correct here because every descriptor
   * stored has passed through `withChecksum`, so the same quorum always
   * produces the same string. Two textually different descriptors describing
   * the same wallet register twice, which is harmless: the index they produce
   * is identical and duplicate addresses are recorded once.
   */
  addRegistration(descriptor: string): void {
    const wallet = this.#wallet
    if (wallet === undefined) throw new SessionError('No wallet is loaded.')
    if (!wallet.registrations.includes(descriptor)) wallet.registrations.push(descriptor)
  }

  /** Replace the whole list, as when loading one out of the store. */
  setRegistrations(descriptors: readonly string[]): void {
    const wallet = this.#wallet
    if (wallet === undefined) throw new SessionError('No wallet is loaded.')
    wallet.registrations = [...descriptors]
  }

  /** The seed, for operations that need it. Never serialised. */
  requireSeed(): Secret {
    const wallet = this.#wallet
    if (wallet === undefined) throw new SessionError('No wallet is loaded.')
    if (!this.#unlocked) throw new SessionError('The wallet is locked.')
    return wallet.seed
  }

  /**
   * The mnemonic, for display during creation only.
   *
   * This is the one exception to INV-KEY-1 and it is deliberately awkward to
   * reach. See the note at the top of this file.
   */
  revealMnemonic(): string {
    const wallet = this.#wallet
    if (wallet === undefined) throw new SessionError('No wallet is loaded.')

    if (wallet.provenance === 'loaded') {
      throw new SessionError(
        'This seed was loaded from storage and will not be displayed. A seed is shown once, ' +
          'when it is created, so it can be written down. Recovering it afterwards is what the ' +
          'backup is for.'
      )
    }
    if (wallet.confirmedBackup) {
      throw new SessionError(
        'You have already confirmed this seed was written down, so it will not be shown again.'
      )
    }
    if (wallet.mnemonic === undefined) {
      throw new SessionError('There is no mnemonic held for this wallet.')
    }
    return wallet.mnemonic
  }

  /**
   * The words, for checking one the user types back.
   *
   * Distinct from revealMnemonic on purpose: this is used AFTER backup is
   * confirmed, by seed.checkWord, which returns only a boolean. The words never
   * cross the IPC boundary through this path, and the caller cannot enumerate
   * them by guessing, because guessing a word IS the verification.
   */
  peekWordsForVerification(): readonly string[] {
    const wallet = this.#wallet
    if (wallet === undefined) throw new SessionError('No wallet is loaded.')
    if (wallet.mnemonic === undefined) {
      throw new SessionError(
        'This seed was loaded from storage, so there are no words held in this session to ' +
          'check against. Word checking is part of creating a wallet.'
      )
    }
    return wallet.mnemonic.split(' ')
  }

  /** Record that the user has written the mnemonic down. Irreversible. */
  confirmBackup(): void {
    const wallet = this.#wallet
    if (wallet === undefined) throw new SessionError('No wallet is loaded.')
    wallet.confirmedBackup = true
  }

  /**
   * Zeroize and forget everything, including the network.
   *
   * Resetting the network matters and is not tidiness. The network is chosen at
   * wallet creation and locked to that wallet; if it survived a lock, the NEXT
   * wallet created on this device would silently inherit it. Someone locking a
   * signet wallet and then setting up what they believe is a mainnet one would
   * get signet, with correct-looking addresses and no indication anywhere.
   *
   * Mainnet is the default because it is the one a user cannot arrive at by
   * accident: choosing a test network is then always a deliberate act.
   */
  lock(): void {
    this.#wallet?.seed.dispose()
    this.#wallet = undefined
    this.#unlocked = false
    this.#network = MAINNET
  }
}
