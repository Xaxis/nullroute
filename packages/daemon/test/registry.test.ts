/**
 * Tests for daemon.store.registry.
 *
 * A device holding several wallets has one failure that matters more than every
 * other combined: the user signs with a wallet they did not mean to use. Every
 * other property here exists to make that hard.
 *
 * So the tests are mostly about the boundary between what a wallet SAYS it is
 * and what it IS. The hint file beside each blob is editable by anyone holding
 * the card. The sealed identity is not. Wherever the two can disagree, the
 * sealed one has to win and the user has to be told.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAINNET, SIGNET, Secret, masterFingerprint } from '@nullroute/core'
import { StoreError, BadPassphraseError } from '../src/store/envelope.js'
import { MAX_ATTEMPTS, WalletStore } from '../src/store/store.js'
import {
  MAX_LABEL,
  MAX_WALLETS,
  WalletRegistry,
  normaliseLabel,
} from '../src/store/registry.js'

/** Cheap parameters. The plumbing is under test, not the work factor. */
const FAST = { m: 8192, t: 1, p: 1 } as const
const PASSPHRASE = 'correct horse battery staple'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nullroute-registry-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** A distinct seed per index, so two wallets are genuinely different wallets. */
function seedFor(index: number): Secret {
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 32; i += 1) bytes[i] = (index * 37 + i) & 0xff
  return Secret.fromBytes(bytes, 'test-seed')
}

function registry(): WalletRegistry {
  return new WalletRegistry(dir, FAST)
}

function createWallet(
  reg: WalletRegistry,
  index: number,
  label: string,
  network = MAINNET,
  passphrase = PASSPHRASE
): string {
  using seed = seedFor(index)
  return reg.create({ seed, network, passphrase, label, colour: 'teal' }).id
}

function hintPath(id: string): string {
  return join(dir, id, 'wallet.hint')
}

