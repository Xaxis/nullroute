/**
 * Tests for what a disposed seed leaves behind.
 *
 * Secret.dispose() zeroes the buffer the Secret owns. It cannot zero a copy it
 * never saw, and opening a store made two: Buffer.from(hex) and the decipher's
 * output Buffers, each small enough to come out of Node's shared 8KB pool,
 * which outlives the call. The raw seed and the hex plaintext were both still
 * readable there after dispose().
 *
 * What this cannot cover, and secret.ts already says: a JavaScript string is
 * immutable, so the JSON text and the hex string parsed out of it are left to
 * the garbage collector.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAINNET, Secret } from '@nullroute/core'
import { StoreError, seedFromHex } from '../src/store/envelope.js'
import { createBackup, restoreBackup } from '../src/store/backup.js'
import { WalletStore } from '../src/store/store.js'

const FAST = { m: 8192, t: 1, p: 1 } as const
// Distinctive, so a match in the pool is this seed and not a coincidence.
const SEED_HEX = 'c0ffee15deadbeef8badf00d0ddba11fee1dead5ca1ab1efacefeedbaadf00d0'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nullroute-pool-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function indexOf(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer
    }
    return i
  }
  return -1
}

/** The pool small Buffers are allocated from right now. */
function pool(): Uint8Array {
  return new Uint8Array(Buffer.allocUnsafe(1).buffer)
}

/**
 * Whether the pool still holds the seed, in raw or hex form.
 *
 * With a control: a canary written through the same allocator must be found,
 * or the search is looking at a different pool from the one the code used and
 * a "not found" would prove nothing.
 */
function leftInPool(): { raw: boolean; hex: boolean } {
  const canary = Buffer.from('6e756c6c726f7574652d63616e617279', 'hex')
  const current = pool()
  expect(indexOf(current, canary), 'the canary is in the pool being searched').toBeGreaterThan(-1)
  return {
    // The needle is built outside the pool: Buffer.from would write the very
    // bytes being searched for into the pool being searched.
    raw: indexOf(current, seedFromHex(SEED_HEX)) !== -1,
    hex: indexOf(current, new TextEncoder().encode(SEED_HEX.slice(0, 32))) !== -1,
  }
}

describe('what a disposed seed leaves in the Buffer pool', () => {
  /** INV-STORE-9. Opening a sealed store. */
  it('leaves-no-copy-of-a-stored-seed-after-dispose', () => {
    const store = new WalletStore(dir, FAST)
    store.create(Secret.fromBytes(seedFromHex(SEED_HEX), 'test'), MAINNET, 'pw')
    pool().fill(0)

    const opened = store.unlock('pw')
    expect(Array.from(opened.seed.bytes)).toEqual(Array.from(seedFromHex(SEED_HEX)))
    opened.seed.dispose()

    expect(leftInPool()).toEqual({ raw: false, hex: false })
  })

  /** INV-STORE-9. Restoring a backup that carries its seed. */
  it('leaves-no-copy-of-a-restored-seed-after-dispose', () => {
    const backup = createBackup(
      {
        network: MAINNET,
        registrations: [],
        label: 'Vault',
        seed: Secret.fromBytes(seedFromHex(SEED_HEX), 'test'),
      },
      'pw',
      'test',
      FAST
    )
    pool().fill(0)

    const restored = restoreBackup(backup, 'pw')
    expect(restored.seed).toBeDefined()
    restored.seed?.dispose()

    expect(leftInPool()).toEqual({ raw: false, hex: false })
  })

  /**
   * INV-STORE-9. Malformed hex is refused. Buffer.from stopped at the first bad
   * character and returned a shorter seed, which is a different wallet.
   */
  it('refuses-seed-hex-it-cannot-read-rather-than-truncating-it', () => {
    for (const bad of ['', 'abc', `${SEED_HEX.slice(0, 20)}zz${SEED_HEX.slice(22)}`]) {
      expect(() => seedFromHex(bad), JSON.stringify(bad)).toThrow(StoreError)
    }
    expect(seedFromHex(SEED_HEX)).toHaveLength(32)
  })
})
