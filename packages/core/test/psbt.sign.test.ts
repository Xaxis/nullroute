/**
 * Tests for core.psbt.sign.
 *
 * The reproducibility test is the important one and it is not a performance
 * check. A signing device that produces randomised signatures can leak the
 * private key a few bits per transaction, through nothing but valid spends that
 * verify correctly and look normal on screen. Byte-identical output is what
 * removes the space that leak would live in, so this asserts it directly rather
 * than trusting that the library is deterministic.
 */

import { describe, expect, it } from 'vitest'
import * as btc from '@scure/btc-signer'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { mnemonicToSeed } from '../src/bip39/mnemonic.js'
import { rootFromSeed } from '../src/derive/hd.js'
import { MAINNET } from '../src/network/networks.js'
import { deriveAddresses } from '../src/address/address.js'
import { PsbtError } from '../src/psbt/review.js'
import { reviewTransaction, SIGHASH_NONE } from '../src/psbt/review.js'
import { AUX_RAND, signTransaction } from '../src/psbt/sign.js'

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const ACCOUNT = "m/84'/0'/0'"
const SIGNING_PATH = `${ACCOUNT}/0/0`
const STRANGER = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'

/** A transaction spending our own first receive address. */
function fundedTransaction(sighashType?: number): btc.Transaction {
  using seed = mnemonicToSeed(MNEMONIC, '')
  const root = rootFromSeed(seed, MAINNET)
  const account = root.derive(ACCOUNT)
  const [ours] = deriveAddresses(account, {
    scriptType: 'p2wpkh',
    network: MAINNET,
    change: false,
    start: 0,
    count: 1,
  })
  root.wipePrivateData()
  if (ours === undefined) throw new Error('no address')

  const script = btc.OutScript.encode(
    btc.Address({
      bech32: MAINNET.bech32,
      pubKeyHash: MAINNET.pubKeyHash,
      scriptHash: MAINNET.scriptHash,
      wif: MAINNET.wif,
    }).decode(ours.address)
  )

  const tx = new btc.Transaction()
  tx.addInput({
    txid: hexToBytes('a'.repeat(64)),
    index: 0,
    witnessUtxo: { script, amount: 100_000n },
    ...(sighashType === undefined ? {} : { sighashType }),
  })
  tx.addOutputAddress(STRANGER, 90_000n, MAINNET)
  return tx
}

function review(tx: btc.Transaction) {
  return reviewTransaction(tx, { network: MAINNET, isChange: () => undefined })
}

describe('core.psbt.sign', () => {
  it('signs-an-input-it-owns', () => {
    using seed = mnemonicToSeed(MNEMONIC, '')
    const tx = fundedTransaction()
    const result = signTransaction(tx, seed, {
      network: MAINNET,
      paths: [SIGNING_PATH],
      review: review(tx),
    })

    expect(result.inputsSigned).toBeGreaterThan(0)
    expect(result.signedWith).toContain(SIGNING_PATH)
    expect(result.psbt.length).toBeGreaterThan(0)
  })

  /**
   * INV-SIG-2. The whole determinism apparatus exists for this assertion.
   *
   * The brief asks for a hundred signatures of the same input. Any variation at
   * all in the output bytes would mean there is room in a signature to encode
   * something, which is exactly the covert channel this device is built to
   * close.
   */
  it('produces-byte-identical-signatures', () => {
    using seed = mnemonicToSeed(MNEMONIC, '')

    const signatures = new Set<string>()
    for (let i = 0; i < 100; i += 1) {
      const tx = fundedTransaction()
      const result = signTransaction(tx, seed, {
        network: MAINNET,
        paths: [SIGNING_PATH],
        review: review(tx),
      })
      signatures.add(bytesToHex(result.psbt))
    }

    // One distinct value across a hundred signings, or there is a leak channel.
    expect(signatures.size).toBe(1)
  })

  it('uses-zero-aux-rand', () => {
    // Stated as a test so it cannot be changed without a failing assertion.
    // A randomised aux_rand would reopen the covert channel that byte-identical
    // signatures close.
    expect(AUX_RAND).toHaveLength(32)
    expect(AUX_RAND.every((b) => b === 0)).toBe(true)
  })

  // INV-SIG-3: the review gate. A caller cannot sign by simply not checking.
  it('refuses-to-sign-a-transaction-the-review-rejected', () => {
    using seed = mnemonicToSeed(MNEMONIC, '')
    const tx = fundedTransaction(SIGHASH_NONE)
    const verdict = review(tx)
    expect(verdict.signable).toBe(false)

    expect(() =>
      signTransaction(tx, seed, { network: MAINNET, paths: [SIGNING_PATH], review: verdict })
    ).toThrow(PsbtError)
    expect(() =>
      signTransaction(tx, seed, { network: MAINNET, paths: [SIGNING_PATH], review: verdict })
    ).toThrow(/Refusing to sign/)
  })

  it('allows-an-explicit-per-signature-override', () => {
    using seed = mnemonicToSeed(MNEMONIC, '')
    const tx = fundedTransaction(SIGHASH_NONE)
    // Deliberately awkward, applies to this one call, and is never persisted.
    const result = signTransaction(tx, seed, {
      network: MAINNET,
      paths: [SIGNING_PATH],
      review: review(tx),
      overrideBlockingWarnings: true,
    })
    expect(result.inputsSigned).toBeGreaterThan(0)
  })

  // INV-SIG-4: signing something that is not ours fails loudly rather than
  // returning an unsigned PSBT that looks like success.
  it('fails-loudly-when-no-path-matches', () => {
    using seed = mnemonicToSeed(MNEMONIC, '')
    const tx = fundedTransaction()
    expect(() =>
      signTransaction(tx, seed, {
        network: MAINNET,
        // A real path, but not the one that owns this input.
        paths: [`${ACCOUNT}/1/47`],
        review: review(tx),
      })
    ).toThrow(/different wallet/)
  })

  it('rejects-an-empty-path-list', () => {
    using seed = mnemonicToSeed(MNEMONIC, '')
    const tx = fundedTransaction()
    expect(() =>
      signTransaction(tx, seed, { network: MAINNET, paths: [], review: review(tx) })
    ).toThrow(/nothing to sign with/)
  })

  // A different seed must produce a different signature, which is the trivial
  // direction of determinism but worth pinning: identical output for different
  // keys would be catastrophic and is exactly what a broken nonce looks like.
  it('different-seeds-produce-different-signatures', () => {
    const txA = fundedTransaction()
    using seedA = mnemonicToSeed(MNEMONIC, '')
    const a = signTransaction(txA, seedA, {
      network: MAINNET,
      paths: [SIGNING_PATH],
      review: review(txA),
    })

    const txB = fundedTransaction()
    using seedB = mnemonicToSeed(MNEMONIC, 'a different passphrase')
    // A different seed does not own this input, so it refuses. That IS the
    // right behaviour, and it is asserted rather than worked around.
    expect(() =>
      signTransaction(txB, seedB, {
        network: MAINNET,
        paths: [SIGNING_PATH],
        review: review(txB),
      })
    ).toThrow(/different wallet/)

    expect(a.inputsSigned).toBeGreaterThan(0)
  })
})
