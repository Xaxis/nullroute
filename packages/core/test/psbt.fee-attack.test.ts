/**
 * Tests for input amounts the device cannot check (SP-REV-3).
 *
 * The fee a review shows is the inputs minus the outputs, and the input
 * amounts come from the PSBT. A segwit v0 signature commits only to its own
 * input's amount, so a coordinator can understate one input in one signing
 * round and another in the next and have the user pay a fee they never saw.
 * BIP-174 describes it. The defence is the previous transaction: with it the
 * amount is checked, without it the review blocks until the user overrides.
 * Taproot needs neither, because BIP-341 commits to every input's amount.
 */

import { describe, expect, it } from 'vitest'
import * as btc from '@scure/btc-signer'
import { hexToBytes } from '@noble/hashes/utils.js'
import { secp256k1, schnorr } from '@noble/curves/secp256k1.js'
import { MAINNET } from '../src/network/networks.js'
import { parsePsbt } from '../src/psbt/parse.js'
import { reviewTransaction } from '../src/psbt/review.js'
import { fundedBy } from './fixtures/funding.js'

const STRANGER = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'
const OPTIONS = { network: MAINNET, isChange: () => undefined }
const KEY = hexToBytes('11'.repeat(32))

function review(tx: btc.Transaction) {
  return reviewTransaction(parsePsbt(tx.toPSBT()), OPTIONS)
}

describe('core.psbt.review input amounts', () => {
  /** INV-PSBT-17. The attack shape: a segwit v0 input with only its stated amount. */
  it('blocks-a-segwit-v0-input-whose-amount-it-cannot-check', () => {
    const script = btc.p2wpkh(secp256k1.getPublicKey(KEY, true)).script
    const tx = new btc.Transaction()
    tx.addInput({
      txid: hexToBytes('ab'.repeat(32)),
      index: 0,
      witnessUtxo: { script, amount: 100_000n },
    })
    tx.addOutputAddress(STRANGER, 90_000n, MAINNET)

    const reviewed = review(tx)
    const warning = reviewed.warnings.find((w) => w.kind === 'unverified-amount')
    expect(warning?.blocking).toBe(true)
    expect(warning?.message).toContain('input 0')
    expect(reviewed.signable).toBe(false)
  })

  /** INV-PSBT-17. The same input with the transaction it spends is checked and allowed. */
  it('allows-it-once-the-previous-transaction-is-there', () => {
    const script = btc.p2wpkh(secp256k1.getPublicKey(KEY, true)).script
    const tx = new btc.Transaction()
    tx.addInput(fundedBy(script, 100_000n))
    tx.addOutputAddress(STRANGER, 90_000n, MAINNET)

    const reviewed = review(tx)
    expect(reviewed.warnings.map((w) => w.kind)).not.toContain('unverified-amount')
    expect(reviewed.fee.feeSats).toBe(10_000n)
  })

  /**
   * INV-PSBT-17. A previous transaction that disagrees with the stated amount is
   * refused before review, so the check cannot be satisfied by attaching any
   * transaction at all. The library does this; the test pins that it still does.
   */
  it('refuses-a-previous-transaction-that-disagrees-with-the-stated-amount', () => {
    const script = btc.p2wpkh(secp256k1.getPublicKey(KEY, true)).script
    const honest = fundedBy(script, 100_000n)
    const tx = new btc.Transaction()
    tx.addInput({ ...honest, witnessUtxo: { script, amount: 50_000n } })
    tx.addOutputAddress(STRANGER, 40_000n, MAINNET)
    // Refused where a PSBT arrives: parsing the file the coordinator sent.
    expect(() => parsePsbt(tx.toPSBT())).toThrow(/different from nonWitnessUtxo/)
  })

  /** INV-PSBT-17. Taproot commits to every amount, so it needs no previous transaction. */
  it('does-not-block-an-all-taproot-transaction', () => {
    const payment = btc.p2tr(schnorr.getPublicKey(KEY))
    const tx = new btc.Transaction()
    tx.addInput({
      txid: hexToBytes('cd'.repeat(32)),
      index: 0,
      witnessUtxo: { script: payment.script, amount: 100_000n },
      tapInternalKey: payment.tapInternalKey,
    })
    tx.addOutputAddress(STRANGER, 90_000n, MAINNET)

    expect(review(tx).warnings.map((w) => w.kind)).not.toContain('unverified-amount')
  })
})
