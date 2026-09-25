/**
 * The published BIP-143 worked examples, the segwit v0 sighash.
 *
 * BIP-143 prints its examples in the BIP text rather than shipping a file, so
 * spec/vectors/bip143-sighash.json is an extraction, pinned by hash in
 * sign.spec.yaml. Its source is the "Example" section of bip-0143.mediawiki at
 * bitcoin/bips d1d2042c857f337c147785c1d02cfd9f9d3c84fb, and it was produced by:
 *
 *   node tools/extract-bip143-vectors.mjs bip-0143.mediawiki <commit>
 *
 * which copies every value verbatim and states its reading rules. Running it on
 * that commit reproduces the file byte for byte. The first test here checks that
 * every published preimage hashes to its published sigHash, which is the check a
 * transcription error would fail.
 *
 * THREE LEVELS OF COVERAGE, AND THEY ARE NOT THE SAME CLAIM.
 *
 * Sighash, all 14 published: `Transaction.preimageWitnessV0`, the call
 * @scure/btc-signer's `Transaction.sign` makes for every segwit v0 input, which
 * is the call psbt/sign.ts makes. It is given the BIP's own scriptCode, so the
 * BIP's OP_CODESEPARATOR handling is checked as arithmetic on a script the
 * caller already cut, not as script execution. The library returns the hash
 * and never the preimage, so the preimage itself is checked only against the
 * BIP's own hash, above.
 *
 * Signature, 12 published with a private key: `secp256k1.sign` from
 * @noble/curves with `prehash: false`, the primitive the library's signECDSA
 * calls, compared DER byte for byte. That the BIP's signatures come out of it
 * unchanged is the evidence that they are RFC 6979 signatures. The two No
 * FindAndDelete examples publish no key (the BIP says the keys were recovered
 * from fixed signatures), so their three signatures are verified instead.
 *
 * Device path, 8 of the 14: the inputs nullroute can own, p2wpkh, sh(wpkh) and
 * sh(wsh(multi)), as a PSBT through parsePsbt and signed with
 * `Transaction.sign(key, allowed, AUX_RAND)`, the call in psbt/sign.ts. The
 * examples give raw keys rather than a seed, so the seed derivation in
 * signTransaction is not part of this. The native P2WSH scripts use
 * OP_CODESEPARATOR and the No FindAndDelete scripts contain no key; no
 * descriptor this device accepts produces either, so INV-PSBT-1 means the
 * device never signs them. Both keys of the first OP_CODESEPARATOR script are
 * still offered to the signing call, which must sign nothing: for the second
 * key it would otherwise commit to the whole script rather than the BIP's cut
 * scriptCode, and produce a signature that does not verify.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as btc from '@scure/btc-signer'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { parsePsbt } from '../src/psbt/parse.js'
import { SIGHASH_ALL, SIGHASH_DEFAULT } from '../src/psbt/review.js'
import { AUX_RAND } from '../src/psbt/sign.js'

interface Input {
  readonly description: string
  readonly scriptPubKey: string
  readonly value: string
  readonly redeemScript?: string
  readonly witnessScript?: string
  readonly privateKey?: string
  readonly publicKey?: string
}

interface Signing {
  readonly label: string
  readonly outpoint?: string
  readonly scriptCode?: string
  readonly amount?: string
  readonly nHashType?: string
  readonly preimage: string
  readonly sigHash: string
  readonly publicKey?: string
  readonly privateKey?: string
  readonly signature?: string
}

interface Example {
  readonly unsignedTx?: string
  readonly signedTx?: string
  readonly swappedTx?: string
  readonly inputs: readonly Input[]
  readonly signatures: readonly Signing[]
}

interface Vectors {
  readonly source: string
  readonly bipsCommit: string
  readonly sections: readonly { readonly name: string; readonly examples: readonly Example[] }[]
}

const VECTORS = JSON.parse(
  readFileSync(new URL('../../../spec/vectors/bip143-sighash.json', import.meta.url), 'utf8')
) as Vectors

/**
 * Published cases whose outcome here differs from what the BIP says, keyed by
 * sigHash, with the reason.
 *
 * EMPTY. If a library change makes a case fail, it goes here and is reported,
 * rather than the expected value being changed to match. The expected values
 * are the BIP's, not ours.
 */
