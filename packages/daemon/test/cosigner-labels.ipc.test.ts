/**
 * Tests for naming the other keys in a quorum.
 *
 * A quorum screen listed anonymous extended keys, so on the second device of
 * three you were looking at two strings and trying to remember which physical
 * object each one was. Naming them is the difference between a legible fleet
 * and a list of hex.
 *
 * The names decide nothing, which is most of what these tests are about: they
 * must survive a reseal, never be treated as evidence, and never cost anybody a
 * wallet if they are malformed.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHandler } from '../src/handler.js'
import { Session } from '../src/session.js'
import { WalletRegistry } from '../src/store/registry.js'
import { WalletStore } from '../src/store/store.js'
import type { BootAttestation } from '../src/boot/attestation.js'

const FAST = { m: 8192, t: 1, p: 1 } as const
const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const attestation = { passed: true } as unknown as BootAttestation

const XPUB = 'xpub6DwwuunwScQuscvvkT8Q2gRUcvV8DXcnpXhcnVFP6EPq6MTfWSJ9zJdWi1S8mvNMjhGqrCu2gjmYYpAoUCbGZTMFpAKPBFSF4rV3H7Nrbnr'

let dir: string
let session: Session
let registry: WalletRegistry
let call: (method: string, params?: Record<string, unknown>) => Promise<unknown>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nullroute-cosigner-'))
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
    passphrase: 'correct horse',
    label: 'Family Vault',
    colour: 'teal',
  })) as { id: string }
  return created.id
}

describe('multisig.labelCosigner', () => {
  /**
   * INV-COSIGN-1. A name is set, returned, and marked as the user's own rather
   * than as anything the device checked.
   */
  it('names-a-key-and-says-the-name-proves-nothing', async () => {
    await openWallet()

    const result = (await call('multisig.labelCosigner', {
      xpub: XPUB,
      label: "Dad's Coldcard",
    })) as { cosigners: { xpub: string; label: string }[]; verified: boolean; note: string }

    expect(result.cosigners).toEqual([{ xpub: XPUB, label: "Dad's Coldcard" }])
    expect(result.verified).toBe(false)
    expect(result.note).toContain('never checked')
    expect(result.note).toContain('says nothing about who controls that key')
  })

  it('replaces-a-name-rather-than-accumulating-them', async () => {
    await openWallet()
    await call('multisig.labelCosigner', { xpub: XPUB, label: 'Attic' })
    const result = (await call('multisig.labelCosigner', { xpub: XPUB, label: 'Office' })) as {
      cosigners: { xpub: string; label: string }[]
    }
    expect(result.cosigners).toEqual([{ xpub: XPUB, label: 'Office' }])
  })

  it('clears-a-name-when-given-an-empty-one', async () => {
    await openWallet()
    await call('multisig.labelCosigner', { xpub: XPUB, label: 'Attic' })
    const result = (await call('multisig.labelCosigner', { xpub: XPUB, label: '  ' })) as {
      cosigners: unknown[]
    }
    expect(result.cosigners).toEqual([])
  })

  /**
   * INV-COSIGN-1. Names are stripped the same way a wallet name is, because
   * this string is rendered beside a key on the screen that agrees to a quorum.
   */
  it('strips-a-name-that-could-render-as-something-else', async () => {
    await openWallet()
    const result = (await call('multisig.labelCosigner', {
      xpub: XPUB,
      label: '‮Attic',
    })) as { cosigners: { label: string }[] }
    expect(result.cosigners[0]?.label).toBe('Attic')
  })

  /**
   * INV-COSIGN-2. The names survive a reseal.
   *
   * This is the one that would break silently. Renaming a wallet, or
   * registering a quorum, reseals the store, and a path that forgot to carry
   * these would erase every name the user had assigned as a side effect of
   * changing a colour.
   */
  it('survives-a-rename-and-a-reboot', async () => {
    const id = await openWallet()
    await call('multisig.labelCosigner', {
      xpub: XPUB,
      label: 'Attic',
      passphrase: 'correct horse',
    })

    // Renaming reseals. The name must come through it.
    await call('wallets.rename', {
      label: 'Family Vault 2',
      colour: 'rose',
      passphrase: 'correct horse',
    })

    // And a full reboot: lock, and open the sealed file again.
    session.lock()
    const opened = registry.unlock(id, 'correct horse')
    expect(opened.cosigners).toEqual([{ xpub: XPUB, label: 'Attic' }])
    opened.seed.dispose()
  })

  /**
   * INV-COSIGN-2. Without a passphrase the name lives for this session only,
   * and the response says which it was rather than leaving a screen to guess.
   */
  it('says-whether-a-name-was-written-or-only-held', async () => {
    await openWallet()

    const held = (await call('multisig.labelCosigner', { xpub: XPUB, label: 'Attic' })) as {
      persisted: boolean
    }
    expect(held.persisted).toBe(false)

    const written = (await call('multisig.labelCosigner', {
      xpub: XPUB,
      label: 'Attic',
      passphrase: 'correct horse',
    })) as { persisted: boolean }
    expect(written.persisted).toBe(true)
  })

  it('refuses-to-name-a-cosigner-with-no-wallet-open', async () => {
    session.lock()
    await expect(call('multisig.labelCosigner', { xpub: XPUB, label: 'Attic' })).rejects.toThrow(
      /No wallet is loaded/
    )
  })
})

