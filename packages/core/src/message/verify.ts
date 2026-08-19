/**
 * Checking somebody else's proof that they control an address.
 *
 * Spec: core.message.bip322
 *
 * WHY AN AIR-GAPPED SIGNER VERIFIES. The device could sign proofs and never
 * check one, and that is what it did. But the question "is this address really
 * theirs" arrives exactly where this device is useful and nothing else is: an
 * exchange or a counterparty hands over an address and a signature, and the
 * machine you would otherwise check it on is the networked one you do not trust
 * with the answer. Verification needs no key and no network, which makes it the
 * cheapest thing this device can offer and one of the more valuable.
 *
 * IT IS ALSO HOW YOU CHECK YOUR OWN WORK. A signature this device produced can
 * be pasted back in, and a proof only this software accepts is worth nothing to
 * whoever asked for it. That check is a differential test in CI and it should
 * be available to a user too.
 *
 * WHAT IT ANSWERS, precisely: whoever produced this signature held the key for
 * this address at some point, and agreed to exactly these bytes. It does not
 * say when, it does not say the address holds money, and it does not say the
 * person handing it to you is the person who made it. A valid signature is
 * evidence about a key, not about a human, and the screen says so.
 *
 * FAILS CLOSED, EVERYWHERE. Every path that cannot establish validity returns
 * invalid with a reason. There is no path that returns valid because something
 * was unrecognised, and nothing here throws on malformed input: a proof that
 * crashes the verifier is a proof that got a different answer than "no".
 */

import * as btc from '@scure/btc-signer'
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js'
import { base64 } from '@scure/base'
import { type Network } from '../network/networks.js'
import { toBtcNetwork } from '../address/address.js'
import { buildToSpend, toSpendTxidForBuilder } from './sign.js'
import { MAX_MESSAGE_LENGTH } from './bip322.js'

/** The most a signature may decode to. A witness for these types is under 200 bytes. */
const MAX_SIGNATURE_BYTES = 512

export interface MessageVerification {
  readonly valid: boolean
  /** What the address turned out to be, when it could be read. */
  readonly scriptType: 'p2wpkh' | 'p2sh-p2wpkh' | 'p2tr' | 'p2pkh' | 'unknown'
  /**
   * Why it is not valid, in the terms somebody can act on.
   *
   * Present whenever `valid` is false and absent when it is true, so a screen
   * cannot show a reason beside a pass and confuse which one it is reading.
   */
  readonly reason?: string
}

function fail(scriptType: MessageVerification['scriptType'], reason: string): MessageVerification {
  return { valid: false, scriptType, reason }
}

/**
 * Read a witness stack out of the serialised form BIP-322 base64-encodes.
 *
 * Hand-written because the input is hostile and the failure has to be a return
 * rather than a throw. Length prefixes are compact size, and a prefix claiming
 * more bytes than remain is the obvious way to attack a parser that trusts it.
 */
function decodeWitness(bytes: Uint8Array): readonly Uint8Array[] | null {
  let offset = 0

  const readCompact = (): number | null => {
    const first = bytes[offset]
    if (first === undefined) return null
    offset += 1
    if (first < 0xfd) return first
    // Longer forms are legal compact size and cannot occur in a witness this
    // device accepts, since MAX_SIGNATURE_BYTES is far below 0xfd of anything.
    // Refused rather than parsed, because the shorter path is the whole input.
    return null
  }

  const count = readCompact()
  if (count === null || count === 0 || count > 4) return null

  const stack: Uint8Array[] = []
  for (let index = 0; index < count; index += 1) {
    const length = readCompact()
    if (length === null) return null
    if (offset + length > bytes.length) return null
    stack.push(bytes.subarray(offset, offset + length))
    offset += length
  }

  // Trailing bytes mean the encoding says one thing and the buffer says
  // another. Two readers could disagree about what was signed, so it is not a
  // valid proof even if the part that parsed checks out.
  if (offset !== bytes.length) return null
  return stack
}

/** The script an address pays to, or null when it cannot be read. */
function scriptFor(address: string, network: Network): Uint8Array | null {
  try {
    return btc.OutScript.encode(btc.Address(toBtcNetwork(network)).decode(address))
  } catch {
    return null
  }
}

