/**
 * Tests for the several-wallet IPC surface.
 *
 * The registry tests cover what is on disk. These cover the thing a user can
 * actually reach: switching between wallets, and whether the daemon's answer to
 * "which wallet is about to sign" can ever be wrong.
 *
 * It can only be wrong in one way, and it is the way that costs money. If the
 * seed in memory and the name on screen ever come from different places, a user
 * reviewing a transaction under one wallet's name signs with another's keys. So
 * every response that names a wallet is checked against the seed that is loaded,
 * not against what was asked for.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAINNET, SIGNET, mnemonicToSeed } from '@nullroute/core'
import { createHandler } from '../src/handler.js'
import { Session } from '../src/session.js'
import { WalletRegistry } from '../src/store/registry.js'
import { WalletStore } from '../src/store/store.js'
import type { BootAttestation } from '../src/boot/attestation.js'

const FAST = { m: 8192, t: 1, p: 1 } as const

const MNEMONIC_A =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const MNEMONIC_B =
  'legal winner thank year wave sausage worth useful legal winner thank yellow'

const attestation = {
  passed: true,
  manifestRoot: '0'.repeat(64),
  specs: 0,
  invariants: 0,
  checks: [],
  version: 'test',
} as unknown as BootAttestation

let dir: string
let session: Session
let call: (method: string, params?: Record<string, unknown>) => Promise<unknown>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nullroute-wallets-ipc-'))
  session = new Session()
  const registry = new WalletRegistry(dir, FAST)
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

/** Import a mnemonic and save it as a named wallet, the way the UI does. */
async function makeWallet(
  mnemonic: string,
  label: string,
  passphrase: string,
  network = 'mainnet'
): Promise<string> {
  session.lock()
  await call('network.set', { id: network })
  await call('wallet.import', { mnemonic, passphrase: '' })
  const created = (await call('wallets.create', { passphrase, label, colour: 'teal' })) as {
    id: string
  }
  return created.id
}

interface ListResponse {
  readonly wallets: readonly {
    id: string
    label: string
    colour: string
    network: string
    exists: boolean
  }[]
  readonly active: { id: string; label: string } | null
  readonly verified: boolean
  readonly max: number
}

