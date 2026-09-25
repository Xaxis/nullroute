/**
 * The published BIP-340 test vectors, read from the file the BIP ships.
 *
 * spec/vectors/bip340-test-vectors.csv is bip-0340/test-vectors.csv from
 * bitcoin/bips at d1d2042c857f337c147785c1d02cfd9f9d3c84fb, unmodified and
 * pinned by hash in sign.spec.yaml. Nothing in it came from this code.
 *
 * WHAT THIS DOES AND DOES NOT SHOW. Every Schnorr signature this device makes
 * comes from `schnorr.sign` in @noble/curves: directly for a BIP-322 taproot
 * proof (message/sign.ts), and through @scure/btc-signer's Transaction.sign for
 * a PSBT. Every Schnorr check it makes is `schnorr.verify` (message/verify.ts).
 * So the vectors run against those two functions.
 *
 * The signing vectors carry their own aux_rand, and most are not zero. This
 * device never passes anything but zero (INV-SIG-1), so a signing vector with a
 * nonzero aux_rand cannot be reproduced through the device's own path, only
 * through the primitive it calls. Passing the vector's aux_rand here shows the
 * primitive is BIP-340; that the device's path fixes aux_rand to zero is the
 * separate test psbt.sign.test.ts::uses-zero-aux-rand, and the BIP-341 key path
 * vectors (vectors.bip341.test.ts) show the device's actual signing call with
 * that zero reproducing published signatures end to end.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { AUX_RAND } from '../src/psbt/sign.js'

interface Row {
  readonly index: string
  readonly secretKey: string
  readonly publicKey: string
  readonly auxRand: string
  readonly message: string
  readonly signature: string
  readonly valid: boolean
  readonly comment: string
}

const HEADER = 'index,secret key,public key,aux_rand,message,signature,verification result,comment'

/**
 * The file is plain comma separated text: no field is quoted and no comment
 * contains a comma, which the column count check below would catch if a later
 * revision changed that.
 */
function readVectors(): Row[] {
  const text = readFileSync(
    new URL('../../../spec/vectors/bip340-test-vectors.csv', import.meta.url),
    'utf8'
  )
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0)
  if (lines[0] !== HEADER) throw new Error(`Unexpected header: ${String(lines[0])}`)
  return lines.slice(1).map((line) => {
    const fields = line.split(',')
    if (fields.length !== 8) throw new Error(`Expected 8 columns: ${line}`)
    const [index, secretKey, publicKey, auxRand, message, signature, result, comment] = fields as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ]
    if (result !== 'TRUE' && result !== 'FALSE') throw new Error(`Bad result: ${line}`)
    return {
      index,
      secretKey,
      publicKey,
      auxRand,
      message,
      signature,
      valid: result === 'TRUE',
      comment,
    }
  })
}

const VECTORS = readVectors()
const SIGNING = VECTORS.filter((row) => row.secretKey.length > 0)

describe('core.psbt.sign published BIP-340 vectors', () => {
  it('reads-every-published-bip340-vector', () => {
    // 19 rows at the pinned commit. 0 to 3 and 15 to 18 carry a secret key;
    // 4 to 14 are verification only, and 5 to 14 are the ten expected false.
    expect(VECTORS).toHaveLength(19)
    expect(SIGNING).toHaveLength(8)
    expect(VECTORS.filter((row) => !row.valid)).toHaveLength(10)
  })

  /** INV-SIG-6. The signing primitive reproduces every published signature. */
  it('signs-every-published-bip340-vector', () => {
    for (const row of SIGNING) {
      const secret = hexToBytes(row.secretKey)
      const where = `vector ${row.index}`
      expect(bytesToHex(schnorr.getPublicKey(secret)), where).toBe(row.publicKey.toLowerCase())
      const signature = schnorr.sign(hexToBytes(row.message), secret, hexToBytes(row.auxRand))
      expect(bytesToHex(signature), where).toBe(row.signature.toLowerCase())
    }
  })

  /**
   * INV-SIG-6. Every row verifies to its published result, including the ten
   * that must fail: a key off the curve, an odd R, a negated message or s, an
   * infinite point, and field and order overflows in r, s and the key. A
   * verifier that accepted any of these would accept a forgery.
   */
  it('verifies-every-published-bip340-vector', () => {
    for (const row of VECTORS) {
      const verdict = schnorr.verify(
        hexToBytes(row.signature),
        hexToBytes(row.message),
        hexToBytes(row.publicKey)
      )
      expect(verdict, `vector ${row.index} ${row.comment}`).toBe(row.valid)
    }
  })

  /**
   * INV-SIG-1. The vectors whose aux_rand is already zero are the ones where
   * the device's own constant goes into the call unchanged, so for those the
   * published signature is exactly what this device would produce.
   */
  it('reproduces-the-zero-aux-rand-vectors-with-the-devices-own-constant', () => {
    const zero = SIGNING.filter((row) => /^0{64}$/.test(row.auxRand))
    // Vectors 0 and 15 to 18.
    expect(zero.map((row) => row.index)).toEqual(['0', '15', '16', '17', '18'])
    for (const row of zero) {
      const signature = schnorr.sign(hexToBytes(row.message), hexToBytes(row.secretKey), AUX_RAND)
      expect(bytesToHex(signature), `vector ${row.index}`).toBe(row.signature.toLowerCase())
    }
  })
})
