/**
 * Several independent wallets on one device.
 *
 * Spec: daemon.store.registry
 *
 * Each wallet is a `WalletStore` of its own, in its own directory, under its own
 * passphrase. Nothing is shared: opening one tells you nothing about another and
 * cannot weaken another, which is the whole point of storing them separately
 * rather than as slots inside one blob.
 *
 * THIS IS NOT THE DURESS FEATURE. `docs/THREAT-MODEL.md` uses the word "profile"
 * for a set of indistinguishable wallets selected by which PIN you type, where
 * the device must never reveal how many exist. That is phase 7 and is the
 * opposite of this: here the device lists what it holds, by name, on purpose,
 * because a user who cannot tell their wallets apart signs with the wrong one.
 * The vocabulary is kept separate so the two cannot be confused in a spec, in a
 * commit message, or by a user who read the threat model.
 *
 * THE RULE EVERYTHING ELSE FOLLOWS FROM. A wallet's identity comes from inside
 * its ciphertext. The directory name is a random id that no user input touches.
 * The label and colour a user chose are sealed with the seed, and the copy kept
 * outside for the picker is a hint that is corrected on every successful unlock
 * and is never allowed to decide anything.
 *
 * WHAT AN UNSEALED HINT CAN AND CANNOT DO. Anyone holding the card can edit a
 * hint, so the picker can be made to lie about which wallet is which. That is
 * worth stating plainly and is worth less to an attacker than it first appears:
 * the same access lets them delete the blob outright, so relabelling buys them
 * no capability they did not have. What it must never do is survive contact with
 * the truth, so a label that disagrees with the sealed one is overwritten at
 * unlock and the user is told.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { type Network, type Secret, masterFingerprint } from '@nullroute/core'
import { StoreError, type KdfCost, KDF_DEFAULTS } from './envelope.js'
import { WalletStore, type StoredWallet } from './store.js'

/**
 * How many wallets one device holds.
 *
 * Not a technical limit. A picker a user has to scroll is a picker where the
 * wrong row gets tapped, and a device holding thirty wallets is one where
 * nobody remembers which passphrase is which.
 */
export const MAX_WALLETS = 8

/** Characters in a wallet's directory name. 64 bits of random hex. */
const ID_LENGTH = 16
const ID_PATTERN = /^[0-9a-f]{16}$/

/** The unsealed hint beside each sealed blob. */
const HINT_FILE = 'wallet.hint'

/**
 * Colour tags, as ids rather than as colour values.
 *
 * The UI decides what "slate" looks like. Storing a hex colour would let a hint
 * file specify white on white, or a colour that renders as another wallet's,
 * which turns a decoration into a way to make two wallets look alike.
 */
export const WALLET_COLOURS = [
  'slate',
  'amber',
  'teal',
  'violet',
  'rose',
  'lime',
  'cyan',
  'orange',
] as const
export type WalletColour = (typeof WALLET_COLOURS)[number]

export const DEFAULT_COLOUR: WalletColour = 'slate'

/** The most characters a label may carry. Longer is a layout attack. */
export const MAX_LABEL = 32

export interface WalletHint {
  readonly label: string
  readonly colour: WalletColour
  /** For telling a signet wallet from a mainnet one before unlocking. */
  readonly network: string
  /**
   * The master fingerprint, for one purpose only: refusing to store the same
   * seed twice.
   *
   * Unauthenticated like the rest of this file, so it is NEVER displayed and
   * never used to identify a wallet to a user. INV-UI-20 already establishes
   * that a fingerprint nobody verified must not be shown as though it were
   * checked, and a picker is exactly where that mistake would matter.
   *
   * Forging it costs an attacker a refused create, which is a nuisance rather
   * than a loss. Deleting it defeats the duplicate check, which requires the
   * user to then go and create a duplicate on purpose.
   */
  readonly fingerprint?: string
  /**
   * Whether a BIP-39 passphrase was applied when this wallet was created.
   *
   * NOT the passphrase that encrypts the store. That one protects a file; this
   * one IS part of the key, and a wallet created under one is unrecoverable
   * from the mnemonic alone. Recorded so a screen can say so before the user
   * wonders where their money went. It reveals nothing: the wallet's existence
   * already implies someone made it.
   */
  readonly bip39Passphrase?: boolean
}

