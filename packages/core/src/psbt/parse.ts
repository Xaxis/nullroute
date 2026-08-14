/**
 * PSBT decoding, and the script-to-address mapping the review depends on.
 *
 * Spec: core.psbt.parse
 *
 * This exists so that nothing outside `packages/core` needs to depend on a
 * Bitcoin library. The daemon reads a PSBT off a QR code or an SD card and has
 * to turn it into something reviewable, and if it imported the signer library
 * directly there would be two places in the tree that know how to interpret a
 * transaction. There is one.
 *
 * Decoding is deliberately unforgiving. A PSBT arrives from the networked world
 * across the air gap and is the single largest piece of attacker-controlled
 * input this device ever accepts, so anything not understood exactly is
 * refused rather than interpreted generously. A parser that guesses is a parser
 * that can be steered.
 */

import * as btc from '@scure/btc-signer'
import { base64 } from '@scure/base'
import { type Network } from '../network/networks.js'
import { PsbtError } from './review.js'

/** Loose upper bound. A real PSBT is kilobytes; this is a denial-of-service stop. */
const MAX_PSBT_BYTES = 1_000_000

/**
 * Decode a PSBT from base64 text or raw bytes.
 *
 * Accepts either because the two transports differ: a QR code carries base64
 * and an SD card carries a `.psbt` file, and the caller should not have to care
 * which one it got.
 */
export function parsePsbt(input: string | Uint8Array): btc.Transaction {
  let bytes: Uint8Array
  if (typeof input === 'string') {
    // Whitespace is stripped because a base64 blob that has been through a
    // text field, a QR decoder or a file will often carry newlines, and
    // rejecting it for that would be obstructive rather than strict.
    const cleaned = input.replace(/\s+/g, '')
    if (cleaned.length === 0) throw new PsbtError('No PSBT was supplied.')
    try {
      bytes = base64.decode(cleaned)
    } catch {
      throw new PsbtError(
        'That is not valid base64, so it cannot be a PSBT. Check that the whole string was copied.'
      )
    }
  } else {
    bytes = input
  }

  if (bytes.length > MAX_PSBT_BYTES) {
    throw new PsbtError(
      `That PSBT is ${String(bytes.length)} bytes, which is far larger than any real transaction. Refusing it.`
    )
  }

  // The magic prefix is checked here so the error says what is wrong. Without
  // it the library's own failure reads as a generic parse error, and the usual
  // cause is that someone pasted a raw transaction or a descriptor instead.
  const MAGIC = [0x70, 0x73, 0x62, 0x74, 0xff] // "psbt\xff"
  if (bytes.length < MAGIC.length || MAGIC.some((b, i) => bytes[i] !== b)) {
    throw new PsbtError(
      'That does not start with the PSBT magic bytes. It may be a raw transaction, ' +
        'a descriptor, or truncated.'
    )
  }

  try {
    return btc.Transaction.fromPSBT(bytes)
  } catch (err) {
    // Not swallowed: the library's message names the field it choked on, which
    // is the only useful thing to show someone holding a PSBT that will not load.
    throw new PsbtError(`That PSBT could not be decoded. ${(err as Error).message}`)
  }
}

/** Base64, the form a PSBT travels in. */
export function encodePsbt(bytes: Uint8Array): string {
  return base64.encode(bytes)
}

/**
 * The address a locking script pays to, or undefined when the script is not one
 * of the standard forms.
 *
 * Undefined is a normal answer, not a failure. A bare multisig or an OP_RETURN
 * has no address, and the review shows the script instead. Returning undefined
 * rather than throwing keeps an exotic output from making the whole transaction
 * unreviewable, which would be the wrong trade: the user still needs to see the
 * other outputs.
 */
export function addressFromScript(script: Uint8Array, network: Network): string | undefined {
  try {
    const decoded = btc.OutScript.decode(script)
    if (decoded.type === 'unknown') return undefined
    return btc
      .Address({
        bech32: network.bech32,
        pubKeyHash: network.pubKeyHash,
        scriptHash: network.scriptHash,
        wif: network.wif,
      })
      .encode(decoded)
  } catch {
    return undefined
  }
}
