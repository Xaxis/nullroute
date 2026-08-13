/**
 * PSBT signing.
 *
 * Spec: core.psbt.sign
 *
 * Signing is the one operation on this device that cannot be undone, so the
 * function that performs it takes the review as an argument and refuses to
 * proceed if the review said no. That is not belt and braces: a caller that
 * could sign without reviewing would make every guarantee in review.ts
 * advisory.
 *
 * DETERMINISM IS THE SECURITY PROPERTY HERE, not a nice-to-have.
 *
 * A signing device that produces randomised signatures can leak your private
 * key through nothing but valid transactions. Grind the nonce until chosen bits
 * of the signature encode part of the key, publish, repeat, and an observer who
 * knows the scheme reads the key off the blockchain over a few dozen spends.
 * Every signature verifies. Nothing on the device looks wrong.
 *
 * The defence is that there is no free space in the signature to hide anything
 * in. ECDSA nonces come from RFC 6979, and Schnorr signing uses BIP-340 with
 * `aux_rand` fixed to 32 zero bytes. Given the same key and the same
 * transaction, the bytes are always identical, and anyone holding the seed can
 * recompute them and check.
 *
 * Fixing `aux_rand` to zero is a real trade rather than a free win. BIP-340
 * permits a randomised value, which defends against certain fault injection
 * attacks. For a device whose premise is that a user can audit it,
 * verifiability is worth more, and that judgement is stated here rather than
 * buried.
 */

import * as btc from '@scure/btc-signer'
import { type Secret } from '../util/secret.js'
import { type Network } from '../network/networks.js'
import { rootFromSeed } from '../derive/hd.js'
import { normalizePath } from '../derive/path.js'
import { PsbtError, SIGHASH_ALL, SIGHASH_DEFAULT, type Review } from './review.js'

/** Zero, always. See the note above: this is what closes the covert channel. */
export const AUX_RAND = new Uint8Array(32)

export interface SignOptions {
  readonly network: Network
  /** Derivation paths to sign with, one per input that this device owns. */
  readonly paths: readonly string[]
  /**
   * The review of this exact transaction. Signing refuses unless it says the
   * transaction is signable, so a caller cannot skip the checks by not asking.
   */
  readonly review: Review
  /**
   * Sign despite a blocking warning. Applies to ONE call, is never persisted,
   * and exists because a knowledgeable user occasionally has a real reason.
   * Everything about it is deliberately awkward.
   */
  readonly overrideBlockingWarnings?: boolean
}

export interface SignResult {
  /** The signed PSBT, ready to move back across the air gap. */
  readonly psbt: Uint8Array
  readonly inputsSigned: number
  /** Paths that actually produced a signature. */
  readonly signedWith: readonly string[]
}

/**
 * Sign a transaction.
 *
 * The transaction is mutated in place by the library, so the caller should pass
 * one it is willing to have signed. The seed is borrowed, not owned: the caller
 * disposes it.
 */
export function signTransaction(
  tx: btc.Transaction,
  seed: Secret,
  options: SignOptions
): SignResult {
  const { network, paths, review } = options

  // The review gate. A caller that wanted to sign without reviewing would have
  // to construct a Review saying it was fine, which is a conspicuous thing to
  // find in a diff.
  if (!review.signable && options.overrideBlockingWarnings !== true) {
    const blocking = review.warnings.filter((w) => w.blocking).map((w) => w.message)
    throw new PsbtError(
      `Refusing to sign. ${blocking.join(' ')} ` +
        `If you genuinely intend this, it has to be requested explicitly for this one signature.`
    )
  }

  if (paths.length === 0) {
    throw new PsbtError('No derivation paths were given, so there is nothing to sign with.')
  }

  const root = rootFromSeed(seed, network)
  const signedWith: string[] = []
  let inputsSigned = 0

  try {
    for (const path of paths) {
      const canonical = normalizePath(path)
      const child = root.derive(canonical)
      const privateKey = child.privateKey
      if (privateKey === null) {
        throw new PsbtError(`Derivation ${canonical} produced no private key.`)
      }

      // The library matches the key against each input's script itself and
      // signs only what it can. The allowed-sighash list is restricted to what
      // the review accepted, so what gets signed cannot differ from what was
      // reviewed.
      //
      // Both SIGHASH_ALL and SIGHASH_DEFAULT are listed when the review passed,
      // because they are the same intent expressed differently: taproot encodes
      // "commits to everything" as 0 and omits the byte, while every other
      // script type encodes it as 1. Listing only one silently signs nothing
      // for the other half of the script types.
      const allowed = review.sighash.acceptable
        ? [SIGHASH_ALL, SIGHASH_DEFAULT]
        : [review.sighash.type]

      const before = countSignatures(tx)
      let signed = 0
      try {
        signed = tx.sign(privateKey, allowed, AUX_RAND)
      } catch (err) {
        // The library throws when a key matches nothing. That is not an error
        // per path: this device may hold one of several keys in a quorum, so a
        // path that signs nothing is normal and the aggregate is what matters.
        if (!/No inputs signed/i.test((err as Error).message)) throw err
      }
      if (signed > 0 || countSignatures(tx) > before) {
        signedWith.push(canonical)
        inputsSigned += signed
      }
    }
  } finally {
    // Best effort: the library holds key bytes in arrays this module does not
    // own. The real mitigations are no swap and a short-lived process. See
    // docs/PROVISIONING.md.
    root.wipePrivateData()
  }

  if (inputsSigned === 0) {
    throw new PsbtError(
      'None of the given derivation paths matched an input of this transaction. ' +
        'Nothing was signed. This usually means the transaction belongs to a different wallet.'
    )
  }

  return { psbt: tx.toPSBT(), inputsSigned, signedWith }
}

/** How many partial signatures the transaction currently carries. */
function countSignatures(tx: btc.Transaction): number {
  let total = 0
  for (let i = 0; i < tx.inputsLength; i += 1) {
    const input = tx.getInput(i)
    const partial: unknown = input.partialSig
    if (Array.isArray(partial)) total += partial.length
    const schnorr: unknown = input.tapKeySig
    if (schnorr !== undefined && schnorr !== null) total += 1
  }
  return total
}