/**
 * The BIP-322 `to_sign` transaction for an address and a message.
 *
 * Identical to the one the signing path builds, and deliberately built here
 * from the address rather than shared with it: a verifier that reused the
 * signer's object would agree with the signer by construction, which is not
 * verification.
 */
function toSignFor(message: string, script: Uint8Array): btc.Transaction {
  const toSpend = buildToSpend(message, script)
  const toSign = new btc.Transaction({
    version: 0,
    allowUnknownOutputs: true,
    allowLegacyWitnessUtxo: true,
  })
  toSign.addInput({
    txid: toSpendTxidForBuilder(toSpend),
    index: 0,
    sequence: 0,
    witnessUtxo: { script, amount: 0n },
  })
  toSign.addOutput({ script: Uint8Array.from([0x6a]), amount: 0n })
  return toSign
}

/**
 * Verify a BIP-322 simple-variant signature.
 *
 * Takes exactly what a verifier is given in the real world: an address, the
 * message, and the base64 signature. Nothing else, and in particular no public
 * key, because recovering which key it must have been is the point.
 */
export function verifyMessage(
  address: string,
  message: string,
  signature: string,
  network: Network
): MessageVerification {
  if (message.length > MAX_MESSAGE_LENGTH) {
    return fail(
      'unknown',
      `That message is ${String(message.length)} characters and this device reads up to ` +
        `${String(MAX_MESSAGE_LENGTH)}. A message nobody read to the end is a message nobody ` +
        `can check.`
    )
  }

  const script = scriptFor(address, network)
  if (script === null) {
    return fail(
      'unknown',
      'That is not an address on this network. Check you are not comparing a mainnet address ' +
        'against a testnet wallet, which is the usual cause.'
    )
  }

  let raw: Uint8Array
  try {
    raw = base64.decode(signature.trim())
  } catch {
    return fail('unknown', 'That signature is not valid base64.')
  }
  if (raw.length > MAX_SIGNATURE_BYTES) {
    return fail('unknown', 'That signature is far larger than any BIP-322 witness.')
  }

  // A legacy signmessage signature is 65 raw bytes with no witness framing. Named
  // rather than parsed as a broken witness, because "wrong scheme" is something
  // a user can act on and "malformed" is not.
  const decoded = btc.OutScript.decode(script)
  if (decoded.type === 'pkh') {
    return fail(
      'p2pkh',
      'That is a legacy address. Legacy addresses use the older signmessage scheme rather than ' +
        'BIP-322, which commits to different bytes, and this device checks those separately.'
    )
  }

  const stack = decodeWitness(raw)
  if (stack === null) {
    return fail(
      'unknown',
      'That signature is not a witness stack this device can read. A full-variant BIP-322 proof, ' +
        'which is what a multisig quorum produces, is not the simple variant and is not supported.'
    )
  }

  if (decoded.type === 'tr') {
    return verifyTaproot(stack, message, script)
  }
  if (decoded.type === 'wpkh') {
    return verifyKeyHash(stack, message, script, script.slice(2), 'p2wpkh', network)
  }
  if (decoded.type === 'sh') {
    return verifyWrapped(stack, message, script, network)
  }

  return fail(
    'unknown',
    'This device checks proofs for p2wpkh, p2sh-p2wpkh and taproot addresses. That address is ' +
      'none of them.'
  )
}

/**
 * Taproot: one 64 byte signature, checked against the key in the address.
 *
 * 65 bytes is also legal, and means an explicit sighash flag. SIGHASH_ALL is
 * accepted because other wallets emit it; anything else is refused, because a
 * flag like SINGLE or NONE covers less of the transaction than the verifier
 * assumes and a proof under one is not a proof of the same thing.
 */
function verifyTaproot(
  stack: readonly Uint8Array[],
  message: string,
  script: Uint8Array
): MessageVerification {
  if (stack.length !== 1) {
    return fail(
      'p2tr',
      'That is not a taproot key-path proof. A script-path spend proves control of one branch ' +
        'rather than of the address, and is not what BIP-322 simple asks for.'
    )
  }
  const element = stack[0]
  if (element === undefined || (element.length !== 64 && element.length !== 65)) {
    return fail('p2tr', 'A taproot signature is 64 bytes, or 65 with an explicit sighash flag.')
  }

  let hashType: number = btc.SigHash.DEFAULT
  let signature = element
  if (element.length === 65) {
    hashType = element[64] ?? 0
    signature = element.subarray(0, 64)
    if (hashType !== btc.SigHash.ALL) {
      return fail(
        'p2tr',
        'That signature uses a sighash flag that covers less than the whole transaction, so it ' +
          'does not prove agreement to this message.'
      )
    }
  }

  const digest = toSignFor(message, script).preimageWitnessV1(0, [script], hashType, [0n])
  // The key in the address is the TWEAKED one. Nothing here has the internal
  // key and nothing needs it: the address is what is being proved.
  const valid = schnorr.verify(signature, digest, script.slice(2))
  return valid
    ? { valid: true, scriptType: 'p2tr' }
    : fail('p2tr', 'That signature does not match this address and this message.')
}