const KNOWN_EXCEPTIONS: ReadonlyMap<string, string> = new Map<string, string>()

interface Case {
  readonly where: string
  readonly example: Example
  readonly signing: Signing
}

function section(name: string): readonly Example[] {
  const found = VECTORS.sections.find((s) => s.name === name)
  if (found === undefined) throw new Error(`no section ${name}`)
  return found.examples
}

const CASES: readonly Case[] = VECTORS.sections.flatMap((s) =>
  s.examples.flatMap((example, e) =>
    example.signatures.map((signing, i) => ({
      where: `${s.name}, example ${String(e + 1)}, ${signing.label} #${String(i + 1)}`,
      example,
      signing,
    }))
  )
)

function sha256d(bytes: Uint8Array): Uint8Array {
  return sha256(sha256(bytes))
}

/** Little-endian unsigned integer, as the BIP prints amount and nHashType. */
function readLE(hex: string): bigint {
  return BigInt(`0x${(hex.match(/../g) ?? []).reverse().join('') || '0'}`)
}

/** A BTC amount as printed ("9.87654321") in satoshis, without floating point. */
function sats(value: string): bigint {
  const [whole = '0', fraction = ''] = value.split('.')
  return BigInt(whole) * 100_000_000n + BigInt(fraction.padEnd(8, '0'))
}

/**
 * Strip the one-byte length the BIP prints in front of each scriptCode. The
 * library adds it back itself; every published scriptCode is under 0xfd bytes.
 */
function script(scriptCode: string): Uint8Array {
  const bytes = hexToBytes(scriptCode)
  expect(bytes[0], scriptCode).toBe(bytes.length - 1)
  return bytes.subarray(1)
}

/** The BIP prints one signature with a space before its hash type byte. */
function compact(hex: string): string {
  return hex.replace(/ /g, '')
}

function transaction(example: Example): btc.Transaction {
  const raw = example.unsignedTx ?? example.signedTx ?? ''
  // The No FindAndDelete outputs are empty scripts, which the library treats
  // as unknown; the check here is the sighash, not the outputs.
  return btc.Transaction.fromRaw(hexToBytes(raw), {
    allowUnknownOutputs: true,
    disableScriptCheck: true,
  })
}

function inputIndex(tx: btc.Transaction, outpoint: string): number {
  for (let i = 0; i < tx.inputsLength; i += 1) {
    const input = tx.getInput(i)
    // An outpoint prints as the txid in wire order, then the index as 4 bytes LE.
    const index = new Uint8Array(4)
    new DataView(index.buffer).setUint32(0, input.index ?? 0, true)
    const serialised =
      bytesToHex((input.txid ?? new Uint8Array()).slice().reverse()) + bytesToHex(index)
    if (serialised === outpoint) return i
  }
  throw new Error(`no input spends ${outpoint}`)
}

/**
 * What the sighash commits to for one case: input index, script, amount, type.
 *
 * Every case but one lists these beside its preimage. The last No FindAndDelete
 * case gives only a signed transaction, its preimage and its hash, so its
 * script is the witness script from that transaction and its amount and hash
 * type are read from the published preimage (the 8 bytes after the script, and
 * the last 4). For that one case the check covers the three hashes, the
 * outpoint, the sequence and the lock time, and not the amount or the type.
 */
