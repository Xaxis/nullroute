/**
 * Tests for the phase 4 IPC surface: message review, labels and BIP-85.
 *
 * The core modules are tested against published vectors elsewhere. What is
 * checked here is the boundary: what crosses to the frontend, what is refused,
 * and whether anything reaches a screen that should not.
 *
 * BIP-85 is the interesting one, because it is the second method on this device
 * that deliberately returns key material. The first is `seed.reveal`, which is
 * gated on session state and refused for a stored seed. This one is different
 * and has to be justified rather than assumed: a derived child is a wallet the
 * user is about to write down, so showing it is the point.
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

let dir: string
let session: Session
let call: (method: string, params?: Record<string, unknown>) => Promise<unknown>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nullroute-phase4-'))
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

describe('message.review', () => {
  it('reports-the-commitment-a-verifier-will-recompute', async () => {
    const review = (await call('message.review', { message: 'Hello World' })) as {
      hashHex: string
      refusals: string[]
      warnings: string[]
    }
    expect(review.hashHex).toBe(
      'f0eb03b1a75ac6d9847f55c624a99169b5dccba2a31f5b23bea77ba270de0a7a'
    )
    expect(review.refusals).toEqual([])
  })

  it('refuses-a-message-that-would-display-differently-from-what-is-signed', async () => {
    const review = (await call('message.review', { message: 'pay ‮BTC 1' })) as {
      refusals: string[]
    }
    expect(review.refusals.length).toBeGreaterThan(0)
    expect(review.refusals[0]).toContain('display differently')
  })

  /**
   * INV-DAEMON-20. Signing runs the review again rather than trusting an
   * earlier call. A caller that reviewed one message and signed another would
   * produce a proof over text nobody read, which is the whole risk here.
   */
  it('signs-a-message-and-names-the-address-that-proves-it', async () => {
    await call('wallet.import', { mnemonic: MNEMONIC, passphrase: '' })

    const signed = (await call('message.sign', {
      message: 'Hello World',
      scriptType: 'p2wpkh',
      path: "m/84'/0'/0'/0/0",
    })) as { address: string; signature: string; path: string }

    expect(signed.address).toBe('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu')
    expect(signed.path).toBe("m/84'/0'/0'/0/0")
    expect(signed.signature.length).toBeGreaterThan(0)
  })

  it('refuses-to-sign-a-message-the-review-refuses', async () => {
    await call('wallet.import', { mnemonic: MNEMONIC, passphrase: '' })
    await expect(
      call('message.sign', { message: '', scriptType: 'p2wpkh', path: "m/84'/0'/0'/0/0" })
    ).rejects.toThrow(/no message/)
    await expect(
      call('message.sign', {
        message: 'pay \u202eBTC 1',
        scriptType: 'p2wpkh',
        path: "m/84'/0'/0'/0/0",
      })
    ).rejects.toThrow(/display differently/)
  })

  it('refuses-to-sign-with-no-wallet-loaded', async () => {
    session.lock()
    await expect(
      call('message.sign', {
        message: 'Hello World',
        scriptType: 'p2wpkh',
        path: "m/84'/0'/0'/0/0",
      })
    ).rejects.toThrow(/No wallet is loaded/)
  })
})

describe('labels', () => {
  it('imports-and-exports-without-deciding-anything', async () => {
    const txid = '00'.repeat(32)
    const text = `${JSON.stringify({ type: 'tx', ref: txid, label: 'Rent' })}\nnot json\n`

    const imported = (await call('labels.import', { text })) as {
      labels: { type: string; ref: string; label: string }[]
      skipped: { line: number }[]
      note: string
    }
    expect(imported.labels).toHaveLength(1)
    // The dropped line is reported, so a screen can say the import was partial.
    expect(imported.skipped.map((s) => s.line)).toEqual([2])
    // And the response says out loud that a label decides nothing.
    expect(imported.note).toContain('decides whether an address is yours')

    const exported = (await call('labels.export', { labels: imported.labels })) as {
      text: string
    }
    expect(exported.text).toBe(`${JSON.stringify({ type: 'tx', ref: txid, label: 'Rent' })}\n`)
  })

  it('refuses-an-export-that-is-not-a-list', async () => {
    await expect(call('labels.export', { labels: 'nonsense' })).rejects.toThrow(/must be an array/)
  })
})

