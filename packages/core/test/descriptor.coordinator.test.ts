/**
 * Tests for core.descriptor.coordinator.
 *
 * These files arrive from another vendor's program, across an air gap, and the
 * user cannot reasonably audit one by eye: a Coldcard setup file has no
 * descriptor in it at all, so this module ASSEMBLES one from three prose lines.
 * Getting Format wrong turns a P2SH wallet into a P2WSH one with entirely
 * different addresses, and nothing on screen would say so.
 *
 * So the tests here are mostly about refusing: a missing header line, a policy
 * that disagrees with the cosigner count, a checksum that does not match the
 * contents. The happy paths are short because the happy paths are easy.
 */

import { describe, expect, it } from 'vitest'
import {
  CoordinatorFormatError,
  exportBundle,
  importCoordinatorFile,
} from '../src/descriptor/coordinator.js'
import { parseDescriptor } from '../src/descriptor/parse.js'

const X1 =
  'xpub6E64WfdQwBGz85XhbZryr9gUGUPBgoSu5WV6tJWpzAvgAmpVpdPHkT3XYmpMEQ8VJdMYvZmxbDPGvzKvXpJcqE6mvHKPqCkxDkCkKzMgKFN'
const X2 =
  'xpub6DwMjZTuHNbxHTLmH1EQrHwEbYq4jkuUKAoNr5xnSCWNBqrCgUCLTcBiJvcnPeGCCLGWq1FDwStGe1EiKQEUCzHsY7HpEEbGyDGvGCbLGxE'
const X3 =
  'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz'

function coldcard(overrides: Partial<Record<string, string>> = {}, keys = [X1, X2, X3]): string {
  const header: Record<string, string | undefined> = {
    Name: 'Family Vault',
    Policy: `2 of ${String(keys.length)}`,
    Derivation: "m/48'/0'/0'/2'",
    Format: 'P2WSH',
    ...overrides,
  }
  const lines = ['# Coldcard Multisig setup file (created on 4369050F)', '#']
  for (const [key, value] of Object.entries(header)) {
    if (value !== undefined) lines.push(`${key}: ${value}`)
  }
  lines.push('')
  const fingerprints = ['4369050F', '5C9E228D', '2E7D9D1E', '11223344']
  keys.forEach((key, i) => lines.push(`${fingerprints[i] ?? '99999999'}: ${key}`))
  return lines.join('\n')
}

