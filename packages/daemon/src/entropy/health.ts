/**
 * Whether a machine entropy source can be trusted enough to use.
 *
 * Spec: daemon.entropy.health
 *
 * docs/ENTROPY.md has described these gates for a long time, in the present
 * tense, as things "the daemon" does before any machine source is used. None of
 * them existed. That is the overclaim this project calls a security bug: a
 * reader deciding between the dice path and a machine path was told the machine
 * path is gated, and it was not.
 *
 * WHAT IS CHECKED, and each is a real failure mode rather than a ritual:
 *
 *   The kernel pool is initialised. `entropy_avail` near zero on Linux means
 *   the CSPRNG has not been seeded, which happens in early boot and is exactly
 *   when a headless device with no user input is at its weakest.
 *
 *   A hardware RNG exists. The Pi has one. Its absence means the pool is being
 *   fed by timing jitter alone on a machine with no keyboard, no mouse and no
 *   network.
 *
 *   Two consecutive reads differ, and neither is all zero. This is the stuck-RNG
 *   test. A hardware RNG that has failed typically returns a constant, and a
 *   constant passes every statistical test applied to a single sample.
 *
 * WHAT IT REFUSES TO DO. Report health it did not observe. None of these paths
 * exist outside Linux, and much of this project is written on a Mac. A gate
 * that returned "healthy" because it could not find its own evidence would be
 * the same false pass the provisioning verifiers are careful about, on a more
 * expensive subject. It reports `unknown` instead, and the caller decides.
 */

import { readFileSync, existsSync, openSync, readSync, closeSync } from 'node:fs'

/** Where each fact lives. Injectable so the tests do not need a Pi. */
export interface HealthSources {
  readonly entropyAvail: string
  readonly hwrng: string
  /** Seconds since boot. Machine-only modes are refused very early on. */
  readonly uptimeSeconds: () => number | null
}

export const LINUX_SOURCES: HealthSources = {
  entropyAvail: '/proc/sys/kernel/random/entropy_avail',
  hwrng: '/dev/hwrng',
  uptimeSeconds: () => {
    try {
      const raw = readFileSync('/proc/uptime', 'utf8').split(' ')[0]
      const seconds = Number(raw)
      return Number.isFinite(seconds) ? seconds : null
    } catch {
      return null
    }
  },
}

/**
 * Below this the Linux pool is not meaningfully seeded.
 *
 * Modern kernels block until initialised and then report a large number, so
 * this is a floor for the case where the file exists and reads implausibly low
 * rather than a threshold anybody tunes.
 */
export const MIN_ENTROPY_AVAIL = 128

/** Machine-only modes are refused this soon after boot without a hardware RNG. */
export const EARLY_BOOT_SECONDS = 60

export type Verdict = 'ok' | 'failed' | 'unknown'

export interface HealthCheck {
  readonly name: string
  readonly verdict: Verdict
  readonly detail: string
}

export interface HealthReport {
  /** True only if every check returned `ok`. `unknown` is not `ok`. */
  readonly healthy: boolean
  /** True if anything could not be observed here. Never rendered as healthy. */
  readonly unknown: boolean
  readonly checks: readonly HealthCheck[]
}

function poolInitialised(sources: HealthSources): HealthCheck {
  if (!existsSync(sources.entropyAvail)) {
    return {
      name: 'kernel-pool',
      verdict: 'unknown',
      detail: `${sources.entropyAvail} does not exist here, so the kernel pool was not checked. It is a Linux path.`,
    }
  }
  let available: number
  try {
    available = Number(readFileSync(sources.entropyAvail, 'utf8').trim())
  } catch (err) {
    return { name: 'kernel-pool', verdict: 'unknown', detail: (err as Error).message }
  }
  if (!Number.isFinite(available)) {
    return {
      name: 'kernel-pool',
      verdict: 'unknown',
      detail: 'entropy_avail did not read as a number',
    }
  }
  return available >= MIN_ENTROPY_AVAIL
    ? { name: 'kernel-pool', verdict: 'ok', detail: `entropy_avail is ${String(available)}` }
    : {
        name: 'kernel-pool',
        verdict: 'failed',
        detail: `entropy_avail is ${String(available)}, which means the pool is not seeded`,
      }
}

/**
 * Read two consecutive blocks from the hardware RNG and compare them.
 *
 * The comparison is the whole point. A stuck hardware RNG returns a constant,
 * and a constant is indistinguishable from a good sample when you only look
 * once. Two reads is the cheapest test that catches it.
 */
/**
 * Fill a block from the generator, or say how far it got.
 *
 * A character device is allowed to return fewer bytes than asked for, so this
 * keeps reading until the block is full. The attempt count is bounded because a
 * device returning one byte at a time forever must not become a hang inside a
 * health check, and zero bytes back means there is no more to have.
 *
 * Returns the number of bytes read when it could not fill the block, which is
 * what the caller reports rather than judging the allocator's zeros.
 */
