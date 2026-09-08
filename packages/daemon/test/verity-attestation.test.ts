/**
 * Tier 1's half of the boot attestation: the dm-verity root hash.
 *
 * The manifest root says the APPLICATION is the published one. This says what
 * the operating system underneath it is, and a verified application on an
 * unverified system is a lock on a door in a paper wall.
 *
 * Every case here is about the difference between reporting a number and
 * reporting nothing, because the failure that matters is a value appearing on
 * the lock screen when no mapping exists. A user comparing that against a
 * release would be comparing against something invented.
 */

import { describe, expect, it, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readVerityRootHash } from '../src/boot/attestation.js'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function withFile(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'nr-verity-'))
  dirs.push(dir)
  const path = join(dir, 'verity-roothash')
  writeFileSync(path, contents)
  return path
}

const VALID = 'a'.repeat(64)

describe('daemon.boot verity attestation', () => {
  it('reports-the-root-hash-of-the-running-mapping', () => {
    expect(readVerityRootHash(withFile(`${VALID}\n`))).toBe(VALID)
    // Whitespace either side is what a shell redirect produces.
    expect(readVerityRootHash(withFile(`  ${VALID}  \n\n`))).toBe(VALID)
  })

  it('reports-nothing-rather-than-a-blank-where-there-is-no-mapping', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nr-verity-'))
    dirs.push(dir)
    // The file a laptop has: none at all.
    expect(readVerityRootHash(join(dir, 'does-not-exist'))).toBeNull()

    // And the shapes a broken writer produces. Each must be null, never the
    // string itself: an empty value rendered on the lock screen looks like a
    // hash that has not loaded yet rather than a device with no verity.
    expect(readVerityRootHash(withFile(''))).toBeNull()
    expect(readVerityRootHash(withFile('\n'))).toBeNull()
    expect(readVerityRootHash(withFile('   '))).toBeNull()
  })

  it('refuses-anything-that-is-not-a-root-hash', () => {
    // Too short, too long, wrong alphabet, and a plausible-looking error
    // message that a careless writer might have redirected into the file.
    expect(readVerityRootHash(withFile('a'.repeat(63)))).toBeNull()
    expect(readVerityRootHash(withFile('a'.repeat(65)))).toBeNull()
    expect(readVerityRootHash(withFile('A'.repeat(64)))).toBeNull()
    expect(readVerityRootHash(withFile('z'.repeat(64)))).toBeNull()
    expect(readVerityRootHash(withFile('no nullroute-system mapping'))).toBeNull()
    expect(readVerityRootHash(withFile(`${VALID} and something else`))).toBeNull()
  })
})
