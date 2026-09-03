/**
 * Tests for daemon.store and daemon.store.envelope.
 *
 * Written as the attacks rather than as the happy path, because the happy path
 * here is one line and the interesting behaviour is all refusal: a wrong
 * passphrase, a rewritten parameter, a truncated file, a crash during a write.
 *
 * Argon2 parameters are turned right down in these tests. That is safe because
 * what is under test is the plumbing, not the cost, and the cost is what makes
 * the real thing take half a second per attempt. One test pins the shipped
 * defaults so that turning them down here cannot quietly turn them down there.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { base64 } from '@scure/base'
import { MAINNET, SIGNET, Secret, masterFingerprint } from '@nullroute/core'
import {
  BadPassphraseError,
  KDF_DEFAULTS,
  StoreError,
  assertEnvelope,
  open,
  seal,
} from '../src/store/envelope.js'
import { MAX_ATTEMPTS, WalletStore } from '../src/store/store.js'

/** Cheap parameters. The plumbing is under test, not the work factor. */
const FAST = { m: 8192, t: 1, p: 1 } as const

const SEED_HEX = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
const PASSPHRASE = 'correct horse battery staple'

function seedBytes(): Secret {
  return Secret.fromBytes(Uint8Array.from(Buffer.from(SEED_HEX, 'hex')), 'test-seed')
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nullroute-store-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('daemon.store.envelope', () => {
  it('round-trips-a-seed', () => {
    using seed = seedBytes()
    const envelope = seal(seed, PASSPHRASE, FAST)
    using opened = open(envelope, PASSPHRASE)
    expect(Buffer.from(opened.bytes).toString('hex')).toBe(SEED_HEX)
  })

  // INV-STORE-1. The plaintext must not be recoverable from the file.
  it('never-writes-the-seed-in-the-clear', () => {
    using seed = seedBytes()
    const envelope = seal(seed, PASSPHRASE, FAST)
    const serialized = JSON.stringify(envelope)

    expect(serialized).not.toContain(SEED_HEX)
    expect(serialized).not.toContain(PASSPHRASE)
    // And not as raw bytes anywhere in the ciphertext either.
    const cipher = Buffer.from(base64.decode(envelope.ciphertext))
    expect(cipher.includes(Buffer.from(SEED_HEX, 'hex'))).toBe(false)
  })

  // INV-STORE-2. A wrong passphrase fails authentication rather than
  // producing plausible bytes. Returning garbage would hand the caller a valid
  // BIP-32 seed for a wallet the user has never seen.
  it('refuses-a-wrong-passphrase', () => {
    using seed = seedBytes()
    const envelope = seal(seed, PASSPHRASE, FAST)
    expect(() => open(envelope, 'not the passphrase')).toThrow(BadPassphraseError)
    expect(() => open(envelope, '')).toThrow(BadPassphraseError)
    expect(() => open(envelope, `${PASSPHRASE} `)).toThrow(BadPassphraseError)
  })

  it('refuses-an-empty-passphrase-when-sealing', () => {
    using seed = seedBytes()
    expect(() => seal(seed, '', FAST)).toThrow(/empty passphrase/)
  })

  /**
   * INV-STORE-3, and the reason the header is authenticated.
   *
   * The KDF parameters sit outside the ciphertext, so an attacker with the card
   * can edit them. Turning the memory cost down to nothing would make every
   * guess cheap. Because the header is the GCM additional data, altering it
   * breaks the open instead.
   */
  it('refuses-a-file-whose-parameters-were-rewritten', () => {
    using seed = seedBytes()
    const envelope = seal(seed, PASSPHRASE, { m: 16384, t: 2, p: 1 })

    // Still inside the accepted range, so it passes shape validation and has to
    // be caught by the authentication rather than by a bounds check.
    const weakened = { ...envelope, kdf: { ...envelope.kdf, m: 8192 } }
    expect(() => open(weakened, PASSPHRASE)).toThrow(BadPassphraseError)

    const restamped = { ...envelope, kdf: { ...envelope.kdf, t: 1 } }
    expect(() => open(restamped, PASSPHRASE)).toThrow(BadPassphraseError)
  })

  it('refuses-a-tampered-ciphertext-or-tag', () => {
    using seed = seedBytes()
    const envelope = seal(seed, PASSPHRASE, FAST)

    const bytes = base64.decode(envelope.ciphertext)
    bytes[0] = (bytes[0] ?? 0) ^ 0x01
    expect(() => open({ ...envelope, ciphertext: base64.encode(bytes) }, PASSPHRASE)).toThrow(
      BadPassphraseError
    )

    const tag = base64.decode(envelope.tag)
    tag[0] = (tag[0] ?? 0) ^ 0x01
    expect(() => open({ ...envelope, tag: base64.encode(tag) }, PASSPHRASE)).toThrow(
      BadPassphraseError
    )
  })

  // Bounds are enforced before any work is done. A file claiming m=1 would
  // derive a key instantly; one claiming m=2^31 would exhaust a Pi's memory.
  it('refuses-parameters-outside-the-accepted-range', () => {
    using seed = seedBytes()
    const envelope = seal(seed, PASSPHRASE, FAST)

    for (const kdf of [
      { ...envelope.kdf, m: 1 },
      { ...envelope.kdf, m: 2 ** 31 },
      { ...envelope.kdf, t: 0 },
      { ...envelope.kdf, p: 99 },
      { ...envelope.kdf, m: 1.5 },
    ]) {
      expect(() => {
        assertEnvelope({ ...envelope, kdf })
      }, JSON.stringify(kdf)).toThrow(/outside the range/)
    }
  })

  it('refuses-a-file-that-is-not-a-store', () => {
    expect(() => {
      assertEnvelope(null)
    }).toThrow(StoreError)
    expect(() => {
      assertEnvelope({})
    }).toThrow(/not a nullroute-store/)
    expect(() => {
      assertEnvelope({ format: 'nullroute-store', version: 99 })
    }).toThrow(/version/)
  })

  /**
   * The shipped work factor, pinned.
   *
   * These tests run with the cost turned down, so nothing else here would
   * notice if the defaults were lowered. Argon2id at 64 MiB and three passes is
   * roughly half a second on a Pi 4, and the whole protection a stolen card
   * gets is that number multiplied by the size of the guess space.
   */
  it('ships-a-real-work-factor', () => {
    expect(KDF_DEFAULTS.m).toBeGreaterThanOrEqual(65536)
    expect(KDF_DEFAULTS.t).toBeGreaterThanOrEqual(3)
  })

  it('uses-a-fresh-salt-and-nonce-every-time', () => {
    using seed = seedBytes()
    const a = seal(seed, PASSPHRASE, FAST)
    const b = seal(seed, PASSPHRASE, FAST)
    expect(a.kdf.salt).not.toBe(b.kdf.salt)
    expect(a.cipher.nonce).not.toBe(b.cipher.nonce)
    // Same seed, same passphrase, different bytes. A store that sealed
    // deterministically would leak that two devices hold the same wallet.
    expect(a.ciphertext).not.toBe(b.ciphertext)
  })
})

describe('daemon.store', () => {
  it('creates-unlocks-and-reports-status', () => {
    const store = new WalletStore(dir, FAST)
    expect(store.status().exists).toBe(false)

    using seed = seedBytes()
    store.create(seed, SIGNET, PASSPHRASE)
    expect(store.status().exists).toBe(true)
    expect(store.status().attemptsRemaining).toBe(MAX_ATTEMPTS)

    const opened = store.unlock(PASSPHRASE)
    expect(Buffer.from(opened.seed.bytes).toString('hex')).toBe(SEED_HEX)
    opened.seed.dispose()
  })

  // Replacing a wallet has to be deliberate. A create that overwrote would be
  // one mis-tap from erasing a wallet the user believes is safe.
  it('refuses-to-overwrite-an-existing-wallet', () => {
    const store = new WalletStore(dir, FAST)
    using seed = seedBytes()
    store.create(seed, SIGNET, PASSPHRASE)
    expect(() => {
      store.create(seed, SIGNET, 'another passphrase')
    }).toThrow(/already exists/)
  })

  it('counts-failures-and-resets-on-success', () => {
    const store = new WalletStore(dir, FAST)
    using seed = seedBytes()
    store.create(seed, SIGNET, PASSPHRASE)

    expect(() => {
      store.unlock('wrong')
    }).toThrow(BadPassphraseError)
    expect(() => {
      store.unlock('wrong')
    }).toThrow(BadPassphraseError)
    expect(store.status().failedAttempts).toBe(2)
    expect(store.status().attemptsRemaining).toBe(MAX_ATTEMPTS - 2)

    store.unlock(PASSPHRASE).seed.dispose()
    expect(store.status().failedAttempts).toBe(0)
  })

  // INV-STORE-4. The blob is gone before the throw, so a caller that dies on
  // the way out cannot leave an exhausted counter beside an intact wallet.
  it('destroys-the-wallet-after-the-last-attempt', () => {
    const store = new WalletStore(dir, FAST)
    using seed = seedBytes()
    store.create(seed, SIGNET, PASSPHRASE)

    for (let i = 1; i < MAX_ATTEMPTS; i += 1) {
      expect(
        () => {
          store.unlock('wrong')
        },
        `attempt ${String(i)}`
      ).toThrow(BadPassphraseError)
      expect(store.exists()).toBe(true)
    }
    expect(() => {
      store.unlock('wrong')
    }).toThrow(/has been erased/)

    expect(store.exists()).toBe(false)
    expect(store.status().destroyed).toBe(true)
    // And the right passphrase no longer helps, because there is nothing left.
    expect(() => {
      store.unlock(PASSPHRASE)
    }).toThrow(/no wallet/)
  })

  /**
   * The counter is not a security control against someone holding the card,
   * and this test says so out loud rather than leaving the impression that it
   * is. Deleting the sidecar resets the count. That is not a defect to be fixed
   * here: the counter has to be readable before the passphrase is known, so it
   * cannot be authenticated, and anyone who can delete it could equally have
   * copied the blob and be guessing against the copy.
   */
  it('has-a-counter-that-anyone-holding-the-card-can-reset', () => {
    const store = new WalletStore(dir, FAST)
    using seed = seedBytes()
    store.create(seed, SIGNET, PASSPHRASE)

    expect(() => {
      store.unlock('wrong')
    }).toThrow(BadPassphraseError)
    expect(store.status().failedAttempts).toBe(1)

    rmSync(join(dir, 'wallet.attempts'), { force: true })
    expect(store.status().failedAttempts).toBe(0)
    expect(store.exists()).toBe(true)
  })

  // A scribbled counter must not brick a good wallet.
  it('treats-a-corrupt-counter-as-zero', () => {
    const store = new WalletStore(dir, FAST)
    using seed = seedBytes()
    store.create(seed, SIGNET, PASSPHRASE)
    writeFileSync(join(dir, 'wallet.attempts'), 'not json at all')

    expect(store.status().failedAttempts).toBe(0)
    store.unlock(PASSPHRASE).seed.dispose()
  })

  it('refuses-a-truncated-store-file', () => {
    const store = new WalletStore(dir, FAST)
    using seed = seedBytes()
    store.create(seed, SIGNET, PASSPHRASE)

    const whole = readFileSync(store.path, 'utf8')
    writeFileSync(store.path, whole.slice(0, whole.length / 2))
    expect(() => {
      store.unlock(PASSPHRASE)
    }).toThrow(StoreError)
  })

  // INV-STORE-5. A write leaves no temporary files behind, so a directory
  // listing cannot accumulate half-written stores.
  it('leaves-no-temporary-files-behind', () => {
    const store = new WalletStore(dir, FAST)
    using seed = seedBytes()
    store.create(seed, SIGNET, PASSPHRASE)
    store.unlock(PASSPHRASE).seed.dispose()

    const stray = readdirSync(dir).filter((f) => f.endsWith('.tmp'))
    expect(stray).toEqual([])
  })

  /**
   * The network is part of the wallet, so it has to survive a lock.
   *
   * `lock()` resets the session to mainnet deliberately, so that a new wallet
   * never inherits the last one's chain. Before the network was sealed with the
   * seed, that reset meant a signet wallet unlocked into bc1 addresses: real
   * mainnet addresses, shown under a wallet the user had created as a test.
   */
  it('restores-the-network-the-wallet-was-created-on', () => {
    const store = new WalletStore(dir, FAST)
    using seed = seedBytes()
    store.create(seed, SIGNET, PASSPHRASE)

    const opened = store.unlock(PASSPHRASE)
    expect(opened.network.id).toBe('signet')
    expect(opened.network.isMainnet).toBe(false)
    expect(opened.network.id).not.toBe(MAINNET.id)
    opened.seed.dispose()
  })

  /**
   * INV-STORE-6. An unreadable payload must not leave a decrypted seed behind.
   *
   * The store is opened with the correct passphrase, so the plaintext is
   * authentic and the seed is real. It then fails validation, and the question
   * is what happened to the bytes in between. Building the Secret before the
   * last thing that can throw leaves a decrypted seed constructed, orphaned and
   * never disposed, which is an INV-KEY-2 violation.
   *
   * Reachable in practice: a store written by a newer build naming a network
   * this one does not know, which is exactly what the downgrade-and-verify
   * workflow in docs/VERIFICATION.md asks people to do.
   */
  it('constructs-no-seed-when-the-payload-fails-validation', () => {
    const store = new WalletStore(dir, FAST)
    using seed = seedBytes()
    store.create(seed, SIGNET, PASSPHRASE)

    // Re-seal the same wallet naming a network that does not exist here. Sealed
    // rather than edited on disk, because the header is authenticated and an
    // edited file would fail to open before it ever reached the decoder.
    const payload = JSON.stringify({
      v: 1,
      network: 'chain-from-the-future',
      seed: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
    })
    using plaintext = Secret.fromBytes(new TextEncoder().encode(payload), 'test-payload')
    writeFileSync(
      join(dir, 'wallet.store'),
      JSON.stringify(seal(plaintext, PASSPHRASE, FAST), null, 2)
    )

    const made = vi.spyOn(Secret, 'fromBytes')
    try {
      expect(() => store.unlock(PASSPHRASE)).toThrow(/Unknown network/)
      // The seed is the one Secret that must never be built on this path.
      const labels = made.mock.calls.map((call) => call[1])
      expect(labels).not.toContain('stored-seed')
    } finally {
      made.mockRestore()
    }
  })

  /**
   * INV-STORE-7. What was sealed is what comes back, byte for byte.
   *
   * This looks tautological and is not. Adding a sealed identity introduced a
   * check that wrapped the decoded seed in a `Secret` to derive a fingerprint
   * from it, and `Secret.fromBytes` takes ownership: disposing the check
   * zeroized the buffer the real seed was about to be built from. Every stored
   * wallet unlocked into 32 zero bytes, which is a valid wallet, with a
   * consistent fingerprint, that nobody has the keys to.
   *
   * Nothing else caught it. The store opened, the identity matched, the label
   * was right, and the addresses were wrong.
   */
  it('returns-exactly-the-seed-that-was-sealed', () => {
    const store = new WalletStore(dir, FAST)
    using seed = seedBytes()
    const before = Buffer.from(seed.bytes).toString('hex')

    store.create(seed, SIGNET, PASSPHRASE, [], {
      label: 'Cold storage',
      colour: 'teal',
      fingerprint: masterFingerprint(seed, SIGNET),
    })

    const opened = store.unlock(PASSPHRASE)
    expect(Buffer.from(opened.seed.bytes).toString('hex')).toBe(before)
    expect(Buffer.from(opened.seed.bytes).toString('hex')).not.toBe('00'.repeat(32))
    expect(opened.label).toBe('Cold storage')
    expect(opened.colour).toBe('teal')
    opened.seed.dispose()
  })

  it('erases-on-request', () => {
    const store = new WalletStore(dir, FAST)
    using seed = seedBytes()
    store.create(seed, SIGNET, PASSPHRASE)
    store.destroy()
    expect(store.exists()).toBe(false)
    // Erasing something already erased is not an error.
    store.destroy()
  })
})