export interface WalletEntry {
  readonly id: string
  /** From the hint file. Unauthenticated until this wallet is unlocked. */
  readonly hint: WalletHint
  readonly exists: boolean
  readonly failedAttempts: number
  readonly attemptsRemaining: number
  readonly destroyed: boolean
}

/** What an unlocked wallet is, once its identity has been checked. */
/**
 * The name shown for a wallet whose store sealed no identity.
 *
 * A v1 store predates sealed labels, so there is nothing authenticated to show.
 * The hint beside it is editable by anyone holding the card, so using it would
 * make an attacker's string the wallet's name on the signing screen, with
 * nothing anywhere reporting that it was never confirmed. A constant is worse
 * to look at and cannot be forged.
 */
export const UNCONFIRMED_LABEL = 'Unconfirmed wallet'

export interface OpenedWallet extends StoredWallet {
  readonly id: string
  readonly label: string
  readonly colour: WalletColour
  /**
   * Whether the label came from inside the ciphertext.
   *
   * False for a wallet migrated from a v1 store, which sealed no identity.
   * Renaming it seals one and makes this true. Until then the caller must
   * present the name as unconfirmed, because there is nothing behind it.
   */
  readonly labelVerified: boolean
  /**
   * True when the hint outside disagreed with the sealed identity.
   *
   * The caller must tell the user. A hint that drifted is usually a crash
   * between two writes, and is occasionally someone editing the card.
   */
  readonly hintCorrected: boolean
}

/**
 * Strip everything that cannot be displayed honestly, and normalise the rest.
 *
 * Extracted so the device name in identity.ts uses THIS definition rather than
 * a copy. Two implementations of "which characters are dangerous in a string we
 * render" is exactly the drift tools/check-ui-constants.mjs exists to catch, and
 * a second copy would be one that quietly forgets a bidi override.
 *
 * Returns the cleaned string, which may be empty. Callers decide what an empty
 * result means, because the message differs: a wallet name and a device name
 * are read in different places.
 */
export function stripUndisplayable(raw: string): string {
  // NFC first, so two strings that look identical cannot differ in storage and
  // defeat a duplicate check.
  const composed = raw.normalize('NFC')

  // Written as escapes rather than as the characters themselves, because the
  // whole point of this set is that several of them are invisible in an editor.
  //
  //   \u0000-\u001F, \u007F-\u009F   C0 and C1 controls
  //   \u200B-\u200F                  zero width space, joiners, LTR and RTL marks
  //   \u2028-\u2029                  line and paragraph separators
  //   \u202A-\u202E                  bidi embedding and override
  //   \u2060-\u2064, \u2066-\u2069   word joiner, invisible operators, isolates
  //   \uFEFF                          zero width no-break space
  //
  // The bidi ones can make a label render in an order it is not stored in,
  // which is how one wallet's name is made to look like another's. The
  // zero-width ones render as nothing, which is how a label passes a non-empty
  // check and then shows as a blank row in the picker.
  const stripped = composed.replace(
    // eslint-disable-next-line no-control-regex -- matching them is the point
    /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/gu,
    ''
  )
  // Collapse every Unicode space to an ordinary one before trimming. A label
  // of non-breaking spaces survives `trim`, renders as a blank row, and lets
  // two wallets carry names that look identical while differing in storage.
  const spaced = stripped.replace(/\p{White_Space}/gu, ' ').replace(/ {2,}/g, ' ')
  return spaced.trim()
}

