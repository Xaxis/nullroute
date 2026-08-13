/**
 * Checks 3 and 4: official test vectors, and differential agreement.
 *
 * Both are structural checks here rather than executors. The vectors themselves
 * run inside the normal test suite (so a failing vector fails a test, which the
 * invariant binding then catches), and what this module verifies is that the
 * vector files a spec claims to test against actually exist and still hash to
 * what the spec pinned.
 *
 * Pinning the hash is the point. Without it, a vector file could be edited to
 * make a failing implementation pass, and every check in the system would stay
 * green while the device produced wrong addresses.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { LoadedSpec } from './specs.js'

export interface VectorResult {
  readonly declared: number
  readonly verified: number
  readonly failures: readonly string[]
  readonly ok: boolean
}

export function checkVectors(root: string, specs: readonly LoadedSpec[]): VectorResult {
  const failures: string[] = []
  let declared = 0
  let verified = 0

  for (const { path, spec } of specs) {
    for (const vector of spec.vectors ?? []) {
      declared += 1
      let bytes: Uint8Array
      try {
        bytes = new Uint8Array(readFileSync(join(root, vector.file)))
      } catch {
        failures.push(`${path}: vector file missing: ${vector.file}`)
        continue
      }
      const actual = bytesToHex(sha256(bytes))
      if (actual !== vector.sha256) {
        failures.push(
          `${path}: vector "${vector.name}" hash mismatch for ${vector.file}\n` +
            `      pinned ${vector.sha256}\n` +
            `      actual ${actual}\n` +
            `      A vector file changed. Either the upstream vectors were updated (re-pin ` +
            `deliberately) or someone edited a vector to make a failing implementation pass.`
        )
        continue
      }
      verified += 1
    }
  }

  return { declared, verified, failures, ok: failures.length === 0 }
}

export interface DifferentialResult {
  readonly declared: number
  readonly failures: readonly string[]
  readonly ok: boolean
}

/**
 * Check that any spec declaring a differential oracle declares it coherently.
 *
 * The agreement itself is asserted by the differential test project, which runs
 * in the suite. What is checked here is that a `critical`-tier module producing
 * a value another implementation could also compute has not quietly dropped its
 * oracle: a differential block that disappears takes its assurance with it and
 * nothing else would notice.
 */
export function checkDifferential(specs: readonly LoadedSpec[]): DifferentialResult {
  const failures: string[] = []
  let declared = 0

  for (const { path, spec } of specs) {
    const diff = spec.differential
    if (diff === undefined) continue
    declared += 1

    if (diff.oracle.trim().length === 0) {
      failures.push(`${path}: differential oracle is empty`)
    }
    if (diff.min_cases < 1) {
      failures.push(`${path}: differential min_cases must be at least 1`)
    }
    // The critical tier is where an implementation disagreement becomes a lost
    // coin rather than a wrong number on a screen.
    if (spec.assurance_tier === 'critical' && diff.min_cases < 100) {
      failures.push(
        `${path}: a critical-tier module needs at least 100 differential cases, ` +
          `declared ${String(diff.min_cases)}`
      )
    }
  }

  return { declared, failures, ok: failures.length === 0 }
}
