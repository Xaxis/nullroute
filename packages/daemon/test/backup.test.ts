/**
 * Tests for daemon.store.backup.
 *
 * A backup is a file an attacker may hold indefinitely and edit at leisure, so
 * the interesting cases are all about what happens when the parts outside the
 * ciphertext are wrong. The outer document carries a label, a network and a
 * hasSeed flag in plaintext, for a human reading a card full of files. None of
 * those may decide anything.
 */

import { describe, expect, it } from 'vitest'
import { MAINNET, SIGNET, Secret } from '@nullroute/core'
import { BadPassphraseError, StoreError } from '../src/store/envelope.js'
import { createBackup, describeBackup, restoreBackup } from '../src/store/backup.js'

/** Cheap parameters. The plumbing is under test, not the work factor. */
const FAST = { m: 8192, t: 1, p: 1 } as const

const SEED_HEX = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
const PASSPHRASE = 'correct horse battery staple'
const REGISTRATIONS = ['wsh(sortedmulti(2,a,b,c))#aaaaaaaa', 'tr(x,multi_a(2,y,z))#bbbbbbbb']

function seed(): Secret {
  return Secret.fromBytes(Uint8Array.from(Buffer.from(SEED_HEX, 'hex')), 'test-seed')
}

function write(withSeed: boolean, network = SIGNET): string {
  const contents = withSeed
    ? { network, registrations: REGISTRATIONS, label: 'Family Vault', seed: seed() }
    : { network, registrations: REGISTRATIONS, label: 'Family Vault' }
  const text = createBackup(contents, PASSPHRASE, 'v0.1.0-test', FAST)
  contents.seed?.dispose()
  return text
}

describe('daemon.store.backup', () => {
  // INV-BACKUP-1. A watch-only backup is the default and restores everything
  // except the ability to spend.
  it('round-trips-a-watch-only-backup', () => {
    const restored = restoreBackup(write(false), PASSPHRASE)

    expect(restored.hasSeed).toBe(false)
    expect(restored.seed).toBeUndefined()
    expect(restored.registrations).toEqual(REGISTRATIONS)
    expect(restored.network.id).toBe('signet')
    expect(restored.label).toBe('Family Vault')
    expect(restored.createdWith).toBe('v0.1.0-test')
  })

  it('round-trips-a-seed-backup', () => {
    const restored = restoreBackup(write(true), PASSPHRASE)

    expect(restored.hasSeed).toBe(true)
    expect(Buffer.from(restored.seed?.bytes ?? new Uint8Array()).toString('hex')).toBe(SEED_HEX)
    expect(restored.registrations).toEqual(REGISTRATIONS)
    restored.seed?.dispose()
  })

  // INV-BACKUP-2. The seed must not be readable without the passphrase.
  it('never-writes-the-seed-in-the-clear', () => {
    const text = write(true)
    expect(text).not.toContain(SEED_HEX)
    expect(text).not.toContain(PASSPHRASE)
    // Nor any registration, which names the cosigners of a wallet.
    for (const registration of REGISTRATIONS) expect(text).not.toContain(registration)
  })

  it('refuses-a-wrong-passphrase-and-an-empty-one', () => {
    expect(() => restoreBackup(write(true), 'wrong')).toThrow(BadPassphraseError)
    expect(() =>
      createBackup({ network: SIGNET, registrations: [], label: 'x' }, '', 'v', FAST)
    ).toThrow(/empty passphrase/)
  })

  /**
   * INV-BACKUP-3, and the reason the network is sealed rather than merely
   * written on the outside.
   *
   * The outer document names a network so a human can tell files apart on a
   * card. Restoring from that copy would let anyone flip a signet backup to
   * mainnet with a text editor, and the restored device would then present real
   * addresses under a wallet the user created as a test.
   */
  it('takes-the-network-from-inside-the-ciphertext', () => {
    const text = write(false, SIGNET)
    const document: unknown = JSON.parse(text)
    const record = document as Record<string, unknown>

    expect(record['network']).toBe('signet')
    record['network'] = 'mainnet'
    record['label'] = 'Definitely Mainnet'

    const restored = restoreBackup(JSON.stringify(record), PASSPHRASE)
    // The label is cosmetic and follows the edit. The network does not.
    expect(restored.label).toBe('Definitely Mainnet')
    expect(restored.network.id).toBe('signet')
    expect(restored.network.isMainnet).toBe(false)
    expect(restored.network.id).not.toBe(MAINNET.id)
  })

  /**
   * The hasSeed flag outside is a label on a box. Flipping it must not conjure
   * a seed, and must not hide one either.
   */
  it('takes-whether-there-is-a-seed-from-inside-the-ciphertext', () => {
    const lying = JSON.parse(write(false)) as Record<string, unknown>
    lying['hasSeed'] = true
    expect(restoreBackup(JSON.stringify(lying), PASSPHRASE).hasSeed).toBe(false)

    const hiding = JSON.parse(write(true)) as Record<string, unknown>
    hiding['hasSeed'] = false
    const restored = restoreBackup(JSON.stringify(hiding), PASSPHRASE)
    expect(restored.hasSeed).toBe(true)
    restored.seed?.dispose()
  })

  it('refuses-a-tampered-envelope', () => {
    const document = JSON.parse(write(true)) as Record<string, unknown>
    const envelope = document['envelope'] as Record<string, string>
    envelope['ciphertext'] = `${envelope['ciphertext']?.slice(0, -4) ?? ''}AAAA`
    expect(() => restoreBackup(JSON.stringify(document), PASSPHRASE)).toThrow(BadPassphraseError)
  })

  it('refuses-a-file-that-is-not-a-backup', () => {
    expect(() => restoreBackup('not json', PASSPHRASE)).toThrow(StoreError)
    expect(() => restoreBackup('{}', PASSPHRASE)).toThrow(/not a nullroute-backup/)
    expect(() =>
      restoreBackup(JSON.stringify({ format: 'nullroute-backup', version: 99 }), PASSPHRASE)
    ).toThrow(/version/)
    expect(() =>
      restoreBackup(JSON.stringify({ format: 'nullroute-backup', version: 1 }), PASSPHRASE)
    ).toThrow(/no envelope/)
  })

  /**
   * INV-BACKUP-4. A screen has to explain a file before asking for a
   * passphrase, and everything it can say at that point is unauthenticated.
   */
  it('describes-a-backup-without-opening-it', () => {
    const described = describeBackup(write(true))
    expect(described).toMatchObject({
      label: 'Family Vault',
      network: 'signet',
      hasSeed: true,
      createdWith: 'v0.1.0-test',
    })
    expect(() => describeBackup('{"format":"something-else"}')).toThrow(/not a nullroute-backup/)
    expect(() => describeBackup('not json')).toThrow(StoreError)
  })

  it('uses-a-fresh-salt-every-time', () => {
    const a = JSON.parse(write(true)) as { envelope: { kdf: { salt: string } } }
    const b = JSON.parse(write(true)) as { envelope: { kdf: { salt: string } } }
    expect(a.envelope.kdf.salt).not.toBe(b.envelope.kdf.salt)
  })

  // A backup restored onto a device that has never seen the original is the
  // whole point, so nothing may depend on local state.
  it('restores-registrations-a-replacement-device-has-never-seen', () => {
    const restored = restoreBackup(write(false), PASSPHRASE)
    expect(restored.registrations).toHaveLength(2)
    expect(restored.registrations[0]).toContain('sortedmulti')
    expect(restored.registrations[1]).toContain('multi_a')
  })
})
