/**
 * The sealed envelope: how a seed is written to disk.
 *
 * Spec: daemon.store.envelope
 *
 * One job. Turn secret bytes plus a passphrase into a blob that is useless
 * without the passphrase, and turn it back. No file handles, no policy, no
 * retry counting: those belong to store.ts, and keeping them apart means the
 * cryptography can be read on its own.
 *
 * THE FORMAT IS JSON ON PURPOSE, and it costs a little size to gain something
 * worth more. A user can open this file with `cat` and read which KDF was used
 * and with which parameters, without running any nullroute code. That is the
 * same reason MANIFEST.lock is plain `sha256sum` output: a person checking
 * whether they have been given weakened parameters should not have to trust the
 * tool whose parameters are in question.
 *
 * What this does NOT protect against, stated here rather than in a footnote:
 *
 *   - A weak passphrase. Argon2id makes each guess expensive; it does not make
 *     a six-digit PIN into a secret. 10^6 guesses at roughly half a second each
 *     is under a week on one machine, and an attacker holding the card can run
 *     as many machines as they like. The PIN buys time against someone who
 *     picks up the device, not against a funded adversary who images the card.
 *   - Anyone who already has the running process. This protects data at rest.
 *
 * Choice of primitives. Argon2id comes from @noble/hashes, in line with the
 * rule that primitives come from noble or scure. AES-256-GCM comes from
 * node:crypto, which is the platform's own implementation rather than anything
 * written here; @noble/ciphers is not a dependency of this project and adding
 * one is not a decision this module gets to make on its own. GCM is used for
 * its authentication: an envelope that decrypted a wrong passphrase into
 * plausible garbage would hand back a valid-looking seed for the wrong wallet.
 */

import { argon2id } from '@noble/hashes/argon2.js'
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto'
import { base64 } from '@scure/base'
import { Secret } from '@nullroute/core'

export class StoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StoreError'
  }
}

/** Wrong passphrase, or a tampered file. Deliberately indistinguishable. */
export class BadPassphraseError extends StoreError {
  constructor() {
    super(
      'That passphrase did not open the store. Either it is wrong, or the file has been ' +
        'altered since it was written.'
    )
    this.name = 'BadPassphraseError'
  }
}

/**
 * Argon2id parameters.
 *
 * 64 MiB and three passes is chosen for a Raspberry Pi 4, where it costs
 * roughly half a second. Higher memory is better against an attacker with
 * parallel hardware and worse for a user waiting at a lock screen, and half a
 * second per unlock is about the most a device can spend before people start
 * choosing shorter passphrases to avoid the wait. That trade is the reason the
 * numbers are written into every file: raising them later must not orphan
 * stores written under the old ones.
 */
export interface KdfCost {
  /** Memory in KiB. */
  readonly m: number
  /** Passes. */
  readonly t: number
  /** Lanes. */
  readonly p: number
}

export const KDF_DEFAULTS: KdfCost = { m: 65536, t: 3, p: 1 }

const FORMAT = 'nullroute-store'
const VERSION = 1
const KEY_BYTES = 32
const SALT_BYTES = 32
/** 96 bits, the size GCM is specified for. Longer nonces are rehashed. */
const NONCE_BYTES = 12
const TAG_BYTES = 16

export interface KdfParams {
  readonly id: 'argon2id'
  readonly m: number
  readonly t: number
  readonly p: number
  readonly salt: string
}

export interface Envelope {
  readonly format: typeof FORMAT
  readonly version: number
  readonly kdf: KdfParams
  readonly cipher: { readonly id: 'aes-256-gcm'; readonly nonce: string }
  readonly ciphertext: string
  readonly tag: string
}

/**
 * The bytes GCM authenticates alongside the ciphertext.
 *
 * Everything that describes how to open the envelope goes in here. Without it
 * an attacker could rewrite the KDF parameters in the file, since they sit
 * outside the ciphertext: change `m` from 65536 to 8 and every guess becomes
 * cheap. The tag would still verify, because it would only be covering the
 * ciphertext. Binding the header means altering a parameter breaks the open,
 * which is the behaviour worth having.
 */
function header(kdf: KdfParams, nonce: string): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({ format: FORMAT, version: VERSION, kdf, cipher: { id: 'aes-256-gcm', nonce } })
  )
}

function deriveKey(passphrase: string, kdf: KdfParams): Secret {
  // No algorithm check here. `assertEnvelope` has already established that the
  // id is one this build supports, and repeating it would be unreachable code
  // pretending to be defensive. When a second KDF is added, the branch goes
  // here and the type stops being a single literal.
  const key = argon2id(new TextEncoder().encode(passphrase), base64.decode(kdf.salt), {
    m: kdf.m,
    t: kdf.t,
    p: kdf.p,
    dkLen: KEY_BYTES,
  })
  return Secret.fromBytes(key, 'store-key')
}

/**
 * Seal secret bytes under a passphrase.
 *
 * The plaintext is borrowed, not consumed: the caller still owns it and is
 * responsible for disposing it.
 */
