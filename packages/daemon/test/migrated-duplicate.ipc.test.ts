/**
 * Tests for one seed being one wallet, when one of them was migrated.
 *
 * The duplicate check compares fingerprints, and a wallet migrated from a v1
 * store has none in its hint until it is first opened. Importing the same seed
 * and saving it therefore passed the check, and the device held two live
 * wallets with one fingerprint under two passphrases, the weaker governing
 * the money.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAINNET, mnemonicToSeed } from '@nullroute/core'
import { createHandler } from '../src/handler.js'
import { Session } from '../src/session.js'
import { WalletRegistry } from '../src/store/registry.js'
import { WalletStore } from '../src/store/store.js'
import type { BootAttestation } from '../src/boot/attestation.js'

const FAST = { m: 8192, t: 1, p: 1 } as const
const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const OTHER = 'legal winner thank year wave sausage worth useful legal winner thank yellow'
const attestation = { passed: true, version: 'test' } as unknown as BootAttestation

let dir: string
let session: Session
let registry: WalletRegistry
let call: (method: string, params?: Record<string, unknown>) => Promise<unknown>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nullroute-migrated-'))
  session = new Session()
  registry = new WalletRegistry(dir, FAST)
  const handler = createHandler({
    attestation,
    session,
    store: new WalletStore(dir, FAST),
    registry,
  })
  call = (method, params = {}) => handler({ id: '1', method, params })

  using seed = mnemonicToSeed(MNEMONIC, '')
  new WalletStore(dir, FAST).create(seed, MAINNET, 'old')
})

afterEach(() => {
  session.lock()
  rmSync(dir, { recursive: true, force: true })
})

async function save(mnemonic: string): Promise<unknown> {
  await call('session.lock')
  await call('wallet.import', { mnemonic, passphrase: '' })
  await call('seed.confirmBackup')
  return call('wallets.create', { passphrase: 'new', label: 'Main', colour: 'teal' })
}

describe('a migrated wallet and the one-seed-one-wallet rule', () => {
  /** INV-MW-4. Before the migrated wallet is opened, nothing can be compared. */
  it('asks-for-the-migrated-wallet-to-be-opened-before-adding-another', async () => {
    const listed = (await call('wallets.list')) as { migrated: string }
    expect(listed.migrated).toMatch(/^[0-9a-f]+$/)

    await expect(save(MNEMONIC)).rejects.toThrow(/Open .* once before adding another/)
    expect(registry.list().filter((entry) => entry.exists)).toHaveLength(1)
  })

  /**
   * INV-MW-4. Once opened it has a fingerprint, the same seed is refused as a
   * duplicate, and a different seed is stored as normal.
   */
  it('refuses-the-same-seed-and-allows-another-once-it-has-been-opened', async () => {
    const listed = (await call('wallets.list')) as { migrated: string }
    await call('wallets.unlock', { id: listed.migrated, passphrase: 'old' })

    await expect(save(MNEMONIC)).rejects.toThrow(/already holds this seed/)
    await save(OTHER)
    expect(registry.list().filter((entry) => entry.exists)).toHaveLength(2)
  })
})
