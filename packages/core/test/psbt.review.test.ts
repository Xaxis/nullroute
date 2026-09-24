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
import { fundedBy } from './fixtures/funding.js'
import { parsePsbt } from '../src/psbt/parse.js'
import { signTransaction } from '../src/psbt/sign.js'

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const FAKE_TXID = 'a'.repeat(64)

/** Our own addresses, derived the same way the device would. */
function ourAddresses(): {
  receive: string[]
  change: string[]
  changePathOf: (a: string) => string | undefined
} {
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
  const tx = new btc.Transaction({
    allowUnknownOutputs: true,
    ...(options.locktime === undefined ? {} : { lockTime: options.locktime }),
  })
  const { receive } = ourAddresses()
  const fundingScript = btc.OutScript.encode(
    btc
      .Address({
        bech32: MAINNET.bech32,
        pubKeyHash: MAINNET.pubKeyHash,
        scriptHash: MAINNET.scriptHash,
        wif: MAINNET.wif,
      })
      .decode(receive[0] ?? '')
  )

  tx.addInput({
    ...fundedBy(fundingScript, options.inputAmount ?? 100_000n),
    ...(options.sighashType === undefined ? {} : { sighashType: options.sighashType }),
    ...(options.sequence === undefined ? {} : { sequence: options.sequence }),
  })

  for (const output of options.outputs) tx.addOutputAddress(output.address, output.amount, MAINNET)
  return tx
}

/**
 * NOT ours. Verified: this is the BIP-173 test vector address, and it does not
 * re-derive from the test mnemonic at any path.
 *
 * This constant used to be bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu, which is
 * the BIP-84 vector address FOR THIS EXACT MNEMONIC and therefore belongs to the
 * wallet under test. Tests that meant "a payment to someone else" were quietly
 * asserting things about a self-send, and the change-substitution test was
 * passing for the wrong reason. See the fixture guard at the end of this file.
 */