/**
 * Make a label safe to store and to render.
 *
 * A label is user input that ends up in a picker row, a header chip, and the
 * sentence on the signing screen naming which wallet is about to sign. It never
 * touches a path, so this is not about traversal. It is about a label that
 * renders as nothing, renders as another wallet's, or renders taller than the
 * row that holds it.
 *
 * REPAIRED, NOT REJECTED, and this docblock said the opposite for a long time.
 * The dangerous characters are stripped and what is left is stored. That is
 * only defensible because the repair is not silent: the sealed label is what
 * comes back from `create` and `rename`, the session takes that one, and every
 * screen shows it, so a user who typed something that came out different sees
 * the difference on the next screen rather than being told about it in an
 * error.
 *
 * Empty and over-long are refused, because neither has a repair that preserves
 * intent: a truncated name is a name for a different wallet.
 *
 * The contrast with BIP-329 labels is deliberate. Those are REFUSED, because
 * they arrive in a file from software this device knows nothing about, and
 * quietly cleaning one would hide that something tried. A wallet name is typed
 * by the person holding the device.
 */
export function normaliseLabel(raw: string): string {
  const trimmed = stripUndisplayable(raw)

  if (trimmed.length === 0) {
    throw new StoreError(
      'That wallet name is empty, or is made only of characters that do not display. ' +
        'Give it a name you can read on the picker.'
    )
  }
  if (trimmed.length > MAX_LABEL) {
    throw new StoreError(
      `That wallet name is ${String(trimmed.length)} characters and the limit is ` +
        `${String(MAX_LABEL)}. A name that does not fit its row is a name you cannot check.`
    )
  }
  return trimmed
}

function isColour(value: unknown): value is WalletColour {
  return typeof value === 'string' && (WALLET_COLOURS as readonly string[]).includes(value)
}

/**
 * Several wallets, each in its own directory under one root.
 *
 * The root also holds the legacy single-wallet files, which are migrated on
 * first sight. See `migrateLegacy`.
 */
export class WalletRegistry {
  readonly #root: string
  readonly #kdf: KdfCost

  constructor(root: string, kdf: KdfCost = KDF_DEFAULTS) {
    this.#root = root
    this.#kdf = kdf
  }

  get root(): string {
    return this.#root
  }

  /** The directory holding one wallet. Derived from the id and nothing else. */
  #directory(id: string): string {
    // Asserted rather than assumed, at every use. A label is user input and an
    // id is not, but the two are strings in the same codebase and the cost of
    // being wrong once is a path outside the store root.
    if (!ID_PATTERN.test(id)) {
      throw new StoreError(`"${id}" is not a wallet id.`)
    }
    return join(this.#root, id)
  }

