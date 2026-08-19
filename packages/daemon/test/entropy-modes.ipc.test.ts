/**
 * Tests for the machine entropy IPC surface.
 *
 * docs/ENTROPY.md has described Mode C, machine-only, since it was written,
 * including that the UI "requires a second confirmation". Neither the mode nor
 * the confirmation existed. The document was describing a device.
 *
 * The interesting part is not that a seed comes out. It is what has to be true
 * first, and what the device refuses.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHandler } from '../src/handler.js'
import { Session } from '../src/session.js'
import { WalletRegistry } from '../src/store/registry.js'
import { WalletStore } from '../src/store/store.js'
import type { BootAttestation } from '../src/boot/attestation.js'

const FAST = { m: 8192, t: 1, p: 1 } as const
const attestation = { passed: true } as unknown as BootAttestation

let dir: string
let session: Session
let call: (method: string, params?: Record<string, unknown>) => Promise<unknown>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nullroute-entropy-'))
  session = new Session()
  const handler = createHandler({
    attestation,
    session,
    store: new WalletStore(dir, FAST),
    registry: new WalletRegistry(dir, FAST),
  })
  call = (method, params = {}) => handler({ id: '1', method, params })
})

afterEach(() => {
  session.lock()
  rmSync(dir, { recursive: true, force: true })
})

describe('entropy.rollDice', () => {
  /**
   * INV-ENTMODE-1. Rejection sampling, not modulo.
   *
   * 256 is not divisible by 6, so `byte % 6` makes 1 through 4 about 1.6
   * percent more likely than 5 and 6. That bias is small, it is invisible in
   * any hand check, and it is exactly the kind of thing a project whose whole
   * claim is checkable arithmetic has no business shipping.
   *
   * Six thousand rolls will not detect a 1.6 percent bias reliably, and that is
   * not what this test is for: it is a smoke test that every face appears and
   * none dominates. The correctness argument is the discard, which is in the
   * handler and stated in its comment.
   */
  it('produces-every-face-without-an-obvious-lean', async () => {
    const result = (await call('entropy.rollDice', { count: 100 })) as { rolls: string }
    expect(result.rolls).toHaveLength(100)
    expect(/^[1-6]{100}$/.test(result.rolls)).toBe(true)

    let all = ''
    for (let i = 0; i < 60; i += 1) {
      all += ((await call('entropy.rollDice', { count: 100 })) as { rolls: string }).rolls
    }
    const counts = new Map<string, number>()
    for (const face of all) counts.set(face, (counts.get(face) ?? 0) + 1)

    expect(counts.size).toBe(6)
    for (const [face, count] of counts) {
      // A tenth of 6000, give or take a wide margin. Detecting the modulo bias
      // is not the goal; detecting a broken generator is.
      expect(count, `face ${face}`).toBeGreaterThan(800)
      expect(count, `face ${face}`).toBeLessThan(1200)
    }
  })

  /**
   * INV-ENTMODE-1. The response says the rolls came from the device, so a screen
   * cannot present them as though somebody watched them land.
   */
  it('says-in-the-response-that-the-device-chose-them', async () => {
    const result = (await call('entropy.rollDice', { count: 5 })) as {
      fromDevice: boolean
      note: string
    }
    expect(result.fromDevice).toBe(true)
    expect(result.note).toContain('not observed by you')
    expect(result.note).toContain('rolls themselves are not')
  })

  it('bounds-what-it-will-roll-in-one-call', async () => {
    const many = (await call('entropy.rollDice', { count: 1000 })) as { rolls: string }
    expect(many.rolls).toHaveLength(100)
    const none = (await call('entropy.rollDice', { count: 0 })) as { rolls: string }
    expect(none.rolls).toHaveLength(1)
  })
})

describe('entropy.fromMachine', () => {
  /**
   * INV-ENTMODE-2. Without an acknowledgement there is no seed, and the refusal
   * says what the acknowledgement is about rather than being a consent gate.
   */
  it('refuses-without-an-explicit-acknowledgement', async () => {
    await expect(call('entropy.fromMachine', {})).rejects.toThrow(/cannot be checked by hand/)
    await expect(call('entropy.fromMachine', { acknowledged: 'yes' })).rejects.toThrow(
      /cannot be checked by hand/
    )
    // No seed was loaded by the attempt.
    expect(session.fingerprint).toBeUndefined()
  })

  /**
   * INV-ENTMODE-2. The health gates run before anything is generated, and the
   * refusal names which one failed and points at the path that does not depend
   * on any of it.
   *
   * This runs on a machine with no /dev/hwrng and no /proc, so the gates report
   * unknown, and unknown is not healthy. That is the assertion: the developer
   * machine is exactly where a lax rule would be written and never noticed.
   */
  it('refuses-when-the-device-cannot-confirm-its-own-sources', async () => {
    await expect(call('entropy.fromMachine', { acknowledged: true })).rejects.toThrow(
      /cannot confirm its entropy sources/
    )
    await expect(call('entropy.fromMachine', { acknowledged: true })).rejects.toThrow(
      /Roll dice instead/
    )
    expect(session.fingerprint).toBeUndefined()
  })
})

describe('entropy.health', () => {
  /**
   * INV-ENTHEALTH-1, across the boundary. The report is returned rather than
   * acted on, so a screen can show what was and was not observed.
   */
  it('reports-what-it-could-not-observe-rather-than-a-verdict', async () => {
    const report = (await call('entropy.health')) as {
      healthy: boolean
      unknown: boolean
      checks: { name: string; verdict: string; detail: string }[]
    }

    expect(report.checks.length).toBeGreaterThan(0)
    // Off a real device, so nothing can be confirmed, and that is not healthy.
    expect(report.unknown).toBe(true)
    expect(report.healthy).toBe(false)
    expect(report.checks.some((c) => c.verdict === 'unknown')).toBe(true)
  })
})
