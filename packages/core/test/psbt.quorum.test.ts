/**
 * Tests for core.psbt.quorum, and for a 2-of-3 signed by two separate devices.
 *
 * THIS IS THE FLEET TEST. Three nullroute devices holding one 2-of-3 wallet is
 * the deployment this project is designed for, and it works by walking a PSBT
 * from one device to the next. Two properties have to hold and neither was
 * covered before this file existed.
 *
 * The second device must PRESERVE the first device's signature. If signing
 * replaced it instead of adding to it, a 2-of-3 across two nullroutes would be
 * impossible, and the failure would look like a transaction that never
 * finalises rather than like a bug.
 *
 * And each device must be able to say whether ITS signature completes the
 * transaction. That is the difference between "carry this onward" and "broadcast
 * it", and it is read from the PSBT alone: a wsh(multi) input carries the
 * witness script, which encodes m and n, and the partial signatures, which name
 * the keys that produced them.
 */

import { describe, expect, it } from 'vitest'
import * as btc from '@scure/btc-signer'
import { hexToBytes } from '@noble/hashes/utils.js'
import { mnemonicToSeed } from '../src/bip39/mnemonic.js'
import { rootFromSeed } from '../src/derive/hd.js'
import { MAINNET } from '../src/network/networks.js'
import { parsePsbt } from '../src/psbt/parse.js'
import { reviewTransaction } from '../src/psbt/review.js'
import { signTransaction } from '../src/psbt/sign.js'
import { alreadySignedBy, signatureProgress } from '../src/psbt/quorum.js'

/** Three devices, three seeds. */
const SEEDS = [
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  'legal winner thank year wave sausage worth useful legal winner thank yellow',
  'letter advice cage absurd amount doctor acoustic avoid letter advice cage above',
]
const PATH = "m/48'/0'/0'/2'/0/0"
const STRANGER = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'
const OPTIONS = { network: MAINNET, isChange: () => undefined }

function publicKeyOf(mnemonic: string): Uint8Array {
  using seed = mnemonicToSeed(mnemonic, '')
  const key = rootFromSeed(seed, MAINNET).derive(PATH)
  if (key.publicKey === null) throw new Error('no public key')
  return key.publicKey
}

/** A 2-of-3 wsh(sortedmulti) payment across the three device keys. */
function quorumPayment() {
  const keys = SEEDS.map(publicKeyOf)
  // BIP-67 order, which is what sortedmulti means and what every cosigner must
  // agree on. Sorting the derived keys, not the parent xpubs.
  const sorted = [...keys].sort((a, b) => Buffer.from(a).compare(Buffer.from(b)))
  return btc.p2wsh(btc.p2ms(2, sorted), btc.NETWORK)
}

function unsignedPsbt(): Uint8Array {
  const payment = quorumPayment()
  const tx = new btc.Transaction()
  tx.addInput({
    txid: hexToBytes('a'.repeat(64)),
    index: 0,
    witnessUtxo: { script: payment.script, amount: 100_000n },
    witnessScript: payment.witnessScript,
  })
  tx.addOutputAddress(STRANGER, 90_000n, MAINNET)
  return tx.toPSBT()
}

/** One device signing whatever it is handed. */
function signOn(device: number, psbt: Uint8Array) {
  using seed = mnemonicToSeed(SEEDS[device] ?? '', '')
  const tx = parsePsbt(psbt)
  const review = reviewTransaction(tx, OPTIONS)
  return { review, result: signTransaction(tx, seed, { network: MAINNET, paths: [PATH], review }) }
}