describe('daemon.store.registry', () => {
  // INV-MW-1. Wallets are independent: separate files, separate passphrases.
  it('holds-several-independent-wallets', () => {
    const reg = registry()
    const cold = createWallet(reg, 1, 'Cold storage', MAINNET, 'passphrase one')
    const hot = createWallet(reg, 2, 'Spending', SIGNET, 'passphrase two')

    expect(reg.list()).toHaveLength(2)
    expect(cold).not.toBe(hot)

    // Each opens under its own passphrase and under no other.
    const openedCold = reg.unlock(cold, 'passphrase one')
    expect(openedCold.label).toBe('Cold storage')
    expect(openedCold.network.id).toBe('mainnet')
    openedCold.seed.dispose()

    expect(() => reg.unlock(hot, 'passphrase one')).toThrow(BadPassphraseError)
    const openedHot = reg.unlock(hot, 'passphrase two')
    expect(openedHot.label).toBe('Spending')
    expect(openedHot.network.id).toBe('signet')
    openedHot.seed.dispose()
  })

  /**
   * INV-MW-2. No part of a wallet's path comes from anything a user typed.
   *
   * The directory is a random id. A label that tried to escape the store root
   * would be a label that could overwrite a file elsewhere on the device, and
   * the only reason it cannot is that the label never reaches a path at all.
   */
  it('never-lets-a-name-influence-a-path', () => {
    const reg = registry()
    const nasty = '../../etc/passwd'
    const id = createWallet(reg, 1, nasty)

    expect(id).toMatch(/^[0-9a-f]{16}$/)
    expect(readdirSync(dir)).toEqual([id])
    expect(existsSync(join(dir, id, 'wallet.store'))).toBe(true)

    // And the name survives verbatim as a label, because it is only ever text.
    const opened = reg.unlock(id, PASSPHRASE)
    expect(opened.label).toBe(nasty)
    opened.seed.dispose()

    // An id that did not come from here is refused rather than joined onto.
    expect(() => reg.store('../escape')).toThrow(StoreError)
    expect(() => reg.store('nonsense')).toThrow(/not a wallet id/)
    expect(WalletRegistry.isId('../escape')).toBe(false)
    expect(WalletRegistry.isId(id)).toBe(true)
  })

  /**
   * INV-MW-3. The hint outside is a hint. The sealed identity is the wallet.
   *
   * This is the attack the whole design is shaped around: relabel the picker so
   * a user opens what they think is their signet test wallet and it is really
   * mainnet, or the reverse.
   */
  it('takes-identity-from-inside-the-ciphertext-and-repairs-the-hint', () => {
    const reg = registry()
    const id = createWallet(reg, 1, 'Signet test', SIGNET)

    writeFileSync(
      hintPath(id),
      JSON.stringify({ label: 'Cold storage', colour: 'rose', network: 'mainnet' })
    )
    // Before unlocking, the picker shows the lie. It has no way not to.
    expect(reg.list()[0]?.hint.label).toBe('Cold storage')

    const opened = reg.unlock(id, PASSPHRASE)
    expect(opened.label).toBe('Signet test')
    expect(opened.colour).toBe('teal')
    expect(opened.network.id).toBe('signet')
    // And the caller is told, so a screen can say the picker was wrong.
    expect(opened.hintCorrected).toBe(true)
    opened.seed.dispose()

    // The lie is gone from disk, not merely ignored in memory.
    const repaired = JSON.parse(readFileSync(hintPath(id), 'utf8')) as Record<string, unknown>
    expect(repaired['label']).toBe('Signet test')
    expect(repaired['network']).toBe('signet')

    // A second unlock has nothing to correct.
    const again = reg.unlock(id, PASSPHRASE)
    expect(again.hintCorrected).toBe(false)
    again.seed.dispose()
  })

  /**
   * INV-MW-4. One seed, one wallet.
   *
   * Sealing the same seed twice under two passphrases means the weaker one
   * governs the money, and a picker showing two different names gives the user
   * no way to notice. The seed is in hand at create time, so this is checkable.
   */
  it('refuses-a-second-wallet-holding-a-seed-it-already-has', () => {
    const reg = registry()
    createWallet(reg, 1, 'Cold storage')

    using same = seedFor(1)
    expect(() =>
      reg.create({
        seed: same,
        network: MAINNET,
        passphrase: 'a much weaker passphrase',
        label: 'Spending',
        colour: 'amber',
      })
    ).toThrow(/already holds this seed/)

    // The same seed on a DIFFERENT network is a different wallet and is allowed,
    // because it derives different addresses and shares nothing a user would
    // confuse.
    using again = seedFor(1)
    expect(() =>
      reg.create({
        seed: again,
        network: SIGNET,
        passphrase: 'another passphrase',
        label: 'Signet copy',
        colour: 'lime',
      })
    ).not.toThrow()
    expect(reg.list()).toHaveLength(2)
  })

  it('refuses-two-wallets-with-the-same-name', () => {
    const reg = registry()
    createWallet(reg, 1, 'Cold storage')
    using other = seedFor(2)
    expect(() =>
      reg.create({
        seed: other,
        network: MAINNET,
        passphrase: PASSPHRASE,
        label: 'cold STORAGE',
        colour: 'rose',
      })
    ).toThrow(/already holds a wallet called/)
  })

  /**
   * INV-MW-5. Renaming must not be able to destroy a wallet.
   *
   * `reseal` verifies the passphrase by calling `unlock`, which counts failures
   * and erases the blob at the limit. Routing a cosmetic change through it would
   * make choosing a different colour a way to lose a wallet, on a screen that
   * shows no attempt counter.
   */
  it('renames-without-spending-the-attempt-budget', () => {
    const reg = registry()
    const id = createWallet(reg, 1, 'Cold storage')
    using seed = seedFor(1)

    for (let attempt = 0; attempt < MAX_ATTEMPTS + 5; attempt += 1) {
      expect(() =>
        reg.rename(id, {
          seed,
          network: MAINNET,
          passphrase: 'wrong',
          label: 'Renamed',
          colour: 'rose',
          registrations: [],
        })
      ).toThrow(BadPassphraseError)
    }

    // Still here, still openable, counter untouched.
    expect(reg.store(id).status().failedAttempts).toBe(0)
    expect(reg.store(id).exists()).toBe(true)

    const hint = reg.rename(id, {
      seed,
      network: MAINNET,
      passphrase: PASSPHRASE,
      label: 'Renamed',
      colour: 'rose',
      registrations: [],
    })
    expect(hint.label).toBe('Renamed')

    const opened = reg.unlock(id, PASSPHRASE)
    expect(opened.label).toBe('Renamed')
    expect(opened.colour).toBe('rose')
    opened.seed.dispose()
  })

  /**
   * A wrong passphrase at the PICKER still counts, and still erases. That is
   * the behaviour INV-STORE-4 describes and renaming is the exception to it,
   * not the other way round.
   */
  it('still-counts-and-erases-on-repeated-wrong-unlocks', () => {
    const reg = registry()
    const id = createWallet(reg, 1, 'Cold storage')

    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
      expect(() => reg.unlock(id, 'wrong')).toThrow(BadPassphraseError)
    }
    expect(() => reg.unlock(id, 'wrong')).toThrow(/has been erased/)
    expect(reg.store(id).exists()).toBe(false)

    // And it erased only that wallet.
    const other = createWallet(reg, 2, 'Untouched')
    expect(reg.store(other).exists()).toBe(true)
  })

  it('erases-one-wallet-and-leaves-the-others', () => {
    const reg = registry()
    const first = createWallet(reg, 1, 'Cold storage')
    const second = createWallet(reg, 2, 'Spending')

    reg.destroy(first)
    expect(existsSync(join(dir, first))).toBe(false)
    expect(reg.list().map((entry) => entry.id)).toEqual([second])

    const opened = reg.unlock(second, PASSPHRASE)
    expect(opened.label).toBe('Spending')
    opened.seed.dispose()
  })

  it('caps-how-many-wallets-one-device-holds', () => {
    const reg = registry()
    for (let index = 0; index < MAX_WALLETS; index += 1) {
      createWallet(reg, index, `Wallet ${String(index)}`)
    }
    using extra = seedFor(99)
    expect(() =>
      reg.create({
        seed: extra,
        network: MAINNET,
        passphrase: PASSPHRASE,
        label: 'One too many',
        colour: 'cyan',
      })
    ).toThrow(/which is the limit/)
  })

  /**
   * INV-MW-6. A device that already has a wallet keeps it.
   *
   * The single most dangerous path in this change: it runs once, on a device
   * with real money on it, and there is no second chance.
   */
  it('migrates-a-pre-multi-wallet-store-without-losing-it', () => {
    // A store written the old way, at the root, with no identity sealed.
    const legacy = new WalletStore(dir, FAST)
    using seed = seedFor(7)
    legacy.create(seed, SIGNET, PASSPHRASE, ['wsh(sortedmulti(2,a,b,c))#aaaaaaaa'])
    expect(existsSync(join(dir, 'wallet.store'))).toBe(true)

    const reg = registry()
    expect(reg.hasLegacy()).toBe(true)
    const id = reg.migrateLegacy()
    if (id === undefined) throw new Error('nothing migrated')

    // Moved, not copied: the old location is clear so it cannot be found twice.
    expect(existsSync(join(dir, 'wallet.store'))).toBe(false)
    expect(reg.hasLegacy()).toBe(false)
    expect(reg.list().map((entry) => entry.id)).toEqual([id])

    // Same passphrase, same seed, same network, same registrations.
    const opened = reg.unlock(id, PASSPHRASE)
    expect(opened.network.id).toBe('signet')
    expect(opened.registrations).toEqual(['wsh(sortedmulti(2,a,b,c))#aaaaaaaa'])
    expect(Buffer.from(opened.seed.bytes).toString('hex')).toBe(
      Buffer.from(seedFor(7).bytes).toString('hex')
    )
    opened.seed.dispose()

    // Running it again is a no-op rather than a second wallet.
    expect(reg.migrateLegacy()).toBeUndefined()
    expect(reg.list()).toHaveLength(1)
  })

  /**
   * A v1 store sealed no label. Reading one must not invent an identity, and
   * must not refuse to open either.
   */
  it('opens-a-v1-store-that-sealed-no-identity', () => {
    const legacy = new WalletStore(dir, FAST)
    using seed = seedFor(3)
    legacy.create(seed, MAINNET, PASSPHRASE)

    const reg = registry()
    const id = reg.migrateLegacy()
    if (id === undefined) throw new Error('nothing migrated')

    const opened = reg.unlock(id, PASSPHRASE)
    // Falls back to the hint the migration wrote, which says what it is.
    expect(opened.label).toBe('My wallet')
    opened.seed.dispose()
  })

  // --- Labels ---------------------------------------------------------------

  it('refuses-a-name-that-does-not-display', () => {
    expect(() => normaliseLabel('')).toThrow(/empty/)
    expect(() => normaliseLabel('   ')).toThrow(/empty/)
    // Zero-width characters only: passes a naive non-empty check, renders blank.
    expect(() => normaliseLabel('​​﻿')).toThrow(/do not display/)
    expect(() => normaliseLabel(' ')).toThrow(/do not display/)
    expect(() => normaliseLabel('x'.repeat(MAX_LABEL + 1))).toThrow(/limit is/)
  })

  it('strips-characters-that-can-forge-another-wallets-name', () => {
    // Bidi override: renders reversed, so this could be made to look like
    // another wallet in the picker.
    expect(normaliseLabel('Cold‮storage')).toBe('Coldstorage')
    // Zero-width joiner hiding inside an otherwise normal name.
    expect(normaliseLabel('Co​ld')).toBe('Cold')
    expect(normaliseLabel('  Cold storage  ')).toBe('Cold storage')
  })

  it('normalises-so-two-identical-looking-names-collide', () => {
    const reg = registry()
    // Precomposed and decomposed forms of the same word.
    createWallet(reg, 1, 'Café')
    using other = seedFor(2)
    expect(() =>
      reg.create({
        seed: other,
        network: MAINNET,
        passphrase: PASSPHRASE,
        label: 'Café',
        colour: 'rose',
      })
    ).toThrow(/already holds a wallet called/)
  })

  it('reads-a-corrupt-hint-as-a-placeholder-rather-than-hiding-the-wallet', () => {
    const reg = registry()
    const id = createWallet(reg, 1, 'Cold storage')

    writeFileSync(hintPath(id), 'not json at all')
    const listed = reg.list()
    // Still listed. A scribbled hint must not make a good wallet unreachable.
    expect(listed).toHaveLength(1)
    expect(listed[0]?.hint.label).toBe('Unnamed wallet')
    expect(listed[0]?.exists).toBe(true)

    // And it still opens, and repairs itself.
    const opened = reg.unlock(id, PASSPHRASE)
    expect(opened.label).toBe('Cold storage')
    expect(opened.hintCorrected).toBe(true)
    opened.seed.dispose()
  })

  it('ignores-directories-that-are-not-wallets', () => {
    const reg = registry()
    const id = createWallet(reg, 1, 'Cold storage')
    writeFileSync(join(dir, '.DS_Store'), 'junk')

    expect(reg.list().map((entry) => entry.id)).toEqual([id])
  })

  /**
   * INV-MW-7. The sealed identity must describe the sealed seed.
   *
   * Not a defence against an attacker, who would edit both. A check against
   * this code: it fires if an identity is ever sealed beside a seed it does not
   * belong to, which would mean the signing screen naming the wrong wallet.
   */
  it('refuses-a-store-whose-sealed-identity-does-not-match-its-seed', () => {
    const reg = registry()
    const id = createWallet(reg, 1, 'Cold storage')
    using wrong = seedFor(2)

    // Re-seal wallet 1's directory with wallet 2's seed under wallet 1's
    // identity, which is the mismatch the check exists for.
    const store = reg.store(id)
    using right = seedFor(1)
    store.resealVerified(wrong, MAINNET, PASSPHRASE, [], {
      label: 'Cold storage',
      colour: 'teal',
      fingerprint: masterFingerprint(right, MAINNET),
    })

    expect(() => reg.unlock(id, PASSPHRASE)).toThrow(/does not match its seed/)
  })
})
