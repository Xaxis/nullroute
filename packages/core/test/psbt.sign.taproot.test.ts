/**
 * Tests for signing a taproot key-path spend.
 *
 * WHY THIS FILE EXISTS. tools/recovery-drill.mjs carried a comment saying
 * taproot was absent because signing one "needs taproot PSBT fields the drill
 * does not build yet", the README listed a taproot recovery drill as one of two
 * things needed before the device is safe for funds, and the website repeated
 * the limit to visitors.
 *
 * None of it was true. The drill does not build the PSBT: Bitcoin Core does,
 * with `walletcreatefundedpsbt`, and Core populates the taproot fields when the
 * descriptor is `tr(...)`. The signing path passes AUX_RAND to a library that
 * handles taproot. Nobody had tried it.
 *
 * So this pins what turned out to already work, because "it works" that nothing
 * asserts is the same as "it works by accident until somebody changes it".
 *
 * THE ASSERTION THAT MATTERS is the last one: the signature verifies against
 * the TWEAKED key. A taproot key-path spend commits to the internal key plus a
 * taproot tweak, and a device that signed with the raw internal key would
 * produce a 64-byte signature of the correct shape that no node accepts. The
 * verification is done with @noble/curves directly rather than by asking the
 * library that produced the signature whether it likes its own work.
 */

import { describe, expect, it } from 'vitest'
import * as btc from '@scure/btc-signer'
import { hexToBytes } from '@noble/hashes/utils.js'
import { schnorr } from '@noble/curves/secp256k1.js'
import { MAINNET } from '../src/network/networks.js'
import { mnemonicToSeed } from '../src/bip39/mnemonic.js'
import { rootFromSeed } from '../src/derive/hd.js'
import { normalizePath } from '../src/derive/path.js'
import { reviewTransaction } from '../src/psbt/review.js'
import { signTransaction } from '../src/psbt/sign.js'
import { alreadySignedBy } from '../src/psbt/quorum.js'

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
/** BIP-86. A different branch from the single-signature segwit account. */
const PATH = "m/86'/0'/0'/0/0"
const STRANGER = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'
const AMOUNT = 100_000n

/** A key-path payment: what btc.p2tr returns when given no script tree. */
type KeyPath = ReturnType<typeof keyPath>
function keyPath(internal: Uint8Array) {
  return btc.p2tr(internal, undefined, btc.NETWORK)
}

/** The x-only internal key at PATH, and the payment it produces. */
function ourTaproot(): { internal: Uint8Array; payment: KeyPath } {
  using seed = mnemonicToSeed(MNEMONIC, '')
  const root = rootFromSeed(seed, MAINNET)
  const child = root.derive(normalizePath(PATH))
  if (child.publicKey === null) throw new Error('no public key')
  // x-only: the leading parity byte is dropped for taproot.
  const internal = child.publicKey.slice(1)
  root.wipePrivateData()
  return { internal, payment: keyPath(internal) }
}

function fundedTaproot(): { tx: btc.Transaction; payment: KeyPath } {
  const { internal, payment } = ourTaproot()
  const tx = new btc.Transaction()
  tx.addInput({
    txid: hexToBytes('a'.repeat(64)),
    index: 0,
    witnessUtxo: { script: payment.script, amount: AMOUNT },
    // What Core writes for a tr() descriptor, and the field that tells a
    // signer this is a key-path spend rather than a script one.
    tapInternalKey: internal,
  })
  tx.addOutputAddress(STRANGER, 90_000n, btc.NETWORK)
  return { tx, payment }
}

