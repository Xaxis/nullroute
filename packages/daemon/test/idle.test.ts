/**
 * Tests for the idle lock.
 *
 * A clock is injected rather than waited on, so these run in microseconds and
 * so nothing here depends on the machine being fast enough. A test that slept
 * for ten minutes would be a test nobody runs.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHandler } from '../src/handler.js'
import { IdleClock, IDLE_LOCK_SECONDS, IDLE_WARN_SECONDS } from '../src/idle.js'
import { Session } from '../src/session.js'
import { WalletRegistry } from '../src/store/registry.js'
import { WalletStore } from '../src/store/store.js'
import type { BootAttestation } from '../src/boot/attestation.js'

const FAST = { m: 8192, t: 1, p: 1 } as const
const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

const attestation = { passed: true } as unknown as BootAttestation

let dir: string
let session: Session
let idle: IdleClock
let clock: number
let call: (method: string, params?: Record<string, unknown>) => Promise<unknown>

/** Move the injected clock forward, in seconds. */
function advance(seconds: number): void {
  clock += seconds * 1000
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nullroute-idle-'))
  clock = 1_700_000_000_000
  session = new Session()
  idle = new IdleClock({ now: () => clock })
  const handler = createHandler({
    attestation,
    session,
    store: new WalletStore(dir, FAST),
    registry: new WalletRegistry(dir, FAST),
    idle,
  })
  call = (method, params = {}) => handler({ id: '1', method, params })
})

afterEach(() => {
  session.lock()
  rmSync(dir, { recursive: true, force: true })
})

describe('IdleClock', () => {
  /** INV-IDLE-1. A touch, and only a touch, is somebody being there. */
  it('counts-only-a-heartbeat-as-somebody-being-there', async () => {
    await call('wallet.import', { mnemonic: MNEMONIC, passphrase: '' })

    advance(IDLE_LOCK_SECONDS - 5)
    expect(idle.expired()).toBe(false)

    await call('session.heartbeat')
    advance(IDLE_LOCK_SECONDS - 5)

    // Nine minutes and fifty five seconds after a touch that came nine minutes
    // and fifty five seconds in. Without the reset this would be long past.
    expect(idle.expired()).toBe(false)
    expect(session.hasWallet).toBe(true)
  })

  /**
   * INV-IDLE-1. The failure this is supposed to prevent, dressed as a feature:
   * a screen that refreshes would otherwise hold a seed in memory forever.
   */
  it('does-not-reset-when-other-requests-arrive', async () => {
    await call('wallet.import', { mnemonic: MNEMONIC, passphrase: '' })

    // A screen polling away for the whole window.
    for (let elapsed = 0; elapsed < IDLE_LOCK_SECONDS; elapsed += 30) {
      advance(30)
      if (session.hasWallet) await call('device.status')
    }

    expect(idle.expired()).toBe(true)
  })

  /** INV-IDLE-2. Locked before the late request is served, not after. */
  it('locks-the-wallet-before-serving-a-late-request', async () => {
    await call('wallet.import', { mnemonic: MNEMONIC, passphrase: '' })
    expect(session.hasWallet).toBe(true)

    advance(IDLE_LOCK_SECONDS + 1)

    // A request that would have succeeded a second earlier. It has to fail
    // because the wallet is shut, not merely return something stale.
    await expect(call('wallet.addresses', { scriptType: 'p2wpkh' })).rejects.toThrow()
    expect(session.hasWallet).toBe(false)
  })

  /**
   * INV-IDLE-2. The window comes from the daemon so a screen counts down from
   * the real number rather than a copy that drifts out of step with it.
   */
  it('reports-the-window-so-a-screen-need-not-copy-it', async () => {
    const beat = (await call('session.heartbeat')) as {
      idle: { seconds: number; warnAt: number } | null
    }
    expect(beat.idle).toEqual({ seconds: IDLE_LOCK_SECONDS, warnAt: IDLE_WARN_SECONDS })
  })

  /**
   * INV-IDLE-3. A clock that jumps forward must not produce a large negative
   * remaining time that a caller reads as plenty of time left.
   */
  it('floors-at-zero-rather-than-going-negative', () => {
    advance(IDLE_LOCK_SECONDS * 100)
    expect(idle.remaining()).toBe(0)
    expect(idle.expired()).toBe(true)
  })

  /**
   * INV-IDLE-3. There has to be a window in which the screen can warn and a
   * person can react, or the feature is an ambush.
   */
  it('warns-before-the-deadline-not-at-it', () => {
    expect(IDLE_WARN_SECONDS).toBeGreaterThan(0)
    expect(IDLE_WARN_SECONDS).toBeLessThan(IDLE_LOCK_SECONDS)

    advance(IDLE_LOCK_SECONDS - IDLE_WARN_SECONDS + 1)
    const left = idle.remaining()
    expect(left).toBeGreaterThan(0)
    expect(left).toBeLessThanOrEqual(IDLE_WARN_SECONDS)
  })
})
