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

/**
 * Which stored wallet the session is using, when it came from one.
 *
 * Absent for a wallet that has been generated or imported and not yet saved.
 * Every field here came from inside the ciphertext, so this is the authenticated
 * answer to "which wallet is about to sign", and it is what the signing screen
 * is told rather than anything the picker displayed.
 */
export interface ActiveWallet {
  readonly id: string
  readonly label: string
  readonly colour: string
}

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
  /** Absent until this wallet is saved to, or loaded from, the store. */
  active: ActiveWallet | undefined
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
  /**
   * True when this seed must never reach the disk.
   *
   * A property of the SESSION rather than of a request, so persistence cannot
   * be reached by a caller that simply forgets to pass a flag. Everything that
   * writes asks the session, and the session refuses. It is set once, at load,
   * and there is no way to clear it: the only exit is `lock`, which forgets the
   * seed. A mode that could be turned off would be a mode that a mis-tap turns
   * off.
   */
  #ephemeral = false
  /**
   * Whether a BIP-39 passphrase was applied to reach the loaded seed.
   *
   * Not the passphrase itself, which is never held: it is consumed deriving the
   * seed and forgotten. This is one bit, and it exists so a screen can say that
   * this wallet cannot be recovered from the mnemonic alone.
   */
  #bip39Passphrase = false

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
  load(
    seed: Secret,
    mnemonic: string,
    provenance: SeedProvenance,
    options: { readonly ephemeral?: boolean; readonly bip39Passphrase?: boolean } = {}
  ): void {
    this.#wallet?.seed.dispose()
    this.#ephemeral = options.ephemeral === true
    this.#bip39Passphrase = options.bip39Passphrase === true
    this.#wallet = {
      seed,
      mnemonic,
      provenance,
      registrations: [],
      fingerprint: masterFingerprint(seed, this.#network),
      // A generated seed has not been written down yet. An imported one, by
      // definition, already exists on paper somewhere.
      confirmedBackup: provenance !== 'generated',
      // Not yet saved anywhere, so it belongs to no stored wallet. Set by
      // `attachTo` once it has been sealed.
      active: undefined,
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
  loadFromStore(seed: Secret, active?: ActiveWallet): void {
    this.#wallet?.seed.dispose()
    // A seed that came off the disk is by definition already on the disk.
    this.#ephemeral = false
    // Whether a passphrase was used is a property of the stored wallet and is
    // set from its sealed hint by the caller, not inferred here.
    this.#bip39Passphrase = false
    this.#wallet = {
      seed,
      mnemonic: undefined,
      provenance: 'loaded',
      registrations: [],
      fingerprint: masterFingerprint(seed, this.#network),
      // It came off disk, so it existed before this session and its backup is
      // not this session's business to assert either way.
      confirmedBackup: true,
      active,
    }
    this.#unlocked = true
  }

  /**
   * Which stored wallet this session is using.
   *
   * The answer every screen showing money should be quoting. It is authenticated
   * because it came out of the ciphertext, unlike anything the picker rendered
   * before a passphrase was typed.
   */
  get active(): ActiveWallet | undefined {
    return this.#wallet?.active
  }

  /** Whether this seed is barred from reaching the disk. */
  get ephemeral(): boolean {
    return this.#ephemeral
  }

  /** Whether a BIP-39 passphrase was applied to reach this seed. */
  get bip39Passphrase(): boolean {
    return this.#bip39Passphrase
  }

  /**
   * Record that the loaded wallet was made with a BIP-39 passphrase.
   *
   * For a wallet coming out of the store, where the fact was recorded when it
   * was created and cannot be inferred from the seed. One bit, and it changes
   * nothing but what a screen says.
   */
  setBip39Passphrase(used: boolean): void {
    this.#bip39Passphrase = used
  }

  /**
   * Refuse anything that would write this seed down.
   *
   * Called by every persistence path rather than checked at one of them, so
   * adding a new way to write is a decision someone has to make on purpose.
   */
  assertPersistable(): void {
    if (this.#ephemeral) {
      throw new SessionError(
        'This wallet was loaded for one session only and nothing about it may be written to ' +
          'this device. Lock and load it again without that option if you want to keep it.'
      )
    }
  }

  /**
   * Bind the session's wallet to a stored one, after it has been sealed.
   *
   * Refuses to rebind. A session whose seed already belongs to one stored wallet
   * cannot be pointed at another without going through `lock`, because a device
   * that could would be one where the header names a wallet and the seed in
   * memory is a different one.
   */
  attachTo(active: ActiveWallet): void {
    const wallet = this.#wallet
    if (wallet === undefined) throw new SessionError('No wallet is loaded.')
    if (wallet.active !== undefined && wallet.active.id !== active.id) {
      throw new SessionError(
        `This session is using ${wallet.active.label}. Lock before switching wallets, so the ` +
          `seed in memory is always the one the screen names.`
      )
    }
    wallet.active = active
  }

  /** Update the name and colour after a rename, without rebinding. */
  relabel(label: string, colour: string): void {
    const wallet = this.#wallet
    if (wallet?.active === undefined) throw new SessionError('No stored wallet is loaded.')
    wallet.active = { id: wallet.active.id, label, colour }
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
    // Cleared with everything else. A stale flag would either bar a later
    // wallet from being saved or, worse, let an ephemeral one be saved.
    this.#ephemeral = false
    this.#bip39Passphrase = false
  }
}
