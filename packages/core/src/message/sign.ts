/**
 * BIP-322: the `to_spend` transaction.
 *
 * Spec: core.message.bip322
 *
 * BIP-322 proves control of an address with a pair of transactions that are
 * never broadcast and could not be. `to_spend` has a single input whose previous
 * output is all zeroes at index 0xffffffff, which no real transaction can
 * reference, and its scriptSig commits to the message. It pays zero satoshis to
 * the address's own script. `to_sign` then spends that output, so authorising
 * it needs exactly the key that could spend the address.
 *
 * WHAT IS HERE. `to_spend`, whose txid matches the value the standard
 * publishes, and simple-variant signing for p2wpkh, p2sh-p2wpkh and p2tr, each
 * verified against a digest computed by a different library.
 *
 * TAPROOT IS A DIFFERENT SIGNATURE, not a different encoding of the same one.
 * BIP-341 sighash rather than BIP-143, Schnorr rather than ECDSA, the TWEAKED
 * key rather than the derived one, and a witness of one 64 byte element rather
 * than two. Every one of those is a place to be quietly wrong: a signature made
 * with the untweaked key is well formed, deterministic, and rejected by every
 * verifier, and nothing about it looks incorrect on this device.
 *
 * `aux_rand` is 32 zero bytes, as it is everywhere else here. See INV-SIG-2.
 *
 * WHAT IS NOT. The full variant, for scripts that cannot be expressed as a
 * witness, which is what a multisig quorum would need; and legacy p2pkh, which
 * BIP-322 allows to use the older signmessage scheme. Legacy lives in
 * packages/core/src/message/legacy.ts because it is a different construction
 * committing to different bytes, and mixing the two in one function is how a
 * caller ends up producing the wrong one. The full variant is refused by name,
 * because a proof a verifier rejects is worse than no proof at all.
 */

import * as btc from '@scure/btc-signer'
import { taprootTweakPrivKey } from '@scure/btc-signer/utils.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js'
import { base64 } from '@scure/base'
import { type Secret } from '../util/secret.js'
import { type Network } from '../network/networks.js'
import { type ScriptType, toBtcNetwork } from '../address/address.js'
import { rootFromSeed } from '../derive/hd.js'
import { normalizePath } from '../derive/path.js'
import { MessageError, assertSignable, messageHash } from './bip322.js'

