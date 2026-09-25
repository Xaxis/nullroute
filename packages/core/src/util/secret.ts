/**
 * INV-KEY-2: every buffer holding a secret is zeroized after use.
 *
 * Spec: core.util.secret
 *
 * The problem this solves is not that people forget to zeroize. It is that
 * zeroization scattered across call sites is unauditable: you cannot tell, by
 * reading a function, whether the caller will clean up, and you cannot grep for
 * the places that failed to. A raw `Uint8Array` of seed bytes looks exactly
 * like a raw `Uint8Array` of an address.
 *
 * So secrets get a distinct type. Lint forbids raw byte arrays for secret
 * material in packages/core and packages/daemon, which turns "did someone
 * remember" into a compile-time question.
 *
 * What this class honestly provides:
 *
 *   - Explicit, greppable disposal, with use-after-dispose as a loud error
 *     rather than a silent read of stale or reused memory.
 *   - Redaction on every path that stringifies an object, so a secret cannot
 *     reach a log line or an error message by accident. That is the mechanism
 *     behind INV-KEY-1.
 *
 * What it does NOT provide, and nobody should assume:
 *
 *   - It cannot stop V8 from having already copied the bytes. A Uint8Array can
 *     be relocated by the garbage collector between allocation and disposal,
 *     leaving a copy behind that we have no reference to and cannot clear. This
 *     is a real limitation of doing cryptography in a managed runtime and it is
 *     stated in docs/THREAT-MODEL.md rather than papered over.
 *   - It is not protection against an attacker who can read process memory. If
 *     they can do that while the process is live, the secret is in use and
 *     therefore in memory regardless.
 *
 * The mitigation for the first point is at the system level, not here: no swap
 * and tmpfs for scratch (provisioning/HARDENING.md), and the seed disposed at
 * lock and on the idle timeout (INV-IDLE-2). The daemon runs until power-off,
 * so a short-lived process is not one of them.
 */

import { clean } from '@noble/hashes/utils.js'

/** Thrown when a disposed secret is read. Never carries the secret. */
export class SecretDisposedError extends Error {
  constructor(label: string) {
    super(
      `Secret "${label}" was used after disposal. This is a bug: the value is gone ` +
        `and reading it would return zeroized or reused memory.`
    )
    this.name = 'SecretDisposedError'
  }
}

/**
 * A byte buffer holding key material, with explicit disposal.
 *
 * Implements `Disposable`, so the preferred call shape is:
 *
 *   using seed = Secret.fromBytes(bytes, 'seed')
 *   derive(seed.bytes)
 *   // zeroized at end of scope, including on an early return or a throw
 */
export class Secret implements Disposable {
  #bytes: Uint8Array | null
  readonly #label: string

  private constructor(bytes: Uint8Array, label: string) {
    this.#bytes = bytes
    this.#label = label
  }

  /**
   * Take ownership of `bytes`. The caller must not retain its own reference:
   * disposal zeroizes this buffer in place, so any surviving alias sees zeros.
   */
  static fromBytes(bytes: Uint8Array, label: string): Secret {
    return new Secret(bytes, label)
  }

  /**
   * Copy `bytes` into a new secret, leaving the caller's buffer untouched.
   * Use this when the source is owned by someone else. It leaves the original
   * un-zeroized by definition, so the caller still has to deal with that.
   */
  static copyOf(bytes: Uint8Array, label: string): Secret {
    return new Secret(Uint8Array.from(bytes), label)
  }

  /** A zero-filled secret of `length` bytes, for a caller that fills it in place. */
  static alloc(length: number, label: string): Secret {
    return new Secret(new Uint8Array(length), label)
  }

  /** Human-readable name, used in errors. Never the value. */
  get label(): string {
    return this.#label
  }

  get disposed(): boolean {
    return this.#bytes === null
  }

  get length(): number {
    return this.#read().length
  }

  /**
   * The underlying bytes. Live reference, not a copy, so mutations are visible
   * to the secret and disposal zeroizes what the caller is holding.
   */
  get bytes(): Uint8Array {
    return this.#read()
  }

  /**
   * Run `fn` with the bytes and dispose afterwards, including on a throw.
   * Equivalent to `using`, for contexts where an explicit scope reads better.
   */
  static withBytes<T>(secret: Secret, fn: (bytes: Uint8Array) => T): T {
    try {
      return fn(secret.bytes)
    } finally {
      secret.dispose()
    }
  }

  /**
   * Constant-time equality. Always compares the full length so the timing does
   * not reveal the position of the first differing byte, which is what a naive
   * early-return comparison leaks.
   *
   * Length is compared first and does short-circuit. That is deliberate: buffer
   * lengths here are public (a 32-byte seed is 32 bytes), so there is nothing to
   * leak, and pretending otherwise would mean padding to a fixed size for no gain.
   */
  equals(other: Secret): boolean {
    const a = this.#read()
    const b = other.#read()
    if (a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i += 1) {
      diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
    }
    return diff === 0
  }

  /**
   * Zeroize and release. Idempotent, so a `using` scope and an explicit call
   * cannot double-free.
   */
  dispose(): void {
    if (this.#bytes === null) return
    clean(this.#bytes)
    this.#bytes = null
  }

  [Symbol.dispose](): void {
    this.dispose()
  }

  #read(): Uint8Array {
    if (this.#bytes === null) throw new SecretDisposedError(this.#label)
    return this.#bytes
  }

  // --- Redaction -----------------------------------------------------------
  // Every route by which an object turns into text is closed. A secret that
  // reaches a log line, an error message, or an IPC response is INV-KEY-1
  // violated, and the most likely way that happens is someone interpolating an
  // object into a template string while debugging.

  toString(): string {
    return `[Secret ${this.#label}]`
  }

  toJSON(): string {
    return `[Secret ${this.#label}]`
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `[Secret ${this.#label}]`
  }

  readonly [Symbol.toStringTag] = 'Secret'
}
