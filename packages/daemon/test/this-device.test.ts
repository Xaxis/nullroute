/**
 * Tests for what signing on this device would do to a transaction's quorum.
 *
 * The signing screen used to compare "present + 1" against "required", both
 * summed over every input. This device adds a signature to every input it
 * owns, and none to one it already signed, so the sum answered a different
 * question. These build real transactions, review them with core, and sign
 * them with core, so the per-input answer is checked against what signing
 * actually does.
 */

import { describe, expect, it } from 'vitest'
import * as btc from '@scure/btc-signer'
import {
  MAINNET,
  deriveAddresses,
  mnemonicToSeed,
  parsePsbt,
  reviewTransaction,
  rootFromSeed,
  signTransaction,
} from '@nullroute/core'
import { buildOwnedIndex, thisDeviceProgress } from '../src/psbt.js'
import { fundedBy } from './fixtures/funding.js'

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const STRANGER = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'
const OPTIONS = { network: MAINNET, isChange: () => undefined }

function ours(count: number): { script: Uint8Array; path: string }[] {
  using seed = mnemonicToSeed(MNEMONIC, '')
  const root = rootFromSeed(seed, MAINNET)
  const addresses = deriveAddresses(root.derive("m/84'/0'/0'"), {
    scriptType: 'p2wpkh',
    network: MAINNET,
    change: false,
    start: 0,
    count,
  })
  root.wipePrivateData()
  return addresses.map((a) => ({
    script: btc.OutScript.encode(btc.Address(btc.NETWORK).decode(a.address)),
    path: `m/84'/0'/0'/${a.path}`,
  }))
}

function progressOf(tx: btc.Transaction) {
  using seed = mnemonicToSeed(MNEMONIC, '')
  const { index } = buildOwnedIndex(seed, MAINNET, { gapLimit: 5, registrations: [] })
  const review = reviewTransaction(tx, OPTIONS)
  const scripts = Array.from(
    { length: tx.inputsLength },
    (_, i) => tx.getInput(i).witnessUtxo?.script
  )
  return { review, device: thisDeviceProgress(scripts, index, seed, MAINNET, review.signatures) }
}

describe('daemon.psbt this device', () => {
  /**
   * INV-UI-35. Two inputs, both this device's. The totals read 0 of 2, so
   * "present + 1 >= required" said this was not the last signature. Signing
   * here completes both inputs.
   */
  it('completes-a-transaction-whose-every-input-it-signs', () => {
    const [a, b] = ours(2)
    const tx = new btc.Transaction()
    tx.addInput(fundedBy(a?.script ?? new Uint8Array(), 60_000n, 1))
    tx.addInput(fundedBy(b?.script ?? new Uint8Array(), 60_000n, 2))
    tx.addOutputAddress(STRANGER, 100_000n, btc.NETWORK)

    const { review, device } = progressOf(tx)
    expect(review.signatures.present + 1 >= (review.signatures.required ?? 0)).toBe(false)
    expect(device).toEqual({
      completesIfSigned: true,
      stillNeeded: 0,
      adds: 2,
      alreadySigned: false,
    })
  })

  /** INV-UI-35. Scanned back after signing: signing again adds nothing. */
  it('knows-it-has-already-signed-every-input-it-can', () => {
    const [a, b] = ours(2)
    const tx = new btc.Transaction()
    tx.addInput(fundedBy(a?.script ?? new Uint8Array(), 60_000n, 1))
    tx.addInput(fundedBy(b?.script ?? new Uint8Array(), 60_000n, 2))
    tx.addOutputAddress(STRANGER, 100_000n, btc.NETWORK)
    using seed = mnemonicToSeed(MNEMONIC, '')
    const signed = signTransaction(tx, seed, {
      network: MAINNET,
      paths: [a?.path ?? '', b?.path ?? ''],
      review: reviewTransaction(tx, OPTIONS),
    })

    const { device } = progressOf(parsePsbt(signed.psbt))
    expect(device.alreadySigned).toBe(true)
    expect(device.adds).toBe(0)
  })

  /**
   * INV-UI-35. An input this device does not own and whose requirement it
   * cannot read makes the answer unknown, not "last".
   */
  it('cannot-tell-when-an-input-it-cannot-read-is-there', () => {
    const [a] = ours(1)
    const tx = new btc.Transaction({ allowUnknownInputs: true })
    tx.addInput(fundedBy(a?.script ?? new Uint8Array(), 60_000n, 1))
    const opaque = btc.p2wsh(btc.p2pk(new Uint8Array(33).fill(2))).script
    tx.addInput(fundedBy(opaque, 60_000n, 3))
    tx.addOutputAddress(STRANGER, 100_000n, btc.NETWORK)

    const { device } = progressOf(tx)
    expect(device.completesIfSigned).toBeNull()
    expect(device.stillNeeded).toBeNull()
    expect(device.adds).toBe(1)
  })
})