describe('core.descriptor.coordinator', () => {
  // INV-COORD-1. Each format a real wallet actually emits.
  it('reads-a-coldcard-setup-file', () => {
    const result = importCoordinatorFile(coldcard())
    expect(result.format).toBe('coldcard')
    expect(result.name).toBe('Family Vault')
    // Receive and change, because the file describes a wallet rather than a
    // single branch.
    expect(result.descriptors).toHaveLength(2)
    expect(result.descriptors[0]?.change).toBe(false)
    expect(result.descriptors[1]?.change).toBe(true)
    expect(result.descriptors[0]?.descriptor).toContain('wsh(sortedmulti(2,')
    expect(result.descriptors[0]?.descriptor).toContain("[4369050f/48'/0'/0'/2']")
    expect(result.descriptors[0]?.descriptor).toMatch(/#[a-z0-9]{8}$/)
  })

  it('reads-json-from-sparrow-or-specter', () => {
    const body = `wsh(sortedmulti(2,[4369050f/48h/0h/0h/2h]${X1}/0/*,[5c9e228d/48h/0h/0h/2h]${X2}/0/*))`
    const result = importCoordinatorFile(JSON.stringify({ label: 'Cold Storage', descriptor: body }))
    expect(result.format).toBe('json')
    expect(result.name).toBe('Cold Storage')
    expect(result.descriptors).toHaveLength(1)
  })

  it('reads-a-bitcoin-core-importdescriptors-array', () => {
    const result = importCoordinatorFile(
      JSON.stringify([
        { desc: `wpkh([4369050f/84h/0h/0h]${X1}/0/*)`, internal: false, active: true },
        { desc: `wpkh([4369050f/84h/0h/0h]${X1}/1/*)`, internal: true, active: true },
      ])
    )
    expect(result.format).toBe('core-importdescriptors')
    // `internal` is the only reliable statement of which branch is which.
    expect(result.descriptors.map((d) => d.change)).toEqual([false, true])
  })

  it('reads-a-bsms-file-and-expands-both-branches', () => {
    const template = `wsh(sortedmulti(2,[4369050f/48h/0h/0h/2h]${X1}/**,[5c9e228d/48h/0h/0h/2h]${X2}/**))`
    const result = importCoordinatorFile(`BSMS 1.0\n${template}\n/0/*,/1/*\nbc1qexample\n`)

    expect(result.format).toBe('bsms')
    expect(result.descriptors).toHaveLength(2)
    expect(result.descriptors[0]?.descriptor).toContain('/0/*')
    expect(result.descriptors[1]?.descriptor).toContain('/1/*')
    expect(result.descriptors[1]?.change).toBe(true)
  })

  it('still-reads-a-bare-descriptor', () => {
    const result = importCoordinatorFile(`wpkh([4369050f/84h/0h/0h]${X1}/0/*)`)
    expect(result.format).toBe('descriptor')
    expect(result.descriptors).toHaveLength(1)
  })

  /**
   * INV-COORD-2. The Coldcard format carries no descriptor, so one is built
   * from Policy, Derivation and Format. Every one of those is required, because
   * a default would silently produce a different wallet.
   */
  it('refuses-a-coldcard-file-missing-any-header-it-builds-from', () => {
    for (const missing of ['Policy', 'Derivation', 'Format']) {
      expect(() =>
        importCoordinatorFile(coldcard({ [missing]: undefined })), missing
      ).toThrow(new RegExp(missing))
    }
  })

  it('refuses-a-policy-that-disagrees-with-the-cosigner-count', () => {
    // Says three, lists two. One of them is wrong and guessing which would
    // produce a quorum nobody agreed to.
    expect(() => importCoordinatorFile(coldcard({ Policy: '2 of 3' }, [X1, X2]))).toThrow(
      /Refusing to guess/
    )
    expect(() => importCoordinatorFile(coldcard({ Policy: '4 of 3' }))).toThrow(
      /not satisfiable/
    )
    expect(() => importCoordinatorFile(coldcard({ Policy: 'two of three' }))).toThrow(
      /Cannot read the policy/
    )
  })

  it('refuses-a-script-format-it-does-not-know', () => {
    expect(() => importCoordinatorFile(coldcard({ Format: 'P2TR' }))).toThrow(/Unknown script format/)
    expect(() => importCoordinatorFile(coldcard({ Format: 'nonsense' }))).toThrow(
      /Unknown script format/
    )
  })

  it('builds-the-script-wrapper-the-format-line-names', () => {
    expect(importCoordinatorFile(coldcard({ Format: 'P2WSH' })).descriptors[0]?.descriptor).toMatch(
      /^wsh\(/
    )
    expect(
      importCoordinatorFile(coldcard({ Format: 'P2SH-P2WSH' })).descriptors[0]?.descriptor
    ).toMatch(/^sh\(wsh\(/)
    expect(importCoordinatorFile(coldcard({ Format: 'P2SH' })).descriptors[0]?.descriptor).toMatch(
      /^sh\(sortedmulti/
    )
  })

  /**
   * INV-COORD-3. A checksum that is present and wrong means the file was
   * altered after its exporter wrote it, which is worth stopping on rather
   * than silently recomputing.
   */
  it('refuses-a-descriptor-whose-checksum-does-not-match', () => {
    const good = importCoordinatorFile(`wpkh([4369050f/84h/0h/0h]${X1}/0/*)`).descriptors[0]
      ?.descriptor
    if (good === undefined) throw new Error('no descriptor')

    const tampered = `${good.slice(0, good.indexOf('#'))}#00000000`
    expect(() => importCoordinatorFile(tampered)).toThrow(/altered since it was written/)

    // And the untampered one round-trips.
    expect(importCoordinatorFile(good).descriptors[0]?.descriptor).toBe(good)
  })

  // Every path ends at the same strict parser, so a format reader cannot
  // smuggle through something the descriptor parser would reject.
  it('re-parses-everything-with-the-strict-parser', () => {
    expect(() => importCoordinatorFile('{"descriptor":"wsh(frobnicate(2))"}')).toThrow(
      CoordinatorFormatError
    )
    expect(() => importCoordinatorFile('{"name":"no descriptor here"}')).toThrow(
      /holds no output descriptor/
    )
    expect(() => importCoordinatorFile('not json {')).toThrow(CoordinatorFormatError)
    expect(() => importCoordinatorFile('')).toThrow(/empty/)
    expect(() => importCoordinatorFile('x'.repeat(200_000))).toThrow(/far larger/)
  })

  it('refuses-a-bsms-version-it-does-not-read', () => {
    expect(() => importCoordinatorFile('BSMS 2.0\nwsh(...)\n/0/*\n')).toThrow(/BSMS 1\.0/)
  })

  /**
   * INV-COORD-4. What a file says about itself is a hint, never evidence.
   *
   * BIP-129 has the coordinator state the first address precisely so the signer
   * can disagree with it. Surfacing it as an unverified claim is the whole
   * point; consuming it as truth would defeat the round it belongs to.
   */
  it('surfaces-what-it-did-not-verify', () => {
    const template = `wsh(sortedmulti(2,[4369050f/48h/0h/0h/2h]${X1}/**,[5c9e228d/48h/0h/0h/2h]${X2}/**))`
    const bsms = importCoordinatorFile(`BSMS 1.0\n${template}\n/0/*,/1/*\nbc1qcoordinatorclaim\n`)
    expect(bsms.unverifiedClaims.join(' ')).toContain('bc1qcoordinatorclaim')
    expect(bsms.unverifiedClaims.join(' ')).toContain('nothing here has checked it')

    const cc = importCoordinatorFile(coldcard())
    expect(cc.unverifiedClaims.join(' ')).toContain('Policy line says 2 of 3')
    expect(cc.unverifiedClaims.join(' ')).toContain('Format line says P2WSH')
  })

  it('exports-a-bundle-a-coordinator-can-read', () => {
    const descriptor = importCoordinatorFile(coldcard()).descriptors[0]?.descriptor
    if (descriptor === undefined) throw new Error('no descriptor')

    const bundle = exportBundle({
      name: 'Family Vault',
      network: 'mainnet',
      descriptors: [{ descriptor, change: false }],
      ourKey: { fingerprint: '4369050f', path: "m/48'/0'/0'/2'", xpub: X1 },
    })
    const parsed: unknown = JSON.parse(bundle)
    const record = parsed as Record<string, unknown>

    expect(record['format']).toBe('nullroute-descriptor-bundle')
    // The shape Bitcoin Core's importdescriptors takes, so it can be fed
    // straight in rather than transcribed.
    const descriptors = record['descriptors'] as { desc: string; internal: boolean }[]
    expect(descriptors[0]?.desc).toBe(descriptor)
    expect(descriptors[0]?.internal).toBe(false)

    const cosigner = record['cosigner'] as Record<string, string>
    expect(cosigner['key_expression']).toBe(`[4369050f/48'/0'/0'/2']${X1}`)

    // And what we wrote is something we would read back.
    expect(importCoordinatorFile(bundle).descriptors[0]?.descriptor).toBe(descriptor)
  })

  it('produces-descriptors-that-parse-under-our-own-rules', () => {
    for (const file of [coldcard(), `wpkh([4369050f/84h/0h/0h]${X1}/0/*)`]) {
      for (const entry of importCoordinatorFile(file).descriptors) {
        expect(() => parseDescriptor(entry.descriptor)).not.toThrow()
      }
    }
  })
})
