/**
 * Tests for changing the passphrase a wallet is sealed under.
 *
 * TWO THINGS HAVE TO BE TRUE AT ONCE and they pull in opposite directions. The
 * file must stop opening under the old passphrase, or the change did nothing.
 * And the wallet inside it must be identical, or the change quietly moved
 * somebody's money to addresses they have never seen.
 *
 * The second is the one worth being careful about. A passphrase that fed the
 * seed derivation rather than the file encryption would produce a completely
 * different wallet, with a different fingerprint and different addresses, and
 * nothing about the screen would say so until the user looked for coins that
 * were no longer anywhere they could reach.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
const OLD = 'the old one'
const NEW = 'a completely different one'

const attestation = { passed: true } as unknown as BootAttestation

let dir: string
let session: Session
let registry: WalletRegistry
let call: (method: string, params?: Record<string, unknown>) => Promise<unknown>

/** Create a wallet, open, under OLD. Returns its id and first address. */
async function makeWallet(): Promise<{ id: string; address: string; fingerprint: string }> {
  await call('wallet.import', { mnemonic: MNEMONIC, passphrase: '' })
  const created = (await call('wallets.create', {
    passphrase: OLD,
    label: 'Cold storage',
    colour: 'slate',
  })) as { id: string }

  const listed = (await call('wallet.addresses', { scriptType: 'p2wpkh', count: 1 })) as {
    addresses: { address: string }[]
  }
  const status = (await call('device.status')) as { fingerprint: string }
  return {
    id: created.id,
    address: listed.addresses[0]?.address ?? '',
    fingerprint: status.fingerprint,
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nullroute-rekey-'))
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

describe('wallets.passphrase', () => {
  /**
   * INV-STORE-6. The file opens under the new one and not the old one, which
   * is the whole point, and a change that left the old one working would be a
   * change that did nothing while reporting success.
   */
  it('opens-under-the-new-passphrase-and-no-longer-under-the-old', async () => {
    const before = await makeWallet()
    await call('wallets.passphrase', { oldPassphrase: OLD, newPassphrase: NEW })

    session.lock()
    await expect(call('wallets.unlock', { id: before.id, passphrase: OLD })).rejects.toThrow()

    session.lock()
    await call('wallets.unlock', { id: before.id, passphrase: NEW })
    expect(session.hasWallet).toBe(true)
  })

  /**
   * INV-MW-3. A re-key must seal the identity that came OUT of the ciphertext,
   * never the one sitting beside it on disk.
   *
   * The hint file is editable by anyone holding the card, and unlock compares
   * it against the sealed identity and rewrites it when they disagree. That
   * comparison is the mechanism that makes an edited picker visible.
   *
   * changePassphrase used to call `#readHint` and seal what it found, two lines
   * under a comment explaining that the fingerprint is recomputed rather than
   * copied because "copying an unauthenticated value into an authenticated one
   * would launder it". Sealing the hint makes a tampered name authentic, so
   * every later unlock compares it against itself, finds nothing, and reports
   * nothing: the one signal that the card was edited is spent making the edit
   * permanent.
   *
   * The tamper here happens after unlock has already corrected the hint once,
   * which is the state the daemon is actually in when this method is called.
   */
  it('seals-the-identity-from-the-ciphertext-and-not-the-hint-beside-it', async () => {
    const before = await makeWallet()
    const hintPath = join(dir, before.id, 'wallet.hint')
    const hint = JSON.parse(readFileSync(hintPath, 'utf8')) as Record<string, unknown>
    expect(hint['label']).toBe('Cold storage')

    // Somebody with the card edits the picker's copy.
    writeFileSync(hintPath, JSON.stringify({ ...hint, label: 'Spending pocket', colour: 'rose' }))

    await call('wallets.passphrase', { oldPassphrase: OLD, newPassphrase: NEW })

    session.lock()
    const opened = (await call('wallets.unlock', {
      id: before.id,
      passphrase: NEW,
    })) as {
      active: { label: string; colour: string }
      labelVerified?: boolean
      hintCorrected?: boolean
    }

    // What the CIPHERTEXT says this wallet is called.
    expect(opened.active.label).toBe('Cold storage')
    expect(opened.active.colour).toBe('slate')
    expect(opened.labelVerified).toBe(true)
    // And the edit is still reported, rather than having become the truth.
    expect(opened.hintCorrected).toBe(true)
  })

  /**
   * INV-STORE-6. The dangerous half. A passphrase that fed the SEED derivation
   * rather than the file encryption would produce a different wallet with a
   * different fingerprint and different addresses, and the user would discover
   * it looking for coins that are no longer anywhere they can reach.
   */
  it('leaves-the-seed-and-therefore-every-address-exactly-as-it-was', async () => {
    const before = await makeWallet()
    await call('wallets.passphrase', { oldPassphrase: OLD, newPassphrase: NEW })

    session.lock()
    await call('wallets.unlock', { id: before.id, passphrase: NEW })

    const after = (await call('wallet.addresses', { scriptType: 'p2wpkh', count: 1 })) as {
      addresses: { address: string }[]
    }
    const status = (await call('device.status')) as { fingerprint: string }

    expect(after.addresses[0]?.address).toBe(before.address)
    expect(status.fingerprint).toBe(before.fingerprint)
  })

  /**
   * INV-STORE-6. A reseal that dropped the registrations would cost somebody
   * their quorum, so their own change would start reading as a payment to a
   * stranger on the signing screen, as a side effect of changing a passphrase.
   */
  it('carries-the-registrations-and-cosigner-names-through', async () => {
    const before = await makeWallet()
    const descriptor = (await call('multisig.ourKey', {})) as { keyExpression: string }
    expect(typeof descriptor.keyExpression).toBe('string')

    // A name assigned to another key, which is sealed alongside.
    session.setCosigners([{ xpub: 'xpub-of-the-attic-pi', label: 'The attic Pi' }])
    const registrations = session.registrations.length

    await call('wallets.passphrase', { oldPassphrase: OLD, newPassphrase: NEW })
    session.lock()
    await call('wallets.unlock', { id: before.id, passphrase: NEW })

    expect(session.registrations).toHaveLength(registrations)
    expect(session.cosigners).toEqual([{ xpub: 'xpub-of-the-attic-pi', label: 'The attic Pi' }])
  })

  /**
   * INV-STORE-6. A wrong old passphrase changes nothing. The blob has to be
   * byte-identical afterwards: a refusal that had already written something
   * would leave a wallet openable under neither.
   */
  it('changes-nothing-at-all-when-the-old-passphrase-is-wrong', async () => {
    const before = await makeWallet()
    const blob = join(dir, before.id, 'wallet.store')
    const bytes = readFileSync(blob)

    await expect(
      call('wallets.passphrase', { oldPassphrase: 'not it', newPassphrase: NEW })
    ).rejects.toThrow()

    expect(readFileSync(blob).equals(bytes)).toBe(true)

    session.lock()
    await call('wallets.unlock', { id: before.id, passphrase: OLD })
    expect(session.hasWallet).toBe(true)
  })

  /**
   * INV-STORE-6. A mistyped passphrase here must NOT count toward the ten
   * attempts that erase the wallet. That counter exists to slow somebody
   * guessing at a locked device, and making a typo in a feature for protecting
   * a wallet a step toward destroying it would be the wrong trade twice over.
   */
  it('does-not-spend-the-attempts-that-erase-the-wallet', async () => {
    const before = await makeWallet()

    for (let attempt = 0; attempt < 12; attempt += 1) {
      await expect(
        call('wallets.passphrase', { oldPassphrase: 'wrong', newPassphrase: NEW })
      ).rejects.toThrow()
    }

    session.lock()
    await call('wallets.unlock', { id: before.id, passphrase: OLD })
    expect(session.hasWallet).toBe(true)
  })

  /** INV-STORE-6. Setting it to what it already is is a mistake, not a no-op. */
  it('refuses-a-new-passphrase-identical-to-the-old-one', async () => {
    await makeWallet()
    await expect(
      call('wallets.passphrase', { oldPassphrase: OLD, newPassphrase: OLD })
    ).rejects.toThrow(/already has/)
  })

  /** INV-STORE-6. Nothing to change when nothing is open. */
  it('refuses-when-no-stored-wallet-is-open', async () => {
    await expect(
      call('wallets.passphrase', { oldPassphrase: OLD, newPassphrase: NEW })
    ).rejects.toThrow(/nothing to change/)
  })
})
