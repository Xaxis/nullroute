/**
 * INV-BUILD-1: the daemon refuses to start unless verification passed.
 *
 * Spec: daemon.boot.attestation
 *
 * This is the mechanism that makes every spec in the repository load-bearing
 * rather than decorative. A spec that stops matching its code fails
 * `make verify`, the report records the failure, and the daemon then will not
 * start. Without this, the specs would be documentation that happened to be
 * checked in CI, and a device could ship with them quietly false.
 *
 * Three conditions have to hold, and each is a distinct way the guarantee could
 * be hollowed out:
 *
 *   1. The report exists. An absent report is not a pass.
 *   2. The report says it passed. Every check must be `passed` or an explicit
 *      `not-applicable`; a `failed` check anywhere stops the boot.
 *   3. The report describes THIS build. Its recorded manifest root hash must
 *      equal the root hash of the manifest actually on disk. A stale report
 *      from a previous build is the most likely way a bad build boots: someone
 *      verifies, edits a file, and restarts.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

export interface VerificationCheck {
  readonly name: string
  readonly status: 'passed' | 'failed' | 'not-applicable'
  readonly detail: string
}

export interface VerificationReport {
  readonly schema: number
  readonly tier: string
  readonly rootHash: string
  readonly specCount: number
  readonly invariantCount: number
  readonly checks: readonly VerificationCheck[]
  readonly passed: boolean
}

/** What the lock screen shows before unlock. */
export interface BootAttestation {
  readonly rootHash: string
  readonly specCount: number
  readonly invariantCount: number
  readonly tier: string
  readonly version: string
  readonly checks: readonly VerificationCheck[]
}

export class AttestationError extends Error {
  constructor(message: string) {
    super(
      `${message}\n\n` +
        `The daemon will not start without a passing verification report that describes ` +
        `this exact build. Run "make verify".`
    )
    this.name = 'AttestationError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

/** Validate the shape of a report read from disk. Never trusts, never casts. */
function asReport(value: unknown): VerificationReport {
  if (!isRecord(value)) {
    throw new AttestationError('The verification report is not an object.')
  }
  const rootHash = value['rootHash']
  const passed = value['passed']
  const checks = value['checks']
  const specCount = value['specCount']
  const invariantCount = value['invariantCount']
  const tier = value['tier']

  if (typeof rootHash !== 'string' || !/^[0-9a-f]{64}$/.test(rootHash)) {
    throw new AttestationError('The report has no valid manifest root hash.')
  }
  if (typeof passed !== 'boolean') {
    throw new AttestationError('The report does not record whether it passed.')
  }
  if (!Array.isArray(checks)) {
    throw new AttestationError('The report records no checks.')
  }

  const parsedChecks: VerificationCheck[] = checks.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new AttestationError(`Check ${String(index)} in the report is malformed.`)
    }
    const name = entry['name']
    const rawStatus = entry['status']
    const detail = entry['detail']
    if (typeof name !== 'string' || typeof rawStatus !== 'string') {
      throw new AttestationError(`Check ${String(index)} in the report is malformed.`)
    }
    // Anything not recognised is treated as failed. A status this code does not
    // understand is not a reason to proceed.
    const status: VerificationCheck['status'] =
      rawStatus === 'passed' || rawStatus === 'not-applicable' ? rawStatus : 'failed'
    return { name, status, detail: typeof detail === 'string' ? detail : '' }
  })

  return {
    schema: typeof value['schema'] === 'number' ? value['schema'] : 0,
    tier: typeof tier === 'string' ? tier : 'unknown',
    rootHash,
    specCount: typeof specCount === 'number' ? specCount : 0,
    invariantCount: typeof invariantCount === 'number' ? invariantCount : 0,
    checks: parsedChecks,
    passed,
  }
}

/** The root hash: SHA-256 of MANIFEST.lock, exactly `sha256sum MANIFEST.lock`. */
export function manifestRootHash(repoRoot: string): string {
  const manifest = readFileSync(join(repoRoot, 'MANIFEST.lock'), 'utf8')
  return bytesToHex(sha256(utf8ToBytes(manifest)))
}

/**
 * Load and validate the verification report, or throw.
 *
 * Throws rather than returning a status, because there is no caller that should
 * be able to proceed past a failure. A boolean here would eventually be
 * ignored somewhere.
 */
export function requirePassingVerification(repoRoot: string, version: string): BootAttestation {
  let raw: string
  try {
    raw = readFileSync(join(repoRoot, 'verification-report.json'), 'utf8')
  } catch {
    throw new AttestationError('No verification report was found.')
  }

  // Parsed as `unknown` and validated, not cast. The report is a file on disk;
  // asserting its type would make the guards below look unnecessary to the
  // compiler while remaining necessary at runtime, which is how a validator
  // gets deleted for being redundant.
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new AttestationError('The verification report is not valid JSON.')
  }

  const report = asReport(parsed)

  const failed = report.checks.filter((c) => c.status === 'failed')

  if (!report.passed) {
    throw new AttestationError(
      `Verification did not pass. Failing checks: ${
        failed.length > 0 ? failed.map((c) => c.name).join(', ') : '(unspecified)'
      }`
    )
  }

  // A `failed` check alongside `passed: true` would be a defect in the verify
  // CLI, so the two are checked independently rather than one trusted.
  if (failed.length > 0) {
    throw new AttestationError(
      `The report claims to have passed while recording failed checks: ` +
        `${failed.map((c) => c.name).join(', ')}. This is a defect in the verifier.`
    )
  }

  // The staleness check. This is the condition most likely to catch a real
  // problem in practice: verify, edit a file, restart.
  const actual = manifestRootHash(repoRoot)
  if (report.rootHash !== actual) {
    throw new AttestationError(
      `The verification report is stale.\n` +
        `  report describes  ${report.rootHash}\n` +
        `  this build is     ${actual}\n` +
        `Something changed since the report was written.`
    )
  }

  return {
    rootHash: actual,
    specCount: report.specCount,
    invariantCount: report.invariantCount,
    tier: report.tier,
    version,
    checks: report.checks,
  }
}

/**
 * Format a hash for display, first and last eight characters.
 *
 * The lock screen shows this abbreviated form with the full value available on
 * demand. Eight and eight is what a person will actually compare against a
 * published value; a full 64 characters gets skimmed.
 */
export function abbreviateHash(hash: string): string {
  if (hash.length <= 20) return hash
  return `${hash.slice(0, 8)}...${hash.slice(-8)}`
}
