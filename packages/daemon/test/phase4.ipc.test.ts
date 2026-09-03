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
    expect(review.hashHex).toBe('f0eb03b1a75ac6d9847f55c624a99169b5dccba2a31f5b23bea77ba270de0a7a')
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
    await expect(call('bip85.derive', { application: 'hex', bytes: 8, index: 0 })).rejects.toThrow(
      /16 to 64 bytes/
    )
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
    const key = btc.WIF(btc.NETWORK).decode('L3VFeEujGtevx9w18HD1fhRbCH67Az2dpCymeRE1SoPK6XQtaN2k')
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

    expect(await call('multisig.verifyAddress', { descriptor: DESCRIPTOR, address })).toMatchObject(
      { found: true, index: 0, change: false }
    )
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

    expect(await call('multisig.verifyAddress', { descriptor: DESCRIPTOR, address })).toMatchObject(
      { found: true, change: true }
    )
  })
})

/**
 * Tests for what a seedless restore actually gives back.
 *
 * THE OVERCLAIM THESE REPLACE. Both the module docstring and docs/USING.md said
 * a seedless backup "restores a device that can derive addresses, recognise its
 * own change and check what belongs to it". It restored a count. The
 * registrations were read out of the file, reported as a number, and dropped,
 * because a seedless restore has no wallet for the session to hold them in.
 *
 * A descriptor needs no seed to be useful, so the fix was to hand them back
 * rather than to weaken the format: checking whether an address belongs to a
 * quorum works without a key, and a 2-of-3 cannot be rebuilt from seed phrases
 * alone because the other keys and the threshold live only in the descriptor.
 */