  store(id: string): WalletStore {
    return new WalletStore(this.#directory(id), this.#kdf)
  }

  /**
   * Read a hint, defensively.
   *
   * Every field falls back rather than throwing. A hint is decoration written
   * beside a wallet, and a scribbled byte in it must not make a perfectly good
   * wallet unlistable and therefore unreachable.
   */
  #readHint(id: string): WalletHint {
    try {
      const raw: unknown = JSON.parse(readFileSync(join(this.#directory(id), HINT_FILE), 'utf8'))
      if (typeof raw === 'object' && raw !== null) {
        const record = raw as Record<string, unknown>
        let label = 'Unnamed wallet'
        if (typeof record['label'] === 'string') {
          // Sanitised on the way IN as well as on the way out, because this
          // string was written by whoever held the card, not by createWallet.
          try {
            label = normaliseLabel(record['label'])
          } catch {
            label = 'Unnamed wallet'
          }
        }
        return {
          label,
          colour: isColour(record['colour']) ? record['colour'] : DEFAULT_COLOUR,
          network: typeof record['network'] === 'string' ? record['network'] : 'unknown',
          ...(typeof record['fingerprint'] === 'string'
            ? { fingerprint: record['fingerprint'] }
            : {}),
          ...(record['bip39Passphrase'] === true ? { bip39Passphrase: true } : {}),
        }
      }
    } catch {
      // Absent or unreadable. Fall through to the placeholder.
    }
    return { label: 'Unnamed wallet', colour: DEFAULT_COLOUR, network: 'unknown' }
  }

  #writeHint(id: string, hint: WalletHint): void {
    const directory = this.#directory(id)
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    // Through the store's atomic writer, so a hint is never half written.
    new WalletStore(directory, this.#kdf).writeSidecarFile(HINT_FILE, JSON.stringify(hint, null, 2))
  }

  /**
   * Every wallet on the device.
   *
   * A directory whose name is not an id is ignored rather than reported, so an
   * editor's backup file or a stray `.DS_Store` does not become a wallet.
   */
  list(): readonly WalletEntry[] {
    let entries: string[]
    try {
      entries = readdirSync(this.#root)
    } catch {
      return []
    }

    const wallets: WalletEntry[] = []
    for (const entry of entries.sort()) {
      if (!ID_PATTERN.test(entry)) continue
      try {
        if (!statSync(join(this.#root, entry)).isDirectory()) continue
      } catch {
        continue
      }
      const status = this.store(entry).status()
      wallets.push({
        id: entry,
        hint: this.#readHint(entry),
        exists: status.exists,
        failedAttempts: status.failedAttempts,
        attemptsRemaining: status.attemptsRemaining,
        destroyed: status.destroyed,
      })
    }
    return wallets
  }

  /**
   * Create a wallet from a seed already in the session.
   *
   * Refuses a seed this device already holds. Forking one seed into two wallets
   * under two passphrases means the weaker passphrase governs the money, and
   * the user would have no way to see that from a picker showing two different
   * names. The check needs the seed, which is here, so declining to make it
   * would be a choice rather than a limitation.
   */
  create(options: {
    readonly seed: Secret
    readonly network: Network
    readonly passphrase: string
    readonly label: string
    readonly colour: WalletColour
    readonly registrations?: readonly string[]
    /**
     * True when a BIP-39 passphrase was applied to reach this seed.
     *
     * Named at length because "passphrase" already means the one that encrypts
     * the store, and the two are unrelated: one protects a file and the other
     * IS part of the key. Confusing them in a variable name is how they get
     * confused on a screen.
     */
    readonly bip39Passphrase?: boolean
  }): { readonly id: string; readonly label: string } {
    const label = normaliseLabel(options.label)
    const existing = this.list()

    // Only wallets that still have a sealed blob count against the limit. A
    // directory left behind by a wallet erased through exhausted attempts is a
    // tombstone, and letting eight of those brick the device would turn a
    // recoverable mistake into a permanent one.
    if (existing.filter((entry) => entry.exists).length >= MAX_WALLETS) {
      throw new StoreError(
        `This device already holds ${String(MAX_WALLETS)} wallets, which is the limit. ` +
          `Erase one before adding another.`
      )
    }

    const fingerprint = masterFingerprint(options.seed, options.network)
    for (const entry of existing) {
      if (!entry.exists) continue

      // Same seed, same network, is the same wallet. Sealing it a second time
      // under a second passphrase means the weaker one governs the money, and
      // a picker showing two names gives the user no way to notice.
      //
      // Keyed on network as well, because the same seed on signet and on
      // mainnet derives different addresses and shares nothing a user would
      // confuse. That is two wallets and is allowed.
      if (entry.hint.fingerprint === fingerprint && entry.hint.network === options.network.id) {
        throw new StoreError(
          `This device already holds this seed as "${entry.hint.label}". Storing it twice under ` +
            `two passphrases means the weaker one controls the money.`
        )
      }
      if (entry.hint.label.toLowerCase() === label.toLowerCase()) {
        throw new StoreError(
          `This device already holds a wallet called "${entry.hint.label}". Two wallets with ` +
            `one name is a way to sign with the wrong one.`
        )
      }
    }

    const id = randomBytes(ID_LENGTH / 2).toString('hex')
    const store = this.store(id)

    store.create(options.seed, options.network, options.passphrase, options.registrations ?? [], {
      label,
      colour: options.colour,
      fingerprint,
    })
    this.#writeHint(id, {
      label,
      colour: options.colour,
      network: options.network.id,
      fingerprint,
      ...(options.bip39Passphrase === true ? { bip39Passphrase: true } : {}),
    })
    // The NORMALISED label is returned, not the caller's. They can differ, and
    // a caller that went on using its own copy would put an unsanitised name in
    // the session while a sanitised one sat in the ciphertext, which is the
    // two-sources-of-identity problem this module exists to prevent.
    return { id, label }
  }

  /**
   * Open one wallet and reconcile its hint against what was sealed.
   *
   * The returned label and colour come from inside the ciphertext. If the hint
   * outside disagreed it is rewritten here and the caller is told, because a
   * picker that lied about which wallet this is has just been caught doing it.
   */
  unlock(id: string, passphrase: string): OpenedWallet {
    const store = this.store(id)
    const opened = store.unlock(passphrase)

    const hint = this.#readHint(id)

    // A v1 store sealed no identity. Falling back to the hint would make an
    // editable file authoritative, and the disagreement check would then be
    // comparing the hint against itself and reporting agreement, so the one
    // signal that something was wrong would never fire. A constant is used
    // instead, and the caller is told the name is not confirmed.
    const labelVerified = opened.label !== undefined
    const label = labelVerified ? (opened.label ?? UNCONFIRMED_LABEL) : UNCONFIRMED_LABEL
    const colour = isColour(opened.colour) ? opened.colour : DEFAULT_COLOUR

    const fingerprint = masterFingerprint(opened.seed, opened.network)
    const corrected =
      hint.label !== label ||
      hint.colour !== colour ||
      hint.network !== opened.network.id ||
      hint.fingerprint !== fingerprint
    if (corrected) {
      // Repairing the hint is housekeeping, and housekeeping must not be able
      // to throw away a seed that has already been decrypted. `opened.seed` is
      // live by this point, and a throw here would abandon it undisposed: an
      // INV-KEY-2 leak triggered by nothing more than a read-only card or a
      // full disk. So the failure is caught, the seed is disposed on the way
      // out, and the error is re-raised rather than hidden.
      try {
        this.#writeHint(id, {
          label,
          colour,
          network: opened.network.id,
          fingerprint,
          ...(hint.bip39Passphrase === true ? { bip39Passphrase: true } : {}),
        })
      } catch (err) {
        opened.seed.dispose()
        throw new StoreError(
          `That wallet opened, but its name could not be written back to the device. ` +
            `Nothing was signed and the seed has been discarded. ${(err as Error).message}`
        )
      }
    }

    return { ...opened, id, label, colour, labelVerified, hintCorrected: corrected }
  }

  /**
   * Change a wallet's name or colour.
   *
   * Takes the seed from an unlocked session rather than reopening the store, and
   * verifies the passphrase WITHOUT counting a failure. That distinction is
   * load-bearing: `reseal` verifies by calling `unlock`, which counts failures
   * and erases the wallet at the limit, so renaming through it would make
   * choosing a different colour a way to destroy a wallet. The counter exists to
   * slow someone guessing at a locked device, and this path requires the wallet
   * to be open already, so there is nothing left to slow.
   */
  rename(
    id: string,
    options: {
      readonly seed: Secret
      readonly network: Network
      readonly passphrase: string
      readonly label: string
      readonly colour: WalletColour
      readonly registrations: readonly string[]
    }
  ): WalletHint {
    const label = normaliseLabel(options.label)
    for (const entry of this.list()) {
      if (entry.id === id || !entry.exists) continue
      if (entry.hint.label.toLowerCase() === label.toLowerCase()) {
        throw new StoreError(`This device already holds a wallet called "${entry.hint.label}".`)
      }
    }

    const fingerprint = masterFingerprint(options.seed, options.network)
    this.store(id).resealVerified(
      options.seed,
      options.network,
      options.passphrase,
      options.registrations,
      { label, colour: options.colour, fingerprint }
    )

    const hint: WalletHint = {
      label,
      colour: options.colour,
      network: options.network.id,
      fingerprint,
    }
    this.#writeHint(id, hint)
    return hint
  }

  /**
   * Erase a wallet and everything beside it.
   *
   * The blob first, so a failure part way through leaves a device with no seed
   * rather than one with a seed and no way to reach it. The directory is removed
   * last and a failure there is not fatal: an empty directory is listed as a
   * wallet that does not exist, which is untidy rather than dangerous.
   */
  /**
   * Remove the directory of a wallet whose blob is already gone.
   *
   * For tidying a tombstone left by exhausted attempts, which `destroy` cannot
   * reach because that requires the wallet to be open and an erased wallet
   * cannot be opened. Refuses while a blob is present, so this can never be a
   * second, quieter way to erase a wallet that still exists.
   */
  forget(id: string): void {
    if (this.store(id).exists()) {
      throw new StoreError(
        'That wallet still has a sealed seed. Open it and erase it explicitly, so the device ' +
          'cannot lose a wallet without being asked to.'
      )
    }
    rmSync(this.#directory(id), { recursive: true, force: true })
  }

  destroy(id: string): void {
    const directory = this.#directory(id)
    this.store(id).destroy()
    try {
      rmSync(directory, { recursive: true, force: true })
    } catch {
      // The sealed blob is already gone, which is the part that mattered.
    }
  }

  /**
   * Move a pre-multi-wallet store into a wallet of its own.
   *
   * A device that has been in use has `wallet.store` and `wallet.attempts` at
   * the root of the store directory. Those files are the user's money and this
   * runs before anything else touches them.
   *
   * Copy, verify, then remove. Never move-then-hope: a crash between the two
   * halves of a rename leaves a device with a store in neither place, and the
   * user finds out at the next unlock. The old files are only unlinked once the
   * new ones are readable, and the label is a placeholder because the sealed
   * payload of a v1 store has no label to recover.
   */
  migrateLegacy(): string | undefined {
    const legacyBlob = join(this.#root, 'wallet.store')
    if (!existsSync(legacyBlob)) return undefined

    const id = randomBytes(ID_LENGTH / 2).toString('hex')
    const directory = this.#directory(id)
    mkdirSync(directory, { recursive: true, mode: 0o700 })

    const legacy = new WalletStore(this.#root, this.#kdf)
    const moved = new WalletStore(directory, this.#kdf)
    try {
      moved.adoptFrom(legacy)
    } catch (err) {
      // Leave nothing behind. A half-made directory lists as a wallet that
      // does not exist, so a failed migration would add a phantom row to the
      // picker on every attempt, and the user would have no way to tell it
      // from a wallet whose blob had been erased.
      rmSync(directory, { recursive: true, force: true })
      throw err
    }

    if (!moved.exists()) {
      rmSync(directory, { recursive: true, force: true })
      throw new StoreError(
        'Moving the existing wallet into its own directory did not produce a readable file. ' +
          'Nothing was removed. The wallet is still where it was.'
      )
    }

    // Only now. Up to this point a crash leaves two copies, which is safe.
    legacy.unlink()

    this.#writeHint(id, {
      // No label was ever sealed in a v1 store. The same constant `unlock`
      // returns, so the picker and the opened wallet agree, and neither
      // invents a name. Renaming seals a real one.
      label: UNCONFIRMED_LABEL,
      colour: DEFAULT_COLOUR,
      network: 'unknown',
    })
    return id
  }

  /** Whether a legacy single-wallet store is present at the root. */
  hasLegacy(): boolean {
    return existsSync(join(this.#root, 'wallet.store'))
  }

  /** Validate an id that arrived over IPC. */
  static isId(value: unknown): value is string {
    return typeof value === 'string' && ID_PATTERN.test(value)
  }
}
