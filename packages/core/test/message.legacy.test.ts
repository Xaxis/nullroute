/**
 * Tests for the older signmessage scheme.
 *
 * WHAT THE DIFFERENTIAL HERE COVERS, and it is worth being exact rather than
 * claiming more. The digest is checked against the construction hashed by a
 * different library, which tests the concatenation, the two compact size
 * lengths and the double-SHA256 chaining. It does not independently test the
 * header byte or the recovery id, because no second implementation of those is
 * available here without taking a dependency, and a dependency added to make a
 * test look stronger is a dependency on this device's build.
 *
 * Those are covered instead by the round trip and by the refusal below it: a
 * wrong compression flag or a wrong recovery id recovers a valid key for a
 * DIFFERENT address, which the address check catches and reports.
 *
 * The trap in this scheme is that recovery ALWAYS produces a key. A signature
 * over any bytes at all recovers some valid public key, so "the signature
 * verifies" means nothing on its own. What proves something is that the
 * recovered key hashes to the address being claimed, and a verifier that
 * skipped that check would accept a proof from anybody.
 */

import { describe, expect, it } from 'vitest'
import * as btc from '@scure/btc-signer'
import { base64 } from '@scure/base'
import { bytesToHex } from '@noble/hashes/utils.js'
import { MAINNET } from '../src/network/networks.js'
import { mnemonicToSeed } from '../src/bip39/mnemonic.js'
import {
  legacyMessageHash,
  signLegacyMessage,
  signLegacyMessageWithKey,
  verifyLegacyMessage,
} from '../src/message/legacy.js'
import { verifyMessage } from '../src/message/verify.js'

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const VECTOR_WIF = 'L3VFeEujGtevx9w18HD1fhRbCH67Az2dpCymeRE1SoPK6XQtaN2k'

describe('core.message.legacy', () => {
  /**
   * INV-MSG-11. The digest, against a hash computed by a different library.
   * Everything else in this module is arithmetic on top of this value, so if
   * it is wrong nothing below it can be right.
   */
  it('commits-to-the-same-bytes-an-independent-implementation-does', async () => {
    // Written out here rather than called: 0x18, the magic string, the message
    // length, the message, hashed twice. That is what the standard specifies
    // and what a reviewer can follow, and the hashing is the other library's.
    const bitcoin = await import('bitcoinjs-lib')
    const magic = Buffer.from('Bitcoin Signed Message:\n', 'utf8')
    const body = Buffer.from('Hello World', 'utf8')
    const expected = bitcoin.crypto.hash256(
      Buffer.concat([Buffer.from([magic.length]), magic, Buffer.from([body.length]), body])
    )

    expect(bytesToHex(legacyMessageHash('Hello World'))).toBe(Buffer.from(expected).toString('hex'))
  })

  /** INV-MSG-11. What it produces, it can check. */
  it('round-trips-a-signature-it-made', () => {
    using seed = mnemonicToSeed(MNEMONIC, '')
    const signed = signLegacyMessage(seed, MAINNET, "m/44'/0'/0'/0/0", 'Hello World')
    expect(signed.address.startsWith('1')).toBe(true)
    expect(verifyLegacyMessage(signed.address, 'Hello World', signed.signature, MAINNET)).toEqual({
      valid: true,
      scriptType: 'p2pkh',
    })
  })

  /**
   * INV-MSG-11. The signature is 65 bytes with a header that says both which
   * recovery id to use and whether the key was compressed. Writing 27 where 31
   * belongs recovers a perfectly valid key for a completely different address.
   */
  it('writes-a-header-that-says-the-key-was-compressed', () => {
    const key = btc.WIF(btc.NETWORK).decode(VECTOR_WIF)
    const signed = signLegacyMessageWithKey(key, MAINNET, 'Hello World')
    const raw = base64.decode(signed.signature)
    expect(raw).toHaveLength(65)
    const header = raw[0] ?? 0
    expect(header).toBeGreaterThanOrEqual(31)
    expect(header).toBeLessThanOrEqual(34)
  })

  /** INV-MSG-11. Determinism, for the reason INV-SIG-1 exists. */
  it('signs-the-same-message-identically-every-time', () => {
    using seed = mnemonicToSeed(MNEMONIC, '')
    const a = signLegacyMessage(seed, MAINNET, "m/44'/0'/0'/0/0", 'Hello World')
    const b = signLegacyMessage(seed, MAINNET, "m/44'/0'/0'/0/0", 'Hello World')
    expect(a.signature).toBe(b.signature)
  })

  /**
   * INV-MSG-12. Recovery always produces a key, so the address check is the
   * only thing proving anything. This is a real signature by a real key,
   * offered against somebody else's address.
   */
  it('refuses-a-real-signature-offered-against-another-address', () => {
    using seed = mnemonicToSeed(MNEMONIC, '')
    const mine = signLegacyMessage(seed, MAINNET, "m/44'/0'/0'/0/0", 'Hello World')
    const theirs = signLegacyMessage(seed, MAINNET, "m/44'/0'/0'/0/1", 'Hello World')

    const checked = verifyLegacyMessage(mine.address, 'Hello World', theirs.signature, MAINNET)
    expect(checked.valid).toBe(false)
    expect(checked.reason).toMatch(/does not produce this address/)
  })

  /** INV-MSG-12. One character, and the proof is gone. */
  it('refuses-a-proof-of-a-different-message', () => {
    using seed = mnemonicToSeed(MNEMONIC, '')
    const signed = signLegacyMessage(seed, MAINNET, "m/44'/0'/0'/0/0", 'Hello World')
    expect(
      verifyLegacyMessage(signed.address, 'Hello world', signed.signature, MAINNET).valid
    ).toBe(false)
  })

  /** INV-MSG-12. Nothing throws, whatever arrives. */
  it('returns-a-refusal-rather-than-throwing-on-anything', () => {
    using seed = mnemonicToSeed(MNEMONIC, '')
    const good = signLegacyMessage(seed, MAINNET, "m/44'/0'/0'/0/0", 'Hello World')

    for (const signature of [
      '',
      'not base64 !!!',
      base64.encode(new Uint8Array(64)),
      base64.encode(new Uint8Array(66)),
      // A header byte outside every recovery id in both compression forms.
      base64.encode(Uint8Array.from([0xff, ...new Uint8Array(64)])),
      base64.encode(new Uint8Array(65)),
    ]) {
      const checked = verifyLegacyMessage(good.address, 'Hello World', signature, MAINNET)
      expect(checked.valid, signature.slice(0, 20)).toBe(false)
      expect(typeof checked.reason).toBe('string')
    }
  })

  /**
   * INV-MSG-12. The two schemes must never be confused for each other. A
   * legacy signature is not a BIP-322 witness and the BIP-322 verifier says so
   * by name rather than reporting a corrupt file.
   */
  it('is-not-interchangeable-with-a-bip322-proof', () => {
    using seed = mnemonicToSeed(MNEMONIC, '')
    const legacy = signLegacyMessage(seed, MAINNET, "m/44'/0'/0'/0/0", 'Hello World')

    const checked = verifyMessage(legacy.address, 'Hello World', legacy.signature, MAINNET)
    expect(checked.valid).toBe(false)
    expect(checked.reason).toMatch(/older signmessage scheme/)
  })
})
