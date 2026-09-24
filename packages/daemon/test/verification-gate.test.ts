/**
 * Tests for the gate the daemon starts behind (INV-BUILD-1).
 *
 * requirePassingVerification decides whether the signing daemon starts at all,
 * and nothing tested it. Each case here is a report that must stop it, plus
 * the one that must not. The report and MANIFEST.lock are written into a
 * scratch directory, because the function reads them from a repository root.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AttestationError,
  manifestRootHash,
  requirePassingVerification,
} from '../src/boot/attestation.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nullroute-gate-'))
  writeFileSync(join(root, 'MANIFEST.lock'), 'deadbeef  packages/core/src/index.ts\n')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function report(overrides: Record<string, unknown> = {}): void {
  writeFileSync(
    join(root, 'verification-report.json'),
    JSON.stringify({
      rootHash: manifestRootHash(root),
      passed: true,
      specCount: 38,
      invariantCount: 316,
      tier: 'signer',
      checks: [
        { name: 'coverage', status: 'passed', detail: '' },
        { name: 'integrity', status: 'passed', detail: '' },
      ],
      ...overrides,
    })
  )
}

const refuses = (pattern: RegExp): void => {
  expect(() => requirePassingVerification(root, 'test')).toThrow(AttestationError)
  expect(() => requirePassingVerification(root, 'test')).toThrow(pattern)
}

describe('daemon.boot verification gate', () => {
  /** INV-BUILD-1. The one report that lets the daemon start. */
  it('starts-on-a-passing-report-that-describes-this-build', () => {
    report()
    const attested = requirePassingVerification(root, 'test')
    expect(attested.rootHash).toBe(manifestRootHash(root))
    expect(attested.checks).toHaveLength(2)
  })

  /** INV-BUILD-1. No report, or one that is not a report. */
  it('refuses-a-missing-or-unreadable-report', () => {
    refuses(/No verification report was found/)
    writeFileSync(join(root, 'verification-report.json'), '{ not json')
    refuses(/not valid JSON/)
    writeFileSync(join(root, 'verification-report.json'), '[]')
    refuses(/no valid manifest root hash|not an object/)
  })

  /** INV-BUILD-1. A report that did not pass, or says it did while recording a failure. */
  it('refuses-a-report-that-did-not-pass-or-contradicts-itself', () => {
    report({ passed: false, checks: [{ name: 'vectors', status: 'failed' }] })
    refuses(/did not pass.*vectors/s)
    report({ checks: [{ name: 'coverage', status: 'failed' }] })
    refuses(/claims to have passed while recording failed checks/)
    // A status this code does not recognise counts as failed.
    report({ checks: [{ name: 'coverage', status: 'probably-fine' }] })
    refuses(/recording failed checks/)
  })

  /** INV-BUILD-1. A report that checked nothing. */
  it('refuses-a-report-that-records-no-checks', () => {
    report({ checks: [] })
    refuses(/records no checks/)
  })

  /** INV-BUILD-1. A report written for a different MANIFEST.lock. */
  it('refuses-a-report-that-describes-another-build', () => {
    report()
    writeFileSync(join(root, 'MANIFEST.lock'), 'cafebabe  packages/core/src/index.ts\n')
    refuses(/stale/)
  })
})