function sighashInputs(c: Case): {
  readonly tx: btc.Transaction
  readonly index: number
  readonly scriptCode: Uint8Array
  readonly amount: bigint
  readonly hashType: number
} {
  const tx = transaction(c.example)
  const { outpoint, scriptCode, amount, nHashType } = c.signing
  if (outpoint !== undefined && scriptCode !== undefined && amount !== undefined) {
    return {
      tx,
      index: inputIndex(tx, outpoint),
      scriptCode: script(scriptCode),
      amount: readLE(amount),
      hashType: Number(readLE(nHashType ?? '')),
    }
  }
  expect(tx.inputsLength).toBe(1)
  const witness = tx.getInput(0).finalScriptWitness ?? []
  const witnessScript = witness[witness.length - 1] ?? new Uint8Array()
  const preimage = c.signing.preimage
  // version 4, hashPrevouts 32, hashSequence 32, outpoint 36, then the script.
  const scriptStart = (4 + 32 + 32 + 36) * 2
  const scriptHex = preimage.slice(scriptStart, scriptStart + 2 + witnessScript.length * 2)
  const scriptEnd = scriptStart + scriptHex.length
  return {
    tx,
    index: 0,
    scriptCode: witnessScript,
    amount: readLE(preimage.slice(scriptEnd, scriptEnd + 16)),
    hashType: Number(readLE(preimage.slice(-8))),
  }
}

/** The key that makes a case's signature: its own, else its input's. */
function keyFor(c: Case): { readonly privateKey?: string; readonly publicKey?: string } {
  if (c.signing.privateKey !== undefined) return c.signing
  if (c.signing.outpoint === undefined) return {}
  const input = c.example.inputs[inputIndex(transaction(c.example), c.signing.outpoint)]
  return input ?? {}
}

