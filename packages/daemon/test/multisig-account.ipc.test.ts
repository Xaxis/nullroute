/**
 * Tests for the multisig account a request may name.
 *
 * Registrations are stored as descriptors alone, and everything that reads
 * them derives this device's key at account 0. A quorum at account 1 was
 * accepted and saved, then recognised by nothing: its change read as a
 * stranger's and signing refused. The account is refused at the door instead.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHandler } from '../src/handler.js'
import { Session } from '../src/session.js'
import type { BootAttestation } from '../src/boot/attestation.js'

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const attestation = { passed: true, version: 'test' } as unknown as BootAttestation

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

describe('the multisig account', () => {
  /** INV-MULTI-13. Every method that hands out or checks a multisig key. */
  it('refuses-an-account-nothing-downstream-would-recognise', async () => {
    const descriptor = 'wsh(sortedmulti(2,a,b))#checksum'
    for (const [method, params] of [
      ['multisig.ourKey', { account: 1 }],
      ['multisig.review', { descriptor, account: 1 }],
      ['multisig.register', { descriptor, account: 1 }],
      ['multisig.exportBundle', { account: 1 }],
    ] as const) {
      await expect(call(method, params), method).rejects.toThrow(/account 0 only/)
    }
    expect(session.registrations).toEqual([])
  })

  /** INV-MULTI-13. Account 0, named or left out, is what everything uses. */
  it('accepts-account-zero-whether-named-or-not', async () => {
    const implicit = (await call('multisig.ourKey')) as { xpub: string }
    const named = (await call('multisig.ourKey', { account: 0 })) as { xpub: string }
    expect(named.xpub).toBe(implicit.xpub)
  })
})
