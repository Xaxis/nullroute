/**
 * Tests for core.psbt.review.
 *
 * These build real transactions rather than asserting on fixtures, because the
 * properties under test are relationships (fee equals in minus out, change is
 * what re-derives) and a fixture would only prove the relationship held once.
 *
 * The change-substitution test is the one that matters. It is the attack this
 * module exists to stop, and it is written as the attack rather than as a
 * happy-path assertion.
 */

import { describe, expect, it } from 'vitest'
import * as btc from '@scure/btc-signer'
import { hexToBytes } from '@noble/hashes/utils.js'
import { mnemonicToSeed } from '../src/bip39/mnemonic.js'
import { rootFromSeed } from '../src/derive/hd.js'
import { MAINNET } from '../src/network/networks.js'
import { deriveAddresses } from '../src/address/address.js'
import {
  PsbtError,
  SIGHASH_ALL,
  SIGHASH_NONE,
  SIGHASH_SINGLE,
  SIGHASH_ANYONECANPAY,
  describeSighash,
  formatBtc,
  reviewTransaction,
} from '../src/psbt/review.js'

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const FAKE_TXID = 'a'.repeat(64)

/** Our own addresses, derived the same way the device would. */
function ourAddresses(): { receive: string[]; change: string[]; changePathOf: (a: string) => string | undefined } {
  using seed = mnemonicToSeed(MNEMONIC, '')
  const root = rootFromSeed(seed, MAINNET)
  const account = root.derive("m/84'/0'/0'")
  const receive = deriveAddresses(account, {
    scriptType: 'p2wpkh',
    network: MAINNET,
    change: false,
    start: 0,
    count: 5,
  })
  const change = deriveAddresses(account, {
    scriptType: 'p2wpkh',
    network: MAINNET,
    change: true,
    start: 0,
    count: 5,
  })
  root.wipePrivateData()

  const changeMap = new Map(change.map((c) => [c.address, `m/84'/0'/0'/${c.path}`]))
  return {
    receive: receive.map((r) => r.address),
    change: change.map((c) => c.address),
    changePathOf: (address: string) => changeMap.get(address),
  }
}

interface BuildOptions {
  readonly inputAmount?: bigint
  readonly outputs: { address: string; amount: bigint }[]
  readonly sighashType?: number
  readonly sequence?: number
  readonly locktime?: number
}

function build(options: BuildOptions): btc.Transaction {
  const tx = new btc.Transaction({ allowUnknownOutputs: true, ...(options.locktime === undefined ? {} : { lockTime: options.locktime }) })
  const { receive } = ourAddresses()
  const fundingScript = btc.OutScript.encode(
    btc.Address({
      bech32: MAINNET.bech32,
      pubKeyHash: MAINNET.pubKeyHash,
      scriptHash: MAINNET.scriptHash,
      wif: MAINNET.wif,
    }).decode(receive[0] ?? '')
  )

  tx.addInput({
    txid: hexToBytes(FAKE_TXID),
    index: 0,
    witnessUtxo: { script: fundingScript, amount: options.inputAmount ?? 100_000n },
    ...(options.sighashType === undefined ? {} : { sighashType: options.sighashType }),
    ...(options.sequence === undefined ? {} : { sequence: options.sequence }),
  })

  for (const output of options.outputs) tx.addOutputAddress(output.address, output.amount, MAINNET)
  return tx
}

const STRANGER = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'

