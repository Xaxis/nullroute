/**
 * Session state: the seed, and the narrow window in which it may be shown.
 *
 * Spec: daemon.session
 *
 * INV-KEY-1 says key material never leaves this process. THREE methods return
 * some, and this used to say one. Each is deliberate, each is a different
 * thing, and the count being wrong is what let the second and third go
 * unexamined for as long as they did.
 *
 * 1. `seed.reveal`, the unavoidable one. During wallet creation the user has
 *    to write the mnemonic down, which means seeing it: a device that never
 *    displayed a seed is a device from which no backup can be made. Narrow,
 *    explicit and stateful rather than a flag someone can pass:
 *
 *      - Revealable ONLY between generation and confirmation.
 *      - Refused once the user has confirmed they wrote it down.
 *      - Refused outright for a seed loaded from storage rather than generated
 *        in this session. Once a wallet exists its seed is never shown again,
 *        and recovering it is a matter of the backup.
 *
 *    `seed.checkWord` belongs to this one: it returns a boolean rather than a
 *    word, but a boolean asked 2048 times is the word, so it carries the same
 *    gates plus a budget. See peekWordsForVerification.
 *
 * 2. `bip85.derive`, which returns a CHILD mnemonic. Writing it down is the
 *    entire point of BIP-85, so refusing to show it would remove the feature
 *    rather than protect anything. Two things bound it: the derivation is
 *    hardened, so the master seed cannot be recovered from a child, and a
 *    caller reaching this already holds an unlocked wallet and could simply
 *    sign with it. What it must not be is a harvester, so the number of
 *    distinct children a session will derive is capped. See
 *    `takeChildDerivation`.
 *
 * 3. `backup.create` with `includeSeed`, which seals the seed under a
 *    passphrase the caller chooses. Explicit, flagged in the response, and
 *    guarded by `assertPersistable`. It is the one the user is warned about
 *    on screen, in the words "a second copy of your money".
 *
 * Everything else on the IPC surface returns public material only. The test in
 * packages/daemon/test/ipc.test.ts asserts that by searching the responses of
 * every method, and it is written so each of these has to be deliberately
 * granted before key material appears anywhere.
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
  /**
   * False when the label is the placeholder for a wallet that sealed no name.
   *
   * Carried so a reseal that is not a rename can leave the name unsealed. A
   * passphrase change or a saved quorum wrote "Unconfirmed wallet" into the
   * ciphertext, and the next unlock presented the placeholder as the wallet's
   * verified name. Absent means verified: a wallet made on this device was
   * named by its owner.
   */
  readonly labelVerified?: boolean
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
  /**
   * Names the user gave the OTHER keys in their quorums, by extended key.
   *
   * In the session because they are sealed with the wallet and have to be
   * rewritten with it: a rename or a new registration reseals, and dropping
   * them there would silently lose every name the user had assigned.
   */
  cosigners: { xpub: string; label: string }[]
  /**
   * What the sealed wallet holds, while it differs from the two lists above.
   *
   * Undefined means the ciphertext and the session agree. It is set only by a
   * change the user was told is NOT saved, a registration, a forgotten quorum
   * or a cosigner name made without a passphrase, and every later reseal
   * writes this instead of the live lists. Without it, renaming the wallet or
   * changing its passphrase sealed whatever the session held, so a quorum the
   * screen had called "for this session only" became permanent as a side
   * effect of a colour change.
   *
   * Defined as a difference rather than kept for every wallet so that a load
   * path which forgets to set it errs towards writing the live lists, which is
   * the old behaviour, and never towards dropping what is already sealed.
   */
  sealed?:
    | {
        registrations: string[]
        cosigners: { xpub: string; label: string }[]
      }
    | undefined
  /**
   * BIP-329 labels loaded for this session.
   *
   * NOT sealed with the wallet, unlike cosigner names, and the difference is
   * deliberate. A cosigner name is a handful of strings the user typed on this
   * device. A label file arrives from software this device knows nothing about
   * and can hold thousands of entries about transactions the device has never
   * seen, so sealing them would grow the encrypted blob without bound for
   * something that decides nothing.
   *
   * The cost is that they are gone at the next lock, and the screen says so.
   */
  labels: { type: string; ref: string; label: string }[]
  readonly provenance: SeedProvenance
  readonly fingerprint: string
  /** True until the user confirms they have written the mnemonic down. */
  confirmedBackup: boolean
  /**
   * Wrong answers left before word checking closes for this session.
   *
   * See peekWordsForVerification. A budget rather than a rate limit, because
   * there is no legitimate use that needs many: the screen asks for three
   * positions and a person mistypes a word or two.
   */
  wordChecksLeft: number
  /**
   * BIP-85 children this session will still derive.
   *
   * See takeChildDerivation. A person derives one or two and writes them down;
   * a harvester walks the index space.
   */
  childDerivationsLeft: number
  /** Absent until this wallet is saved to, or loaded from, the store. */
  active: ActiveWallet | undefined
}