describe('core.psbt.sign published BIP-143 vectors', () => {
  it('reads-every-published-bip143-example', () => {
    expect(VECTORS.sections.map((s) => s.name)).toEqual([
      'Native P2WPKH',
      'P2SH-P2WPKH',
      'Native P2WSH',
      'P2SH-P2WSH',
      'No FindAndDelete',
    ])
    expect(VECTORS.sections.map((s) => s.examples.map((e) => e.signatures.length))).toEqual([
      [1],
      [1],
      [2, 2],
      [6],
      [1, 1],
    ])
    // The transcription check: each preimage is the BIP's, and so is each hash.
    for (const c of CASES) {
      expect(bytesToHex(sha256d(hexToBytes(c.signing.preimage))), c.where).toBe(c.signing.sigHash)
    }
  })

  /**
   * INV-SIG-9. The library's segwit v0 sighash on every published case: all
   * six hash types, out-of-range SINGLE, and both OP_CODESEPARATOR scripts.
   */
  it('computes-every-published-bip143-sighash', () => {
    let checked = 0
    for (const c of CASES) {
      if (KNOWN_EXCEPTIONS.has(c.signing.sigHash)) continue
      const { tx, index, scriptCode, amount, hashType } = sighashInputs(c)
      const digest = tx.preimageWitnessV0(index, scriptCode, hashType, amount)
      expect(bytesToHex(digest), c.where).toBe(c.signing.sigHash)
      checked += 1
    }
    expect(checked).toBe(14)
  })

  /**
   * INV-SIG-9. The BIP says SINGLE|ANYONECANPAY signatures survive swapping
   * the input and output pairs. The swapped transaction it publishes must give
   * each input the same hash as before, and each published signature must
   * still verify against it.
   */
  it('gives-the-same-hash-after-the-published-input-swap', () => {
    const [, example] = section('Native P2WSH')
    if (example?.swappedTx === undefined) throw new Error('no swapped transaction')
    const swapped = transaction({ ...example, unsignedTx: example.swappedTx })
    for (const signing of example.signatures) {
      const index = inputIndex(swapped, signing.outpoint ?? '')
      const digest = swapped.preimageWitnessV0(
        index,
        script(signing.scriptCode ?? ''),
        Number(readLE(signing.nHashType ?? '')),
        readLE(signing.amount ?? '')
      )
      expect(bytesToHex(digest), signing.sigHash).toBe(signing.sigHash)
      const der = hexToBytes(compact(signing.signature ?? '')).subarray(0, -1)
      expect(
        secp256k1.verify(der, digest, hexToBytes(signing.publicKey ?? ''), {
          prehash: false,
          format: 'der',
        })
      ).toBe(true)
    }
    // The swap really moved the inputs, or the check above proves nothing.
    expect(inputIndex(swapped, example.signatures[0]?.outpoint ?? '')).toBe(1)
  })

  /**
   * INV-SIG-9 and INV-SIG-1. The ECDSA primitive reproduces every published
   * signature that comes with its key, byte for byte, DER and hash type byte.
   * A signer using a random nonce would match none of them.
   */
  it('signs-every-published-bip143-signature-with-rfc6979', () => {
    let signed = 0
    for (const c of CASES) {
      const { privateKey, publicKey } = keyFor(c)
      if (privateKey === undefined) continue
      if (KNOWN_EXCEPTIONS.has(c.signing.sigHash)) continue
      const key = hexToBytes(privateKey)
      expect(bytesToHex(secp256k1.getPublicKey(key)), c.where).toBe(publicKey)
      const published = compact(c.signing.signature ?? '')
      const der = secp256k1.sign(hexToBytes(c.signing.sigHash), key, {
        prehash: false,
        format: 'der',
      })
      const hashType = published.slice(-2)
      expect(hashType, c.where).toBe((c.signing.nHashType ?? '').slice(0, 2))
      expect(bytesToHex(der) + hashType, c.where).toBe(published)
      signed += 1
    }
    expect(signed).toBe(12)
  })

  /**
   * INV-SIG-9. The No FindAndDelete examples publish signatures but no keys,
   * so they are verified. Two of the three have a high S value, which segwit
   * v0 consensus accepts and relay policy does not, so the check turns off
   * noble's low-S requirement; the device's own signatures are always low S.
   */
  it('verifies-the-published-signatures-that-come-without-a-key', () => {
    const [single, multi] = section('No FindAndDelete')
    const first = single?.signatures[0]
    if (first === undefined || multi?.signedTx === undefined) throw new Error('missing example')
    const verify = (signature: Uint8Array, hash: string, pubkey: Uint8Array): boolean =>
      secp256k1.verify(signature.subarray(0, -1), hexToBytes(hash), pubkey, {
        prehash: false,
        format: 'der',
        lowS: false,
      })
    expect(
      verify(
        hexToBytes(compact(first.signature ?? '')),
        first.sigHash,
        hexToBytes(first.publicKey ?? '')
      )
    ).toBe(true)

    // The CHECKMULTISIGVERIFY case: witness is an empty item, two signatures,
    // the key count, two keys, the script. Each signature pairs with the key in
    // the same position, as CHECKMULTISIG consumes them in order.
    const witness = transaction(multi).getInput(0).finalScriptWitness ?? []
    expect(witness).toHaveLength(7)
    const hash = multi.signatures[0]?.sigHash ?? ''
    for (const [s, k] of [
      [1, 4],
      [2, 5],
    ] as const) {
      const signature = witness[s] ?? new Uint8Array()
      expect(signature[signature.length - 1]).toBe(SIGHASH_ALL)
      expect(verify(signature, hash, witness[k] ?? new Uint8Array())).toBe(true)
    }
  })
})