describe('daemon wallets IPC', () => {
  it('lists-what-the-device-holds-and-says-it-is-unverified', async () => {
    await makeWallet(MNEMONIC_A, 'Cold storage', 'one')
    session.lock()
    await makeWallet(MNEMONIC_B, 'Spending', 'two', 'signet')
    session.lock()

    const listed = (await call('wallets.list')) as ListResponse
    expect(listed.wallets).toHaveLength(2)
    expect(listed.wallets.map((w) => w.label).sort()).toEqual(['Cold storage', 'Spending'])
    expect(listed.active).toBeNull()
    expect(listed.max).toBe(8)

    // The response says, in a field, that none of this is verified yet.
    expect(listed.verified).toBe(false)
    // And it does not carry a fingerprint, which is the one value a user would
    // reasonably treat as proof.
    expect(JSON.stringify(listed)).not.toContain('fingerprint')
  })

  /**
   * INV-MW-8. Switching wallets replaces the seed rather than adding one.
   *
   * The failure this rules out: unlock B, it fails or half succeeds, and the
   * device is left holding A's seed under B's name.
   */
  it('switches-wallets-and-never-holds-two-seeds', async () => {
    const cold = await makeWallet(MNEMONIC_A, 'Cold storage', 'one')
    session.lock()
    const spending = await makeWallet(MNEMONIC_B, 'Spending', 'two')
    session.lock()

    const first = (await call('wallets.unlock', { id: cold, passphrase: 'one' })) as {
      active: { id: string; label: string }
      fingerprint: string
    }
    expect(first.active.label).toBe('Cold storage')

    // The fingerprint the daemon reports is derived from the seed in memory,
    // so this is the check that the name and the keys agree.
    using seedA = mnemonicToSeed(MNEMONIC_A, '')
    const { masterFingerprint } = await import('@nullroute/core')
    expect(first.fingerprint).toBe(masterFingerprint(seedA, MAINNET))

    const second = (await call('wallets.unlock', { id: spending, passphrase: 'two' })) as {
      active: { id: string; label: string }
      fingerprint: string
    }
    expect(second.active.label).toBe('Spending')
    using seedB = mnemonicToSeed(MNEMONIC_B, '')
    expect(second.fingerprint).toBe(masterFingerprint(seedB, MAINNET))
    expect(second.fingerprint).not.toBe(first.fingerprint)
  })

  /**
   * A failed switch must leave nothing open, rather than leaving the previous
   * wallet loaded while the screen has already moved on.
   */
  it('leaves-nothing-open-when-a-switch-fails', async () => {
    const cold = await makeWallet(MNEMONIC_A, 'Cold storage', 'one')
    session.lock()
    const spending = await makeWallet(MNEMONIC_B, 'Spending', 'two')
    session.lock()

    await call('wallets.unlock', { id: cold, passphrase: 'one' })
    expect(session.active?.label).toBe('Cold storage')

    await expect(call('wallets.unlock', { id: spending, passphrase: 'wrong' })).rejects.toThrow()

    // Not still holding Cold storage's seed under a screen that says Spending.
    expect(session.active).toBeUndefined()
    expect(session.unlocked).toBe(false)
  })

  it('reports-when-the-picker-was-showing-the-wrong-name', async () => {
    const id = await makeWallet(MNEMONIC_A, 'Signet test', 'one', 'signet')
    session.lock()

    writeFileSync(
      join(dir, id, 'wallet.hint'),
      JSON.stringify({ label: 'Cold storage', colour: 'rose', network: 'mainnet' })
    )
    const listed = (await call('wallets.list')) as ListResponse
    expect(listed.wallets[0]?.label).toBe('Cold storage')

    const opened = (await call('wallets.unlock', { id, passphrase: 'one' })) as {
      active: { label: string }
      hintCorrected: boolean
      network: { id: string }
    }
    expect(opened.active.label).toBe('Signet test')
    expect(opened.network.id).toBe('signet')
    expect(opened.hintCorrected).toBe(true)
  })

  /**
   * INV-MW-9. The session takes the label that was SEALED, not the one that
   * was asked for.
   *
   * The registry trims a label and strips characters that do not display, so
   * the two can differ. A handler that went on using its own copy would put an
   * unsanitised name on every screen while a sanitised one sat in the
   * ciphertext, which is the two-sources-of-identity problem the whole module
   * exists to prevent.
   */
  it('names-the-wallet-by-what-was-sealed-not-by-what-was-asked-for', async () => {
    session.lock()
    await call('wallet.import', { mnemonic: MNEMONIC_A, passphrase: '' })
    const created = (await call('wallets.create', {
      passphrase: 'one',
      // Padded, and carrying a zero-width space that renders as nothing.
      label: '  Cold\u200b storage  ',
      colour: 'teal',
    })) as { id: string; active: { label: string } }

    expect(created.active.label).toBe('Cold storage')
    expect(session.active?.label).toBe('Cold storage')

    // And it survives a lock and reopen, so the session matched the ciphertext
    // rather than both being wrong in the same way.
    session.lock()
    const opened = (await call('wallets.unlock', {
      id: created.id,
      passphrase: 'one',
    })) as { active: { label: string }; hintCorrected: boolean }
    expect(opened.active.label).toBe('Cold storage')
    expect(opened.hintCorrected).toBe(false)
  })

  /**
   * INV-MW-11. One seed cannot be written twice by using two doors.
   *
   * store.create is the single-wallet path and predates the registry. Leaving
   * both open meant the same seed could be sealed once through each, under two
   * passphrases, with the weaker one governing the money and nothing on any
   * screen showing that the two entries were the same wallet. The registry's
   * duplicate check cannot see a store written behind its back.
   */
  it('refuses-the-legacy-single-wallet-path-once-it-holds-named-wallets', async () => {
    session.lock()
    await call('wallet.import', { mnemonic: MNEMONIC_A, passphrase: '' })
    await call('wallets.create', { passphrase: 'strong', label: 'Cold', colour: 'teal' })

    await expect(call('store.create', { passphrase: 'weak' })).rejects.toThrow(
      /Use wallets.create instead/
    )

    // The whole single-wallet surface is closed, not just the one that could
    // fork a seed. store.destroy was the worse of the two: it addressed a file
    // that does not exist for a named wallet and reported destroyed:true having
    // removed nothing, which is the worst possible answer to "did you erase my
    // wallet".
    await expect(call('store.destroy')).rejects.toThrow(/Use wallets.destroy instead/)
    await expect(call('store.unlock', { passphrase: 'weak' })).rejects.toThrow(
      /Use wallets.unlock instead/
    )

    // store.status stays: it is read-only, and the lock screen calls it before
    // anything about this device is known.
    await expect(call('store.status')).resolves.toBeTruthy()
  })

  /**
   * INV-MW-12. A legacy store that cannot be migrated must not take the picker
   * with it.
   *
   * The picker is the only route to every other wallet on the device, so a
   * failure to read one file would otherwise make all of them unreachable. The
   * error is reported beside the list rather than instead of it.
   */
  it('still-lists-wallets-when-a-legacy-store-cannot-be-migrated', async () => {
    session.lock()
    await call('wallet.import', { mnemonic: MNEMONIC_A, passphrase: '' })
    await call('wallets.create', { passphrase: 'one', label: 'Cold', colour: 'teal' })
    session.lock()

    // A legacy blob the daemon cannot read.
    const legacy = join(dir, 'wallet.store')
    writeFileSync(legacy, '{}')
    chmodSync(legacy, 0o000)

    try {
      const listed = (await call('wallets.list')) as ListResponse & {
        migrated: string | null
        migrationError: string | null
      }
      expect(listed.wallets.map((w) => w.label)).toEqual(['Cold'])
      expect(listed.migrated).toBeNull()
      // Reported, not swallowed.
      expect(listed.migrationError).not.toBeNull()
    } finally {
      chmodSync(legacy, 0o600)
    }
  })

  it('refuses-an-id-that-is-not-an-id', async () => {
    for (const id of ['../escape', 'wallet.store', '', 'ZZZZ', 123, null]) {
      await expect(call('wallets.unlock', { id, passphrase: 'x' })).rejects.toThrow(
        /not a wallet id/
      )
    }
  })

  it('refuses-a-colour-it-does-not-know', async () => {
    session.lock()
    await call('wallet.import', { mnemonic: MNEMONIC_A, passphrase: '' })
    await expect(
      call('wallets.create', { passphrase: 'x', label: 'Test', colour: 'chartreuse' })
    ).rejects.toThrow(/Unknown colour/)
  })

  it('will-not-save-a-wallet-before-the-mnemonic-is-confirmed', async () => {
    session.lock()
    await call('entropy.fromDice', { rolls: '1'.repeat(100), mix: false })
    await expect(
      call('wallets.create', { passphrase: 'x', label: 'Fresh', colour: 'teal' })
    ).rejects.toThrow(/written the mnemonic down/)
  })

  /**
   * INV-MW-9. Renaming is cosmetic and must stay cosmetic.
   *
   * A wrong passphrase here must not spend any of the ten attempts that erase
   * the wallet, because this screen shows no counter and a user changing a
   * colour has no reason to expect they are near destroying anything.
   */
  it('renames-the-open-wallet-without-risking-it', async () => {
    const id = await makeWallet(MNEMONIC_A, 'Cold storage', 'one')

    for (let attempt = 0; attempt < 15; attempt += 1) {
      await expect(
        call('wallets.rename', { passphrase: 'wrong', label: 'Renamed', colour: 'rose' })
      ).rejects.toThrow()
    }

    const listed = (await call('wallets.list')) as ListResponse
    expect(listed.wallets[0]?.exists).toBe(true)

    const renamed = (await call('wallets.rename', {
      passphrase: 'one',
      label: 'Deep cold',
      colour: 'violet',
    })) as { active: { label: string; colour: string } }
    expect(renamed.active.label).toBe('Deep cold')
    expect(renamed.active.colour).toBe('violet')

    // And it survives a lock and a reopen, so it was sealed and not just held.
    session.lock()
    const reopened = (await call('wallets.unlock', { id, passphrase: 'one' })) as {
      active: { label: string; colour: string }
    }
    expect(reopened.active.label).toBe('Deep cold')
    expect(reopened.active.colour).toBe('violet')
  })

  it('erases-only-the-open-wallet-and-locks-afterwards', async () => {
    const cold = await makeWallet(MNEMONIC_A, 'Cold storage', 'one')
    session.lock()
    await makeWallet(MNEMONIC_B, 'Spending', 'two')
    session.lock()

    await call('wallets.unlock', { id: cold, passphrase: 'one' })
    const destroyed = (await call('wallets.destroy')) as { destroyed: boolean; id: string }
    expect(destroyed.id).toBe(cold)

    expect(session.unlocked).toBe(false)
    const listed = (await call('wallets.list')) as ListResponse
    expect(listed.wallets.map((w) => w.label)).toEqual(['Spending'])
  })

  it('refuses-to-rename-or-erase-with-nothing-open', async () => {
    await expect(
      call('wallets.rename', { passphrase: 'x', label: 'y', colour: 'teal' })
    ).rejects.toThrow(/No stored wallet is open/)
    await expect(call('wallets.destroy')).rejects.toThrow(/No stored wallet is open/)
  })

  /**
   * INV-KEY-1 still holds with several wallets. Nothing on this surface returns
   * a seed, a mnemonic, or a passphrase, for any wallet.
   */
  it('never-returns-key-material-for-any-wallet', async () => {
    const id = await makeWallet(MNEMONIC_A, 'Cold storage', 'one')
    session.lock()

    const responses = [
      await call('wallets.list'),
      await call('wallets.unlock', { id, passphrase: 'one' }),
      await call('wallets.rename', { passphrase: 'one', label: 'Renamed', colour: 'lime' }),
    ]

    using seed = mnemonicToSeed(MNEMONIC_A, '')
    const seedHex = Buffer.from(seed.bytes).toString('hex')

    for (const response of responses) {
      const text = JSON.stringify(response)
      expect(text).not.toContain(seedHex)
      expect(text).not.toContain('abandon')
      expect(text).not.toContain('one')
    }
  })

  it('migrates-a-legacy-store-the-first-time-it-lists', async () => {
    // A wallet written the old way, before this device could hold several.
    const legacy = new WalletStore(dir, FAST)
    using seed = mnemonicToSeed(MNEMONIC_A, '')
    legacy.create(seed, SIGNET, 'legacy passphrase')

    const listed = (await call('wallets.list')) as ListResponse & { migrated: string | null }
    expect(listed.migrated).not.toBeNull()
    expect(listed.wallets).toHaveLength(1)

    // And it opens under the passphrase it always had.
    const opened = (await call('wallets.unlock', {
      id: listed.wallets[0]?.id,
      passphrase: 'legacy passphrase',
    })) as { network: { id: string } }
    expect(opened.network.id).toBe('signet')

    // Listing again does not migrate a second time.
    session.lock()
    const again = (await call('wallets.list')) as ListResponse & { migrated: string | null }
    expect(again.migrated).toBeNull()
    expect(again.wallets).toHaveLength(1)
  })
})
