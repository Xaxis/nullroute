/**
 * Tests for the BIP-129 first address on the way to the screen.
 *
 * Core checks it (INV-COORD-7). These assert the daemon hands the checked
 * address to the screen and lets a refusal through as a refusal, because the
 * screen shows `firstAddress` as this device's own and would be showing a
 * stranger's if the daemon passed the file's line along instead.
 */

import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHandler } from '../src/handler.js'
import { Session } from '../src/session.js'
import type { BootAttestation } from '../src/boot/attestation.js'

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const attestation = { passed: true, version: 'test' } as unknown as BootAttestation

const bsms = (name: string): string =>
  readFileSync(new URL(`../../../spec/interop/sparrow/bsms/${name}`, import.meta.url), 'utf8')

let session: Session
let call: (method: string, params?: Record<string, unknown>) => Promise<unknown>

beforeEach(async () => {
  session = new Session()
  const handler = createHandler({ attestation, session })
  call = (method, params = {}) => handler({ id: '1', method, params })
  await call('wallet.import', { mnemonic: MNEMONIC, passphrase: '' })
})

afterEach(() => {
  session.lock()
})

describe('multisig.importFile and the BIP-129 first address', () => {
  /** INV-COORD-7. The address BIP-129 publishes for its own test vector. */
  it('returns-the-first-address-core-checked', async () => {
    const imported = (await call('multisig.importFile', {
      contents: bsms('multisig-2.bsms'),
    })) as { firstAddress: string | null; unverifiedClaims: readonly string[] }
    expect(imported.firstAddress).toBe(
      'bc1qrgc6p3kylfztu06ysl752gwwuekhvtfh9vr7zg43jvu60mutamcsv948ej'
    )
    expect(imported.unverifiedClaims.join(' ')).not.toContain('bc1q')

    const unstated = (await call('multisig.importFile', {
      contents: bsms('multisig-14.bsms'),
    })) as { firstAddress: string | null }
    expect(unstated.firstAddress).toBeNull()
  })

  /** INV-COORD-7. A file whose address is not its descriptor's never arrives. */
  it('refuses-a-file-whose-first-address-is-not-its-own', async () => {
    await expect(
      call('multisig.importFile', { contents: bsms('multisig-address-mismatch.bsms') })
    ).rejects.toThrow(/says the wallet's first address is/)
    expect(session.registrations).toEqual([])
  })
})