/**
 * Wrong words allowed before checking closes, per session.
 *
 * The screen asks for three positions. A person mistypes; nobody mistypes
 * fifteen times. An enumeration of the 2048-word list needs about 1024 wrong
 * answers for its FIRST position, so this closes long before the first word is
 * recovered rather than merely making the attack slower.
 */
const WRONG_WORDS_ALLOWED = 15

/**
 * BIP-85 children one session will derive, before it stops.
 *
 * bip85.derive returns a complete child mnemonic, which is spendable key
 * material for a real wallet. Showing it is the point of the feature: a child
 * seed you cannot write down is a child seed you cannot use. What it must not
 * be is unlimited, because that turns one compromised moment on the frontend
 * into every child this seed will ever have, including indexes the user has
 * not funded yet and will fund later.
 *
 * Eight, because a person deriving children does so deliberately, one screen at
 * a time, and writes each one down. Nobody writes down eight in a sitting. The
 * ceiling is per session, so locking and opening the wallet again lifts it,
 * which is the right cost: it takes the passphrase.
 */
const CHILD_DERIVATIONS_ALLOWED = 8

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
      cosigners: [],
      labels: [],
      fingerprint: masterFingerprint(seed, this.#network),
      // A generated seed has not been written down yet. An imported one, by
      // definition, already exists on paper somewhere.
      confirmedBackup: provenance !== 'generated',
      wordChecksLeft: WRONG_WORDS_ALLOWED,
      childDerivationsLeft: CHILD_DERIVATIONS_ALLOWED,
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
      cosigners: [],
      labels: [],
      fingerprint: masterFingerprint(seed, this.#network),
      // It came off disk, so it existed before this session and its backup is
      // not this session's business to assert either way.
      confirmedBackup: true,
      wordChecksLeft: WRONG_WORDS_ALLOWED,
      childDerivationsLeft: CHILD_DERIVATIONS_ALLOWED,
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

  /** Names given to the other keys in this wallet's quorums. */
  get cosigners(): readonly { readonly xpub: string; readonly label: string }[] {
    return this.#wallet?.cosigners ?? []
  }

  /**
   * Name one of the other keys, or clear the name by passing an empty label.
   *
   * Keyed by extended key rather than by position: position belongs to one
   * descriptor, and the same physical device is the same device across every
   * quorum it is in.
   */
  labelCosigner(xpub: string, label: string): void {
    const wallet = this.#wallet
    if (wallet === undefined) throw new SessionError('No wallet is loaded.')
    const without = wallet.cosigners.filter((entry) => entry.xpub !== xpub)
    wallet.cosigners = label.length === 0 ? without : [...without, { xpub, label }]
  }

  /** The registrations a reseal writes: the sealed ones, not unsaved changes. */
  get sealedRegistrations(): readonly string[] {
    return this.#wallet?.sealed?.registrations ?? this.registrations
  }

  /** The cosigner names a reseal writes, for the same reason. */
  get sealedCosigners(): readonly { readonly xpub: string; readonly label: string }[] {
    return this.#wallet?.sealed?.cosigners ?? this.cosigners
  }

  /**
   * Remember what is sealed before a change the user was told is not saved.
   *
   * Called BEFORE the live lists change. Only the first unsaved change takes
   * the snapshot; later ones leave it alone, because it records the disk.
   */
  holdUnsaved(): void {
    const wallet = this.#wallet
    if (wallet === undefined || wallet.sealed !== undefined) return
    wallet.sealed = {
      registrations: [...wallet.registrations],
      cosigners: wallet.cosigners.map((entry) => ({ ...entry })),
    }
  }

  /**
   * Record exactly what a write just sealed.
   *
   * Called AFTER the live lists reflect the change that was saved. When disk
   * and session now agree the difference is dropped.
   */
  recordSealed(
    registrations: readonly string[],
    cosigners: readonly { readonly xpub: string; readonly label: string }[]
  ): void {
    const wallet = this.#wallet
    if (wallet === undefined) return
    const same =
      JSON.stringify(registrations) === JSON.stringify(wallet.registrations) &&
      JSON.stringify(cosigners) === JSON.stringify(wallet.cosigners)
    wallet.sealed = same
      ? undefined
      : {
          registrations: [...registrations],
          cosigners: cosigners.map((entry) => ({ ...entry })),
        }
  }

  /** Labels loaded for this session. Empty is normal. */
  get labels(): readonly { readonly type: string; readonly ref: string; readonly label: string }[] {
    return this.#wallet?.labels ?? []
  }

  /** Replace the loaded labels. Passing none clears them. */
  setLabels(
    labels: readonly { readonly type: string; readonly ref: string; readonly label: string }[]
  ): void {
    const wallet = this.#wallet
    if (wallet === undefined) throw new SessionError('No wallet is loaded.')
    wallet.labels = labels.map((entry) => ({ ...entry }))
  }

  setCosigners(cosigners: readonly { readonly xpub: string; readonly label: string }[]): void {
    const wallet = this.#wallet
    if (wallet === undefined) return
    wallet.cosigners = cosigners.map((entry) => ({ ...entry }))
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
  /**
   * Forget a registered quorum.
   *
   * Returns whether anything was removed, so a caller cannot report success for
   * a descriptor that was never there.
   *
   * Removing a registration is not the inverse of adding one in the way it
   * looks. A registered descriptor is how the device decides which outputs are
   * change; forgetting it does not lose money, and it does make the device stop
   * recognising money coming back to itself, which reads on the review screen
   * as a stranger's address. That is the argument for a confirmation, not for
   * refusing: a quorum registered by mistake is otherwise permanent, and
   * registration is the step the documentation calls dangerous.
   */
  forgetRegistration(descriptor: string): boolean {
    const wallet = this.#wallet
    if (wallet === undefined) throw new SessionError('No wallet is loaded.')
    const before = wallet.registrations.length
    wallet.registrations = wallet.registrations.filter((entry) => entry !== descriptor)
    return wallet.registrations.length !== before
  }

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
   * WHAT THIS USED TO BE, AND WHY IT WAS AN ORACLE. This gated on nothing but
   * the mnemonic being present, and its comment argued "the caller cannot
   * enumerate them by guessing, because guessing a word IS the verification".
   * That is true of a person at a screen and false of the untrusted process
   * INV-KEY-1 is written against. The BIP-39 wordlist is 2048 public entries,
   * seed.checkWord returns a boolean with no key derivation behind it, and 24
   * positions at about 1024 tries each is roughly 25,000 calls: the whole
   * mnemonic, over the socket, in seconds.
   *
   * It was reachable in exactly the window seed.reveal is closed in. An
   * imported seed is marked confirmedBackup at load, so revealMnemonic refuses
   * it from the first instant while this answered; a generated one kept
   * answering after the user confirmed the backup and the reveal shut.
   *
   * THREE GATES NOW, and each closes a different half of that:
   *
   *   1. Generated seeds only. An imported mnemonic is one the user typed in,
   *      so there is nothing to verify and no reason to answer at all.
   *   2. Not after the backup is confirmed. Checking is part of confirming;
   *      once that is done this has no legitimate caller, and the reveal is
   *      already shut.
   *   3. A budget of wrong answers, spent on the way in rather than on the way
   *      out, so a caller that is enumerating runs out during the first
   *      position rather than after the last.
   *
   * The words still never cross the boundary through this path. The point is
   * that a boolean repeated enough times is the same information.
   */
  peekWordsForVerification(): readonly string[] {
    const wallet = this.#wallet
    if (wallet === undefined) throw new SessionError('No wallet is loaded.')
    if (wallet.provenance !== 'generated' || wallet.mnemonic === undefined) {
      throw new SessionError(
        'There are no words held in this session to check against. Word checking is part of ' +
          'creating a wallet, and a seed that was imported or opened from storage was never ' +
          'shown by this device in the first place.'
      )
    }
    if (wallet.confirmedBackup) {
      throw new SessionError(
        'You have already confirmed this seed was written down, so it will not be checked ' +
          'again. Restore from your written words if you need to know they are right.'
      )
    }
    if (wallet.wordChecksLeft <= 0) {
      throw new SessionError(
        'Too many words did not match, so checking is closed for this session. Lock and open ' +
          'the wallet again, or start over from your written words.'
      )
    }
    return wallet.mnemonic.split(' ')
  }

  /**
   * Spend one of the budget, on a word that did not match.
   *
   * Only the wrong ones, so somebody checking the three positions they were
   * asked for never touches this and somebody enumerating the wordlist spends
   * it 2047 times out of 2048.
   */
  recordWrongWord(): void {
    const wallet = this.#wallet
    if (wallet === undefined) return
    wallet.wordChecksLeft -= 1
  }

  /**
   * Spend one of the session's BIP-85 budget, or refuse.
   *
   * Called before deriving rather than after, so a caller that has run out
   * gets a refusal instead of a child it then has to be trusted to forget.
   */
  takeChildDerivation(): void {
    const wallet = this.#wallet
    if (wallet === undefined) throw new SessionError('No wallet is loaded.')
    if (wallet.childDerivationsLeft <= 0) {
      throw new SessionError(
        'This session has derived as many child seeds as it will. Lock the wallet and open it ' +
          'again to derive more. A child seed is a wallet of its own: write down the ones you ' +
          'have before making more.'
      )
    }
    wallet.childDerivationsLeft -= 1
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
