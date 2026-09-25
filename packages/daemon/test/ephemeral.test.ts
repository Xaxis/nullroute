/**
 * Tests for ephemeral seed mode.
 *
 * A seed loaded for one session and never written down. Useful for checking
 * that a backup restores what you think it does, and for signing once with a
 * key you do not want this device to keep.
 *
 * The whole feature is a refusal, so that is what the tests are. The property
 * worth having is not "the happy path does not write" but "every path refuses",
 * because the failure mode is silent: a device that wrote a seed the user asked
 * it not to keep looks exactly like one that did not, until someone finds the
 * file.
 *
 * So these tests go looking for a written byte on disk rather than trusting a
 * method to have returned an error.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAINNET, deriveAccountXpub, mnemonicToSeed, withChecksum } from '@nullroute/core'
import { multisigAccountPath } from '../src/multisig.js'
import { createHandler } from '../src/handler.js'
import { Session } from '../src/session.js'
import { WalletRegistry } from '../src/store/registry.js'
import { WalletStore } from '../src/store/store.js'
import type { BootAttestation } from '../src/boot/attestation.js'

// Backups sealed at a test cost; see DaemonState.backupKdf.
const FAST_BACKUP = { m: 8192, t: 1, p: 1 } as const

const FAST = { m: 8192, t: 1, p: 1 } as const
const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

const attestation = {
  passed: true,
  manifestRoot: '0'.repeat(64),
} as unknown as BootAttestation

let dir: string
let session: Session
let call: (method: string, params?: Record<string, unknown>) => Promise<unknown>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nullroute-ephemeral-'))
  session = new Session()
  call = (method, params = {}) =>
    createHandler({
      backupKdf: FAST_BACKUP,
      attestation,
      session,
      store: new WalletStore(dir, FAST),
      registry: new WalletRegistry(dir, FAST),
    })({ id: '1', method, params })
})

afterEach(() => {
  session.lock()
  rmSync(dir, { recursive: true, force: true })
})

/** Every byte under the store directory, so nothing can hide in a sidecar. */
function everythingOnDisk(): string {
  const parts: string[] = []
  const walk = (path: string): void => {
    for (const entry of readdirSync(path)) {
      const full = join(path, entry)
      parts.push(entry)
      if (statSync(full).isDirectory()) walk(full)
      else parts.push(readFileSync(full, 'utf8'))
    }
  }
  walk(dir)
  return parts.join('\n')
}