describe('backup.restore and the quorum descriptors', () => {
  /*
   * INV-KEY-2 on the throwing path, which is the one it is about.
   *
   * restoreBackup returns a live Secret, and the next line was an
   * unconditional session.setNetwork that throws whenever a wallet is already
   * loaded. So restoring a seeded backup with a wallet open decrypted the seed
   * and then abandoned it, repeatably, one per call, while the caller saw a
   * message about the network being fixed.
   *
   * Every other test in this file locks first, which is exactly why nothing
   * caught it. This one deliberately does not.
   */
  it('restores-a-seeded-backup-over-an-open-wallet-without-orphaning-the-seed', async () => {
    await call('wallet.import', { mnemonic: MNEMONIC, passphrase: '' })
    const made = (await call('backup.create', {
      passphrase: 'a backup passphrase',
      includeSeed: true,
    })) as { backup: string }

    // Still open. The wallet from the import is loaded, and the restore has to
    // deal with that rather than throwing past a decrypted seed.
    expect(session.hasWallet).toBe(true)

    const restored = (await call('backup.restore', {
      backup: made.backup,
      passphrase: 'a backup passphrase',
    })) as { hasSeed: boolean; loaded: boolean }

    expect(restored.hasSeed).toBe(true)
    expect(restored.loaded).toBe(true)
    expect(session.hasWallet).toBe(true)
  })

  // A wrong passphrase never gets as far as a Secret, and still refuses.
  it('refuses-a-wrong-passphrase-with-a-wallet-open', async () => {
    await call('wallet.import', { mnemonic: MNEMONIC, passphrase: '' })
    const made = (await call('backup.create', {
      passphrase: 'a backup passphrase',
      includeSeed: true,
    })) as { backup: string }

    await expect(
      call('backup.restore', { backup: made.backup, passphrase: 'wrong' })
    ).rejects.toThrow()
  })

  const DESCRIPTOR =
    'wsh(sortedmulti(2,[73c5da0a/48h/0h/0h/2h]xpub6E64WfdQwBGz85XhbZryr9gUGUPBgoSu5WV6tJWpzAvgAmpVpdPHkT3XYm9R5J6MeWzvLQoz4q845taC9Q28XutbptxAmg7q8QPkjvTL4oi/<0;1>/*,[aabbccdd/48h/0h/0h/2h]xpub6DiYrfRwNnjeX4vHsWMajJVFKrbEEnu8gAW9vDuQzgTWEsEHE16sGWeXXUV1LBWQE1yCTmeprSNcqZ3W74hqVdgDbtYHUv3eM4W2TEUhpan/<0;1>/*))#a7ec6klf'

  /**
   * INV-BACKUP-5. The descriptors come back from a seedless restore, which is
   * the whole reason to keep one: without them a quorum cannot be rebuilt from
   * mnemonics.
   */
  it('hands-back-the-quorum-descriptors-from-a-seedless-backup', async () => {
    await call('wallet.import', { mnemonic: MNEMONIC, passphrase: '' })
    session.setRegistrations([DESCRIPTOR])

    const made = (await call('backup.create', { passphrase: 'a backup passphrase' })) as {
      backup: string
    }
    session.lock()

    const restored = (await call('backup.restore', {
      backup: made.backup,
      passphrase: 'a backup passphrase',
    })) as { hasSeed: boolean; descriptors: string[]; loaded: boolean; registrations: number }

    expect(restored.hasSeed).toBe(false)
    expect(restored.registrations).toBe(1)
    expect(restored.descriptors).toEqual([DESCRIPTOR])
  })

  /**
   * INV-BACKUP-5. And it says they were NOT loaded. A screen reporting a
   * seedless restore as having brought the quorums back would be describing
   * something that did not happen: there is no wallet to hold them in.
   */
  it('says-the-descriptors-were-shown-rather-than-loaded', async () => {
    await call('wallet.import', { mnemonic: MNEMONIC, passphrase: '' })
    session.setRegistrations([DESCRIPTOR])
    const made = (await call('backup.create', { passphrase: 'pw' })) as { backup: string }
    session.lock()

    const restored = (await call('backup.restore', { backup: made.backup, passphrase: 'pw' })) as {
      loaded: boolean
    }
    expect(restored.loaded).toBe(false)
    expect(session.hasWallet).toBe(false)
  })

  /**
   * INV-BACKUP-5. A backup that carried the seed DOES load them, and says so,
   * because there is a wallet for them to go into.
   */
  it('loads-them-into-the-session-when-the-backup-carried-the-seed', async () => {
    await call('wallet.import', { mnemonic: MNEMONIC, passphrase: '' })
    session.setRegistrations([DESCRIPTOR])
    const made = (await call('backup.create', {
      passphrase: 'pw',
      includeSeed: true,
    })) as { backup: string }
    session.lock()

    const restored = (await call('backup.restore', { backup: made.backup, passphrase: 'pw' })) as {
      loaded: boolean
      descriptors: string[]
    }
    expect(restored.loaded).toBe(true)
    expect(restored.descriptors).toEqual([DESCRIPTOR])
    expect(session.registrations).toEqual([DESCRIPTOR])
  })
})

/**
 * Tests for choosing which words to ask back.
 *
 * The positions come from the daemon rather than the frontend, and not because
 * they are a secret: the screen has just shown every word. They come from here
 * because Math.random is banned on this device and the frontend has no other
 * source, which is the rule working rather than getting in the way.
 */
/**
 * A seed this device generated, which is the only kind word checking applies to.
 *
 * These tests used to import a mnemonic and then ask the daemon to check words
 * from it. That is the shape the session now refuses: an imported seed is one
 * the user typed in, so there is nothing to verify, and answering was the
 * oracle that made seed.checkWord equivalent to seed.reveal in about 25,000
 * calls. Dice give a wallet with provenance 'generated' and confirmedBackup
 * false, which is the state the verification step exists for.
 */
async function generateSeed(): Promise<void> {
  await call('entropy.fromDice', { rolls: '142536'.repeat(17) })
}

/*
 * INV-KEY-1 against seed.checkWord, which was an enumeration oracle.
 *
 * The method returns a boolean saying whether a word matches, with no key
 * derivation behind it, against a public 2048-word list. It gated on nothing
 * but the mnemonic being held, so a caller could walk the wordlist at each of
 * 24 positions, about 25,000 calls, and recover the seed phrase over the
 * socket. It was open in exactly the window seed.reveal is shut in: an
 * imported seed is marked confirmedBackup at load, so the reveal refused from
 * the first instant while this answered.
 */
