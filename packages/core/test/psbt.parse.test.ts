/**
 * Tests for core.psbt.parse.
 *
 * A PSBT is the largest piece of attacker-controlled input this device accepts,
 * and it arrives from the networked world. So these are mostly tests that
 * malformed input is REFUSED, rather than tests that good input works. A parser
 * that accepts something it does not understand is the bug worth catching here.
 */

import { describe, expect, it } from 'vitest'
import * as btc from '@scure/btc-signer'
import { hexToBytes } from '@noble/hashes/utils.js'
import { mnemonicToSeed } from '../src/bip39/mnemonic.js'
import { rootFromSeed } from '../src/derive/hd.js'
import { MAINNET, TESTNET3 } from '../src/network/networks.js'
import { deriveAddresses } from '../src/address/address.js'
import { PsbtError } from '../src/psbt/review.js'
import { addressFromScript, encodePsbt, parsePsbt } from '../src/psbt/parse.js'

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
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

/** A real, well-formed PSBT to decode. */
function samplePsbt(): { base64: string; script: Uint8Array } {
  using seed = mnemonicToSeed(MNEMONIC, '')
  const root = rootFromSeed(seed, MAINNET)
  const account = root.derive("m/84'/0'/0'")
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
  })
  tx.addOutputAddress(STRANGER, 90_000n, MAINNET)
  return { base64: encodePsbt(tx.toPSBT()), script }
}

describe('core.psbt.parse', () => {
  it('round-trips-a-psbt-through-base64', () => {
    const { base64 } = samplePsbt()
    const tx = parsePsbt(base64)
    expect(tx.inputsLength).toBe(1)
    expect(tx.outputsLength).toBe(1)
    // Re-encoding gives the same bytes back.
    expect(encodePsbt(tx.toPSBT())).toBe(base64)
  })

  it('accepts-raw-bytes-as-well-as-base64', () => {
    const { base64 } = samplePsbt()
    const fromText = parsePsbt(base64)
    const fromBytes = parsePsbt(fromText.toPSBT())
    expect(fromBytes.inputsLength).toBe(1)
  })

  // A QR decoder, a text field and a file all introduce whitespace. Refusing
  // for that reason would be obstructive rather than strict.
  it('tolerates-whitespace-and-newlines', () => {
    const { base64 } = samplePsbt()
    const wrapped = `${base64.slice(0, 20)}\n  ${base64.slice(20)}\n`
    expect(parsePsbt(wrapped).inputsLength).toBe(1)
  })

  // INV-PSBT-9: anything that is not a PSBT is refused with a message that says
  // what was wrong, rather than being interpreted generously.
  it('refuses-input-that-is-not-a-psbt', () => {
    expect(() => parsePsbt('')).toThrow(/No PSBT/)
    expect(() => parsePsbt('   \n  ')).toThrow(/No PSBT/)
    expect(() => parsePsbt('not base64 at all!!!')).toThrow(/valid base64/)
    // Valid base64, but a raw transaction rather than a PSBT.
    expect(() => parsePsbt('AQIDBAU=')).toThrow(/magic bytes/)
    // A descriptor, which is the other thing people paste into this field.
    expect(() => parsePsbt(btoa("wpkh([00000000/84'/0'/0']xpub.../0/*)"))).toThrow(/magic bytes/)
  })

  it('refuses-a-truncated-psbt', () => {
    const { base64 } = samplePsbt()
    const truncated = encodePsbt(parsePsbt(base64).toPSBT().slice(0, 12))
    expect(() => parsePsbt(truncated)).toThrow(PsbtError)
  })

  it('refuses-an-absurdly-large-input', () => {
    const huge = new Uint8Array(1_000_001)
    huge.set([0x70, 0x73, 0x62, 0x74, 0xff])
    expect(() => parsePsbt(huge)).toThrow(/larger than any real transaction/)
  })

  it('maps-a-script-back-to-its-address', () => {
    using seed = mnemonicToSeed(MNEMONIC, '')
    const root = rootFromSeed(seed, MAINNET)
    const account = root.derive("m/84'/0'/0'")

    for (const scriptType of ['p2pkh', 'p2sh-p2wpkh', 'p2wpkh', 'p2tr'] as const) {
      const [addr] = deriveAddresses(account, {
        scriptType,
        network: MAINNET,
        change: false,
        start: 0,
        count: 1,
      })
      if (addr === undefined) throw new Error('no address')
      const script = btc.OutScript.encode(
        btc.Address({
          bech32: MAINNET.bech32,
          pubKeyHash: MAINNET.pubKeyHash,
          scriptHash: MAINNET.scriptHash,
          wif: MAINNET.wif,
        }).decode(addr.address)
      )
      expect(addressFromScript(script, MAINNET), scriptType).toBe(addr.address)
    }
    root.wipePrivateData()
  })

  // The network matters: the same script encodes to a different address on
  // testnet, and a device that showed the mainnet form would be lying about
  // where the money is going.
  it('encodes-the-address-for-the-network-it-was-given', () => {
    const { script } = samplePsbt()
    const onMainnet = addressFromScript(script, MAINNET)
    const onTestnet = addressFromScript(script, TESTNET3)
    expect(onMainnet).toMatch(/^bc1/)
    expect(onTestnet).toMatch(/^tb1/)
    expect(onMainnet).not.toBe(onTestnet)
  })

  // Undefined is a normal answer. An exotic output must not make the rest of
  // the transaction unreviewable.
  it('returns-undefined-for-a-script-with-no-address', () => {
    // OP_RETURN with a short push: valid, standard, and has no address.
    const opReturn = Uint8Array.from([0x6a, 0x02, 0xde, 0xad])
    expect(addressFromScript(opReturn, MAINNET)).toBeUndefined()
    // Garbage that decodes to nothing at all.
    expect(addressFromScript(Uint8Array.from([0xff, 0xff, 0xff]), MAINNET)).toBeUndefined()
  })
})