export function seal(plaintext: Secret, passphrase: string, params: KdfCost = KDF_DEFAULTS): Envelope {
  if (passphrase.length === 0) {
    throw new StoreError('Refusing to seal a store with an empty passphrase.')
  }

  const kdf: KdfParams = {
    id: 'argon2id',
    m: params.m,
    t: params.t,
    p: params.p,
    salt: base64.encode(randomBytes(SALT_BYTES)),
  }
  const nonceBytes = randomBytes(NONCE_BYTES)
  const nonce = base64.encode(nonceBytes)

  using key = deriveKey(passphrase, kdf)
  const cipher = createCipheriv('aes-256-gcm', key.bytes, nonceBytes)
  cipher.setAAD(header(kdf, nonce))
  const ciphertext = Buffer.concat([cipher.update(plaintext.bytes), cipher.final()])
  const tag = cipher.getAuthTag()

  return {
    format: FORMAT,
    version: VERSION,
    kdf,
    cipher: { id: 'aes-256-gcm', nonce },
    ciphertext: base64.encode(new Uint8Array(ciphertext)),
    tag: base64.encode(new Uint8Array(tag)),
  }
}

/**
 * Open a sealed envelope, or throw.
 *
 * A wrong passphrase and a tampered file raise the same error, with the same
 * message, on purpose. Distinguishing them would tell someone probing the
 * device which of the two they are looking at.
 */
export function open(envelope: Envelope, passphrase: string): Secret {
  assertEnvelope(envelope)

  using key = deriveKey(passphrase, envelope.kdf)
  const tag = base64.decode(envelope.tag)
  if (tag.length !== TAG_BYTES) throw new BadPassphraseError()

  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key.bytes,
      base64.decode(envelope.cipher.nonce)
    )
    decipher.setAAD(header(envelope.kdf, envelope.cipher.nonce))
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([
      decipher.update(base64.decode(envelope.ciphertext)),
      // Throws when the tag does not verify. NOT caught and turned into a
      // "maybe" result: a failed authentication is the whole security property
      // of this function, and swallowing it would return attacker-chosen bytes
      // as a seed.
      decipher.final(),
    ])
    return Secret.fromBytes(new Uint8Array(plaintext), 'store-plaintext')
  } catch {
    throw new BadPassphraseError()
  }
}

/**
 * Validate the shape of something read off disk before touching it.
 *
 * Parsed from a file that an attacker with the card controls, so every field is
 * checked rather than assumed. The parameter bounds matter most: a file
 * claiming `m: 1` would derive a key in microseconds, and a file claiming
 * `m: 2^31` would let a malformed store exhaust memory on a Pi at boot.
 */
export function assertEnvelope(value: unknown): asserts value is Envelope {
  if (typeof value !== 'object' || value === null) {
    throw new StoreError('The store file is not an object.')
  }
  // Read as a bag of unknowns rather than cast to Partial<Envelope>. Casting
  // would tell the compiler that `kdf.id` is already the literal 'argon2id',
  // which is exactly the thing being checked, and every check below would be
  // dead code that looks alive.
  const e = value as Record<string, unknown>

  if (e['format'] !== FORMAT) {
    throw new StoreError(`The store file is not a ${FORMAT} (found "${String(e['format'])}").`)
  }
  if (e['version'] !== VERSION) {
    throw new StoreError(
      `This store was written in format version ${String(e['version'])} and this build reads ` +
        `version ${String(VERSION)}. A newer nullroute wrote it.`
    )
  }
  if (typeof e['ciphertext'] !== 'string' || typeof e['tag'] !== 'string') {
    throw new StoreError('The store file is missing its ciphertext or tag.')
  }

  const cipher = e['cipher']
  if (
    typeof cipher !== 'object' ||
    cipher === null ||
    (cipher as Record<string, unknown>)['id'] !== 'aes-256-gcm' ||
    typeof (cipher as Record<string, unknown>)['nonce'] !== 'string'
  ) {
    throw new StoreError('The store file does not name a cipher this build supports.')
  }

  const kdf = e['kdf']
  if (typeof kdf !== 'object' || kdf === null) {
    throw new StoreError('The store file does not name a key derivation this build supports.')
  }
  const k = kdf as Record<string, unknown>
  if (k['id'] !== 'argon2id' || typeof k['salt'] !== 'string') {
    throw new StoreError('The store file does not name a key derivation this build supports.')
  }

  // Bounds, not just types. Below these a stolen card is cheap to attack;
  // above them the device cannot open its own store.
  const inRange = (n: unknown, lo: number, hi: number): boolean =>
    typeof n === 'number' && Number.isInteger(n) && n >= lo && n <= hi
  if (!inRange(k['m'], 8192, 1048576) || !inRange(k['t'], 1, 16) || !inRange(k['p'], 1, 4)) {
    throw new StoreError(
      'The store file states key derivation parameters outside the range this build accepts. ' +
        'Refusing to use them.'
    )
  }
  if (base64.decode(k['salt']).length !== SALT_BYTES) {
    throw new StoreError('The store file has a salt of the wrong length.')
  }
}

/**
 * Constant-time comparison, for callers checking a value against a stored one.
 *
 * Exported because the retry counter in store.ts needs it and should not grow
 * its own. Length is compared first and in variable time, which leaks only the
 * length, and both inputs here are fixed size anyway.
 */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
