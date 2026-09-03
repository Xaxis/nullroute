/**
 * The older signmessage scheme, for legacy addresses.
 *
 * Spec: core.message.legacy
 *
 * WHY THIS IS SEPARATE, AND MUST STAY SEPARATE. It is not an older encoding of
 * a BIP-322 signature. It commits to entirely different bytes: a magic string
 * and the message, double-SHA256, with no transaction anywhere. A signature
 * under one scheme means nothing under the other, and the single most dangerous
 * thing this file could do is let a caller produce one while believing they
 * asked for the other. So it lives in its own module with its own names, and
 * the BIP-322 path refuses legacy by name rather than falling through to here.
 *
 * WHY IT EXISTS AT ALL. BIP-322 explicitly allows legacy addresses to keep
 * using this, and everything that verifies message signatures today accepts it,
 * including Bitcoin Core's `verifymessage`. A user proving control of an old
 * address to an exchange will be asked for this and nothing else. Refusing it
 * on principle would mean the device cannot do the thing, while the user does
 * it on a laptop with the key typed in, which is worse in every respect.
 *
 * THE SIGNATURE IS RECOVERABLE, which is the one structural difference that
 * matters. There is no public key in the output: the verifier recovers it from
 * the signature and checks it hashes to the address. That is why the header
 * byte encodes both the recovery id and whether the key was compressed, and why
 * getting the compression flag wrong produces a signature that recovers a
 * perfectly valid key for a completely different address.
 *
 * RFC 6979, like everywhere else. INV-SIG-1: a randomised signature has room in
 * it to leak the key, and a message signature is the easiest thing in the world
 * to ask somebody for repeatedly.
 */

import * as btc from '@scure/btc-signer'
import { sha256 } from '@noble/hashes/sha2.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { base64 } from '@scure/base'
import { utf8ToBytes } from '@noble/hashes/utils.js'
import { type Secret } from '../util/secret.js'
import { type Network } from '../network/networks.js'
import { toBtcNetwork } from '../address/address.js'
import { rootFromSeed } from '../derive/hd.js'
import { normalizePath } from '../derive/path.js'
import { MessageError, assertSignable } from './bip322.js'
import { type MessageVerification } from './verify.js'

/**
 * The prefix, exactly as every implementation writes it.
 *
 * The leading 0x18 is the length of the string that follows, written as a
 * compact size. It is part of the hashed bytes rather than framing around them,
 * which is why it appears here as data.
 */
const MAGIC = 'Bitcoin Signed Message:\n'

/** Compact size, for the two lengths this scheme hashes. */
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

/**
 * The digest this scheme signs.
 *
 * Exported because it is the one value a third party can recompute by hand to
 * check this implementation against the standard, the same reason
 * `messageHash` is exported from the BIP-322 side.
 */
export function legacyMessageHash(message: string): Uint8Array {
  const magic = utf8ToBytes(MAGIC)
  const body = utf8ToBytes(message)
  return sha256(sha256(concat([compactSize(magic.length), magic, compactSize(body.length), body])))
}

/**
 * The header byte, which carries the recovery id and the compression flag.
 *
 * 27 for an uncompressed key, 31 for a compressed one, plus the recovery id.
 * This device only ever produces compressed keys, so it only ever writes 31 to
 * 34, but verification accepts both because old signatures exist.
 */
const COMPRESSED_BASE = 31
const UNCOMPRESSED_BASE = 27

export interface LegacySignature {
  readonly address: string
  readonly message: string
  /** 65 raw bytes, base64 encoded. No witness framing: this is not BIP-322. */
  readonly signature: string
}

