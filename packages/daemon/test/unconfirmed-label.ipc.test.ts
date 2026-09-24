/**
 * Tests for the name of a wallet that never sealed one.
 *
 * A wallet migrated from a v1 store has no name inside its ciphertext, so it
 * opens as "Unconfirmed wallet" with labelVerified false, and the screen says
 * the name is not confirmed. Renaming it is the user naming it. Changing its
 * passphrase or saving a quorum is not, and both used to seal the placeholder,
 * after which the wallet opened as a verified wallet called "Unconfirmed
 * wallet".
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAINNET, deriveAccountXpub, mnemonicToSeed, withChecksum } from '@nullroute/core'
import { createHandler } from '../src/handler.js'
import { multisigAccountPath } from '../src/multisig.js'
import { Session } from '../src/session.js'
import { UNCONFIRMED_LABEL, WalletRegistry } from '../src/store/registry.js'
import { WalletStore } from '../src/store/store.js'
import type { BootAttestation } from '../src/boot/attestation.js'

const FAST = { m: 8192, t: 1, p: 1 } as const
const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const attestation = { passed: true, version: 'test' } as unknown as BootAttestation

let dir: string
let session: Session
let call: (method: string, params?: Record<string, unknown>) => Promise<unknown>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nullroute-unconfirmed-'))
  session = new Session()
  const handler = createHandler({
    attestation,
    session,
    store: new WalletStore(dir, FAST),
    registry: new WalletRegistry(dir, FAST),
  })
  call = (method, params = {}) => handler({ id: '1', method, params })
})

afterEach(() => {
  session.lock()
  rmSync(dir, { recursive: true, force: true })
})

interface Opened {
  readonly active: { readonly label: string }
  readonly labelVerified: boolean
}

/** A v1 store at the root, migrated by listing, then opened. */
async function migratedAndOpen(passphrase: string): Promise<string> {
  using seed = mnemonicToSeed(MNEMONIC, '')
  new WalletStore(dir, FAST).create(seed, MAINNET, passphrase)
  const listed = (await call('wallets.list')) as { migrated: string }
  const opened = (await call('wallets.unlock', { id: listed.migrated, passphrase })) as Opened
  expect(opened.labelVerified).toBe(false)
  expect(opened.active.label).toBe(UNCONFIRMED_LABEL)
  return listed.migrated
}

async function reopen(id: string, passphrase: string): Promise<Opened> {
  await call('session.lock')
  return (await call('wallets.unlock', { id, passphrase })) as Opened
}

describe('a wallet whose name was never sealed', () => {
  /** INV-MW-15. Changing the passphrase is not naming the wallet. */
  it('stays-unconfirmed-through-a-passphrase-change', async () => {
    const id = await migratedAndOpen('pw')
    await call('wallets.passphrase', { oldPassphrase: 'pw', newPassphrase: 'pw2' })
    expect((await reopen(id, 'pw2')).labelVerified).toBe(false)
  })

  /** INV-MW-15. Nor is saving a quorum. */
  it('stays-unconfirmed-through-a-saved-quorum', async () => {
    const id = await migratedAndOpen('pw')
    const ours = (await call('multisig.ourKey', {})) as { xpub: string }
    using other = mnemonicToSeed(
      'legal winner thank year wave sausage worth useful legal winner thank yellow',
      ''
    )
    const theirs = deriveAccountXpub(other, MAINNET, multisigAccountPath(MAINNET)).xpub
    const descriptor = withChecksum(`wsh(sortedmulti(2,${ours.xpub}/<0;1>/*,${theirs}/<0;1>/*))`)
    const saved = (await call('multisig.register', { descriptor, passphrase: 'pw' })) as {
      persisted: boolean
    }
    expect(saved.persisted).toBe(true)
    expect((await reopen(id, 'pw')).labelVerified).toBe(false)
  })

  /** INV-MW-15. Renaming it is, and seals the name the user chose. */
  it('is-confirmed-by-renaming-it', async () => {
    const id = await migratedAndOpen('pw')
    await call('wallets.rename', { label: 'Cold storage', colour: 'teal', passphrase: 'pw' })
    const opened = await reopen(id, 'pw')
    expect(opened.labelVerified).toBe(true)
    expect(opened.active.label).toBe('Cold storage')
  })
})
