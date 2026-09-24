/**
 * Tests for the device's own name.
 *
 * Three nullroute devices holding one 2-of-3 hold the same wallet, so they show
 * the same wallet name, the same colour and the same fingerprint. Nothing on any
 * screen said which of the three objects was in your hand. The cosigner position
 * helps and only inside a quorum: a device with no registrations is anonymous
 * and a device in two quorums has two positions.
 *
 * The name is deliberately powerless. It sits in a plain file beside the wallets
 * so it can be read before any passphrase, which is exactly when the question is
 * asked, and that means anyone holding the card can edit it. So it decides
 * nothing, and the tests here are mostly about it failing safely.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DeviceIdentityStore, IdentityError, MAX_NAME_LENGTH } from '../src/store/identity.js'

let dir: string
let identity: DeviceIdentityStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nullroute-identity-'))
  identity = new DeviceIdentityStore(dir)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('daemon.store.identity', () => {
  /**
   * INV-IDENT-1. A device with no name reads as having none, which is a normal
   * state rather than an error: one device with no siblings does not need one,
   * and demanding a name during setup would be a screen between somebody and
   * their seed for no benefit.
   */
  it('reads-as-unnamed-before-anything-is-written', () => {
    expect(identity.read()).toBeNull()
  })

  it('round-trips-a-name-and-a-colour', () => {
    const saved = identity.write({ name: 'The one in the attic', colour: 'teal' })
    expect(saved).toEqual({ name: 'The one in the attic', colour: 'teal', theme: 'dark' })
    expect(identity.read()).toEqual({
      name: 'The one in the attic',
      colour: 'teal',
      theme: 'dark',
    })

    // Replaces rather than accumulating.
    identity.write({ name: 'Attic', colour: 'rose', theme: 'light' })
    expect(identity.read()).toEqual({ name: 'Attic', colour: 'rose', theme: 'light' })
  })

  /**
   * INV-IDENT-1. A damaged or hostile file reads as no name rather than
   * throwing. This value decides nothing, so failing to read it must not stop
   * the device booting: refusing to start because a cosmetic file was corrupt
   * would be a bad trade.
   */
  it('reads-a-broken-file-as-no-name-rather-than-failing', () => {
    for (const contents of [
      'not json',
      '[]',
      'null',
      '{}',
      '{"name":"Attic"}',
      '{"colour":"teal"}',
      '{"name":42,"colour":"teal"}',
      '{"name":"Attic","colour":"chartreuse"}',
    ]) {
      writeFileSync(identity.path, contents)
      expect(identity.read(), contents).toBeNull()
    }
  })

  /**
   * INV-IDENT-2. A name that could render as something other than what it
   * contains is stripped, and the caller is given back what was actually
   * stored rather than what was typed.
   *
   * This string is drawn in the header of every screen, including the one where
   * a transaction is authorised, so a bidi override there could reorder what
   * sits beside it. Stripped rather than refused, matching wallet labels: the
   * repair is not silent, because what comes back is what the header will show.
   */
  it('strips-what-cannot-be-displayed-and-returns-what-was-stored', () => {
    // A right-to-left override in front of an otherwise fine name.
    const saved = identity.write({ name: '\u202eAttic', colour: 'teal' })
    expect(saved.name).toBe('Attic')
    expect(identity.read()?.name).toBe('Attic')

    // Nothing left once the invisible characters go, which has no repair that
    // preserves intent, so it is refused.
    for (const empty of ['\u200b\u200b', '   ', '\ufeff']) {
      expect(() => identity.write({ name: empty, colour: 'teal' }), empty).toThrow(IdentityError)
    }
  })

  /**
   * INV-LABEL-6. The same definition core refuses by, so the characters every
   * hand-written list missed are stripped from a name here too.
   */
  it('strips-the-format-characters-no-list-named', () => {
    const saved = identity.write({ name: 'At\u061Ctic\u180E\u00AD', colour: 'teal' })
    expect(saved.name).toBe('Attic')
  })

  /**
   * INV-IDENT-1. A hand-edited file does not get to bypass the stripping. The
   * file is editable by anyone holding the card, so what was written is not
   * necessarily what this code wrote.
   */
  it('strips-a-hand-edited-file-on-the-way-out-too', () => {
    writeFileSync(identity.path, JSON.stringify({ name: '\u202eAttic', colour: 'teal' }))
    expect(identity.read()?.name).toBe('Attic')

    writeFileSync(identity.path, JSON.stringify({ name: '\u200b\u200b', colour: 'teal' }))
    expect(identity.read()).toBeNull()
  })

  it('refuses-a-name-longer-than-a-header-can-show', () => {
    expect(() => identity.write({ name: 'x'.repeat(MAX_NAME_LENGTH + 1), colour: 'teal' })).toThrow(
      /at most/
    )
    expect(identity.write({ name: 'x'.repeat(MAX_NAME_LENGTH), colour: 'teal' }).name).toHaveLength(
      MAX_NAME_LENGTH
    )
  })

  it('refuses-a-colour-the-device-cannot-draw', () => {
    expect(() => identity.write({ name: 'Attic', colour: 'chartreuse' })).toThrow(/Unknown colour/)
  })

  /**
   * INV-IDENT-2. Nothing about a key is in this file.
   *
   * The allowed set is asserted exactly rather than checked for absence, so a
   * future change that put a fingerprint or an xpub here fails: an
   * unauthenticated identifier sitting beside the wallets it is meant to
   * distinguish is the failure this guards.
   *
   * The theme joined the list because it is cosmetic in the same way the
   * colour is, and because it has to be readable before any passphrase: a
   * theme sealed inside a wallet could only be applied after unlocking, so the
   * first screen anybody sees would always be the default and would then
   * flicker.
   */
  it('writes-a-name-a-colour-and-a-theme-and-nothing-else', () => {
    identity.write({ name: 'Attic', colour: 'teal' })
    const raw: unknown = JSON.parse(readFileSync(identity.path, 'utf8'))
    expect(Object.keys(raw as object).sort()).toEqual(['colour', 'name', 'theme'])
  })

  /**
   * INV-IDENT-2. An unset theme reads as dark, which is what the device ships
   * in, and a theme this build does not recognise reads as dark too. A file
   * written by a newer build must not leave the panel unrendered.
   */
  it('reads-an-unknown-or-missing-theme-as-dark', () => {
    identity.write({ name: 'Attic', colour: 'teal' })
    writeFileSync(identity.path, JSON.stringify({ name: 'Attic', colour: 'teal' }))
    expect(identity.read()?.theme).toBe('dark')

    writeFileSync(
      identity.path,
      JSON.stringify({ name: 'Attic', colour: 'teal', theme: 'solarized' })
    )
    expect(identity.read()?.theme).toBe('dark')
  })

  /** And an unknown theme is refused on the way IN rather than stored. */
  it('refuses-to-store-a-theme-it-does-not-know', () => {
    expect(() => identity.write({ name: 'Attic', colour: 'teal', theme: 'solarized' })).toThrow(
      /Unknown theme/
    )
  })
})
