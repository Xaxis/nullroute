/**
 * Tests for the BIP-39 passphrase flag surviving a seeded backup.
 *
 * A wallet made with a BIP-39 passphrase is shown that the passphrase matters,
 * because the words alone restore a different, empty wallet. The flag lived in
 * the wallet's hint and not in the backup, so restoring a seeded backup onto a
 * fresh device, then saving it, produced a wallet that said it had no
 * passphrase: the warning was off on exactly the wallets it exists for.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAINNET, Secret } from '@nullroute/core'
import { createHandler } from '../src/handler.js'
import { Session } from '../src/session.js'
import { createBackup, restoreBackup } from '../src/store/backup.js'
import { StoreError, open, seal, seedFromHex } from '../src/store/envelope.js'
import { WalletRegistry } from '../src/store/registry.js'
import { WalletStore } from '../src/store/store.js'
import type { BootAttestation } from '../src/boot/attestation.js'

const FAST = { m: 8192, t: 1, p: 1 } as const
const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const attestation = { passed: true, version: 'test' } as unknown as BootAttestation

interface Device {
  readonly dir: string
  readonly session: Session
  readonly registry: WalletRegistry
  readonly call: (method: string, params?: Record<string, unknown>) => Promise<unknown>
}

function device(): Device {
  const dir = mkdtempSync(join(tmpdir(), 'nullroute-flag-'))
  const session = new Session()
  const registry = new WalletRegistry(dir, FAST)
  const handler = createHandler({
    attestation,
    session,
    store: new WalletStore(dir, FAST),
    registry,
  })
  return {
    dir,
    session,
    registry,
    call: (method, params = {}) => handler({ id: '1', method, params }),
  }
}

let devices: Device[] = []

beforeEach(() => {
  devices = []
})

afterEach(() => {
  for (const each of devices) {
    each.session.lock()
    rmSync(each.dir, { recursive: true, force: true })
  }
})

function fresh(): Device {
  const made = device()
  devices.push(made)
  return made
}

describe('the BIP-39 passphrase flag in a seeded backup', () => {
  /**
   * INV-BACKUP-6. The whole route: made with a passphrase, backed up with the
   * seed, restored on another device, saved, locked and opened again.
   */
  // Two devices and six key derivations: about two seconds idle, so it asks
  // for more than the suite's fifteen on a busy machine.
  it('carries-the-flag-through-a-restore-onto-another-device', { timeout: 60_000 }, async () => {
    const first = fresh()
    await first.call('wallet.import', { mnemonic: MNEMONIC, passphrase: 'twenty-fifth word' })
    await first.call('seed.confirmBackup')
    await first.call('wallets.create', { passphrase: 'pw', label: 'Vault', colour: 'teal' })
    const { backup } = (await first.call('backup.create', {
      passphrase: 'bk',
      includeSeed: true,
    })) as { backup: string }

    const second = fresh()
    await second.call('backup.restore', { backup, passphrase: 'bk' })
    expect(second.session.bip39Passphrase).toBe(true)

    await second.call('seed.confirmBackup')
    const made = (await second.call('wallets.create', {
      passphrase: 'pw',
      label: 'Restored',
      colour: 'teal',
    })) as { id: string }
    await second.call('session.lock')
    const opened = (await second.call('wallets.unlock', { id: made.id, passphrase: 'pw' })) as {
      bip39Passphrase: boolean
    }
    expect(opened.bip39Passphrase).toBe(true)
  })

  /** INV-BACKUP-6. And a wallet without one still restores as without one. */
  it('restores-a-wallet-without-a-passphrase-as-without-one', async () => {
    const first = fresh()
    await first.call('wallet.import', { mnemonic: MNEMONIC, passphrase: '' })
    const { backup } = (await first.call('backup.create', {
      passphrase: 'bk',
      includeSeed: true,
    })) as { backup: string }

    const second = fresh()
    await second.call('backup.restore', { backup, passphrase: 'bk' })
    expect(second.session.bip39Passphrase).toBe(false)
  })

  /**
   * INV-BACKUP-6. The flag is read from inside the ciphertext, a backup from
   * before it was sealed restores as no passphrase, which is what it always
   * said, and a flag of the wrong type is refused rather than guessed.
   */
  it('reads-the-flag-from-the-sealed-payload-only', () => {
    const seed = Secret.fromBytes(seedFromHex('11'.repeat(64)), 'test')
    const written = createBackup(
      { network: MAINNET, registrations: [], label: 'Vault', seed, bip39Passphrase: true },
      'bk',
      'test',
      FAST
    )
    const restored = restoreBackup(written, 'bk')
    expect(restored.bip39Passphrase).toBe(true)
    restored.seed?.dispose()

    const document = JSON.parse(written) as { envelope: Parameters<typeof open>[0] }
    using plaintext = open(document.envelope, 'bk')
    const payload = JSON.parse(new TextDecoder().decode(plaintext.bytes)) as Record<string, unknown>

    const reseal = (changed: Record<string, unknown>): string =>
      JSON.stringify({
        ...document,
        envelope: seal(
          Secret.fromBytes(new TextEncoder().encode(JSON.stringify(changed)), 'test'),
          'bk',
          FAST
        ),
      })

    const older = restoreBackup(reseal({ ...payload, bip39Passphrase: undefined }), 'bk')
    expect(older.bip39Passphrase).toBe(false)
    older.seed?.dispose()

    expect(() => restoreBackup(reseal({ ...payload, bip39Passphrase: 'yes' }), 'bk')).toThrow(
      StoreError
    )
    seed.dispose()
  })
})