/** Wrapped segwit: the address is a script hash, so the inner script is checked first. */
function verifyWrapped(
  stack: readonly Uint8Array[],
  message: string,
  script: Uint8Array,
  network: Network
): MessageVerification {
  const pubkey = stack[1]
  if (pubkey === undefined) {
    return fail('p2sh-p2wpkh', 'That witness carries no public key.')
  }

  // Rebuilt from the key in the witness and compared to the address. Without
  // this, any key could sign for any p2sh address: the script hash is the only
  // thing binding the two, and checking the signature alone would not test it.
  let inner: { script: Uint8Array; address?: string }
  try {
    inner = btc.p2sh(btc.p2wpkh(pubkey, toBtcNetwork(network)), toBtcNetwork(network))
  } catch {
    return fail('p2sh-p2wpkh', 'The public key in that witness is not a valid point.')
  }
  if (
    inner.script.length !== script.length ||
    !inner.script.every((byte, index) => byte === script[index])
  ) {
    return fail(
      'p2sh-p2wpkh',
      'That signature is by a key that does not produce this address, so it proves control of ' +
        'something else.'
    )
  }

  return verifyKeyHash(stack, message, script, btc.p2wpkh(pubkey).script.slice(2), 'p2sh-p2wpkh', network)
}

/**
 * The ECDSA half: a DER signature with its sighash byte, then a public key.
 *
 * The key is checked against the address's key hash BEFORE the signature is
 * checked. A valid signature by the wrong key is the failure that matters here,
 * and it is the one that looks most like a pass.
 */
function verifyKeyHash(
  stack: readonly Uint8Array[],
  message: string,
  script: Uint8Array,
  keyHash: Uint8Array,
  scriptType: 'p2wpkh' | 'p2sh-p2wpkh',
  network: Network
): MessageVerification {
  void network
  if (stack.length !== 2) {
    return fail(scriptType, 'A key-hash witness is a signature and a public key, and that is not.')
  }
  const [withFlag, pubkey] = stack
  if (withFlag === undefined || pubkey === undefined || withFlag.length < 2) {
    return fail(scriptType, 'That witness is missing the signature or the public key.')
  }

  const flag = withFlag[withFlag.length - 1]
  if (flag !== btc.SigHash.ALL) {
    return fail(
      scriptType,
      'That signature uses a sighash flag that covers less than the whole transaction, so it ' +
        'does not prove agreement to this message.'
    )
  }

  // The key has to be the one the address commits to. Checked first, because a
  // signature that verifies against the wrong key is the failure that looks
  // most like a pass.
  let hashed: Uint8Array
  try {
    hashed = btc.p2wpkh(pubkey).script.slice(2)
  } catch {
    return fail(scriptType, 'The public key in that witness is not a valid point.')
  }
  if (hashed.length !== keyHash.length || !hashed.every((byte, index) => byte === keyHash[index])) {
    return fail(
      scriptType,
      'That signature is by a key that does not produce this address, so it proves control of ' +
        'something else.'
    )
  }

  const scriptCode = btc.OutScript.encode({ type: 'pkh', hash: keyHash })
  const digest = toSignFor(message, script).preimageWitnessV0(0, scriptCode, btc.SigHash.ALL, 0n)

  let compact: Uint8Array
  try {
    compact = secp256k1.Signature.fromBytes(withFlag.subarray(0, withFlag.length - 1), 'der').toBytes(
      'compact'
    )
  } catch {
    return fail(scriptType, 'That signature is not valid DER.')
  }

  return secp256k1.verify(compact, digest, pubkey)
    ? { valid: true, scriptType }
    : fail(scriptType, 'That signature does not match this address and this message.')
}
