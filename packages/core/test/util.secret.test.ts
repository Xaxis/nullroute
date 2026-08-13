/**
 * Tests for core.util.secret.
 *
 * Test names here are referenced by invariant bindings in secret.spec.yaml,
 * which carries INV-KEY-2.
 */

import { describe, expect, it } from 'vitest'
import { Secret, SecretDisposedError } from '../src/util/secret.js'

describe('core.util.secret', () => {
  // INV-KEY-2: dispose zeroizes the underlying buffer.
  it('zeroizes-on-dispose', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    const secret = Secret.fromBytes(bytes, 'seed')

    expect(secret.bytes).toBe(bytes)
    secret.dispose()

    // The caller's own reference is zeroized in place, not just detached.
    // A detach-only implementation would leave the plaintext in memory with
    // nothing holding it, which is exactly the failure this guards.
    expect([...bytes]).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
    expect(secret.disposed).toBe(true)
  })

  it('use-after-dispose-throws', () => {
    const secret = Secret.fromBytes(new Uint8Array([9, 9]), 'seed')
    secret.dispose()

    expect(() => secret.bytes).toThrow(SecretDisposedError)
    expect(() => secret.length).toThrow(SecretDisposedError)
    // The error names the secret but never carries its value.
    expect(() => secret.bytes).toThrow(/Secret "seed" was used after disposal/)
  })

  it('dispose-is-idempotent', () => {
    const secret = Secret.fromBytes(new Uint8Array([1]), 'seed')
    secret.dispose()
    expect(() => {
      secret.dispose()
    }).not.toThrow()
  })

  // The `using` declaration must dispose on scope exit, including on a throw.
  it('disposes-on-scope-exit', () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    {
      using secret = Secret.fromBytes(bytes, 'scoped')
      expect(secret.length).toBe(4)
    }
    expect([...bytes]).toEqual([0, 0, 0, 0])
  })

  it('disposes-when-scope-throws', () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    expect(() => {
      using secret = Secret.fromBytes(bytes, 'scoped')
      void secret.length
      throw new Error('boom')
    }).toThrow('boom')
    expect([...bytes]).toEqual([0, 0, 0, 0])
  })

  it('withBytes-disposes-after-the-callback', () => {
    const bytes = new Uint8Array([7, 7, 7])
    const secret = Secret.fromBytes(bytes, 'scoped')
    const length = Secret.withBytes(secret, (b) => b.length)
    expect(length).toBe(3)
    expect(secret.disposed).toBe(true)
    expect([...bytes]).toEqual([0, 0, 0])
  })

  it('copyOf-does-not-alias-the-source', () => {
    const source = new Uint8Array([1, 2, 3])
    const secret = Secret.copyOf(source, 'copy')
    secret.dispose()
    // The caller's buffer is untouched, which is the documented contract and
    // also means the caller still has to deal with it themselves.
    expect([...source]).toEqual([1, 2, 3])
  })

  // INV-KEY-1 support: a secret cannot reach a log line or an IPC response by
  // being interpolated into text. Every stringification path is closed.
  it('redacts-on-every-stringification-path', () => {
    const secret = Secret.fromBytes(new Uint8Array([0xde, 0xad, 0xbe, 0xef]), 'seed')

    expect(String(secret)).toBe('[Secret seed]')
    // Interpolating a Secret is exactly what this test exists to check, so the
    // rule that normally forbids it is disabled here on purpose.
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    expect(`${secret}`).toBe('[Secret seed]')
    expect(JSON.stringify(secret)).toBe('"[Secret seed]"')
    expect(JSON.stringify({ wrapped: secret })).toBe('{"wrapped":"[Secret seed]"}')
    expect(Object.prototype.toString.call(secret)).toBe('[object Secret]')

    // None of them leak the bytes.
    for (const rendered of [String(secret), JSON.stringify({ wrapped: secret })]) {
      expect(rendered).not.toContain('deadbeef')
      expect(rendered).not.toContain('222')
    }

    secret.dispose()
  })

  it('compares-in-constant-time-over-the-full-length', () => {
    const a = Secret.fromBytes(new Uint8Array([1, 2, 3, 4]), 'a')
    const b = Secret.fromBytes(new Uint8Array([1, 2, 3, 4]), 'b')
    const c = Secret.fromBytes(new Uint8Array([1, 2, 3, 5]), 'c')
    const shorter = Secret.fromBytes(new Uint8Array([1, 2, 3]), 'd')

    expect(a.equals(b)).toBe(true)
    expect(a.equals(c)).toBe(false)
    expect(a.equals(shorter)).toBe(false)

    for (const s of [a, b, c, shorter]) s.dispose()
  })

  it('alloc-produces-a-zeroed-buffer-of-the-requested-size', () => {
    using secret = Secret.alloc(32, 'blank')
    expect(secret.length).toBe(32)
    expect([...secret.bytes].every((b) => b === 0)).toBe(true)
  })
})