function readBlock(fd: number, size: number): Buffer | number {
  const block = Buffer.alloc(size)
  let filled = 0
  for (let attempt = 0; attempt < 8 && filled < size; attempt += 1) {
    const got = readSync(fd, block, filled, size - filled, null)
    if (got === 0) break
    filled += got
  }
  return filled === size ? block : filled
}

function hardwareRng(sources: HealthSources): HealthCheck {
  if (!existsSync(sources.hwrng)) {
    return {
      name: 'hardware-rng',
      verdict: 'unknown',
      detail: `${sources.hwrng} does not exist here, so the hardware RNG was not checked.`,
    }
  }

  let first: Buffer | number
  let second: Buffer | number
  let fd: number | undefined
  try {
    fd = openSync(sources.hwrng, 'r')
    first = readBlock(fd, 32)
    second = readBlock(fd, 32)
  } catch (err) {
    return {
      name: 'hardware-rng',
      verdict: 'failed',
      detail: `could not read ${sources.hwrng}: ${(err as Error).message}`,
    }
  } finally {
    if (fd !== undefined) closeSync(fd)
  }

  /*
   * A SHORT READ IS AN UNOBSERVED SOURCE, NOT A HEALTHY ONE.
   *
   * readSync returns how many bytes it actually got and the return value was
   * discarded, into a buffer that Buffer.alloc had already zero-filled. So a
   * generator handing over one byte on the second read produced a block of one
   * real byte and thirty-one zeros, and the two tests below both passed it: the
   * blocks differ, and neither is all zero. The verdict was "ok" with the
   * detail "two reads, different, neither all zero", which is a statement about
   * thirty-two bytes when thirty-one of them came from the allocator.
   *
   * Measured: a 33 byte fixture reports ok today. So does a 34 byte one.
   *
   * INV-ENTHEALTH-1 is the rule this breaks, in its own words: a source that
   * could not be observed reports unknown and is never counted as healthy,
   * because a gate that passes for want of evidence is worse than no gate. A
   * block the device only partly filled is exactly that.
   */
  const short = (which: string, block: Buffer | number): HealthCheck | null =>
    typeof block === 'number'
      ? {
          name: 'hardware-rng',
          verdict: 'unknown',
          detail:
            `the ${which} read returned ${String(block)} of 32 bytes, so most of the block ` +
            `was never read from ${sources.hwrng} and the checks below would be judging zeros`,
        }
      : null
  const shortRead = short('first', first) ?? short('second', second)
  if (shortRead !== null) return shortRead
  if (typeof first === 'number' || typeof second === 'number') {
    // Unreachable: shortRead covers both. Present so the narrowing below is the
    // compiler's conclusion rather than a cast.
    return { name: 'hardware-rng', verdict: 'unknown', detail: 'the generator was not read' }
  }

  if (first.equals(second)) {
    return {
      name: 'hardware-rng',
      verdict: 'failed',
      detail: 'two consecutive reads were identical, which is what a stuck generator returns',
    }
  }
  for (const [which, block] of [
    ['first', first],
    ['second', second],
  ] as const) {
    if (block.every((byte) => byte === 0)) {
      return {
        name: 'hardware-rng',
        verdict: 'failed',
        detail: `the ${which} read was all zero, which is what an absent generator returns`,
      }
    }
  }
  return { name: 'hardware-rng', verdict: 'ok', detail: 'two reads, different, neither all zero' }
}

/**
 * Refuse a machine-only mode very early in boot without a hardware RNG.
 *
 * A headless device with no keyboard, no mouse and no network has almost
 * nothing feeding the pool in its first minute, and generating a seed then is
 * the worst moment available.
 */
function notTooEarly(sources: HealthSources, hwrngOk: boolean): HealthCheck {
  if (hwrngOk) {
    return {
      name: 'boot-age',
      verdict: 'ok',
      detail: 'a hardware RNG is present, so boot age does not matter',
    }
  }
  const uptime = sources.uptimeSeconds()
  if (uptime === null) {
    return { name: 'boot-age', verdict: 'unknown', detail: 'uptime is not readable here' }
  }
  return uptime >= EARLY_BOOT_SECONDS
    ? { name: 'boot-age', verdict: 'ok', detail: `${String(Math.round(uptime))}s since boot` }
    : {
        name: 'boot-age',
        verdict: 'failed',
        detail: `only ${String(Math.round(uptime))}s since boot, and there is no hardware RNG to fall back on`,
      }
}

/** Every gate docs/ENTROPY.md describes, run in order. */
export function checkEntropyHealth(sources: HealthSources = LINUX_SOURCES): HealthReport {
  const pool = poolInitialised(sources)
  const rng = hardwareRng(sources)
  const age = notTooEarly(sources, rng.verdict === 'ok')
  const checks = [pool, rng, age]

  return {
    // `unknown` is deliberately not healthy. A gate that passed because it
    // could not find its own evidence is worse than no gate.
    healthy: checks.every((check) => check.verdict === 'ok'),
    unknown: checks.some((check) => check.verdict === 'unknown'),
    checks,
  }
}
