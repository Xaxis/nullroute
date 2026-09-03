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
 * Modules that must declare a differential oracle, and why each one can.
 *
 * WHAT THIS FIXES. The comment below used to say this function catches "a
 * differential block that disappears", and the loop began `if (diff ===
 * undefined) continue`, so a disappearing block was the one thing it could not
 * see. It inspected only the specs that still declared one. The schema says an
 * oracle is "required at the critical tier for anything producing a value
 * another implementation can also compute", and nothing enforced the required
 * part: one of thirty two critical-tier specs declared one, while the
 * differential suite was in fact cross-checking three modules.
 *
 * A named set rather than "every critical spec", because most of them have no
 * independent oracle to compare against: a session lock, a Secret wrapper and
 * an idle clock are this device's behaviour rather than a value bitcoinjs-lib
 * also computes. Demanding a block from those would produce declarations that
 * assert nothing, which is the failure this whole file exists to prevent.
 *
 * Adding a module here is a deliberate act, and so is removing one.
 */
const NEEDS_ORACLE = new Map([
  ['core.address.derive', 'addresses, on every script type and both networks'],
  ['core.derive.hd', 'extended and public keys at 144 derivation paths'],
  ['core.psbt.sign', 'signatures, byte for byte, including the DER encoding'],
])

/**
 * Check that a module with an independent oracle still declares one, and
 * declares it coherently.
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

  const seen = new Set<string>()
  for (const { path, spec } of specs) {
    const diff = spec.differential
    if (diff === undefined) continue
    seen.add(spec.id)
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

  /* The direction the old loop could not look in. A spec that stops declaring
     its oracle simply stopped being inspected, which is precisely how the
     assurance leaves without anybody noticing. */
  for (const [id, what] of NEEDS_ORACLE) {
    if (seen.has(id)) continue
    failures.push(
      `${id}: declares no differential oracle, and it has one: ${what}. ` +
        `Either restore the block or remove the module from NEEDS_ORACLE in ` +
        `packages/verify/src/vectors.ts, which is a decision rather than an edit.`
    )
  }

  return { declared, failures, ok: failures.length === 0 }
}
