/**
 * The published BIP-322 test vectors, read from the file the BIP ships.
 *
 * spec/vectors/bip322-basic.json is bip-0322/basic-test-vectors.json from the
 * bitcoin/bips repository, pinned by hash in message.spec.yaml. Nothing in it
 * came from this code. It carries the 1.0.0 variant prefix, which this device
 * did not write until the BIP was checked again.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as btc from '@scure/btc-signer'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { MAINNET } from '../src/network/networks.js'
import { messageHash } from '../src/message/bip322.js'
import { buildToSpend, signMessageWithKey } from '../src/message/sign.js'
import { verifyMessage } from '../src/message/verify.js'

interface Vectors {
  tx_hashes: { message: string; address: string; message_hash: string; to_spend_tx_hash: string }[]
  simple: {
    message: string
    private_keys: string[]
    address: string
    type: string
    bip322_signatures: string[]
  }[]
  error: { description: string; message: string; address: string; signature: string }[]
}

const VECTORS = JSON.parse(
  readFileSync(new URL('../../../spec/vectors/bip322-basic.json', import.meta.url), 'utf8')
) as Vectors

// What this device signs and checks. P2WSH is not: see the last test.
const SUPPORTED = new Set(['p2wpkh', 'p2tr'])

describe('core.message.bip322 published vectors', () => {
  /** INV-MSG-6. The commitment and the to_spend transaction match the BIP. */
  it('hashes-every-published-message-and-to-spend-transaction', () => {
    for (const vector of VECTORS.tx_hashes) {
      expect(bytesToHex(messageHash(vector.message)), vector.message).toBe(vector.message_hash)
      const script = btc.OutScript.encode(btc.Address(btc.NETWORK).decode(vector.address))
      const txid = bytesToHex(sha256(sha256(buildToSpend(vector.message, script))).reverse())
      expect(txid, vector.message).toBe(vector.to_spend_tx_hash)
    }
  })

  /**
   * INV-MSG-6. Signing a vector's message with its key reproduces the
   * published p2wpkh signature byte for byte, prefix included, and a valid
   * taproot one. The empty message is skipped: this device refuses to sign
   * one, deliberately.
   */
  it('reproduces-a-published-signature-for-every-vector-it-can-sign', () => {
    let signed = 0
    for (const vector of VECTORS.simple) {
      if (!SUPPORTED.has(vector.type) || vector.message === '') continue
      const key = btc.WIF(btc.NETWORK).decode(vector.private_keys[0] ?? '')
      const scriptType = vector.type === 'p2tr' ? 'p2tr' : 'p2wpkh'
      const ours = signMessageWithKey(key, MAINNET, scriptType, vector.message)
      expect(ours.address).toBe(vector.address)
      expect(ours.signature.startsWith('smp')).toBe(true)
      if (vector.type === 'p2tr') {
        // Not byte for byte, and cannot be: the published taproot signature
        // used random aux data, and this device fixes it to 32 zero bytes
        // (INV-SIG-1). What must hold is that the proof it makes is valid.
        expect(
          verifyMessage(vector.address, vector.message, ours.signature, MAINNET)
        ).toMatchObject({ valid: true })
      } else {
        // ECDSA under RFC 6979 is deterministic, so the published bytes are
        // the only right answer.
        expect(vector.bip322_signatures, vector.message).toContain(ours.signature)
      }
      signed += 1
    }
    expect(signed).toBeGreaterThan(0)
  })

  /** INV-MSG-9. Every published signature for a supported type verifies. */
  it('accepts-every-published-signature-it-supports', () => {
    for (const vector of VECTORS.simple) {
      if (!SUPPORTED.has(vector.type)) continue
      for (const signature of vector.bip322_signatures) {
        expect(
          verifyMessage(vector.address, vector.message, signature, MAINNET),
          signature
        ).toMatchObject({ valid: true })
      }
    }
  })

  /** INV-MSG-9. Every published error case is refused, and none throws. */
  it('refuses-every-published-error-case', () => {
    for (const vector of VECTORS.error) {
      const checked = verifyMessage(vector.address, vector.message, vector.signature, MAINNET)
      expect(checked.valid, vector.description).toBe(false)
    }
  })

  /**
   * INV-MSG-9. A script type this device does not check is refused rather than
   * reported valid, even when the published signature is good.
   */
  it('does-not-call-a-p2wsh-proof-valid-when-it-cannot-check-one', () => {
    for (const vector of VECTORS.simple.filter((v) => v.type.startsWith('p2wsh'))) {
      for (const signature of vector.bip322_signatures) {
        expect(verifyMessage(vector.address, vector.message, signature, MAINNET).valid).toBe(false)
      }
    }
  })
})
