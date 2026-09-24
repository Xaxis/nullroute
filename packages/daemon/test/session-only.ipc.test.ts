/**
 * Tests for changes the user was told are for this session only.
 *
 * Registering a quorum, forgetting one, or naming a cosigner without a
 * passphrase is allowed, answers `persisted: false`, and the screen says the
 * change will not survive a lock. Every later reseal used to seal the live
 * session anyway: rename the wallet or change its passphrase and the change
 * nobody saved became permanent, and an explicit save of one quorum carried
 * every unsaved one along with it. These tests lock and reopen the wallet,
 * because only the ciphertext says what was saved.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAINNET, deriveAccountXpub, mnemonicToSeed, withChecksum } from '@nullroute/core'
import { createHandler } from '../src/handler.js'
import { multisigAccountPath } from '../src/multisig.js'
import { Session } from '../src/session.js'
import { WalletRegistry } from '../src/store/registry.js'
import { WalletStore } from '../src/store/store.js'
import type { BootAttestation } from '../src/boot/attestation.js'

const FAST = { m: 8192, t: 1, p: 1 } as const
const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const OTHERS = [
  'legal winner thank year wave sausage worth useful legal winner thank yellow',
  'letter advice cage absurd amount doctor acoustic avoid letter advice cage above',
]
const XPUB =
  'xpub6DkFAXWQ2dHxq2vatrt9qyA3bXYU4ToWQwCHbf5XB2mSTexcHZCeKS1VZYcPoBd5X8yVcbXFHJR9R8UCVpt82VX1VhR28mCyxUFL4r6KFrf'
const attestation = { passed: true, version: 'test' } as unknown as BootAttestation

let dir: string
let session: Session
let registry: WalletRegistry
let call: (method: string, params?: Record<string, unknown>) => Promise<unknown>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nullroute-session-only-'))
  session = new Session()
  registry = new WalletRegistry(dir, FAST)
  const handler = createHandler({
    attestation,
    session,
    store: new WalletStore(dir, FAST),
    registry,
  })
  call = (method, params = {}) => handler({ id: '1', method, params })
})

afterEach(() => {
  session.lock()
  rmSync(dir, { recursive: true, force: true })
})

async function openWallet(): Promise<string> {
  await call('wallet.import', { mnemonic: MNEMONIC, passphrase: '' })
  await call('seed.confirmBackup')
  const created = (await call('wallets.create', {
    passphrase: 'pw',
    label: 'Vault',
    colour: 'teal',
  })) as { id: string }
  return created.id
}

/** A 2-of-2 between this wallet and one other seed. */
async function quorum(other: string): Promise<string> {
  const ours = (await call('multisig.ourKey', {})) as { xpub: string }
  using seed = mnemonicToSeed(other, '')
  const theirs = deriveAccountXpub(seed, MAINNET, multisigAccountPath(MAINNET)).xpub
  return withChecksum(`wsh(sortedmulti(2,${ours.xpub}/<0;1>/*,${theirs}/<0;1>/*))`)
}

/** What the ciphertext holds, read the way a reboot would read it. */
function sealed(id: string, passphrase: string) {
  session.lock()
  const opened = registry.unlock(id, passphrase)
  const result = { registrations: [...opened.registrations], cosigners: [...opened.cosigners] }
  opened.seed.dispose()
  return result
}

describe('changes held for this session only', () => {
  /**
   * INV-COSIGN-4. The route that was measured: register without a passphrase,
   * as the frontend does, then rename the wallet correctly.
   */
  it('does-not-seal-an-unsaved-registration-on-rename', async () => {
    const id = await openWallet()
    const held = (await call('multisig.register', {
      descriptor: await quorum(OTHERS[0] ?? ''),
    })) as {
      persisted: boolean
    }
    expect(held.persisted).toBe(false)

    await call('wallets.rename', { label: 'Vault 2', colour: 'rose', passphrase: 'pw' })
    expect(sealed(id, 'pw').registrations).toEqual([])
  })

  /** INV-COSIGN-4. The other direction: an unsaved forget, then a new passphrase. */
  it('does-not-seal-an-unsaved-forget-on-a-passphrase-change', async () => {
    const id = await openWallet()
    const descriptor = await quorum(OTHERS[0] ?? '')
    await call('multisig.register', { descriptor, passphrase: 'pw' })
    const forgotten = (await call('multisig.forget', { descriptor })) as { persisted: boolean }
    expect(forgotten.persisted).toBe(false)

    await call('wallets.passphrase', { oldPassphrase: 'pw', newPassphrase: 'pw2' })
    expect(sealed(id, 'pw2').registrations).toEqual([descriptor])
  })

  /** INV-COSIGN-4. A cosigner name held for the session stays out of a rename. */
  it('does-not-seal-an-unsaved-cosigner-name-on-rename', async () => {
    const id = await openWallet()
    await call('multisig.labelCosigner', { xpub: XPUB, label: 'Attic' })

    await call('wallets.rename', { label: 'Vault 2', colour: 'rose', passphrase: 'pw' })
    expect(sealed(id, 'pw').cosigners).toEqual([])
  })

  /**
   * INV-COSIGN-4. Saving one quorum saves that one. It used to seal the whole
   * live list, including one registered a moment earlier for the session only.
   */
  it('saves-only-the-quorum-it-was-asked-to-save', async () => {
    const id = await openWallet()
    const first = await quorum(OTHERS[0] ?? '')
    const second = await quorum(OTHERS[1] ?? '')
    await call('multisig.register', { descriptor: first })
    const saved = (await call('multisig.register', { descriptor: second, passphrase: 'pw' })) as {
      persisted: boolean
    }
    expect(saved.persisted).toBe(true)

    expect(sealed(id, 'pw').registrations).toEqual([second])
  })

  /**
   * INV-COSIGN-4. And the fix must not cost what WAS saved: a saved quorum and
   * a saved name survive a later rename untouched, with an unsaved change
   * sitting beside them in the session.
   */
  it('keeps-what-was-saved-through-a-later-rename', async () => {
    const id = await openWallet()
    const kept = await quorum(OTHERS[0] ?? '')
    await call('multisig.register', { descriptor: kept, passphrase: 'pw' })
    await call('multisig.labelCosigner', { xpub: XPUB, label: 'Attic', passphrase: 'pw' })
    await call('multisig.register', { descriptor: await quorum(OTHERS[1] ?? '') })

    await call('wallets.rename', { label: 'Vault 2', colour: 'rose', passphrase: 'pw' })
    const after = sealed(id, 'pw')
    expect(after.registrations).toEqual([kept])
    expect(after.cosigners).toEqual([{ xpub: XPUB, label: 'Attic' }])
  })
})