/** A compact size integer, as Bitcoin serialises lengths. */
function compactSize(value: number): Uint8Array {
  if (value < 0xfd) return Uint8Array.from([value])
  if (value <= 0xffff) return Uint8Array.from([0xfd, value & 0xff, (value >> 8) & 0xff])
  return Uint8Array.from([
    0xfe,
    value & 0xff,
    (value >> 8) & 0xff,
    (value >> 16) & 0xff,
    (value >>> 24) & 0xff,
  ])
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function uint32LE(value: number): Uint8Array {
  return Uint8Array.from([
    value & 0xff,
    (value >> 8) & 0xff,
    (value >> 16) & 0xff,
    (value >>> 24) & 0xff,
  ])
}

/**
 * The `to_spend` transaction, byte for byte.
 *
 * Built by hand rather than through a transaction builder, because every field
 * is fixed by BIP-322 and a builder that normalised any of them (a version, a
 * sequence, an impossible outpoint) would produce a different txid and
 * therefore a proof nobody can verify. This is the one place where writing the
 * bytes out is clearer than describing them.
 */
export function buildToSpend(message: string, scriptPubKey: Uint8Array): Uint8Array {
  const commitment = messageHash(message)

  // OP_0 PUSH32 <message hash>. 34 bytes.
  const scriptSig = concat([Uint8Array.from([0x00, 0x20]), commitment])

  return concat([
    uint32LE(0), // version 0, not 1 or 2
    Uint8Array.from([0x01]), // one input
    new Uint8Array(32), // an outpoint no transaction can have
    uint32LE(0xffffffff),
    compactSize(scriptSig.length),
    scriptSig,
    uint32LE(0), // sequence 0
    Uint8Array.from([0x01]), // one output
    new Uint8Array(8), // zero satoshis
    compactSize(scriptPubKey.length),
    scriptPubKey,
    uint32LE(0), // locktime 0
  ])
}

/**
 * The txid of `to_spend`, in the order a transaction builder expects.
 *
 * A txid is hashed in one order and DISPLAYED in the other, and libraries
 * disagree about which their API takes. @scure/btc-signer takes the displayed
 * order and reverses on serialisation; bitcoinjs-lib takes the hashed order and
 * writes it as-is.
 *
 * Getting this wrong cost an entire implementation. The signatures came out
 * deterministic, correctly shaped and for the right address, and committed to
 * an outpoint that does not exist. Nothing about the output looked wrong. It
 * was caught by serialising the same transaction with both libraries and
 * diffing the bytes, which is the only reason this comment can be specific.
 */
export function toSpendTxidForBuilder(toSpend: Uint8Array): Uint8Array {
  return Uint8Array.from([...sha256(sha256(toSpend))].reverse())
}

/** Script types that carry a witness, and can therefore be signed simply. */
const WITNESS_TYPES: readonly ScriptType[] = ['p2wpkh', 'p2sh-p2wpkh', 'p2tr']

export interface MessageSignature {
  readonly address: string
  readonly message: string
  /** The witness stack, serialised and base64 encoded, as BIP-322 specifies. */
  readonly signature: string
  readonly scriptType: ScriptType
}

interface Payment {
  readonly address: string
  readonly script: Uint8Array
  /** The p2pkh script BIP-143 uses as the scriptCode for a key-hash spend. */
  readonly scriptCode: Uint8Array
  readonly keyHash: Uint8Array
}

/**
 * The payment for a public key, with everything signing needs.
 *
 * The same calls address.ts makes, so the address a signature claims and the
 * address the explorer shows cannot drift apart.
 */
function paymentFor(pubkey: Uint8Array, scriptType: ScriptType, network: Network): Payment {
  const net = toBtcNetwork(network)

  switch (scriptType) {
    case 'p2wpkh': {
      const p = btc.p2wpkh(pubkey, net)
      const keyHash = p.script.slice(2)
      return {
        address: p.address,
        script: p.script,
        // BIP-143 scriptCode for a key-hash spend is the implied p2pkh script,
        // NOT the witness program. This is the part everybody gets wrong once.
        scriptCode: btc.OutScript.encode({ type: 'pkh', hash: keyHash }),
        keyHash,
      }
    }
    case 'p2sh-p2wpkh': {
      const inner = btc.p2wpkh(pubkey, net)
      const p = btc.p2sh(inner, net)
      const keyHash = inner.script.slice(2)
      return {
        address: p.address,
        script: p.script,
        scriptCode: btc.OutScript.encode({ type: 'pkh', hash: keyHash }),
        keyHash,
      }
    }
    case 'p2tr': {
      // The x-only key, and the address commits to the TWEAKED version of it.
      // p2tr() does the tweak; the private side is tweaked separately below,
      // and the two have to agree or the signature is for a key nobody asked
      // about.
      const xonly = pubkey.length === 32 ? pubkey : pubkey.slice(1)
      const p = btc.p2tr(xonly, undefined, net)
      return {
        address: p.address,
        script: p.script,
        // Taproot has no scriptCode: BIP-341 commits to the whole previous
        // output rather than to a script fragment. Carried as the output script
        // so the shape of this record stays one thing, and never used for a
        // taproot signature.
        scriptCode: p.script,
        keyHash: p.script.slice(2),
      }
    }
    default:
      throw new MessageError(`${scriptType} cannot be signed by this path.`)
  }
}

/**
 * The taproot half of simple-variant signing.
 *
 * Split out rather than branched inline, because almost nothing is shared: a
 * different sighash, a different curve operation, a different key, and a
 * different witness shape. A single function with four `if taproot` branches
 * would be four places to get it subtly wrong instead of one place to read.
 *
 * SIGHASH_DEFAULT, which is 0x00 and is not SIGHASH_ALL. It covers the same
 * fields and produces a 64 byte signature with no trailing flag byte, which is
 * what BIP-341 asks for and what makes the witness one element shorter. A
 * signature carrying an explicit 0x01 is also valid BIP-322 and is accepted on
 * the verifying side, but this device produces the shorter one: there is
 * exactly one right answer and emitting it consistently is worth more than
 * matching whatever another wallet happened to do.
 */
function signTaproot(privateKey: Uint8Array, network: Network, message: string): MessageSignature {
  const xonly = schnorr.getPublicKey(privateKey)
  const payment = paymentFor(xonly, 'p2tr', network)

  const toSpend = buildToSpend(message, payment.script)
  const toSign = new btc.Transaction({ version: 0, allowUnknownOutputs: true })
  toSign.addInput({
    txid: toSpendTxidForBuilder(toSpend),
    index: 0,
    sequence: 0,
    witnessUtxo: { script: payment.script, amount: 0n },
  })
  toSign.addOutput({ script: Uint8Array.from([0x6a]), amount: 0n })

  // BIP-341 takes every previous output, not one script and one amount, because
  // it commits to all of them. There is one input here, so the arrays hold one.
  const digest = toSign.preimageWitnessV1(0, [payment.script], btc.SigHash.DEFAULT, [0n])

  // The KEY THE ADDRESS COMMITS TO, which is the internal key plus the taproot
  // tweak. Signing with the untweaked key produces a well formed, deterministic
  // signature that every verifier rejects, and nothing about it looks wrong
  // here. There is no script tree, so the tweak takes no merkle root.
  const tweaked = taprootTweakPrivKey(privateKey)

  // 32 zero bytes, not entropy. INV-SIG-2: BIP-340 permits randomising this and
  // a randomised signature has room in it to leak the key a few bits at a time.
  const signature = schnorr.sign(digest, tweaked, new Uint8Array(32))

  // One witness element of 64 bytes. No public key: a taproot spend does not
  // carry one, because the address IS the key.
  const encoded = concat([compactSize(1), compactSize(signature.length), signature])

  return {
    address: payment.address,
    message,
    signature: base64.encode(encoded),
    scriptType: 'p2tr',
  }
}

/**
 * Sign a message with a raw private key.
 *
 * Separate from the derivation so the BIP-322 vectors, published as a WIF
 * rather than a seed, can be checked in the shape they are published in.
 * Nothing on the IPC surface reaches this; `signMessage` does.
 *
 * THE SIGNATURE IS PRODUCED HERE rather than by handing the transaction to a
 * library to sign. The library's own signing entry point was tried and produced
 * a signature that verified against neither the digest it computes itself nor
 * the one bitcoinjs-lib computes for the same transaction, and rather than
 * ship something whose provenance could not be explained, the digest is taken
 * from the library and signed with @noble/curves directly. That is one fewer
 * black box on the path that produces proofs, which is the right direction for
 * this device regardless.
 */
export function signMessageWithKey(
  privateKey: Uint8Array,
  network: Network,
  scriptType: ScriptType,
  message: string
): MessageSignature {
  // Refused before anything is derived. A message that cannot be displayed
  // honestly must not reach a signing path, and throwing here rather than
  // returning a list is what stops a caller proceeding by omission.
  assertSignable(message)

  if (!WITNESS_TYPES.includes(scriptType)) {
    throw new MessageError(
      `This device signs BIP-322 messages for p2wpkh, p2sh-p2wpkh and p2tr addresses. ` +
        `${scriptType} is not one of them: a legacy address uses the older signmessage scheme, ` +
        `which is a different construction committing to different bytes, and is signed by ` +
        `signLegacyMessage instead.`
    )
  }

  if (scriptType === 'p2tr') return signTaproot(privateKey, network, message)

  const pubkey = secp256k1.getPublicKey(privateKey, true)
  const payment = paymentFor(pubkey, scriptType, network)

  const toSpend = buildToSpend(message, payment.script)

  // to_sign: spends to_spend's only output to an OP_RETURN, every field zeroed
  // exactly as the standard fixes it.
  const toSign = new btc.Transaction({
    version: 0,
    allowUnknownOutputs: true,
    allowLegacyWitnessUtxo: true,
  })
  toSign.addInput({
    txid: toSpendTxidForBuilder(toSpend),
    index: 0,
    sequence: 0,
    witnessUtxo: { script: payment.script, amount: 0n },
  })
  toSign.addOutput({ script: Uint8Array.from([0x6a]), amount: 0n })

  // The BIP-143 digest, from the library, and the signature over it, from
  // @noble/curves. RFC 6979, so the same key and message give the same bytes
  // every time: see INV-SIG-1.
  const digest = toSign.preimageWitnessV0(0, payment.scriptCode, btc.SigHash.ALL, 0n)
  // noble returns the compact form. Converted to DER here, which is what a
  // Bitcoin witness carries.
  const compact = secp256k1.sign(digest, privateKey)
  const der = secp256k1.Signature.fromBytes(compact, 'compact').toBytes('der')

  // Witness for a key-hash spend: the signature with its sighash byte, then the
  // public key. Assembled here rather than taken from the library, since the
  // library never signed.
  const withFlag = concat([der, Uint8Array.from([0x01])])
  const encoded = concat([
    compactSize(2),
    compactSize(withFlag.length),
    withFlag,
    compactSize(pubkey.length),
    pubkey,
  ])

  return { address: payment.address, message, signature: base64.encode(encoded), scriptType }
}

/**
 * Sign a message with the key at a derivation path.
 *
 * The address is returned with the signature because a BIP-322 signature is
 * meaningless without it: verification takes the address, the message and the
 * signature, and this device is the only thing that knows which address a path
 * produced.
 */
export function signMessage(
  seed: Secret,
  network: Network,
  scriptType: ScriptType,
  path: string,
  message: string
): MessageSignature & { readonly path: string } {
  const normalised = normalizePath(path)
  const child = rootFromSeed(seed, network).derive(normalised)
  if (child.privateKey === null) {
    throw new MessageError(`Deriving ${normalised} produced no private key.`)
  }
  return { ...signMessageWithKey(child.privateKey, network, scriptType, message), path: normalised }
}