describe('core.psbt.sign published BIP-143 vectors through the signing call', () => {
  /**
   * The example's unsigned transaction as a PSBT for one of its inputs, carried
   * through parsePsbt the way every PSBT reaches the signer. Segwit v0 commits
   * only to the amount of the input being signed, so only that input gets its
   * previous output.
   */
  function psbtFor(example: Example, index: number, hashType: number): btc.Transaction {
    const input = example.inputs[index]
    if (input === undefined) throw new Error(`no input ${String(index)}`)
    const tx = transaction(example)
    tx.updateInput(index, {
      witnessUtxo: { script: hexToBytes(input.scriptPubKey), amount: sats(input.value) },
      sighashType: hashType,
      ...(input.redeemScript === undefined ? {} : { redeemScript: hexToBytes(input.redeemScript) }),
      ...(input.witnessScript === undefined
        ? {}
        : { witnessScript: hexToBytes(input.witnessScript) }),
    })
    return parsePsbt(tx.toPSBT())
  }

  /**
   * The allowed list signTransaction passes: ALL and DEFAULT when the review
   * accepted the sighash, otherwise the one type the user overrode for.
   */
  function allowed(hashType: number): number[] {
    return hashType === SIGHASH_ALL ? [SIGHASH_ALL, SIGHASH_DEFAULT] : [hashType]
  }

  function signThrough(example: Example, signing: Signing, where: string): btc.Transaction {
    const tx0 = transaction(example)
    const index = inputIndex(tx0, signing.outpoint ?? '')
    const hashType = Number(readLE(signing.nHashType ?? ''))
    const { privateKey } =
      signing.privateKey === undefined ? (example.inputs[index] ?? {}) : signing
    const tx = psbtFor(example, index, hashType)
    expect(tx.sign(hexToBytes(privateKey ?? ''), allowed(hashType), AUX_RAND), where).toBe(1)
    const sigs = tx.getInput(index).partialSig ?? []
    expect(sigs, where).toHaveLength(1)
    expect(bytesToHex(sigs[0]?.[1] ?? new Uint8Array()), where).toBe(
      compact(signing.signature ?? '')
    )
    return tx
  }

  /**
   * INV-SIG-10. p2wpkh and sh(wpkh), SIGHASH_ALL. The p2sh-p2wpkh input is
   * then finalised and extracted, and must be the BIP's signed transaction.
   * The native example's other input is a legacy P2PK, not segwit v0, and is
   * not signed here, so that transaction is not reproduced whole.
   */
  it('signs-the-published-single-key-inputs-through-the-signing-call', () => {
    const [native] = section('Native P2WPKH')
    const [nested] = section('P2SH-P2WPKH')
    if (native === undefined || nested === undefined) throw new Error('missing example')
    for (const [example, name] of [
      [native, 'Native P2WPKH'],
      [nested, 'P2SH-P2WPKH'],
    ] as const) {
      const signing = example.signatures[0]
      if (signing === undefined) throw new Error(`no signature in ${name}`)
      const tx = signThrough(example, signing, name)
      if (example === nested) {
        tx.finalize()
        expect(bytesToHex(tx.extract())).toBe(nested.signedTx)
      }
    }
  })

  /**
   * INV-SIG-10. The sh(wsh(multi)) 6-of-6, one key per hash type: ALL, NONE,
   * SINGLE and the three ANYONECANPAY forms, each signed with the type the
   * user would have overridden for. A PSBT input carries one sighash type, so
   * each signature comes from its own PSBT.
   */
  it('signs-every-published-multisig-hash-type-through-the-signing-call', () => {
    const [example] = section('P2SH-P2WSH')
    if (example === undefined) throw new Error('missing example')
    const types = example.signatures.map((s) => Number(readLE(s.nHashType ?? '')))
    expect(types).toEqual([0x01, 0x02, 0x03, 0x81, 0x82, 0x83])
    for (const signing of example.signatures) {
      if (KNOWN_EXCEPTIONS.has(signing.sigHash)) continue
      signThrough(example, signing, signing.label)
    }
  })

  /**
   * INV-SIG-10. The first native P2WSH script executes an OP_CODESEPARATOR,
   * so its second signature commits to a cut scriptCode. The signing call has
   * no way to know where execution will be, and must sign neither key rather
   * than commit to the wrong script.
   */
  it('signs-nothing-for-the-published-codeseparator-script', () => {
    const [example] = section('Native P2WSH')
    if (example === undefined) throw new Error('missing example')
    for (const signing of example.signatures) {
      const tx = psbtFor(example, 1, Number(readLE(signing.nHashType ?? '')))
      expect(() => tx.sign(hexToBytes(signing.privateKey ?? ''), [0x03], AUX_RAND)).toThrow(
        /No inputs signed/
      )
      expect(tx.getInput(1).partialSig).toBeUndefined()
    }
  })
})