/** Sign with a raw private key, so published vectors can be checked as published. */
export function signLegacyMessageWithKey(
  privateKey: Uint8Array,
  network: Network,
  message: string
): LegacySignature {
  // The same gate the BIP-322 path uses. A message that cannot be displayed
  // honestly must not reach a signing path whichever scheme it is going to.
  assertSignable(message)

  const digest = legacyMessageHash(message)
  const recovered = secp256k1.sign(digest, privateKey, { prehash: false, format: 'recovered' })

  // noble writes the recovery id first, then r and s. This scheme writes a
  // single header byte carrying the recovery id plus the compression flag, then
  // r and s. Rewritten rather than passed through: the two layouts are the same
  // length and swapping them silently produces a signature that recovers the
  // wrong key.
  const recoveryId = recovered[0]
  if (recoveryId === undefined || recoveryId > 3) {
    throw new MessageError('Signing produced no usable recovery id.')
  }
  const signature = concat([Uint8Array.from([COMPRESSED_BASE + recoveryId]), recovered.subarray(1)])

  const pubkey = secp256k1.getPublicKey(privateKey, true)
  const { address } = btc.p2pkh(pubkey, toBtcNetwork(network))

  return { address, message, signature: base64.encode(signature) }
}

/** Sign with the key at a derivation path. */
export function signLegacyMessage(
  seed: Secret,
  network: Network,
  path: string,
  message: string
): LegacySignature & { readonly path: string } {
  const normalised = normalizePath(path)
  const child = rootFromSeed(seed, network).derive(normalised)
  if (child.privateKey === null) {
    throw new MessageError(`Deriving ${normalised} produced no private key.`)
  }
  return {
    ...signLegacyMessageWithKey(child.privateKey, network, message),
    path: normalised,
  }
}

/**
 * Verify a legacy signmessage signature.
 *
 * Fails closed on every path, and never throws, for the reason the BIP-322
 * verifier does not: the input is a file somebody else wrote, and a verifier
 * that crashes has given an answer other than "no".
 */
export function verifyLegacyMessage(
  address: string,
  message: string,
  signature: string,
  network: Network
): MessageVerification {
  let raw: Uint8Array
  try {
    raw = base64.decode(signature.trim())
  } catch {
    return { valid: false, scriptType: 'p2pkh', reason: 'That signature is not valid base64.' }
  }
  if (raw.length !== 65) {
    return {
      valid: false,
      scriptType: 'p2pkh',
      reason:
        'A signmessage signature is exactly 65 bytes: a header, then r and s. That one is ' +
        `${String(raw.length)}.`,
    }
  }

  const header = raw[0] ?? 0
  const compressed = header >= COMPRESSED_BASE
  const base = compressed ? COMPRESSED_BASE : UNCOMPRESSED_BASE
  const recoveryId = header - base
  if (recoveryId < 0 || recoveryId > 3) {
    return {
      valid: false,
      scriptType: 'p2pkh',
      reason: 'That signature has no usable recovery id in its header byte.',
    }
  }

  const digest = legacyMessageHash(message)
  let pubkey: Uint8Array
  try {
    pubkey = secp256k1.recoverPublicKey(
      concat([Uint8Array.from([recoveryId]), raw.subarray(1)]),
      digest,
      { prehash: false }
    )
  } catch {
    return {
      valid: false,
      scriptType: 'p2pkh',
      reason: 'No public key can be recovered from that signature.',
    }
  }

  // Recovery ALWAYS produces a key. That is the whole trap in this scheme: a
  // signature over any bytes recovers some valid key, so the signature being
  // "valid" means nothing on its own. What proves anything is that the
  // recovered key hashes to the address being claimed.
  const point = secp256k1.Point.fromBytes(pubkey)
  const encoded = point.toBytes(compressed)
  let derived: string | undefined
  try {
    derived = btc.p2pkh(encoded, toBtcNetwork(network)).address
  } catch {
    derived = undefined
  }

  if (derived === undefined) {
    return {
      valid: false,
      scriptType: 'p2pkh',
      reason: 'That signature recovers a key that produces no address on this network.',
    }
  }
  if (derived !== address.trim()) {
    return {
      valid: false,
      scriptType: 'p2pkh',
      reason:
        'That signature is by a key that does not produce this address, so it proves control ' +
        'of something else.',
    }
  }

  return { valid: true, scriptType: 'p2pkh' }
}
