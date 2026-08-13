/**
 * Check 5: integrity. Every tracked source matches MANIFEST.lock, and the root
 * hash recomputes.
 *
 * The format is deliberately plain `sha256sum` output: 64 lowercase hex, two
 * spaces, the repo-relative path, LF. Sorted ascending by raw path bytes under
 * LC_ALL=C. The root hash is SHA-256 over the concatenated lines, which is
 * exactly `sha256sum MANIFEST.lock`.
 *
 * That choice is the whole design. Because the line format is sha256sum's own
 * output, a skeptic verifies our tool with coreutils rather than with our tool:
 *
 *   sha256sum -c MANIFEST.lock     # every file, and it names the offender
 *   sha256sum MANIFEST.lock        # the root hash the device displays
 *
 * A Merkle tree would buy O(log n) inclusion proofs that nullroute has no use
 * for (the manifest is a few hundred lines and is published in full), and would
 * cost the property that actually matters, since no standard command line tool
 * computes a Merkle root over a directory.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

export interface ManifestEntry {
  readonly sha256: string
  readonly path: string
}

export interface IntegrityResult {
  readonly entries: readonly ManifestEntry[]
  readonly rootHash: string
  readonly mismatched: readonly { path: string; expected: string; actual: string }[]
  readonly missing: readonly string[]
  readonly ok: boolean
}

export class ManifestError extends Error {}

/** Parse a `sha256sum`-format manifest. */
export function parseManifest(text: string): ManifestEntry[] {
  const entries: ManifestEntry[] = []
  const lines = text.split('\n')

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (line === undefined || line.length === 0) continue
    // Comments would break `sha256sum -c`, so the format has none.
    const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line)
    if (match === null) {
      throw new ManifestError(
        `MANIFEST.lock line ${String(i + 1)} is not sha256sum format ` +
          `(64 lowercase hex, two spaces, path): ${JSON.stringify(line)}`
      )
    }
    const [, hash, path] = match
    if (hash === undefined || path === undefined) continue
    entries.push({ sha256: hash, path })
  }

  return entries
}

/**
 * The root hash: SHA-256 over the manifest bytes exactly as written.
 *
 * Hashing the file rather than recomposing lines is deliberate. It guarantees
 * that what we hash is byte-for-byte what `sha256sum MANIFEST.lock` hashes,
 * with no opportunity for a trailing-newline or line-ending difference to make
 * our number disagree with the verifier's.
 */
export function rootHashOf(manifestText: string): string {
  return bytesToHex(sha256(utf8ToBytes(manifestText)))
}

/**
 * Verify every entry against the working tree.
 *
 * Sort order is checked too. A manifest sorted under a locale-aware collation
 * would still verify file by file, but its root hash would differ from the one
 * a verifier computes with `LC_ALL=C sort`, and the mismatch would look like
 * tampering rather than like a locale bug.
 */
export function checkIntegrity(root: string, manifestPath = 'MANIFEST.lock'): IntegrityResult {
  const text = readFileSync(join(root, manifestPath), 'utf8')
  const entries = parseManifest(text)

  const mismatched: { path: string; expected: string; actual: string }[] = []
  const missing: string[] = []

  for (const entry of entries) {
    let bytes: Uint8Array
    try {
      bytes = new Uint8Array(readFileSync(join(root, entry.path)))
    } catch {
      missing.push(entry.path)
      continue
    }
    const actual = bytesToHex(sha256(bytes))
    if (actual !== entry.sha256) {
      mismatched.push({ path: entry.path, expected: entry.sha256, actual })
    }
  }

  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const sortedCorrectly = entries.every((e, i) => e.path === sorted[i]?.path)
  if (!sortedCorrectly) {
    throw new ManifestError(
      'MANIFEST.lock is not sorted by path under LC_ALL=C. The per-file checks would ' +
        'still pass, but the root hash will not match what a verifier computes.'
    )
  }

  // A case-only collision is invisible on macOS (APFS is case-insensitive) and
  // real on Linux, so a Mac-computed root would never match Linux CI. Caught
  // here rather than as a baffling hash mismatch in a pull request.
  const lowered = new Map<string, string>()
  for (const entry of entries) {
    const key = entry.path.toLowerCase()
    const clash = lowered.get(key)
    if (clash !== undefined && clash !== entry.path) {
      throw new ManifestError(
        `MANIFEST.lock contains paths differing only by case: "${clash}" and "${entry.path}". ` +
          `These collide on a case-insensitive filesystem, so the root hash would differ ` +
          `between macOS and Linux.`
      )
    }
    lowered.set(key, entry.path)
  }

  return {
    entries,
    rootHash: rootHashOf(text),
    mismatched,
    missing,
    ok: mismatched.length === 0 && missing.length === 0,
  }
}
