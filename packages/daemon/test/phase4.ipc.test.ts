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

/**
 * Tests for the message boundary after taproot, legacy and verification.
 *
 * The schemes are tested in core against independent digests. What is checked
 * here is that the RIGHT ONE is used: the daemon routes by script type and by
 * address, never by a flag a caller passes, so there is no request that asks
 * for one scheme and receives the other.
 */
describe('message.verify and scheme routing', () => {
  it('signs-taproot-and-checks-its-own-proof', async () => {
    await call('wallet.import', { mnemonic: MNEMONIC, passphrase: '' })
    const signed = (await call('message.sign', {
      message: 'Hello World',
      scriptType: 'p2tr',
      path: "m/86'/0'/0'/0/0",
    })) as { address: string; signature: string; scheme: string }

    expect(signed.scheme).toBe('bip322')
    expect(signed.address.startsWith('bc1p')).toBe(true)

    expect(
      await call('message.verify', {
        address: signed.address,
        message: 'Hello World',
        signature: signed.signature,
      })
    ).toEqual({ valid: true, scriptType: 'p2tr' })
  })

  /**
   * INV-MSG-12. A legacy address gets the older scheme, and the response says
   * which one it used. Somebody asked for "a BIP-322 signature" who hands over
   * a signmessage one will be told it is invalid, so the device has to say.
   */
  it('routes-a-legacy-address-to-the-older-scheme-and-says-so', async () => {
    await call('wallet.import', { mnemonic: MNEMONIC, passphrase: '' })
    const signed = (await call('message.sign', {
      message: 'Hello World',
      scriptType: 'p2pkh',
      path: "m/44'/0'/0'/0/0",
    })) as { address: string; signature: string; scheme: string }

    expect(signed.scheme).toBe('signmessage')
    expect(signed.address.startsWith('1')).toBe(true)

    // And the verifier picks the same scheme from the address alone.
    expect(
      await call('message.verify', {
        address: signed.address,
        message: 'Hello World',
        signature: signed.signature,
      })
    ).toEqual({ valid: true, scriptType: 'p2pkh' })
  })

  /**
   * INV-MSG-10. Verification is a public computation and must not need a seed.
   * Requiring a passphrase to check a stranger's signature would be asking for
   * the most dangerous thing somebody owns in exchange for arithmetic.
   */
  it('checks-a-proof-with-no-wallet-loaded-at-all', async () => {
    // Signed first, then locked, so the proof is real rather than a fixture.
    await call('wallet.import', { mnemonic: MNEMONIC, passphrase: '' })
    const signed = (await call('message.sign', {
      message: 'Hello World',
      scriptType: 'p2wpkh',
      path: "m/84'/0'/0'/0/0",
    })) as { address: string; signature: string }
    session.lock()
    expect(session.hasWallet).toBe(false)

    expect(
      await call('message.verify', {
        address: signed.address,
        message: 'Hello World',
        signature: signed.signature,
      })
    ).toEqual({ valid: true, scriptType: 'p2wpkh' })
  })

  /** INV-MSG-10. A refusal crosses the boundary as a result, not as a throw. */
  it('returns-a-refusal-rather-than-failing-the-request', async () => {
    const refused = (await call('message.verify', {
      address: 'bc1q9vza2e8x573nczrlzms0wvx3gsqjx7vavgkx0l',
      message: 'Hello World',
      signature: 'bm90IGEgc2lnbmF0dXJl',
    })) as { valid: boolean; reason: string }
    expect(refused.valid).toBe(false)
    expect(typeof refused.reason).toBe('string')
  })
})

/**
 * Tests for naming which cosigner still has to sign.
 *
 * The join is tested in core against synthetic PSBTs. What is checked here is
 * that the daemon supplies the right quorum to join against, and that a device
 * with no registration says it cannot tell rather than returning an empty list
 * that a screen would render as "nobody else has to sign".
 */