describe('core.psbt.sign taproot', () => {
  /**
   * INV-SIG-3. A taproot input is signed, and the sighash is SIGHASH_DEFAULT.
   *
   * Taproot encodes "commits to everything" as an omitted zero byte, while
   * every other script type encodes it as 1. A device that only accepted
   * SIGHASH_ALL would silently sign nothing here, which looks identical to a
   * transaction that was not ours.
   */
  it('signs-a-taproot-key-path-input', () => {
    using seed = mnemonicToSeed(MNEMONIC, '')
    const { tx } = fundedTaproot()

    const review = reviewTransaction(tx, { network: MAINNET, isChange: () => undefined })
    expect(review.sighash.name).toBe('SIGHASH_DEFAULT')
    expect(review.sighash.acceptable).toBe(true)

    const result = signTransaction(tx, seed, {
      network: MAINNET,
      paths: [PATH],
      review,
      overrideBlockingWarnings: true,
    })

    expect(result.inputsSigned).toBe(1)
    expect(result.signedWith).toEqual([PATH])
  })

  /**
   * INV-QUORUM-3. A device recognises a transaction it has already signed, and
   * that has to hold for the wallet type this device recommends.
   *
   * The signature says so: a taproot key-path spend carries `tapKeySig` and no
   * public key beside it, because the key IS the output. signaturesOn records
   * that as the opaque string "taproot-key-path" rather than naming a signer,
   * which is the right answer for attribution and the wrong one for this
   * question, because alreadySignedBy compares it against a set of hex public
   * keys it can never match.
   *
   * The test bound to INV-QUORUM-3 is a 2-of-3 witness script using partialSig,
   * so the invariant held for every wallet type except the BIP-86 one, and a
   * taproot user scanning a QR sequence back was told nothing every time.
   *
   * The input names the signer in `tapInternalKey`, which is the field the
   * signer itself read to produce the spend.
   */
  it('knows-it-has-already-signed-a-taproot-key-path-input', () => {
    using seed = mnemonicToSeed(MNEMONIC, '')
    const { tx } = fundedTaproot()
    const review = reviewTransaction(tx, { network: MAINNET, isChange: () => undefined })

    const first = signTransaction(tx, seed, {
      network: MAINNET,
      paths: [PATH],
      review,
      overrideBlockingWarnings: true,
    })
    expect(first.wasAlreadySigned).toBe(false)

    // The same transaction back again, which is what a scanned-back QR sequence
    // or a card read twice looks like.
    const returned = btc.Transaction.fromPSBT(first.psbt)
    const againReview = reviewTransaction(returned, {
      network: MAINNET,
      isChange: () => undefined,
    })
    const again = signTransaction(returned, seed, {
      network: MAINNET,
      paths: [PATH],
      review: againReview,
      overrideBlockingWarnings: true,
    })
    expect(again.wasAlreadySigned).toBe(true)

    // Somebody else's key has not signed it, so this is recognition rather than
    // a function that started answering yes to everything.
    const theirs = btc.Transaction.fromPSBT(first.psbt)
    const stranger = hexToBytes('02'.repeat(33))
    expect(alreadySignedBy(theirs, [stranger])).toBe(false)
    expect(alreadySignedBy(btc.Transaction.fromPSBT(first.psbt), [])).toBe(false)
  })

  /**
   * INV-SIG-3. THE ONE THAT MATTERS. The signature verifies against the
   * TWEAKED key, checked with @noble/curves rather than by asking the library
   * that produced it whether it approves of its own output.
   *
   * A taproot key-path spend commits to the internal key plus a taproot tweak.
   * Signing with the raw internal key produces a 64-byte signature of exactly
   * the right shape that no node on the network will accept, and nothing about
   * the PSBT would look wrong.
   */
  it('produces-a-signature-that-verifies-against-the-tweaked-key', () => {
    using seed = mnemonicToSeed(MNEMONIC, '')
    const { tx, payment } = fundedTaproot()
    const review = reviewTransaction(tx, { network: MAINNET, isChange: () => undefined })

    const result = signTransaction(tx, seed, {
      network: MAINNET,
      paths: [PATH],
      review,
      overrideBlockingWarnings: true,
    })

    // Reloaded from the serialised PSBT, which also proves the signature
    // survives the round trip a QR transfer puts it through.
    const reloaded = btc.Transaction.fromPSBT(result.psbt)
    reloaded.finalize()

    const witness = reloaded.getInput(0).finalScriptWitness
    expect(witness).toBeDefined()
    expect(witness).toHaveLength(1)
    const signature = witness?.[0]
    // 64 bytes, so SIGHASH_DEFAULT with no trailing sighash byte.
    expect(signature).toHaveLength(64)

    const sighash = reloaded.preimageWitnessV1(0, [payment.script], 0, [AMOUNT])
    expect(schnorr.verify(signature as Uint8Array, sighash, payment.tweakedPubkey)).toBe(true)

    // And NOT against the untweaked internal key, which is the mistake this
    // test exists to catch.
    const { internal } = ourTaproot()
    expect(schnorr.verify(signature as Uint8Array, sighash, internal)).toBe(false)
  })

  /**
   * INV-SIG-1, for taproot. BIP-340 with aux_rand fixed to 32 zero bytes, so
   * the same key and transaction always produce identical bytes.
   *
   * Schnorr signing is randomised by default, and a randomised signature has
   * room in it to leak the private key a few bits at a time with the user
   * unable to tell. This is the reason the whole determinism apparatus exists,
   * and taproot is where it would be easiest to lose.
   */
  it('signs-the-same-taproot-input-identically-every-time', () => {
    using seed = mnemonicToSeed(MNEMONIC, '')

    const signOnce = (): string => {
      const { tx } = fundedTaproot()
      const review = reviewTransaction(tx, { network: MAINNET, isChange: () => undefined })
      const result = signTransaction(tx, seed, {
        network: MAINNET,
        paths: [PATH],
        review,
        overrideBlockingWarnings: true,
      })
      const reloaded = btc.Transaction.fromPSBT(result.psbt)
      reloaded.finalize()
      return Buffer.from(reloaded.getInput(0).finalScriptWitness?.[0] ?? []).toString('hex')
    }

    const first = signOnce()
    expect(signOnce()).toBe(first)
    expect(signOnce()).toBe(first)
  })
})
