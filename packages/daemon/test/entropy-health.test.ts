/**
 * Tests for the machine entropy health gates.
 *
 * These gates were documented in docs/ENTROPY.md, in the present tense, as
 * things the daemon does before any machine source is used. None of them
 * existed. Somebody reading that page to decide between rolling dice and
 * letting the device choose was told the second path was gated, and it was not.
 *
 * The hardest requirement is the same one the provisioning verifiers have: not
 * reporting health that was not observed. None of these paths exist outside
 * Linux, and a gate that returned "healthy" because it could not find its own
 * evidence would be worse than no gate, on a more expensive subject.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  EARLY_BOOT_SECONDS,
  MIN_ENTROPY_AVAIL,
  checkEntropyHealth,
  type HealthSources,
} from '../src/entropy/health.js'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nullroute-health-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** A fixture stand-in for the Linux paths. */
function sources(options: {
  entropyAvail?: string
  hwrng?: Buffer | 'missing'
  uptime?: number | null
}): HealthSources {
  const entropyPath = join(dir, 'entropy_avail')
  if (options.entropyAvail !== undefined) writeFileSync(entropyPath, options.entropyAvail)

  const hwrngPath = join(dir, 'hwrng')
  if (options.hwrng !== undefined && options.hwrng !== 'missing') {
    writeFileSync(hwrngPath, options.hwrng)
  }

  return {
    entropyAvail: options.entropyAvail === undefined ? join(dir, 'absent') : entropyPath,
    hwrng:
      options.hwrng === undefined || options.hwrng === 'missing' ? join(dir, 'absent') : hwrngPath,
    uptimeSeconds: () => options.uptime ?? null,
  }
}

/** 64 bytes: two different 32-byte blocks, as a working generator would give. */
function twoGoodBlocks(): Buffer {
  return Buffer.concat([Buffer.alloc(32, 0xa5), Buffer.alloc(32, 0x5a)])
}

describe('daemon.entropy.health', () => {
  /**
   * INV-ENTHEALTH-1. Nothing to look at means unknown, not healthy.
   */
  it('reports-unknown-rather-than-healthy-when-it-cannot-look', () => {
    const report = checkEntropyHealth(sources({}))

    expect(report.healthy).toBe(false)
    expect(report.unknown).toBe(true)
    const pool = report.checks.find((c) => c.name === 'kernel-pool')
    expect(pool?.verdict).toBe('unknown')
    expect(pool?.detail).toContain('Linux path')
  })

  /**
   * INV-ENTHEALTH-1. Stated separately because it is the property that matters
   * and the one easiest to lose in a refactor: `unknown` must never satisfy
   * `healthy`.
   */
  it('never-calls-an-unknown-source-healthy', () => {
    // Everything readable and fine except the hardware RNG, which is absent.
    const report = checkEntropyHealth(
      sources({ entropyAvail: '4096', hwrng: 'missing', uptime: 3600 })
    )
    expect(report.checks.some((c) => c.verdict === 'unknown')).toBe(true)
    expect(report.healthy).toBe(false)
  })

  /**
   * INV-ENTHEALTH-2. The stuck-generator test, and the reason two reads are
   * taken rather than one: a constant is indistinguishable from a good sample
   * when you only look once.
   */
  it('refuses-a-stuck-generator', () => {
    const stuck = Buffer.concat([Buffer.alloc(32, 0x7f), Buffer.alloc(32, 0x7f)])
    const report = checkEntropyHealth(sources({ entropyAvail: '4096', hwrng: stuck, uptime: 3600 }))

    const rng = report.checks.find((c) => c.name === 'hardware-rng')
    expect(rng?.verdict).toBe('failed')
    expect(rng?.detail).toContain('identical')
    expect(report.healthy).toBe(false)
  })

  it('refuses-an-all-zero-read', () => {
    const zeros = Buffer.concat([Buffer.alloc(32, 0), Buffer.alloc(32, 0x11)])
    const report = checkEntropyHealth(sources({ entropyAvail: '4096', hwrng: zeros, uptime: 3600 }))

    const rng = report.checks.find((c) => c.name === 'hardware-rng')
    expect(rng?.verdict).toBe('failed')
    expect(rng?.detail).toContain('all zero')
  })

  it('accepts-two-different-non-zero-reads', () => {
    const report = checkEntropyHealth(
      sources({ entropyAvail: '4096', hwrng: twoGoodBlocks(), uptime: 3600 })
    )

    expect(report.checks.find((c) => c.name === 'hardware-rng')?.verdict).toBe('ok')
    expect(report.healthy).toBe(true)
    expect(report.unknown).toBe(false)
  })

  /**
   * INV-ENTHEALTH-3. An unseeded pool is the early-boot failure: a headless
   * device with no keyboard, no mouse and no network has almost nothing feeding
   * it, and generating a seed then is the worst moment available.
   */
  it('refuses-an-unseeded-kernel-pool', () => {
    const report = checkEntropyHealth(
      sources({
        entropyAvail: String(MIN_ENTROPY_AVAIL - 1),
        hwrng: twoGoodBlocks(),
        uptime: 3600,
      })
    )

    const pool = report.checks.find((c) => c.name === 'kernel-pool')
    expect(pool?.verdict).toBe('failed')
    expect(pool?.detail).toContain('not seeded')
    expect(report.healthy).toBe(false)
  })

  it('refuses-early-boot-without-a-hardware-rng', () => {
    const report = checkEntropyHealth(
      sources({ entropyAvail: '4096', hwrng: 'missing', uptime: EARLY_BOOT_SECONDS - 1 })
    )

    const age = report.checks.find((c) => c.name === 'boot-age')
    expect(age?.verdict).toBe('failed')
    expect(age?.detail).toContain('no hardware RNG')
  })

  /**
   * A hardware RNG that works makes boot age irrelevant: the pool being young
   * does not matter when there is a dedicated source feeding it.
   */
  it('allows-early-boot-when-a-hardware-rng-is-present', () => {
    const report = checkEntropyHealth(
      sources({ entropyAvail: '4096', hwrng: twoGoodBlocks(), uptime: 1 })
    )

    expect(report.checks.find((c) => c.name === 'boot-age')?.verdict).toBe('ok')
    expect(report.healthy).toBe(true)
  })
})