describe('core.psbt.quorum', () => {
  /**
   * INV-QUORUM-1. The quorum is readable from the PSBT alone, with no
   * registration and no coordinator.
   */
  it('reads-m-of-n-and-who-signed-out-of-the-psbt', () => {
    const progress = signatureProgress(parsePsbt(unsignedPsbt()))

    expect(progress.inputs).toHaveLength(1)
    expect(progress.inputs[0]?.required).toBe(2)
    expect(progress.inputs[0]?.cosigners).toBe(3)
    expect(progress.present).toBe(0)
    expect(progress.untouched).toBe(true)
    expect(progress.complete).toBe(false)
    expect(progress.inputs[0]?.satisfied).toBe(false)
  })

  /**
   * INV-QUORUM-2. THE FLEET PROPERTY. A second device adds its signature to the
   * first device's rather than replacing it, and the result finalises.
   *
   * If this were wrong, a 2-of-3 held on three of these devices could never be
   * spent, and the symptom would be a transaction that simply never becomes
   * broadcastable rather than anything that looks like an error.
   */
  it('lets-a-second-device-add-to-the-first-devices-signature', () => {
    const first = signOn(0, unsignedPsbt())

    expect(first.result.inputsSigned).toBe(1)
    expect(first.result.signatures.present).toBe(1)
    // One of two. This device must NOT tell its user they are finished.
    expect(first.result.signatures.complete).toBe(false)
    expect(first.result.finalised).toBeUndefined()

    const second = signOn(1, first.result.psbt)

    // The first device's signature survived the trip.
    expect(second.review.signatures.present).toBe(1)
    expect(second.review.signatures.complete).toBe(false)

    expect(second.result.signatures.present).toBe(2)
    expect(second.result.signatures.complete).toBe(true)
    expect(second.result.signatures.inputs[0]?.signedBy).toHaveLength(2)

    // And the second device can hand over something broadcastable, because it
    // knows nothing else has to sign.
    expect(second.result.finalised).toBeDefined()
    expect(second.result.finalised?.txid).toMatch(/^[0-9a-f]{64}$/)
    expect(second.result.finalised?.hex.length).toBeGreaterThan(0)
  })

  /**
   * The third device is not needed, and asking it anyway must not break the
   * transaction. A user who walks all three devices out of caution should end up
   * with a valid spend, not a corrupted one.
   */
  it('survives-a-third-device-signing-a-transaction-already-complete', () => {
    const first = signOn(0, unsignedPsbt())
    const second = signOn(1, first.result.psbt)
    const third = signOn(2, second.result.psbt)

    expect(third.review.signatures.complete).toBe(true)
    expect(third.result.signatures.present).toBe(3)
    // Still finalises: a 2-of-3 with three signatures is satisfied, and the
    // library takes the ones it needs.
    expect(third.result.finalised).toBeDefined()
  })

  /**
   * INV-QUORUM-3. A device recognises a transaction it has already signed.
   *
   * This happens constantly in practice: a QR sequence is scanned back, or a
   * card is read twice. Signing again is harmless because the result is
   * byte-identical, but a device that says nothing leaves the user unsure
   * whether anything happened at all.
   */
  it('knows-when-it-has-already-signed', () => {
    const first = signOn(0, unsignedPsbt())
    expect(first.result.wasAlreadySigned).toBe(false)

    const again = signOn(0, first.result.psbt)
    expect(again.result.wasAlreadySigned).toBe(true)
    // And it is still one signature, not two from the same key.
    expect(again.result.signatures.present).toBe(1)
    // Byte-identical, which is what makes signing twice safe rather than merely
    // tolerable. See INV-SIG-2.
    expect(Buffer.from(again.result.psbt).equals(Buffer.from(first.result.psbt))).toBe(true)

    // A different device has not signed.
    const ourKeys = [publicKeyOf(SEEDS[0] ?? '')]
    const theirKeys = [publicKeyOf(SEEDS[2] ?? '')]
    expect(alreadySignedBy(parsePsbt(first.result.psbt), ourKeys)).toBe(true)
    expect(alreadySignedBy(parsePsbt(first.result.psbt), theirKeys)).toBe(false)
    // And an empty key list is not a claim about anything.
    expect(alreadySignedBy(parsePsbt(first.result.psbt), [])).toBe(false)
  })

  /**
   * INV-QUORUM-4. A single-key input needs one signature and that IS readable,
   * so an ordinary spend reports completion correctly too.
   */
  it('reports-a-single-signature-wallet-as-complete-when-signed', () => {
    using seed = mnemonicToSeed(SEEDS[0] ?? '', '')
    const root = rootFromSeed(seed, MAINNET)
    const child = root.derive("m/84'/0'/0'/0/0")
    if (child.publicKey === null) throw new Error('no key')
    const payment = btc.p2wpkh(child.publicKey, btc.NETWORK)

    const tx = new btc.Transaction()
    tx.addInput({
      txid: hexToBytes('b'.repeat(64)),
      index: 0,
      witnessUtxo: { script: payment.script, amount: 100_000n },
    })
    tx.addOutputAddress(STRANGER, 90_000n, MAINNET)

    const parsed = parsePsbt(tx.toPSBT())
    const before = signatureProgress(parsed)
    expect(before.inputs[0]?.required).toBe(1)
    expect(before.complete).toBe(false)

    const review = reviewTransaction(parsed, OPTIONS)
    const result = signTransaction(parsed, seed, {
      network: MAINNET,
      paths: ["m/84'/0'/0'/0/0"],
      review,
    })
    expect(result.signatures.complete).toBe(true)
    expect(result.finalised).toBeDefined()
  })

  /**
   * INV-QUORUM-5. An input whose requirement cannot be read is reported as
   * unknown and treated as UNMET.
   *
   * Guessing "probably one is enough" would mean telling a user they are
   * finished on the strength of a script this code did not decode, which is the
   * one wrong answer here: they would stop carrying the PSBT onward.
   */
  it('treats-an-unreadable-requirement-as-unmet-rather-than-guessing', () => {
    // A bare script with no witnessUtxo and no scripts to decompose.
    const tx = new btc.Transaction({ allowUnknownInputs: true })
    tx.addInput({ txid: hexToBytes('c'.repeat(64)), index: 0 })
    tx.addOutputAddress(STRANGER, 1_000n, MAINNET)

    const progress = signatureProgress(btc.Transaction.fromPSBT(tx.toPSBT(), { allowUnknownInputs: true }))
    expect(progress.inputs[0]?.required).toBeUndefined()
    expect(progress.inputs[0]?.satisfied).toBe(false)
    expect(progress.complete).toBe(false)
    // The total is unknown rather than zero, so a screen cannot render "0 of 0".
    expect(progress.required).toBeUndefined()
  })

  it('reports-progress-on-the-review-so-a-screen-can-show-it-before-signing', () => {
    const first = signOn(0, unsignedPsbt())
    const second = signOn(1, first.result.psbt)

    // The review, not just the result: the user needs this BEFORE they sign, to
    // know whether they are the last signature or a middle one.
    expect(second.review.signatures.present).toBe(1)
    expect(second.review.signatures.required).toBe(2)
    expect(second.review.signatures.inputs[0]?.cosigners).toBe(3)
  })
})
