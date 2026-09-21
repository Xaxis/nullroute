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
  /**
   * The dm-verity root hash of the mapping this device is running on, or null
   * where there is no verity device: a laptop under `make dev` has none, and
   * saying so is more useful than an empty string that reads as a value.
   */
  readonly verityRootHash: string | null
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

/**
 * The dm-verity root hash of the mapping this device booted on.
 *
 * TIER 1'S HALF OF THE ATTESTATION. The manifest root above says the
 * APPLICATION is the published one. It says nothing about the operating system
 * underneath it, and a verified application on an unverified system is a lock
 * on a door in a paper wall. This is the number that covers the rest of the
 * partition: every block of the root filesystem is checked against it as it is
 * read.
 *
 * READ FROM THE ACTIVE MAPPING, NOT FROM THE CARD. `nullroute-attest.service`
 * asks the running kernel what the device-mapper table actually says and writes
 * the answer here. Reading /boot/system.roothash instead would report the
 * number somebody wrote on the card, which is the number an attacker who
 * rewrote the boot partition would have chosen. Neither is a defence against
 * that attacker, and only one of them is a statement about what is running.
 *
 * Null rather than a throw when the file is absent. There is no verity device
 * under `make dev`, and a daemon that refused to start on a laptop would be a
 * daemon nobody develops against. What must never happen is a value appearing
 * where there is no mapping, which is why this reads a file written by
 * something that queried the kernel rather than deriving it.
 */
export function readVerityRootHash(path = '/run/nullroute-attest/verity-roothash'): string | null {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return null
  }
  const value = raw.trim()
  // The same shape as any other root hash. Anything else is a file that has
  // been meddled with, and a malformed hash is not a hash.
  return /^[0-9a-f]{64}$/.test(value) ? value : null
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

  // The staleness check, and it is narrower than the old comment here claimed.
  // That comment said this was "the condition most likely to catch a real
  // problem in practice: verify, edit a file, restart". It is not, and the
  // difference is worth stating in the module whose job is attestation.
  //
  // WHAT IT COMPARES is the root the report recorded against SHA-256 of the
  // MANIFEST.lock on disk now. Nothing here opens a single source file. Edit a
  // source and call this function directly and it returns an attestation, which
  // was measured rather than reasoned about. What it catches is the manifest
  // being regenerated without the report being rewritten, so the report
  // describes a tree that is no longer the one on disk.
  //
  // WHAT ACTUALLY COVERS FILE CONTENTS is `sha256sum -c MANIFEST.lock`, check 5
  // in packages/verify, which is what wrote the report this trusts, and
  // dm-verity on the device, which checks every block of the root filesystem as
  // the kernel reads it. Every supported way of starting this daemon runs the
  // first: `make dev` and `make dev-daemon` both depend on `manifest verify`.
  // Editing a source and running one of them regenerates the manifest, so the
  // integrity check re-hashes the file and the root hash on the lock screen
  // moves, which is the signal a reader is told to compare.
  //
  // So this is the last of three gates rather than the only one, and it is the
  // cheap one. Re-hashing the tree here as well would duplicate check 5 at
  // every boot, on a filesystem dm-verity is already checking block by block.
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
    verityRootHash: readVerityRootHash(),
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
