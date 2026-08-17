/**
 * Tests for the BIP-322 to_spend transaction.
 *
 * The txid is the whole test. BIP-322 publishes it for a known address and the
 * empty message, and `to_sign` references it, so a single wrong byte anywhere in
 * the construction, the version, the impossible outpoint, the commitment, the
 * sequence, the zero value, produces a different one and a proof nobody can
 * verify.
 *
 */

import { describe, expect, it } from 'vitest'
import * as btc from '@scure/btc-signer'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { base64 } from '@scure/base'
import { MAINNET } from '../src/network/networks.js'
import { mnemonicToSeed } from '../src/bip39/mnemonic.js'
import { buildToSpend, signMessage, signMessageWithKey } from '../src/message/sign.js'

/** The address and to_spend txid BIP-322 publishes, verbatim. */
const VECTOR_ADDRESS = 'bc1q9vza2e8x573nczrlzms0wvx3gsqjx7vavgkx0l'
const VECTOR_TO_SPEND_TXID =
  'c5680aa69bb8d860bf82d4e9cd3504b55dde018de765a91bb566283c545a99a7'

function scriptFor(address: string): Uint8Array {
  return btc.OutScript.encode(btc.Address(btc.NETWORK).decode(address))
}

describe('core.message.bip322 to_spend', () => {
  /**
   * INV-MSG-5. The published txid.
   *
   * The strongest check available for this construction: it is somebody else's
   * number, it covers every byte, and it cannot be matched by an implementation
   * that got any field wrong.
   */
  it('matches-the-published-to_spend-txid', () => {
    const id = sha256(sha256(buildToSpend('', scriptFor(VECTOR_ADDRESS))))
    // Reversed, because a txid is displayed in the opposite order to the way it
    // is hashed, and the document prints the displayed form.
    expect(bytesToHex(Uint8Array.from([...id].reverse()))).toBe(VECTOR_TO_SPEND_TXID)
  })

  it('builds-every-field-the-standard-fixes', () => {
    const hex = bytesToHex(buildToSpend('', scriptFor(VECTOR_ADDRESS)))

    // Version 0, one input, the outpoint no transaction can have.
    expect(hex.startsWith(`0000000001${'00'.repeat(32)}ffffffff`)).toBe(true)
    // OP_0 PUSH32 then the tagged hash of the empty message.
    expect(hex).toContain(
      '220020c90c269c4f8fcbe6880f72a721ddfbf1914268a794cbb21cfafee13770ae19f1'
    )
    // One output of zero satoshis, and locktime 0.
    expect(hex).toContain(`01${'00'.repeat(8)}`)
    expect(hex.endsWith('00000000')).toBe(true)
  })

  /**
   * The commitment is inside the transaction, so two messages give two
   * different to_spend transactions and therefore two different outpoints for
   * to_sign. That is what stops a proof over one message being replayed as a
   * proof over another.
   */
  it('commits-to-the-message-in-the-transaction-itself', () => {
    const script = scriptFor(VECTOR_ADDRESS)
    const a = bytesToHex(buildToSpend('one', script))
    const b = bytesToHex(buildToSpend('two', script))

    expect(a).not.toBe(b)
    // Same length: only the committed hash differs.
    expect(a.length).toBe(b.length)
  })

  /**
   * The address is part of the commitment too, so the same message under two
   * addresses is two different transactions. A proof is about one address.
   */
  it('commits-to-the-address-as-well-as-the-message', () => {
    const a = bytesToHex(buildToSpend('same', scriptFor(VECTOR_ADDRESS)))
    const b = bytesToHex(
      buildToSpend('same', scriptFor('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'))
    )
    expect(a).not.toBe(b)
  })

  it('is-deterministic', () => {
    const script = scriptFor(VECTOR_ADDRESS)
    expect(bytesToHex(buildToSpend('Hello World', script))).toBe(
      bytesToHex(buildToSpend('Hello World', script))
    )
  })
})

/**
 * Tests for BIP-322 signing.
 *
 * ONE TEST MATTERS and the rest support it: does a signature this device
 * produces verify against a digest computed by a different library? A message
 * signature only this software accepts proves nothing to the person who asked
 * for it, which is the entire purpose of the scheme.
 *
 * An earlier implementation passed every other test here and failed that one.
 * It was deterministic, correctly shaped, and for the correct address, and it
 * committed to an outpoint that does not exist, because @scure/btc-signer takes
 * a txid in displayed order and bitcoinjs-lib takes it in hashed order.
 */
