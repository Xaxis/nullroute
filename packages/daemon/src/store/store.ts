/**
 * The wallet store: the sealed envelope, on disk, with a retry counter.
 *
 * Spec: daemon.store
 *
 * Everything here is file handling and policy. The cryptography is in
 * envelope.ts and this module does not reach into it.
 *
 * WHAT THE RETRY COUNTER IS AND IS NOT. It counts consecutive failed unlock
 * attempts and, past a limit, destroys the sealed blob. That defends against
 * one thing: a person who picks up a running device and starts guessing. It
 * does NOT defend against anyone who has the card, because the counter lives
 * beside the ciphertext and they can simply restore it, or copy the blob first
 * and guess against the copy forever. Anything written here or on screen that
 * implies otherwise is a lie, and the threat model says so in the same words.
 *
 * The honest summary is that a stolen card is protected by the passphrase and
 * by Argon2id, and by nothing else.
 *
 * DESTRUCTION IS REAL. Passing the limit erases the wallet from this device.
 * The mnemonic on paper is the recovery path, which is why the seed screen
 * gates on confirming it was written down. Overwriting the file before
 * unlinking is best effort and nothing more: on flash storage with wear
 * levelling the old blocks are still there, so the property being relied on is
 * that the blob was encrypted in the first place, not that it was erased.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { Secret, masterFingerprint, networkById, type Network } from '@nullroute/core'
import {
  BadPassphraseError,
  type KdfCost,
  KDF_DEFAULTS,
  StoreError,
  assertEnvelope,
  open,
  seal,
  type Envelope,
} from './envelope.js'

/**
 * Consecutive failures before the blob is destroyed.
 *
 * Generous on purpose. The counter cannot stop an offline attack, so a tight
 * limit buys almost no security while making it easy for a legitimate user to
 * destroy their own wallet with a sticky keypad. Ten wrong attempts in a row is
 * a person who does not know the passphrase.
 */
export const MAX_ATTEMPTS = 10

interface Sidecar {
  /** Consecutive failures. Reset to zero by any successful unlock. */
  readonly failedAttempts: number
}

/**
 * What is actually sealed.
 *
 * The network is in here rather than beside the ciphertext because it is part
 * of the wallet's identity, not metadata about the file. The same seed derives
 * completely different addresses on mainnet and on signet, so a stored wallet
 * that came back on the wrong network would show a user addresses that are not
 * theirs, under a label saying they are. An early version did exactly that:
 * `lock()` resets the session network to mainnet, nothing restored it, and a
 * signet wallet unlocked into bc1 addresses.
 *
 * Sealing it also means it cannot be edited on the card, which matters more
 * than it first looks: flipping a stored wallet from signet to mainnet would be
 * a way to get a user to treat real addresses as worthless test ones.
 */
interface SealedPayload {
  /**
   * 1 is a store written before this device could hold more than one wallet.
   * 2 adds the wallet's identity. Both are readable; only 2 is written.
   */
  readonly v: 1 | 2
  readonly network: string
  /** Hex, because JSON has no bytes. */
  readonly seed: string
  /**
   * Registered multisig descriptors, sealed alongside the seed.
   *
   * Inside the ciphertext rather than beside it, for the same reason the
   * network is: a registration decides which outputs the device calls change,
   * so an attacker who could edit one on the card could make their own address
   * look like money coming back to the user. Optional because a store written
   * before multisig existed simply has none, which is the correct reading.
   */
  readonly registrations?: readonly string[]
  /**
   * The wallet's name and colour, sealed with the seed (v2).
   *
   * Inside the ciphertext for the same reason the network is. A copy lives
   * beside the file so a picker can show something before any passphrase is
   * typed, and that copy is editable by whoever holds the card. If the two
   * disagree, this one is the wallet and the other one is a hint that was
   * wrong, which the registry rewrites and reports.
   */
  readonly label?: string
  readonly colour?: string
  /**
   * The master fingerprint of the sealed seed, on the sealed network.
   *
   * Not a defence against an attacker: it is sealed alongside the thing it
   * describes, so anyone who could change one could change both. It is a check
   * against this code, and it fires if a future change ever seals an identity
   * beside a seed it does not belong to.
   */
  readonly fingerprint?: string
}

/** A wallet's name and colour, as sealed. */
export interface WalletIdentity {
  readonly label: string
  readonly colour: string
  readonly fingerprint: string
}

export interface StoredWallet {
  readonly seed: Secret
  readonly network: Network
  readonly registrations: readonly string[]
  /** Absent for a v1 store, which sealed no identity. */
  readonly label?: string
  readonly colour?: string
}

export interface StoreStatus {
  readonly exists: boolean
  readonly failedAttempts: number
  readonly attemptsRemaining: number
  /** True once the blob has been destroyed by exhausted attempts. */
  readonly destroyed: boolean
}