describe('seed.checkWord is not an oracle', () => {
  it('refuses-word-checks-for-a-seed-this-device-did-not-generate', async () => {
    await call('wallet.import', { mnemonic: MNEMONIC, passphrase: '' })

    // The reveal is already shut for an import, and this has to be too.
    await expect(call('seed.reveal')).rejects.toThrow()
    await expect(call('seed.checkWord', { index: 0, word: 'legal' })).rejects.toThrow(
      /part of creating a wallet/
    )
    await expect(call('seed.checkPositions', { count: 3 })).rejects.toThrow()
  })

  it('refuses-word-checks-once-the-backup-is-confirmed', async () => {
    await generateSeed()
    // Open before, which is the legitimate use.
    expect(await call('seed.checkWord', { index: 0, word: 'nope' })).toEqual({ correct: false })

    await call('seed.confirmBackup')

    await expect(call('seed.reveal')).rejects.toThrow()
    await expect(call('seed.checkWord', { index: 0, word: 'nope' })).rejects.toThrow(
      /already confirmed/
    )
  })

  /*
   * The budget, which is what closes the window that legitimately exists.
   * Spent only on wrong answers, so somebody checking the three positions they
   * were asked for never touches it, and somebody walking the wordlist runs
   * out during the first position rather than after the last.
   */
  it('closes-word-checking-after-too-many-wrong-answers', async () => {
    await generateSeed()

    for (let attempt = 0; attempt < 15; attempt += 1) {
      expect(await call('seed.checkWord', { index: 0, word: `wrong${String(attempt)}` })).toEqual({
        correct: false,
      })
    }
    await expect(call('seed.checkWord', { index: 0, word: 'wrong' })).rejects.toThrow(
      /closed for this session/
    )

    /*
     * Closed for a RIGHT answer too, which is the half that matters: a caller
     * that has been walking the wordlist does not get to finish by arriving at
     * the correct word on the next call. Read from seed.reveal, which is still
     * open here because the backup has not been confirmed.
     */
    const revealed = (await call('seed.reveal')) as { words: string[] }
    const first = revealed.words[0] ?? 'abandon'
    await expect(call('seed.checkWord', { index: 0, word: first })).rejects.toThrow(
      /closed for this session/
    )
  })
})

describe('seed.checkPositions', () => {
  it('returns-positions-and-never-words', async () => {
    await generateSeed()

    const chosen = (await call('seed.checkPositions', { count: 3 })) as {
      positions: number[]
      total: number
    }

    expect(chosen.positions).toHaveLength(3)
    expect(chosen.total).toBe(24)
    // Every position is in range, and nothing in the response is a word.
    for (const position of chosen.positions) {
      expect(position).toBeGreaterThanOrEqual(0)
      expect(position).toBeLessThan(chosen.total)
    }
    expect(JSON.stringify(chosen)).not.toContain('abandon')
  })

  /** Distinct, so a three word check is not the same word three times. */
  it('never-asks-for-the-same-position-twice', async () => {
    await generateSeed()

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const chosen = (await call('seed.checkPositions', { count: 3 })) as { positions: number[] }
      expect(new Set(chosen.positions).size).toBe(chosen.positions.length)
    }
  })

  /**
   * Every position is reachable. A biased chooser that never asked about the
   * last word would leave a word nobody ever checks, which is exactly the kind
   * of quiet gap this check exists to close.
   */
  it('can-ask-about-any-position-including-the-last', async () => {
    await generateSeed()

    const seen = new Set<number>()
    for (let attempt = 0; attempt < 200 && seen.size < 24; attempt += 1) {
      const chosen = (await call('seed.checkPositions', { count: 3 })) as { positions: number[] }
      for (const position of chosen.positions) seen.add(position)
    }
    expect(seen.size).toBe(24)
  })

  /** Asking for more words than exist returns every position, not an error. */
  it('caps-at-the-number-of-words-there-are', async () => {
    await generateSeed()
    const chosen = (await call('seed.checkPositions', { count: 50 })) as { positions: number[] }
    expect(chosen.positions).toHaveLength(24)
  })
})