describe('core.psbt.review', () => {
  // INV-PSBT-2: THE attack this module exists to stop.
  it('labels-change-only-when-it-re-derives', () => {
    const { change, changePathOf } = ourAddresses()
    const ourChange = change[0]
    if (ourChange === undefined) throw new Error('no change address')

    const tx = build({
      inputAmount: 100_000n,
      outputs: [
        { address: STRANGER, amount: 60_000n },
        { address: ourChange, amount: 35_000n },
      ],
    })

    const review = reviewTransaction(tx, { network: MAINNET, isChange: changePathOf })

    // Ours re-derives, so it is change and the path is shown.
    const changeOut = review.outputs.find((o) => o.address === ourChange)
    expect(changeOut?.kind).toBe('change')
    expect(changeOut?.changePath).toContain("84'/0'/0'/1/0")

    // The stranger's does not, so it is a payment.
    expect(review.outputs.find((o) => o.address === STRANGER)?.kind).toBe('payment')
  })

  // The substitution, written as the attack. An attacker swaps their own
  // address into the change position; only re-derivation catches it.
  it('refuses-to-call-an-attackers-address-change', () => {
    const { changePathOf } = ourAddresses()
    const tx = build({
      inputAmount: 100_000n,
      outputs: [
        { address: STRANGER, amount: 60_000n },
        // Positioned exactly where change would sit, and it is not ours.
        { address: 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g', amount: 35_000n },
      ],
    })

    const review = reviewTransaction(tx, { network: MAINNET, isChange: changePathOf })
    // BOTH outputs are payments. Nothing about position or shape earns the
    // change label.
    expect(review.outputs.every((o) => o.kind === 'payment')).toBe(true)
    expect(review.outputs.filter((o) => o.changePath !== undefined)).toHaveLength(0)
  })

  // INV-PSBT-3: sighash policy.
  it('refuses-sighash-flags-that-do-not-commit-to-outputs', () => {
    const { changePathOf } = ourAddresses()

    for (const flag of [
      SIGHASH_NONE,
      SIGHASH_SINGLE,
      SIGHASH_ALL | SIGHASH_ANYONECANPAY,
      SIGHASH_NONE | SIGHASH_ANYONECANPAY,
    ]) {
      const tx = build({ outputs: [{ address: STRANGER, amount: 90_000n }], sighashType: flag })
      const review = reviewTransaction(tx, { network: MAINNET, isChange: changePathOf })
      expect(review.signable, `flag 0x${flag.toString(16)}`).toBe(false)
      expect(review.warnings.some((w) => w.kind === 'sighash' && w.blocking)).toBe(true)
    }
  })

  it('accepts-sighash-all', () => {
    const { changePathOf } = ourAddresses()
    const tx = build({
      outputs: [{ address: STRANGER, amount: 90_000n }],
      sighashType: SIGHASH_ALL,
    })
    const review = reviewTransaction(tx, { network: MAINNET, isChange: changePathOf })
    expect(review.sighash.acceptable).toBe(true)
    expect(review.signable).toBe(true)
  })

  // The flag is explained in words, not as a hex constant, because a constant
  // tells a user nothing about what an attacker could still change.
  it('describes-sighash-in-plain-language', () => {
    expect(describeSighash(SIGHASH_ALL).meaning).toContain('every input and every output')
    expect(describeSighash(SIGHASH_NONE).meaning).toContain('does NOT commit to the outputs')
    expect(describeSighash(SIGHASH_SINGLE).meaning).toContain('only ONE output')
    expect(describeSighash(SIGHASH_ALL | SIGHASH_ANYONECANPAY).meaning).toContain(
      'other inputs can be added'
    )
    // Taproot's default is encoded as absent and commits to everything.
    expect(describeSighash(undefined).acceptable).toBe(true)
  })

  // INV-PSBT-4: the fee is derived, never taken from the PSBT.
  it('computes-the-fee-from-inputs-minus-outputs', () => {
    const { changePathOf } = ourAddresses()
    const tx = build({
      inputAmount: 100_000n,
      outputs: [{ address: STRANGER, amount: 90_000n }],
    })
    const review = reviewTransaction(tx, { network: MAINNET, isChange: changePathOf })

    expect(review.fee.feeSats).toBe(10_000n)
    expect(review.fee.totalInSats).toBe(100_000n)
    expect(review.fee.totalOutSats).toBe(90_000n)
    expect(review.fee.satsPerVbyte).toBeGreaterThan(0)
    // 10,000 on a 90,000 spend is 11.1 percent, well past the threshold.
    expect(review.fee.percentOfSpend).toBeCloseTo(11.1, 1)
    expect(review.warnings.some((w) => w.kind === 'high-fee')).toBe(true)
  })

  it('refuses-a-transaction-that-spends-more-than-it-has', () => {
    const { changePathOf } = ourAddresses()
    const tx = build({
      inputAmount: 50_000n,
      outputs: [{ address: STRANGER, amount: 90_000n }],
    })
    expect(() => reviewTransaction(tx, { network: MAINNET, isChange: changePathOf })).toThrow(
      PsbtError
    )
  })

  // A PSBT with no input amount cannot be reviewed. A wallet that guessed the
  // fee here could be made to pay any fee at all.
  it('refuses-a-psbt-with-no-input-amount', () => {
    const { changePathOf } = ourAddresses()
    const tx = new btc.Transaction({ allowUnknownInputs: true, allowUnknownOutputs: true })
    tx.addInput({ txid: hexToBytes(FAKE_TXID), index: 0 })
    tx.addOutputAddress(STRANGER, 1000n, MAINNET)
    expect(() => reviewTransaction(tx, { network: MAINNET, isChange: changePathOf })).toThrow(
      /no amount/
    )
  })

  it('reports-replaceability-and-locktime', () => {
    const { changePathOf } = ourAddresses()

    const final = build({
      outputs: [{ address: STRANGER, amount: 90_000n }],
      sequence: 0xffffffff,
    })
    const finalReview = reviewTransaction(final, { network: MAINNET, isChange: changePathOf })
    expect(finalReview.replaceable).toBe(false)
    expect(finalReview.warnings.some((w) => w.kind === 'not-replaceable')).toBe(true)

    const rbf = build({
      outputs: [{ address: STRANGER, amount: 90_000n }],
      sequence: 0xfffffffd,
      locktime: 800_000,
    })
    const rbfReview = reviewTransaction(rbf, { network: MAINNET, isChange: changePathOf })
    expect(rbfReview.replaceable).toBe(true)
    // A locktime is surfaced in human terms rather than as a raw number.
    expect(rbfReview.warnings.find((w) => w.kind === 'locktime')?.message).toContain('block 800000')
  })

  // Amounts are bigint end to end. 21 million BTC exceeds what a double holds
  // exactly, and a fee is not a place to discover that.
  it('handles-amounts-without-floating-point', () => {
    expect(formatBtc(100_000_000n)).toBe('1.00000000')
    expect(formatBtc(1n)).toBe('0.00000001')
    expect(formatBtc(2_100_000_000_000_000n)).toBe('21000000.00000000')
    // A value beyond 2^53 satoshis still renders exactly.
    expect(formatBtc(9_007_199_254_740_993n)).toBe('90071992.54740993')
  })
})