describe('who still has to sign', () => {
  it('says-it-cannot-tell-when-no-quorum-is-registered', async () => {
    await call('wallet.import', { mnemonic: MNEMONIC, passphrase: '' })

    const btc = await import('@scure/btc-signer')
    const key = btc.WIF(btc.NETWORK).decode(
      'L3VFeEujGtevx9w18HD1fhRbCH67Az2dpCymeRE1SoPK6XQtaN2k'
    )
    const payment = btc.p2wpkh(
      (await import('@noble/curves/secp256k1.js')).secp256k1.getPublicKey(key, true),
      btc.NETWORK
    )

    const tx = new btc.Transaction({ allowUnknownOutputs: true })
    tx.addInput({
      txid: new Uint8Array(32).fill(3),
      index: 0,
      witnessUtxo: { script: payment.script, amount: 50_000n },
    })
    tx.addOutput({ script: Uint8Array.from([0x6a]), amount: 0n })

    // Not this wallet's input, so signing is refused before attribution runs.
    // What matters is that the refusal is about the inputs rather than a crash
    // in the attribution path.
    await expect(
      call('psbt.sign', { psbt: Buffer.from(tx.toPSBT()).toString('base64') })
    ).rejects.toThrow(/nothing here for this device to sign/)
  })

  /**
   * INV-QUORUM-6. The single-signature case, which is the one most likely to be
   * rendered wrongly: a device with no quorum must not report cosigners.
   */
  it('names-no-cosigners-for-a-single-signature-wallet', async () => {
    await call('wallet.import', { mnemonic: MNEMONIC, passphrase: '' })

    const listed = (await call('wallet.addresses', { scriptType: 'p2wpkh', count: 1 })) as {
      addresses: { address: string }[]
    }
    const address = listed.addresses[0]?.address ?? ''

    const btc = await import('@scure/btc-signer')
    const script = btc.OutScript.encode(btc.Address(btc.NETWORK).decode(address))
    const tx = new btc.Transaction({ allowUnknownOutputs: true })
    tx.addInput({
      txid: new Uint8Array(32).fill(4),
      index: 0,
      witnessUtxo: { script, amount: 50_000n },
    })
    tx.addOutputAddress(address, 40_000n, btc.NETWORK)

    const signed = (await call('psbt.sign', {
      psbt: Buffer.from(tx.toPSBT()).toString('base64'),
      overrideBlockingWarnings: true,
    })) as { attribution: { cosigners: unknown[]; waiting: string } }

    expect(signed.attribution.cosigners).toHaveLength(0)
    expect(signed.attribution.waiting).toMatch(/No quorum is registered/)
  })
})

/**
 * Tests for checking an address against a registered quorum.
 *
 * A SEPARATE METHOD FROM wallet.verifyAddress on purpose. A quorum address does
 * not derive from this device alone by construction, so asking the
 * single-signature verifier about one answers no about something perfectly
 * correct, and a screen reporting that would teach somebody to ignore its only
 * alarm.
 */
describe('multisig.verifyAddress', () => {
  const DESCRIPTOR =
    'wsh(sortedmulti(2,[73c5da0a/48h/0h/0h/2h]xpub6E64WfdQwBGz85XhbZryr9gUGUPBgoSu5WV6tJWpzAvgAmpVpdPHkT3XYm9R5J6MeWzvLQoz4q845taC9Q28XutbptxAmg7q8QPkjvTL4oi/<0;1>/*,[aabbccdd/48h/0h/0h/2h]xpub6DiYrfRwNnjeX4vHsWMajJVFKrbEEnu8gAW9vDuQzgTWEsEHE16sGWeXXUV1LBWQE1yCTmeprSNcqZ3W74hqVdgDbtYHUv3eM4W2TEUhpan/<0;1>/*))#a7ec6klf'

  it('confirms-an-address-that-comes-out-of-the-descriptor', async () => {
    await call('wallet.import', { mnemonic: MNEMONIC, passphrase: '' })

    const derived = (await call('multisig.addresses', {
      descriptor: DESCRIPTOR,
      start: 0,
      count: 1,
    })) as { addresses: { address: string; index: number }[] }
    const address = derived.addresses[0]?.address ?? ''

    expect(
      await call('multisig.verifyAddress', { descriptor: DESCRIPTOR, address })
    ).toMatchObject({ found: true, index: 0, change: false })
  })

  /**
   * INV-QUORUM-6. Not found says how far it looked. "Not in this quorum" and
   * "beyond the gap limit" are different, and a screen reporting the second as
   * the first would call a correct address wrong.
   */
  it('says-how-far-it-searched-rather-than-implying-a-verdict', async () => {
    await call('wallet.import', { mnemonic: MNEMONIC, passphrase: '' })
    const refused = (await call('multisig.verifyAddress', {
      descriptor: DESCRIPTOR,
      address: 'bc1q9vza2e8x573nczrlzms0wvx3gsqjx7vavgkx0l',
      gapLimit: 5,
    })) as { found: boolean; searchedTo: number }

    expect(refused.found).toBe(false)
    expect(refused.searchedTo).toBe(5)
  })

  /** INV-QUORUM-6. Change addresses count: money comes back on that branch too. */
  it('finds-an-address-on-the-change-branch-as-well', async () => {
    await call('wallet.import', { mnemonic: MNEMONIC, passphrase: '' })

    const derived = (await call('multisig.addresses', {
      descriptor: DESCRIPTOR,
      change: true,
      start: 0,
      count: 1,
    })) as { addresses: { address: string }[] }
    const address = derived.addresses[0]?.address ?? ''

    expect(
      await call('multisig.verifyAddress', { descriptor: DESCRIPTOR, address })
    ).toMatchObject({ found: true, change: true })
  })
})
