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
 * WHAT IS HERE AND WHAT IS NOT. This builds `to_spend`, and its txid is checked
 * against the value the standard publishes. `to_sign` and the witness that
 * proves control are NOT here. An implementation existed, produced signatures
 * that looked right, and could not be shown to verify against a sighash
 * computed by another library. A message signature that only this device
 * accepts proves nothing to anybody, so it was removed rather than shipped
 * behind a flag. See the spec's security notes.
 */

import { messageHash } from './bip322.js'

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
