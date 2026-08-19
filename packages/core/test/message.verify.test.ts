/**
 * Tests for checking somebody else's proof.
 *
 * THE ROUND TRIP IS THE WEAK TEST. This module verifying what the sign module
 * produced proves the two agree, which they would even if both were wrong the
 * same way. It is here because it catches regressions cheaply, and the tests
 * that carry weight are the ones below it: a proof this device did not make,
 * and every way a proof can be wrong while looking right.
 *
 * The failure that matters most is a signature that is valid, deterministic and
 * for the wrong key. Nothing about it is malformed, and a verifier that checked
 * the signature without checking the key against the address would accept it
 * from anybody.
 */

import { describe, expect, it } from 'vitest'
import * as btc from '@scure/btc-signer'
import { base64 } from '@scure/base'
import { MAINNET, TESTNET3 } from '../src/network/networks.js'
import { mnemonicToSeed } from '../src/bip39/mnemonic.js'
import { signMessage, signMessageWithKey } from '../src/message/sign.js'
import { verifyMessage } from '../src/message/verify.js'

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const VECTOR_WIF = 'L3VFeEujGtevx9w18HD1fhRbCH67Az2dpCymeRE1SoPK6XQtaN2k'

describe('core.message.bip322 verification', () => {
  /** INV-MSG-9. Every type this device signs, it can also check. */
  it('accepts-every-kind-of-proof-this-device-produces', () => {
    using seed = mnemonicToSeed(MNEMONIC, '')
    const cases = [
      { scriptType: 'p2wpkh', path: "m/84'/0'/0'/0/0" },
      { scriptType: 'p2sh-p2wpkh', path: "m/49'/0'/0'/0/0" },
      { scriptType: 'p2tr', path: "m/86'/0'/0'/0/0" },
    ] as const

    for (const { scriptType, path } of cases) {
      const signed = signMessage(seed, MAINNET, scriptType, path, 'Hello World')
      const checked = verifyMessage(signed.address, 'Hello World', signed.signature, MAINNET)
      expect(checked, scriptType).toEqual({ valid: true, scriptType })
    }
  })

  /**
   * INV-MSG-9. A proof the device did not make. The taproot signature here is
   * produced by an independent path, tweaking and signing directly, so this
   * verifier is checked against something other than its own sibling.
   */
  it('accepts-a-taproot-proof-built-outside-this-module', async () => {
    const { taprootTweakPrivKey } = await import('@scure/btc-signer/utils.js')
    const { schnorr } = await import('@noble/curves/secp256k1.js')
    const { sha256 } = await import('@noble/hashes/sha2.js')
    const { buildToSpend } = await import('../src/message/sign.js')

    const key = btc.WIF(btc.NETWORK).decode(VECTOR_WIF)
    const payment = btc.p2tr(schnorr.getPublicKey(key), undefined, btc.NETWORK)
    const message = 'Hello World'

    const toSpend = buildToSpend(message, payment.script)
    const toSign = new btc.Transaction({ version: 0, allowUnknownOutputs: true })
    toSign.addInput({
      txid: Uint8Array.from([...sha256(sha256(toSpend))].reverse()),
      index: 0,
      sequence: 0,
      witnessUtxo: { script: payment.script, amount: 0n },
    })
    toSign.addOutput({ script: Uint8Array.from([0x6a]), amount: 0n })

    const signature = schnorr.sign(
      toSign.preimageWitnessV1(0, [payment.script], 0, [0n]),
      taprootTweakPrivKey(key),
      new Uint8Array(32)
    )
    const witness = base64.encode(Uint8Array.from([0x01, 0x40, ...signature]))

    expect(verifyMessage(payment.address, message, witness, MAINNET)).toEqual({
      valid: true,
      scriptType: 'p2tr',
    })
  })

  /**
   * INV-MSG-9. The signature is real and the key is somebody else's. This is
   * the failure a verifier that only checks the signature accepts from anybody,
   * and it is the reason the key is checked against the address FIRST.
   */
  it('refuses-a-valid-signature-by-a-key-that-is-not-this-address', () => {
    using seed = mnemonicToSeed(MNEMONIC, '')
    const mine = signMessage(seed, MAINNET, 'p2wpkh', "m/84'/0'/0'/0/0", 'Hello World')
    const theirs = signMessage(seed, MAINNET, 'p2wpkh', "m/84'/0'/0'/0/1", 'Hello World')

    // Their perfectly good signature, presented against my address.
    const checked = verifyMessage(mine.address, 'Hello World', theirs.signature, MAINNET)
    expect(checked.valid).toBe(false)
    expect(checked.reason).toMatch(/does not produce this address/)
  })

  /** INV-MSG-9. One character of the message, and the proof is gone. */
  it('refuses-a-proof-of-a-message-that-is-not-the-one-shown', () => {
    using seed = mnemonicToSeed(MNEMONIC, '')
    const signed = signMessage(seed, MAINNET, 'p2tr', "m/86'/0'/0'/0/0", 'Hello World')
    const checked = verifyMessage(signed.address, 'Hello world', signed.signature, MAINNET)
    expect(checked.valid).toBe(false)
    expect(checked.reason).toMatch(/does not match this address and this message/)
  })

  /**
   * INV-MSG-10. Nothing throws. A verifier that crashes on hostile input has
   * given a different answer than "no", and the input here is by definition a
   * file somebody else wrote.
   */
  it('returns-a-refusal-rather-than-throwing-on-anything', () => {
    using seed = mnemonicToSeed(MNEMONIC, '')
    const good = signMessage(seed, MAINNET, 'p2wpkh', "m/84'/0'/0'/0/0", 'Hello World')

    const rubbish = [
      '',
      'not base64 at all !!!',
      base64.encode(new Uint8Array(0)),
      base64.encode(Uint8Array.from([0xff])),
      // A count that claims more elements than the buffer holds.
      base64.encode(Uint8Array.from([0x02, 0x40])),
      // A length prefix running past the end.
      base64.encode(Uint8Array.from([0x01, 0x7f, 0x00, 0x00])),
      // Trailing bytes after a well formed stack: two readers could disagree.
      `${good.signature}AAAA`,
      base64.encode(new Uint8Array(600)),
    ]

    for (const signature of rubbish) {
      const checked = verifyMessage(good.address, 'Hello World', signature, MAINNET)
      expect(checked.valid, signature.slice(0, 24)).toBe(false)
      expect(typeof checked.reason).toBe('string')
    }
  })

  /**
   * INV-MSG-10. A legacy address is named as the wrong scheme rather than
   * reported as malformed, because "wrong scheme" is something a user can act
   * on and "malformed" sends them looking for a corrupt file.
   */
  it('names-the-scheme-rather-than-calling-a-legacy-address-broken', () => {
    const checked = verifyMessage(
      '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
      'Hello World',
      base64.encode(new Uint8Array(65)),
      MAINNET
    )
    expect(checked.scriptType).toBe('p2pkh')
    expect(checked.reason).toMatch(/older signmessage scheme/)
  })

  /**
   * INV-MSG-10. Comparing a mainnet address against a testnet wallet is the
   * usual cause of a proof that will not check, so the refusal says so instead
   * of leaving somebody to suspect the signature.
   */
  it('says-which-network-when-the-address-is-for-the-other-one', () => {
    const key = btc.WIF(btc.NETWORK).decode(VECTOR_WIF)
    const signed = signMessageWithKey(key, MAINNET, 'p2wpkh', 'Hello World')
    const checked = verifyMessage(signed.address, 'Hello World', signed.signature, TESTNET3)
    expect(checked.valid).toBe(false)
    expect(checked.reason).toMatch(/not an address on this network/)
  })
})