export class WalletStore {
  readonly #blob: string
  readonly #sidecar: string
  readonly #kdf: KdfCost

  /**
   * The KDF parameters are a constructor argument because they have to rise
   * over time: today's cost on a Pi 4 is not what it should be on hardware in
   * five years, and every sealed file records the parameters it was written
   * with so raising them never orphans an old store.
   *
   * Callers that leave them alone get the shipped defaults, and a separate test
   * pins those, so lowering the real work factor cannot slip through by way of
   * this argument.
   */
  constructor(directory: string, kdf: KdfCost = KDF_DEFAULTS) {
    this.#blob = join(directory, 'wallet.store')
    this.#sidecar = join(directory, 'wallet.attempts')
    this.#kdf = kdf
  }

  get path(): string {
    return this.#blob
  }

  /** The unauthenticated attempt counter beside the blob. */
  get sidecarPath(): string {
    return this.#sidecar
  }

  exists(): boolean {
    return existsSync(this.#blob)
  }

  status(): StoreStatus {
    const failed = this.#readSidecar().failedAttempts
    return {
      exists: this.exists(),
      failedAttempts: failed,
      attemptsRemaining: Math.max(0, MAX_ATTEMPTS - failed),
      destroyed: !this.exists() && failed >= MAX_ATTEMPTS,
    }
  }

  /**
   * Seal a seed under a passphrase and write it.
   *
   * Refuses to overwrite. Replacing a wallet is a separate, explicit act
   * (`destroy` then `create`), because a create that silently clobbered an
   * existing store would be one mis-click away from erasing a wallet whose
   * mnemonic the user believes is backed up.
   */
  create(
    seed: Secret,
    network: Network,
    passphrase: string,
    registrations: readonly string[] = [],
    identity?: WalletIdentity
  ): void {
    if (this.exists()) {
      throw new StoreError(
        'A wallet already exists here. Erase it explicitly before creating another.'
      )
    }

    const payload: SealedPayload = {
      v: 2,
      network: network.id,
      seed: Buffer.from(seed.bytes).toString('hex'),
      registrations,
      ...(identity === undefined
        ? {}
        : { label: identity.label, colour: identity.colour, fingerprint: identity.fingerprint }),
    }
    using plaintext = Secret.fromBytes(
      new TextEncoder().encode(JSON.stringify(payload)),
      'store-payload'
    )
    this.#writeAtomic(this.#blob, JSON.stringify(seal(plaintext, passphrase, this.#kdf), null, 2))
    this.#writeSidecar({ failedAttempts: 0 })
  }

  /**
   * Open the store, or count the failure.
   *
   * A successful unlock resets the counter. The last attempt before the limit
   * destroys the blob, and that happens BEFORE this returns, so a caller that
   * crashes on the way out cannot leave a device with an exhausted counter and
   * an intact wallet.
   */
  unlock(passphrase: string): StoredWallet {
    if (!this.exists()) {
      throw new StoreError('There is no wallet on this device.')
    }

    const envelope = this.#readEnvelope()
    try {
      using plaintext = open(envelope, passphrase)
      const wallet = this.#decodePayload(plaintext)
      this.#writeSidecar({ failedAttempts: 0 })
      return wallet
    } catch (err) {
      if (!(err instanceof BadPassphraseError)) throw err

      const failed = this.#readSidecar().failedAttempts + 1
      this.#writeSidecar({ failedAttempts: failed })
      if (failed >= MAX_ATTEMPTS) {
        this.destroy()
        throw new StoreError(
          `That was attempt ${String(failed)} of ${String(MAX_ATTEMPTS)}. The wallet on this ` +
            `device has been erased. Restore it from your mnemonic.`
        )
      }
      throw new BadPassphraseError()
    }
  }

  /**
   * Re-seal an existing store with a changed registration list.
   *
   * Separate from `create`, which refuses to overwrite. Registering a quorum
   * has to rewrite the file, and doing that through `create` would mean
   * relaxing the guard that stops a mis-tap erasing a wallet.
   */
  reseal(
    seed: Secret,
    network: Network,
    passphrase: string,
    registrations: readonly string[],
    identity?: WalletIdentity
  ): void {
    if (!this.exists()) {
      throw new StoreError('There is no wallet here to update.')
    }
    // Verified before the old blob is replaced. Re-sealing under a passphrase
    // that does not open the current store would silently change the
    // passphrase, and the user would discover it at the next unlock.
    //
    // This path COUNTS a failure, because it is reachable from registration,
    // which a locked device can be walked into. See `resealVerified` for the
    // cosmetic case, where counting would make renaming a wallet a way to
    // destroy it.
    this.unlock(passphrase).seed.dispose()
    this.#writeSealed(seed, network, passphrase, registrations, identity)
  }

  /**
   * Re-seal without counting a failed passphrase against the wallet.
   *
   * For changes made while the wallet is already open: a name, a colour. The
   * passphrase is still verified, so a wrong one changes nothing, but a wrong
   * one also does not spend part of the ten-attempt budget that erases the
   * wallet. The counter exists to slow someone guessing at a locked device, and
   * a caller holding the decrypted seed has already passed that gate.
   */
  resealVerified(
    seed: Secret,
    network: Network,
    passphrase: string,
    registrations: readonly string[],
    identity?: WalletIdentity
  ): void {
    if (!this.exists()) {
      throw new StoreError('There is no wallet here to update.')
    }
    // Opened directly rather than through `unlock`, so the sidecar is untouched
    // on both the success and the failure path.
    open(this.#readEnvelope(), passphrase).dispose()
    this.#writeSealed(seed, network, passphrase, registrations, identity)
  }

  #writeSealed(
    seed: Secret,
    network: Network,
    passphrase: string,
    registrations: readonly string[],
    identity?: WalletIdentity
  ): void {
    const payload: SealedPayload = {
      v: 2,
      network: network.id,
      seed: Buffer.from(seed.bytes).toString('hex'),
      registrations,
      ...(identity === undefined
        ? {}
        : { label: identity.label, colour: identity.colour, fingerprint: identity.fingerprint }),
    }
    using plaintext = Secret.fromBytes(
      new TextEncoder().encode(JSON.stringify(payload)),
      'store-payload'
    )
    this.#writeAtomic(this.#blob, JSON.stringify(seal(plaintext, passphrase, this.#kdf), null, 2))
  }

  /**
   * Write a file beside the blob, atomically.
   *
   * For the registry's unsealed hint. Routed through here rather than written
   * directly so every file in a wallet's directory gets the same 0600 and the
   * same write-then-rename, including the ones that hold nothing secret.
   */
  writeSidecarFile(name: string, contents: string): void {
    if (name.includes('/') || name.includes('\\') || name.includes('..')) {
      throw new StoreError(`"${name}" is not a file name.`)
    }
    this.#writeAtomic(join(dirname(this.#blob), name), contents)
  }

  /**
   * Copy another store's files into this one, without opening either.
   *
   * For moving a pre-multi-wallet store into a directory of its own. No
   * passphrase is involved and the ciphertext is copied verbatim, so a
   * migration cannot depend on the user being able to unlock right now.
   */
  adoptFrom(source: WalletStore): void {
    if (!existsSync(source.path)) {
      throw new StoreError('There is nothing at the source to move.')
    }
    this.#writeAtomic(this.#blob, readFileSync(source.path, 'utf8'))
    if (existsSync(source.sidecarPath)) {
      this.#writeAtomic(this.#sidecar, readFileSync(source.sidecarPath, 'utf8'))
    }
  }

  /**
   * Remove the blob and its counter, after they have been copied elsewhere.
   *
   * Distinct from `destroy`, which overwrites first because it is erasing the
   * only copy. Here another copy exists and has been verified, so scribbling on
   * these bytes protects nothing that the encryption did not already protect.
   */
  unlink(): void {
    rmSync(this.#blob, { force: true })
    rmSync(this.#sidecar, { force: true })
  }

  /**
   * Erase the wallet from this device.
   *
   * The overwrite before unlinking is best effort and is not the property being
   * relied on: flash storage with wear levelling keeps the old blocks. What
   * makes this safe is that the blob was encrypted before it was ever written.
   */
  destroy(): void {
    if (existsSync(this.#blob)) {
      try {
        const size = readFileSync(this.#blob).length
        writeFileSync(this.#blob, randomBytes(size))
      } catch {
        // An unreadable or unwritable file still gets unlinked below. Failing
        // to scribble on it must not prevent removing it.
      }
      rmSync(this.#blob, { force: true })
    }
  }

  /**
   * Turn the decrypted bytes back into a wallet.
   *
   * This runs on authenticated plaintext, so it is not parsing hostile input,
   * but it still validates: a payload written by a future version, or one whose
   * network no longer exists, has to fail loudly rather than derive addresses
   * on a network nobody chose.
   */
  #decodePayload(plaintext: Secret): StoredWallet {
    let parsed: unknown
    try {
      parsed = JSON.parse(new TextDecoder().decode(plaintext.bytes))
    } catch {
      throw new StoreError('The store opened but its contents are not readable.')
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new StoreError('The store opened but its contents are not an object.')
    }
    const payload = parsed as Partial<SealedPayload>
    if (
      (payload.v !== 1 && payload.v !== 2) ||
      typeof payload.seed !== 'string' ||
      typeof payload.network !== 'string'
    ) {
      throw new StoreError('The store contents are not in a layout this build understands.')
    }
    // Absent is normal for a store written before multisig, and is not the
    // same as a corrupt field. Anything present that is not an array of strings
    // is refused rather than partially read: a half-understood registration
    // decides which outputs count as change.
    const raw: unknown = payload.registrations
    let registrations: readonly string[] = []
    if (raw !== undefined) {
      if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== 'string')) {
        throw new StoreError('The store contains a registration list this build cannot read.')
      }
      registrations = raw as readonly string[]
    }

    // The network is resolved BEFORE the seed becomes a Secret, and the order
    // is load-bearing rather than stylistic. Object literal properties evaluate
    // top to bottom, so building the Secret first and calling networkById in
    // the next line means an unknown network id throws with a decrypted seed
    // already constructed, orphaned, and never disposed. That is an INV-KEY-2
    // violation reachable by opening a store written by a newer build, which
    // the downgrade-and-verify workflow in docs/VERIFICATION.md invites.
    // A v1 store sealed no identity, which is not the same as a corrupt one.
    // A v2 store that carries a label of the wrong type IS corrupt, and is
    // refused rather than half read: a label decides what the signing screen
    // says this wallet is called.
    let label: string | undefined
    let colour: string | undefined
    if (payload.v === 2) {
      if (payload.label !== undefined && typeof payload.label !== 'string') {
        throw new StoreError('The store contains a wallet name this build cannot read.')
      }
      if (payload.colour !== undefined && typeof payload.colour !== 'string') {
        throw new StoreError('The store contains a colour tag this build cannot read.')
      }
      label = payload.label
      colour = payload.colour
    }

    const network = networkById(payload.network)
    const bytes = Uint8Array.from(Buffer.from(payload.seed, 'hex'))

    // The sealed fingerprint is checked against the sealed seed before either
    // is handed out. Both were written by this code under one passphrase, so
    // this catches a bug here rather than an attacker: it fires if an identity
    // is ever sealed beside a seed it does not describe, which would mean the
    // signing screen naming a wallet whose keys are not the ones signing.
    if (typeof payload.fingerprint === 'string') {
      // copyOf, NOT fromBytes. fromBytes takes ownership and disposal zeroizes
      // the buffer in place, so checking through it would hand back a seed of
      // 32 zero bytes: every stored wallet would unlock into the same empty
      // wallet, and the fingerprint on screen would be consistent with it.
      using check = Secret.copyOf(bytes, 'fingerprint-check')
      const actual = masterFingerprint(check, network)
      if (actual !== payload.fingerprint) {
        throw new StoreError(
          `This store's sealed identity does not match its seed (says ${payload.fingerprint}, ` +
            `derives ${actual}). Refusing to open it.`
        )
      }
    }

    return {
      seed: Secret.fromBytes(bytes, 'stored-seed'),
      network,
      registrations,
      ...(label === undefined ? {} : { label }),
      ...(colour === undefined ? {} : { colour }),
    }
  }

  #readEnvelope(): Envelope {
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(this.#blob, 'utf8'))
    } catch (err) {
      throw new StoreError(`The store file could not be read. ${(err as Error).message}`)
    }
    assertEnvelope(parsed)
    return parsed
  }

  /**
   * The counter, read defensively.
   *
   * A missing, unreadable or nonsensical sidecar reads as zero rather than
   * throwing. It is not authenticated and cannot be: it has to be legible
   * before the passphrase is known. Treating a corrupt one as fatal would turn
   * a scribbled byte into a device that refuses to unlock a perfectly good
   * wallet, which is a worse outcome than resetting a counter that was never
   * load-bearing against an attacker holding the card.
   */
  #readSidecar(): Sidecar {
    try {
      const raw: unknown = JSON.parse(readFileSync(this.#sidecar, 'utf8'))
      if (typeof raw === 'object' && raw !== null) {
        const value: unknown = (raw as { failedAttempts?: unknown }).failedAttempts
        if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
          return { failedAttempts: value }
        }
      }
    } catch {
      // Absent or unparseable. Zero.
    }
    return { failedAttempts: 0 }
  }

  #writeSidecar(value: Sidecar): void {
    this.#writeAtomic(this.#sidecar, JSON.stringify(value))
  }

  /**
   * Write via a temporary file and rename.
   *
   * `rename` within a directory is atomic, so a reader sees either the old
   * contents or the new ones and never a half-written file. Writing in place
   * would mean a power cut during the write leaves a truncated store, and a
   * truncated store is an erased wallet.
   *
   * Permissions are set to 0600 before the rename rather than after, so the
   * file is never briefly world-readable at its final name.
   */
  #writeAtomic(target: string, contents: string): void {
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
    const temporary = `${target}.${randomBytes(6).toString('hex')}.tmp`
    writeFileSync(temporary, contents, { mode: 0o600 })
    chmodSync(temporary, 0o600)
    renameSync(temporary, target)
  }
}