describe('ephemeral seed mode', () => {
  // INV-EPH-1. The seed works. This is a signing session, not a dry run.
  it('signs-and-derives-like-any-other-wallet', async () => {
    const loaded = (await call('wallet.import', {
      mnemonic: MNEMONIC,
      passphrase: '',
      ephemeral: true,
    })) as { fingerprint: string; ephemeral: boolean }

    expect(loaded.ephemeral).toBe(true)
    expect(loaded.fingerprint).toBe('73c5da0a')

    const addresses = (await call('wallet.addresses', {
      scriptType: 'p2wpkh',
      change: false,
      start: 0,
      count: 1,
    })) as { addresses: { address: string }[] }
    expect(addresses.addresses[0]?.address).toBe('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu')
  })

  /**
   * INV-EPH-2. Every path that writes refuses, and the refusal says why.
   *
   * Enumerated rather than sampled: a new way to write must be a decision
   * somebody makes on purpose, and this test is where they find out.
   */
  it('refuses-every-way-of-writing-the-seed-down', async () => {
    await call('wallet.import', { mnemonic: MNEMONIC, passphrase: '', ephemeral: true })

    // store.create is refused outright once a registry exists, before it ever
    // reaches the ephemeral check. Both refusals are correct; this asserts the
    // seed does not reach the disk, which is what the mode promises.
    await expect(call('store.create', { passphrase: 'x' })).rejects.toThrow()
    await expect(
      call('wallets.create', { passphrase: 'x', label: 'Kept', colour: 'teal' })
    ).rejects.toThrow(/one session only/)
    await expect(call('backup.create', { passphrase: 'x', includeSeed: true })).rejects.toThrow(
      /one session only/
    )
    // A seedless backup is refused too. It still records that this wallet
    // existed, on which network, and who its cosigners are.
    await expect(call('backup.create', { passphrase: 'x', includeSeed: false })).rejects.toThrow(
      /one session only/
    )

    // Nothing reached the disk, checked by looking rather than by trusting the
    // errors above.
    expect(readdirSync(dir)).toEqual([])
  })

  /**
   * Registering a quorum is allowed and is simply not persisted, which is the
   * same shape as registering without a passphrase. It is reported as not
   * persisted rather than silently dropped.
   */
  it('registers-a-quorum-for-the-session-without-writing-it', async () => {
    await call('wallet.import', { mnemonic: MNEMONIC, passphrase: '', ephemeral: true })

    const ourKey = (await call('multisig.ourKey', { account: 0 })) as { xpub: string }
    // Derived rather than written out. A literal xpub in a test is a literal
    // that can be subtly wrong, and this one only has to be a real cosigner.
    using cosignerSeed = mnemonicToSeed(
      'legal winner thank year wave sausage worth useful legal winner thank yellow',
      ''
    )
    const other = deriveAccountXpub(cosignerSeed, MAINNET, multisigAccountPath(MAINNET)).xpub
    // Through withChecksum, because the register path refuses a descriptor
    // without one: a single mistyped character is a valid descriptor for a
    // different wallet.
    const descriptor = withChecksum(`wsh(sortedmulti(2,${ourKey.xpub}/<0;1>/*,${other}/<0;1>/*))`)

    const registered = (await call('multisig.register', {
      descriptor,
      passphrase: 'a passphrase that would normally persist it',
    })) as { persisted: boolean }

    expect(registered.persisted).toBe(false)
    expect(readdirSync(dir)).toEqual([])

    // And it is usable for this session, which is the point of allowing it.
    const registrations = (await call('multisig.registrations')) as {
      descriptors: readonly string[]
    }
    expect(registrations.descriptors).toHaveLength(1)
  })

  /**
   * INV-EPH-3. The mode cannot be turned off.
   *
   * There is no method that clears it and no parameter that overrides it. The
   * only exit is locking, which forgets the seed, so a user who wanted a
   * throwaway session cannot be walked into keeping one.
   */
  it('cannot-be-switched-off-without-forgetting-the-seed', async () => {
    await call('wallet.import', { mnemonic: MNEMONIC, passphrase: '', ephemeral: true })
    expect(session.ephemeral).toBe(true)

    // Re-importing the same mnemonic without the flag is a NEW load, which is
    // allowed: it is the user deliberately starting over, and the previous
    // seed is disposed on the way.
    await call('wallet.import', { mnemonic: MNEMONIC, passphrase: '', ephemeral: false })
    expect(session.ephemeral).toBe(false)

    // Locking clears it, so the next wallet is not silently barred from being
    // saved either.
    await call('wallet.import', { mnemonic: MNEMONIC, passphrase: '', ephemeral: true })
    session.lock()
    expect(session.ephemeral).toBe(false)
  })

  it('says-so-on-device-status-so-every-screen-can-repeat-it', async () => {
    await call('wallet.import', { mnemonic: MNEMONIC, passphrase: '', ephemeral: true })
    const status = (await call('device.status')) as { ephemeral: boolean }
    expect(status.ephemeral).toBe(true)

    session.lock()
    expect(((await call('device.status')) as { ephemeral: boolean }).ephemeral).toBe(false)
  })

  /**
   * A wallet loaded from the store is on the disk by definition, so unlocking
   * one must clear the flag rather than inherit it from whatever came before.
   */
  it('does-not-carry-the-flag-onto-a-stored-wallet', async () => {
    // A stored wallet first.
    await call('wallet.import', { mnemonic: MNEMONIC, passphrase: '' })
    const created = (await call('wallets.create', {
      passphrase: 'stored',
      label: 'Kept',
      colour: 'teal',
    })) as { id: string }

    // Then an ephemeral session, then back to the stored one.
    session.lock()
    await call('wallet.import', {
      mnemonic: 'legal winner thank year wave sausage worth useful legal winner thank yellow',
      passphrase: '',
      ephemeral: true,
    })
    expect(session.ephemeral).toBe(true)

    await call('wallets.unlock', { id: created.id, passphrase: 'stored' })
    expect(session.ephemeral).toBe(false)

    // And it can be renamed, which is a write, proving the flag really cleared.
    await expect(
      call('wallets.rename', { passphrase: 'stored', label: 'Still kept', colour: 'rose' })
    ).resolves.toBeTruthy()
  })

  it('leaves-nothing-of-the-seed-on-disk-after-a-whole-session', async () => {
    await call('wallet.import', { mnemonic: MNEMONIC, passphrase: '', ephemeral: true })
    await call('wallet.addresses', { scriptType: 'p2wpkh', change: false, start: 0, count: 5 })
    await call('wallet.descriptor', { scriptType: 'p2wpkh', change: false })
    session.lock()

    using seed = mnemonicToSeed(MNEMONIC, '')
    const contents = everythingOnDisk()
    expect(contents).not.toContain(Buffer.from(seed.bytes).toString('hex'))
    expect(contents).not.toContain('abandon')
    expect(contents).toBe('')
  })
})
