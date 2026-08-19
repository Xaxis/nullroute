/**
 * Tests for naming which cosigner still has to sign.
 *
 * WHAT MUST NEVER HAPPEN is this producing a confident name for a signature it
 * did not actually trace. The join runs through the PSBT's own derivation
 * records, and a PSBT is a file somebody else wrote: a missing record, a
 * fingerprint for a key not in the quorum, and a taproot key-path signature
 * that names no key at all are all ordinary, and all have to come out as
 * "cannot say" rather than as a name.
 *
 * The sentence is built here rather than on the screen so its awkward cases are
 * tested: one unnamed cosigner reads differently from three, and a screen
 * assembling that from string concatenation gets it wrong once.
 */

import { describe, expect, it } from 'vitest'
import * as btc from '@scure/btc-signer'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { attributeSignatures, describeWaiting, type QuorumKey } from '../src/psbt/attribution.js'

const QUORUM: readonly QuorumKey[] = [
  { position: 0, fingerprint: 'aabbccdd', name: 'The attic Pi', isThisDevice: false },
  { position: 1, fingerprint: '73c5da0a', isThisDevice: true },
  { position: 2, fingerprint: '11223344', name: 'The one at my brother’s', isThisDevice: false },
]

/** A PSBT with derivation records mapping a key to a master fingerprint. */
function psbtWith(records: readonly { key: Uint8Array; fingerprint: number }[]): btc.Transaction {
  const tx = new btc.Transaction({ allowUnknownOutputs: true, allowLegacyWitnessUtxo: true })
  tx.addInput({
    txid: new Uint8Array(32).fill(7),
    index: 0,
    witnessUtxo: { script: btc.p2wpkh(records[0]?.key ?? new Uint8Array(33)).script, amount: 1000n },
    bip32Derivation: records.map((record) => [
      record.key,
      { fingerprint: record.fingerprint, path: [2147483732, 2147483648, 2147483648, 0, 0] },
    ]),
  })
  tx.addOutput({ script: Uint8Array.from([0x6a]), amount: 0n })
  return tx
}

/**
 * A real compressed public key, distinct per index.
 *
 * Derived rather than fabricated, because p2wpkh validates the point and a
 * plausible-looking 33 bytes is rejected. The first attempt here used made-up
 * bytes and failed on exactly that.
 */
function key(index: number): Uint8Array {
  const secret = new Uint8Array(32)
  secret[31] = index + 1
  return secp256k1.getPublicKey(secret, true)
}

describe('core.psbt.attribution', () => {
  /**
   * INV-QUORUM-5. The join itself: a signature by a key whose derivation record
   * names a fingerprint in the quorum is attributed to that cosigner.
   */
  it('names-the-cosigner-behind-a-signature', () => {
    const tx = psbtWith([
      { key: key(0), fingerprint: 0xaabbccdd },
      { key: key(1), fingerprint: 0x73c5da0a },
    ])
    const attributed = attributeSignatures(tx, QUORUM, [Buffer.from(key(0)).toString('hex')])

    expect(attributed.unattributed).toBe(0)
    expect(attributed.cosigners.map((c) => c.signed)).toEqual([true, false, false])
    expect(describeWaiting(attributed)).toBe(
      'Still to sign: this device and The one at my brother’s.'
    )
  })

  /**
   * INV-QUORUM-5. A signature this device cannot trace is counted as untraced,
   * never quietly dropped. Dropping it would make a signed transaction look
   * unsigned; attributing it would name somebody who may not have signed.
   */
  it('counts-a-signature-it-cannot-trace-rather-than-dropping-it', () => {
    // No derivation record for the key that signed.
    const tx = psbtWith([{ key: key(0), fingerprint: 0xaabbccdd }])
    const attributed = attributeSignatures(tx, QUORUM, [Buffer.from(key(5)).toString('hex')])

    expect(attributed.unattributed).toBe(1)
    expect(attributed.cosigners.every((c) => !c.signed)).toBe(true)
  })

  /**
   * INV-QUORUM-5. A taproot key-path signature names no key at all, which is a
   * property of the scheme rather than a defect in the file.
   */
  it('treats-a-taproot-key-path-signature-as-one-it-cannot-attribute', () => {
    const tx = psbtWith([{ key: key(0), fingerprint: 0xaabbccdd }])
    const attributed = attributeSignatures(tx, QUORUM, ['taproot-key-path'])
    expect(attributed.unattributed).toBe(1)
  })

  /**
   * INV-QUORUM-5. A fingerprint that resolves but is not in the quorum is still
   * untraced. Counting it as attributed because it resolved to SOMETHING would
   * report a signature by a key the quorum does not contain as one of ours.
   */
  it('does-not-attribute-a-key-that-is-not-in-this-quorum', () => {
    const tx = psbtWith([{ key: key(9), fingerprint: 0xdeadbeef }])
    const attributed = attributeSignatures(tx, QUORUM, [Buffer.from(key(9)).toString('hex')])

    expect(attributed.unattributed).toBe(1)
    expect(attributed.cosigners.every((c) => !c.signed)).toBe(true)
  })

  /**
   * INV-QUORUM-6. No quorum is not "nobody signed". A screen rendering the
   * second for the first would tell somebody with a single-signature wallet
   * that two cosigners are outstanding.
   */
  it('says-it-cannot-tell-rather-than-showing-an-empty-list', () => {
    const tx = psbtWith([{ key: key(0), fingerprint: 0xaabbccdd }])
    const attributed = attributeSignatures(tx, [], [Buffer.from(key(0)).toString('hex')])

    expect(attributed.unavailable).toMatch(/No quorum is registered/)
    expect(describeWaiting(attributed)).toMatch(/No quorum is registered/)
  })

  /** INV-QUORUM-6. One unnamed cosigner reads differently from several. */
  it('writes-a-sentence-that-agrees-with-itself-about-unnamed-cosigners', () => {
    const anonymous: QuorumKey[] = [
      { position: 0, fingerprint: 'aabbccdd', isThisDevice: false },
      { position: 1, fingerprint: '73c5da0a', isThisDevice: false },
      { position: 2, fingerprint: '11223344', isThisDevice: false },
    ]
    const tx = psbtWith([{ key: key(0), fingerprint: 0xaabbccdd }])

    const none = attributeSignatures(tx, anonymous, [])
    expect(describeWaiting(none)).toBe('Still to sign: 3 cosigners you have not named.')

    const one = attributeSignatures(tx, anonymous.slice(0, 1), [])
    expect(describeWaiting(one)).toBe('Still to sign: one cosigner you have not named.')
  })

  /** INV-QUORUM-6. And when there is nobody left, it says so rather than nothing. */
  it('says-plainly-when-every-cosigner-has-signed', () => {
    const tx = psbtWith([
      { key: key(0), fingerprint: 0xaabbccdd },
      { key: key(1), fingerprint: 0x73c5da0a },
      { key: key(2), fingerprint: 0x11223344 },
    ])
    const attributed = attributeSignatures(tx, QUORUM, [
      Buffer.from(key(0)).toString('hex'),
      Buffer.from(key(1)).toString('hex'),
      Buffer.from(key(2)).toString('hex'),
    ])
    expect(describeWaiting(attributed)).toBe('Every cosigner in this quorum has signed.')
  })
})