describe('bip85.derive', () => {
  beforeEach(async () => {
    await call('wallet.import', { mnemonic: MNEMONIC, passphrase: '' })
  })

  it('returns-a-child-with-the-path-that-produced-it', async () => {
    const child = (await call('bip85.derive', {
      application: 'mnemonic',
      wordCount: 12,
      index: 0,
    })) as { words: string; path: string; wordCount: number }

    expect(child.words.split(' ')).toHaveLength(12)
    // The path is not optional and not on request. The child is unrecoverable
    // without it, and a user who writes down only the words has recorded the
    // half their master mnemonic already implies.
    expect(child.path).toBe("m/83696968'/39'/0'/12'/0'")
  })

  it('derives-hex-and-passwords-too', async () => {
    const hex = (await call('bip85.derive', {
      application: 'hex',
      bytes: 32,
      index: 1,
    })) as { hex: string; path: string }
    expect(hex.hex).toHaveLength(64)
    expect(hex.path).toBe("m/83696968'/128169'/32'/1'")

    const password = (await call('bip85.derive', {
      application: 'password',
      length: 24,
      index: 2,
    })) as { password: string; path: string }
    expect(password.password).toHaveLength(24)
    expect(password.path).toBe("m/83696968'/707764'/24'/2'")
  })

  it('refuses-an-application-it-does-not-know', async () => {
    await expect(call('bip85.derive', { application: 'wif', index: 0 })).rejects.toThrow(
      /Expected mnemonic, hex or password/
    )
  })

  it('refuses-parameters-the-standard-does-not-allow', async () => {
    await expect(
      call('bip85.derive', { application: 'mnemonic', wordCount: 15, index: 0 })
    ).rejects.toThrow(/12, 18 or 24 words/)
    await expect(
      call('bip85.derive', { application: 'hex', bytes: 8, index: 0 })
    ).rejects.toThrow(/16 to 64 bytes/)
  })

  /**
   * Gated on an unlocked wallet like everything else that touches the seed. A
   * device with nothing loaded has no master to derive from, and saying so is
   * better than deriving from whatever happens to be in memory.
   */
  it('refuses-when-no-wallet-is-loaded', async () => {
    session.lock()
    await expect(
      call('bip85.derive', { application: 'mnemonic', wordCount: 12, index: 0 })
    ).rejects.toThrow(/No wallet is loaded/)
  })

  /**
   * The derived child is NOT written anywhere. A child the user wants to keep is
   * imported as a wallet in its own right, which goes through the same
   * confirmation as any other wallet. Deriving one must not quietly create it.
   */
  it('writes-nothing-to-the-device', async () => {
    const { readdirSync } = await import('node:fs')
    await call('bip85.derive', { application: 'mnemonic', wordCount: 24, index: 0 })
    expect(readdirSync(dir)).toEqual([])
  })
})

/**
 * Tests for labels reaching the screen that reads a transaction.
 *
 * BIP-329 labels were imported, exported, and consumed by nothing. That is the
 * one place they are worth anything: an output labelled "Rent, March" is
 * recognisable, and an unlabelled one to an address nobody knows is worth a
 * second look.
 */
describe('labels on the review screen', () => {
  const ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'

  it('holds-labels-for-the-session-only-when-asked-to', async () => {
    await call('wallet.import', { mnemonic: MNEMONIC, passphrase: '' })
    const text = `${JSON.stringify({ type: 'addr', ref: ADDRESS, label: 'Rent, March' })}\n`

    // Not loaded unless the caller says so, so parsing a file to look at it
    // does not quietly change what the signing screen will show.
    const looked = (await call('labels.import', { text })) as { loaded?: number }
    expect(looked.loaded ?? 0).toBe(0)

    const loaded = (await call('labels.import', { text, load: true })) as { loaded: number }
    expect(loaded.loaded).toBe(1)
  })

  /**
   * INV-LABEL-5. A loaded label appears against the output whose address it
   * names, and against no other.
   */
  it('attaches-a-label-to-the-output-it-names', async () => {
    await call('wallet.import', { mnemonic: MNEMONIC, passphrase: '' })
    await call('labels.import', {
      text: `${JSON.stringify({ type: 'addr', ref: ADDRESS, label: 'Rent, March' })}\n`,
      load: true,
    })

    // A transaction paying that address, built here rather than mocked so the
    // matching runs against a real review.
    const btc = await import('@scure/btc-signer')
    const tx = new btc.Transaction({ allowUnknownOutputs: true })
    tx.addInput({
      txid: new Uint8Array(32).fill(1),
      index: 0,
      witnessUtxo: {
        script: btc.OutScript.encode(btc.Address(btc.NETWORK).decode(ADDRESS)),
        amount: 100_000n,
      },
    })
    tx.addOutputAddress(ADDRESS, 90_000n, btc.NETWORK)

    const review = (await call('psbt.review', {
      psbt: Buffer.from(tx.toPSBT()).toString('base64'),
    })) as { outputs: { address: string | null; label: string | null }[] }

    const paid = review.outputs.find((o) => o.address === ADDRESS)
    expect(paid?.label).toBe('Rent, March')
  })

  /**
   * INV-LABEL-5. Labels go when the wallet locks. They are not sealed, and a
   * screen that kept showing them after a lock would be showing notes about a
   * wallet that is no longer open.
   */
  it('forgets-labels-when-the-wallet-locks', async () => {
    await call('wallet.import', { mnemonic: MNEMONIC, passphrase: '' })
    await call('labels.import', {
      text: `${JSON.stringify({ type: 'addr', ref: ADDRESS, label: 'Rent' })}\n`,
      load: true,
    })
    expect(session.labels).toHaveLength(1)

    session.lock()
    expect(session.labels).toHaveLength(0)
  })
})