/**
 * Tests for forgetting a quorum.
 *
 * A quorum registered by mistake was permanent, which is a strange property for
 * the step docs/FLEET.md calls the dangerous one.
 */
describe('multisig.forget', () => {
  const DESCRIPTOR = 'wsh(sortedmulti(2,a,b,c))#checksum'

  /**
   * INV-COSIGN-3. Forgetting a descriptor this device never registered is
   * refused rather than reported as success, because a descriptor differing by
   * one character is a different quorum and silently doing nothing would leave
   * the real one registered.
   */
  it('refuses-a-descriptor-that-was-never-registered', async () => {
    await openWallet()
    await expect(call('multisig.forget', { descriptor: DESCRIPTOR })).rejects.toThrow(
      /no registration matching/
    )
  })

  it('refuses-to-forget-a-quorum-with-no-wallet-open', async () => {
    session.lock()
    await expect(call('multisig.forget', { descriptor: DESCRIPTOR })).rejects.toThrow(
      /No wallet is loaded/
    )
  })

  /**
   * INV-COSIGN-3. Forgetting removes exactly one and says how many are left,
   * and the note says what it did not do: a registration is not a key, so
   * nothing here loses money.
   */
  it('forgets-one-and-says-what-that-did-not-cost', async () => {
    await openWallet()
    session.setRegistrations([DESCRIPTOR, 'wsh(sortedmulti(2,d,e,f))#other'])

    const result = (await call('multisig.forget', { descriptor: DESCRIPTOR })) as {
      forgotten: boolean
      remaining: number
      note: string
    }

    expect(result.forgotten).toBe(true)
    expect(result.remaining).toBe(1)
    expect(session.registrations).toEqual(['wsh(sortedmulti(2,d,e,f))#other'])
    expect(result.note).toContain('does not lose money')
    expect(result.note).toContain('payment to a stranger')
  })

  it('says-whether-the-removal-was-written-or-only-held', async () => {
    await openWallet()
    session.setRegistrations([DESCRIPTOR])
    const held = (await call('multisig.forget', { descriptor: DESCRIPTOR })) as {
      persisted: boolean
    }
    expect(held.persisted).toBe(false)

    session.setRegistrations([DESCRIPTOR])
    const written = (await call('multisig.forget', {
      descriptor: DESCRIPTOR,
      passphrase: 'correct horse',
    })) as { persisted: boolean }
    expect(written.persisted).toBe(true)
  })
})
