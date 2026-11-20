/**
 * Tests for the integrity row's completeness half.
 *
 * Every other part of checkIntegrity asks whether the files the manifest lists
 * are intact. None asked whether the list was whole, so a file committed
 * without `make manifest` sat outside the root hash a user compares before
 * entering their PIN, and `make verify` passed. These build a tiny tree on disk
 * and hand the check a tracked-file list, which is what cli.ts takes from git.
 */

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { checkIntegrity } from '../../packages/verify/src/manifest.js'

function tree(files: Record<string, string>, listed: readonly string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'nullroute-integrity-'))
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), body)
  }
  const lines = [...listed].sort().map(
    (p) =>
      `${createHash('sha256')
        .update(files[p] ?? '')
        .digest('hex')}  ${p}\n`
  )
  writeFileSync(join(root, 'MANIFEST.lock'), lines.join(''))
  return root
}

const FILES = {
  'package.json': '{}',
  'packages/core/a.ts': 'a',
  'packages/core/b.ts': 'b',
  'site/index.html': 'not under a manifest root',
}

describe('verify.integrity completeness', () => {
  it('fails-when-a-tracked-file-under-a-root-is-not-in-the-manifest', () => {
    const root = tree(FILES, ['package.json', 'packages/core/a.ts'])
    const result = checkIntegrity(root, 'MANIFEST.lock', Object.keys(FILES))
    expect(result.completeness).toBe('checked')
    expect(result.unlisted).toEqual(['packages/core/b.ts'])
    expect(result.missing).toEqual([])
    expect(result.mismatched).toEqual([])
    expect(result.ok).toBe(false)
  })

  it('ignores-tracked-files-outside-every-root-the-manifest-covers', () => {
    const root = tree(FILES, ['package.json', 'packages/core/a.ts', 'packages/core/b.ts'])
    const result = checkIntegrity(root, 'MANIFEST.lock', Object.keys(FILES))
    expect(result.unlisted).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('says-completeness-was-not-checked-without-a-tracked-list', () => {
    const root = tree(FILES, ['package.json', 'packages/core/a.ts'])
    const result = checkIntegrity(root)
    expect(result.completeness).toBe('not-checked')
    expect(result.unlisted).toEqual([])
  })
})