describe('core.message.bip322 signing', () => {
  const MNEMONIC =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
  const VECTOR_WIF = 'L3VFeEujGtevx9w18HD1fhRbCH67Az2dpCymeRE1SoPK6XQtaN2k'

  /**
   * INV-MSG-6. The signature verifies against a sighash this module did not
   * compute, for a transaction rebuilt by a different library.
   */
  it('produces-a-signature-that-verifies-against-an-independent-sighash', async () => {
    const bitcoin = await import('bitcoinjs-lib')
    const key = btc.WIF(btc.NETWORK).decode(VECTOR_WIF)
    const message = 'Hello World'

    const signed = signMessageWithKey(key, MAINNET, 'p2wpkh', message)
    expect(signed.address).toBe(VECTOR_ADDRESS)

    // Rebuilt with the other library, which takes the txid in HASHED order.
    const toSpendId = sha256(sha256(buildToSpend(message, scriptFor(VECTOR_ADDRESS))))
    const toSign = new bitcoin.Transaction()
    toSign.version = 0
    toSign.addInput(Buffer.from(toSpendId), 0, 0)
    toSign.addOutput(Buffer.from([0x6a]), 0n)

    const pubkey = secp256k1.getPublicKey(key, true)
    const scriptCode = Buffer.concat([
      Buffer.from([0x76, 0xa9, 0x14]),
      bitcoin.crypto.hash160(Buffer.from(pubkey)),
      Buffer.from([0x88, 0xac]),
    ])
    const digest = toSign.hashForWitnessV0(0, scriptCode, 0n, bitcoin.Transaction.SIGHASH_ALL)

    // Pull the DER signature out of our witness and check it against that.
    const raw = base64.decode(signed.signature)
    expect(raw[0]).toBe(2)
    const sigLength = raw[1] ?? 0
    const der = raw.subarray(2, 2 + sigLength - 1)
    expect(raw[2 + sigLength - 1]).toBe(bitcoin.Transaction.SIGHASH_ALL)

    const compact = secp256k1.Signature.fromBytes(der, 'der').toBytes('compact')
    expect(secp256k1.verify(compact, Uint8Array.from(digest), pubkey)).toBe(true)

    // And the witness carries the public key that address commits to.
    const keyStart = 2 + sigLength + 1
    expect(bytesToHex(raw.subarray(keyStart))).toBe(bytesToHex(pubkey))
  })

  it('signs-wrapped-segwit-too', async () => {
    const bitcoin = await import('bitcoinjs-lib')
    using seed = mnemonicToSeed(MNEMONIC, '')
    const signed = signMessage(seed, MAINNET, 'p2sh-p2wpkh', "m/49'/0'/0'/0/0", 'Hello World')

    expect(signed.address.startsWith('3')).toBe(true)
    const raw = base64.decode(signed.signature)
    expect(raw[0]).toBe(2)
    void bitcoin
  })

  /**
   * INV-MSG-6. Determinism, for the reason INV-SIG-1 exists. A message
   * signature is the easiest thing in the world to ask somebody for repeatedly,
   * so any room to hide key material is room an attacker can use at will.
   */
  it('signs-the-same-message-identically-every-time', () => {
    using seed = mnemonicToSeed(MNEMONIC, '')
    const a = signMessage(seed, MAINNET, 'p2wpkh', "m/84'/0'/0'/0/0", 'Hello World')
    const b = signMessage(seed, MAINNET, 'p2wpkh', "m/84'/0'/0'/0/0", 'Hello World')
    expect(b.signature).toBe(a.signature)
    // A different message is a different signature.
    const c = signMessage(seed, MAINNET, 'p2wpkh', "m/84'/0'/0'/0/0", 'Goodbye World')
    expect(c.signature).not.toBe(a.signature)
  })

  it('signs-for-the-address-the-path-produces', () => {
    using seed = mnemonicToSeed(MNEMONIC, '')
    const signed = signMessage(seed, MAINNET, 'p2wpkh', "m/84'/0'/0'/0/0", 'Hello World')
    expect(signed.address).toBe('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu')
    expect(signed.path).toBe("m/84'/0'/0'/0/0")
  })

  /**
   * INV-MSG-7. What is refused, and refused by name rather than approximated.
   * A proof a verifier rejects is worse than no proof.
   */
  it('refuses-what-it-cannot-sign', () => {
    using seed = mnemonicToSeed(MNEMONIC, '')
    for (const scriptType of ['p2pkh', 'p2tr'] as const) {
      expect(() =>
        signMessage(seed, MAINNET, scriptType, "m/84'/0'/0'/0/0", 'Hello World')
      ).toThrow(/not one of them/)
    }
  })

  it('refuses-a-message-the-review-would-refuse', () => {
    using seed = mnemonicToSeed(MNEMONIC, '')
    const path = "m/84'/0'/0'/0/0"
    expect(() => signMessage(seed, MAINNET, 'p2wpkh', path, '')).toThrow(/no message/)
    expect(() => signMessage(seed, MAINNET, 'p2wpkh', path, 'x'.repeat(2000))).toThrow(
      /nobody read to the end/
    )
  })
})
