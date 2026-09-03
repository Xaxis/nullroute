/**
 * Choosing which quorum a transaction belongs to, on a device in several.
 *
 * THE BUG THIS EXISTS FOR, which is invisible on any simpler setup. Selecting
 * the quorum by "did any of its cosigners sign" is wrong precisely when a
 * device is registered in two, because it holds the SAME account key in both.
 * Once it signs, both quorums report a signature and the answer becomes
 * whichever happened to be registered first, which names the wrong cosigners
 * and tells somebody to walk to the wrong device.
 *
 * The join has to be on what the transaction NAMES, not on what signed it: a
 * PSBT carries a derivation record for every key of the quorum it spends from,
 * and another quorum shares only the keys the two have in common.
 */

import { describe, expect, it } from 'vitest'
import * as btc from '@scure/btc-signer'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { fingerprintsNamedBy } from '../src/psbt/attribution.js'

function key(index: number): Uint8Array {
  const secret = new Uint8Array(32)
  secret[31] = index + 1
  return secp256k1.getPublicKey(secret, true)
}

/** A PSBT naming a set of (key, master fingerprint) pairs, as Core writes them. */
function psbtNaming(pairs: readonly { key: Uint8Array; fingerprint: number }[]): btc.Transaction {
  const tx = new btc.Transaction({ allowUnknownOutputs: true, allowLegacyWitnessUtxo: true })
  tx.addInput({
    txid: new Uint8Array(32).fill(9),
    index: 0,
    witnessUtxo: { script: btc.p2wpkh(pairs[0]?.key ?? key(0)).script, amount: 5000n },
    bip32Derivation: pairs.map((pair) => [
      pair.key,
      {
        fingerprint: pair.fingerprint,
        path: [2147483696, 2147483648, 2147483648, 2147483650, 0, 0],
      },
    ]),
  })
  tx.addOutput({ script: Uint8Array.from([0x6a]), amount: 0n })
  return tx
}

/** How many of a quorum's fingerprints a transaction names. The selection rule. */
function score(tx: btc.Transaction, quorum: readonly string[]): number {
  const named = fingerprintsNamedBy(tx)
  return quorum.filter((fingerprint) => named.has(fingerprint.toLowerCase())).length
}

/** This device's key, shared between both quorums. */
const OURS = 0x73c5da0a
const QUORUM_X = ['73c5da0a', 'aabbccdd', '11112222']
const QUORUM_Y = ['73c5da0a', '33334444', '55556666']

describe('core.psbt.attribution across several quorums', () => {
  /**
   * INV-QUORUM-7. A transaction spending quorum Y names all three of Y's keys
   * and exactly one of X's, which is this device's own. Selecting on "did
   * anybody sign" cannot tell them apart, because this device signs both.
   */
  it('tells-two-quorums-apart-by-what-the-transaction-names', () => {
    const spendingY = psbtNaming([
      { key: key(0), fingerprint: OURS },
      { key: key(1), fingerprint: 0x33334444 },
      { key: key(2), fingerprint: 0x55556666 },
    ])

    expect(score(spendingY, QUORUM_Y)).toBe(3)
    // Exactly the shared key, which is why "more than one" is the threshold.
    expect(score(spendingY, QUORUM_X)).toBe(1)
  })

  /**
   * INV-QUORUM-7. One key in common is what any two quorums on this device
   * share by construction, so it is never enough to decide on.
   */
  it('treats-a-single-shared-key-as-no-answer-at-all', () => {
    const shared = psbtNaming([{ key: key(0), fingerprint: OURS }])

    expect(score(shared, QUORUM_X)).toBe(1)
    expect(score(shared, QUORUM_Y)).toBe(1)
    // Neither scores above one, so neither is a match under the rule.
    expect(Math.max(score(shared, QUORUM_X), score(shared, QUORUM_Y))).toBeLessThanOrEqual(1)
  })

  /**
   * INV-QUORUM-7. Two quorums that genuinely match equally well are a tie, and
   * a tie is not an answer: naming the wrong set of cosigners is worse than
   * saying the device cannot tell.
   */
  it('produces-a-tie-rather-than-a-guess-when-two-quorums-match-equally', () => {
    const overlapping = psbtNaming([
      { key: key(0), fingerprint: OURS },
      { key: key(1), fingerprint: 0xaabbccdd },
      { key: key(2), fingerprint: 0x33334444 },
    ])

    expect(score(overlapping, QUORUM_X)).toBe(2)
    expect(score(overlapping, QUORUM_Y)).toBe(2)
  })

  /** INV-QUORUM-7. Taproot derivations count too, or a taproot quorum scores zero. */
  it('reads-taproot-derivations-as-well-as-classic-ones', () => {
    const tx = new btc.Transaction({ allowUnknownOutputs: true, allowLegacyWitnessUtxo: true })
    tx.addInput({
      txid: new Uint8Array(32).fill(9),
      index: 0,
      witnessUtxo: { script: btc.p2wpkh(key(0)).script, amount: 5000n },
      tapBip32Derivation: [
        [key(0).slice(1), { hashes: [], der: { fingerprint: OURS, path: [2147483734, 0, 0] } }],
      ],
    })
    tx.addOutput({ script: Uint8Array.from([0x6a]), amount: 0n })

    // Read at all: a taproot-only PSBT must not come back empty, which would
    // score every quorum zero and silently answer "cannot tell" for all of them.
    expect(fingerprintsNamedBy(tx).size).toBeGreaterThan(0)
  })
})