const STRANGER = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'

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
        { address: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', amount: 35_000n },
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
    /*
     * 0x81, asserted on BOTH halves of the sentence.
     *
     * This line used to check only the appended clause, so it passed while the
     * first half read "This signature uses a sighash flag nullroute does not
     * recognise" and the name came back as the hex "0x81 | ANYONECANPAY". The
     * two exits for SIGHASH_ALL match the whole byte and 0x81 is not it, and
     * nothing downstream had a branch for the base. A test that reads one
     * clause of a two-clause sentence is a test that passes on the broken one.
     */
    const anyone = describeSighash(SIGHASH_ALL | SIGHASH_ANYONECANPAY)
    expect(anyone.name).toBe('SIGHASH_ALL | ANYONECANPAY')
    expect(anyone.meaning).toContain('commits to every output')
    expect(anyone.meaning).toContain('other inputs can be added')
    expect(anyone.meaning).not.toContain('does not recognise')
    // Still refused, which is INV-PSBT-3. Naming it correctly is not accepting it.
    expect(anyone.acceptable).toBe(false)
    // The two that were already right, so a regression on either is visible here.
    expect(describeSighash(SIGHASH_NONE | SIGHASH_ANYONECANPAY).name).toBe(
      'SIGHASH_NONE | ANYONECANPAY'
    )
    expect(describeSighash(SIGHASH_SINGLE | SIGHASH_ANYONECANPAY).name).toBe(
      'SIGHASH_SINGLE | ANYONECANPAY'
    )
    // A byte this device genuinely does not know still says so rather than
    // being given a name it does not have.
    expect(describeSighash(0x40).name).toBe('0x40')
    expect(describeSighash(0x40).meaning).toContain('does not recognise')
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

  /**
   * INV-PSBT-7. BIP-125 signals replaceability when ANY input does. Requiring
   * every input to called a mixed transaction not replaceable, and Core's
   * mempool treats it as replaceable.
   */
  it('counts-one-signalling-input-as-replaceable', () => {
    const { changePathOf } = ourAddresses()
    const tx = build({ outputs: [{ address: STRANGER, amount: 90_000n }], sequence: 0xffffffff })
    tx.addInput({
      ...fundedBy(tx.getInput(0).witnessUtxo?.script ?? new Uint8Array(), 50_000n, 7),
      sequence: 0xfffffffd,
    })
    const review = reviewTransaction(tx, { network: MAINNET, isChange: changePathOf })
    expect(review.replaceable).toBe(true)
    expect(review.warnings.some((w) => w.kind === 'not-replaceable')).toBe(false)
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

  /**
   * Splice an unknown key-value pair into the first input's map.
   *
   * Done at the byte level because that is the only way such a pair reaches the
   * device: it arrives inside a file that some other software wrote. The signer
   * will not let one be attached through its own API, which is correct of it
   * and useless for this test.
   *
   * Type 0x60 is unassigned. Picking an arbitrary low number does not work:
   * 0x0f is `output_index` in PSBT v2, so the parser tries to decode it as one
   * and fails on the buffer rather than filing it under unknown.
   */
  function withUnknownInputField(tx: btc.Transaction, type = 0x60): btc.Transaction {
    const bytes = tx.toPSBT()
    let i = 5 // past the "psbt\xff" magic

    const readCompactSize = (): number => {
      const first = bytes[i]
      if (first === undefined) throw new Error('truncated PSBT in test fixture')
      if (first < 0xfd) {
        i += 1
        return first
      }
      if (first === 0xfd) {
        const lo = bytes[i + 1] ?? 0
        const hi = bytes[i + 2] ?? 0
        i += 3
        return lo | (hi << 8)
      }
      throw new Error('test fixture does not handle large varints')
    }

    // Walk the global map to its terminating zero. The next byte begins the
    // first input's map, which is where the pair goes.
    for (;;) {
      const keyLength = readCompactSize()
      if (keyLength === 0) break
      i += keyLength
      // Read into a variable first. `i += readCompactSize()` evaluates `i`
      // BEFORE the call advances it, so the reader's own advance past the
      // length prefix is discarded and the walk drifts one byte per entry.
      const valueLength = readCompactSize()
      i += valueLength
    }

    const spliced = [...bytes]
    spliced.splice(i, 0, 0x01, type, 0x02, 0xde, 0xad)
    const parsed = btc.Transaction.fromPSBT(Uint8Array.from(spliced))

    // The fixture checks itself. Byte surgery that lands one position early
    // puts the pair in the global map instead, where it parses cleanly and is
    // invisible to the input, so the test under it would pass or fail for
    // reasons having nothing to do with the code being tested.
    const attached: unknown = parsed.getInput(0).unknown
    const count = Array.isArray(attached) ? attached.length : 0
    if (count !== 1) {
      throw new Error(
        `fixture did not attach an unknown field to input 0 (found ${String(count)}). ` +
          `The splice offset ${String(i)} is probably not the start of the input map.`
      )
    }
    return parsed
  }

  /**
   * INV-PSBT-15. A PSBT can carry key-value pairs this device does not model.
   *
   * BIP-174 requires them to be preserved rather than dropped, and they are.
   * The reason to say so on screen is not that they are dangerous: PSBT
   * metadata is not covered by the signature, so an unknown field cannot move
   * money. It is that the file was produced by something the device does not
   * fully understand, and a user comparing against their coordinator should
   * know the device is not showing them everything the file contains.
   */
  it('reports-fields-it-does-not-understand', () => {
    const { changePathOf } = ourAddresses()
    const tx = withUnknownInputField(build({ outputs: [{ address: STRANGER, amount: 90_000n }] }))

    const review = reviewTransaction(tx, { network: MAINNET, isChange: changePathOf })
    const warning = review.warnings.find((w) => w.kind === 'unknown-fields')

    expect(warning).toBeDefined()
    expect(warning?.message).toContain('1 field')
    // Informative, never a refusal. Treating an unmodelled field as an attack
    // would make the device reject ordinary transactions from newer software.
    expect(warning?.blocking).toBe(false)
    expect(review.signable).toBe(true)
  })

  // The pair must survive the device, or nullroute would silently strip data
  // its coordinator put there and BIP-174 asks it to preserve.
  it('preserves-fields-it-does-not-understand', () => {
    const tx = withUnknownInputField(build({ outputs: [{ address: STRANGER, amount: 90_000n }] }))
    const roundTripped = btc.Transaction.fromPSBT(tx.toPSBT())
    const unknown: unknown = roundTripped.getInput(0).unknown
    expect(Array.isArray(unknown) ? unknown.length : 0).toBe(1)
  })

  /**
   * INV-PSBT-15. Through parsing AND signing, which is where it failed. The
   * test above round-trips with the library directly; the device parses with
   * parsePsbt and then the signer updates the input, and the unknown pair was
   * dropped at that update while the review said it would be passed through.
   */
  it('keeps-fields-it-does-not-understand-through-signing', () => {
    const { changePathOf } = ourAddresses()
    const built = withUnknownInputField(
      build({ outputs: [{ address: STRANGER, amount: 90_000n }] })
    )
    const tx = parsePsbt(built.toPSBT())
    const review = reviewTransaction(tx, { network: MAINNET, isChange: changePathOf })
    using seed = mnemonicToSeed(MNEMONIC, '')
    const result = signTransaction(tx, seed, {
      network: MAINNET,
      paths: ["m/84'/0'/0'/0/0"],
      review,
    })

    const signed = btc.Transaction.fromPSBT(result.psbt, { allowUnknown: true }).getInput(0)
    const unknown: unknown = signed.unknown
    expect(Array.isArray(unknown) ? unknown.length : 0).toBe(1)
    expect(signed.partialSig).toHaveLength(1)
  })

  /**
   * INV-PSBT-2. A false claim that an output is ours is reported for a taproot
   * output too. Only the segwit record was read, so a tapBip32Derivation
   * naming this wallet's fingerprint made the output look like any payment.
   */
  it('reports-a-false-taproot-claim-on-an-output', () => {
    const { changePathOf } = ourAddresses()
    const stranger = btc.p2tr(new Uint8Array(32).fill(7))
    const tx = build({ outputs: [] })
    tx.addOutput({
      script: stranger.script,
      amount: 90_000n,
      tapBip32Derivation: [
        [
          new Uint8Array(32).fill(7),
          {
            hashes: [],
            der: { fingerprint: 0x73c5da0a, path: [2147483734, 2147483648, 2147483648, 1, 0] },
          },
        ],
      ],
    })
    const arrived = btc.Transaction.fromPSBT(tx.toPSBT())
    const review = reviewTransaction(arrived, { network: MAINNET, isChange: changePathOf })
    expect(review.outputs[0]?.kind).toBe('payment')
    expect(review.outputs[0]?.changeRejectedBecause).toContain('does not derive from this wallet')
  })

  it('says-nothing-when-every-field-is-understood', () => {
    const { changePathOf } = ourAddresses()
    const tx = build({ outputs: [{ address: STRANGER, amount: 90_000n }] })
    const review = reviewTransaction(tx, { network: MAINNET, isChange: changePathOf })
    expect(review.warnings.some((w) => w.kind === 'unknown-fields')).toBe(false)
  })
})
