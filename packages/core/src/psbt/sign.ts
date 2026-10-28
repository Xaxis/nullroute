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
import { bytesToHex } from '@noble/hashes/utils.js'
import { PsbtError, SIGHASH_ALL, SIGHASH_DEFAULT, type Review } from './review.js'
import { alreadySignedBy, signatureProgress, type SignatureProgress } from './quorum.js'

/** Zero, always. See the note above: this is what closes the covert channel. */
export const AUX_RAND = new Uint8Array(32)

/**
 * What may happen to a reviewed transaction: refused outright, signed, or held
 * until the user overrides it for one signature.
 */
export type SignVerdict = 'refuse' | 'allow' | 'block-until-override'

/**
 * The one place that decides it (INV-SIG-11).
 *
 * The rule used to be written out four times: here, in the daemon, in the
 * review screen's Sign button and in the conformance adapter, which said in a
 * comment that it mirrored the screen. Four copies of the rule that gates the
 * only irreversible act on the device is three chances for one of them to
 * drift, and the copy that drifts is the one nobody tests against the others.
 *
 * BOTH `signable` AND THE WARNINGS ARE READ, not one taken as standing for
 * the other. `signable` is defined in review.ts as "no blocking warning", but
 * the screen receives it as a boolean over JSON, where nothing enforces that
 * coupling, so a review that says signable while carrying a blocking warning
 * is held. Typed structurally for the same reason: the screen's view of a
 * review is not a `Review`, and it has to be able to ask. `signable` is
 * `unknown` because over JSON it is: only `true` allows, so a string "false"
 * cannot pass as truthy.
 */
export function signVerdict(
  review: {
    readonly signable: unknown
    readonly warnings: readonly { readonly blocking: boolean }[]
  },
  ownedInputs: number
): SignVerdict {
  // Written as "not more than zero" so a count that is not a number refuses.
  if (!(ownedInputs > 0)) return 'refuse'
  if (review.signable !== true || review.warnings.some((w) => w.blocking)) {
    return 'block-until-override'
  }
  return 'allow'
}

/** An input this device owns, and the derivation path of the key that owns it. */
export interface OwnedInput {
  readonly index: number
  readonly path: string
}

export interface SignOptions {
  readonly network: Network
  /**
   * The inputs to sign, each with its key's derivation path, and nothing else
   * is signed. INV-SIG-13.
   *
   * This was a list of paths, and each key was handed to the library's
   * whole-transaction sign, which signs EVERY input whose script contains the
   * key or its hash. An input locking this device's key under a script the
   * review did not count as the wallet's (the same key as p2pkh, inside a
   * stranger's multisig) was signed too, while the review showed it as
   * someone else's money. The review is what the user agreed to, so the
   * inputs it counted as owned are the only ones signed.
   */
  readonly inputs: readonly OwnedInput[]
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
  /**
   * How far along the signatures are AFTER this device signed.
   *
   * The fleet case. A 2-of-3 walked between three devices needs each one to
   * answer "does my signature finish this", and the answer decides whether the
   * user carries the PSBT to the next device or broadcasts it.
   */
  readonly signatures: SignatureProgress
  /**
   * True when this device's signature was already present before it signed.
   *
   * Happens whenever a QR sequence is scanned back or a card is read twice.
   * Signing again is harmless, because the result is byte-identical, but a
   * device that says nothing leaves the user unsure whether anything happened.
   */
  readonly wasAlreadySigned: boolean
  /**
   * The finalised transaction, present only when nothing else has to sign.
   *
   * A PSBT is what a coordinator wants and a raw transaction is what a node
   * wants, so both are returned rather than making the user find out which they
   * needed. Absent when the quorum is short: a half-signed transaction has no
   * broadcastable form, and producing one would be a lie about its state.
   */
  readonly finalised?: { readonly hex: string; readonly txid: string }
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
  const { network, inputs, review } = options

  // The review gate. A caller that wanted to sign without reviewing would have
  // to construct a Review saying it was fine, which is a conspicuous thing to
  // find in a diff.
  const verdict = signVerdict(review, inputs.length)
  if (verdict === 'refuse') {
    throw new PsbtError('No owned inputs were given, so there is nothing to sign.')
  }
  if (verdict === 'block-until-override' && options.overrideBlockingWarnings !== true) {
    const blocking = review.warnings.filter((w) => w.blocking).map((w) => w.message)
    throw new PsbtError(
      `Refusing to sign. ${blocking.join(' ')} ` +
        `If you genuinely intend this, it has to be requested explicitly for this one signature.`
    )
  }

  const root = rootFromSeed(seed, network)
  const signedWith: string[] = []
  let inputsSigned = 0

  // Recorded BEFORE signing. Afterwards the answer is always yes, so a device
  // that checked later could never tell the user their signature was already
  // there, which is the common case when a QR sequence is scanned back.
  // One key per path, each signing only the inputs paired with it.
  const byPath = new Map<string, number[]>()
  for (const { index, path } of inputs) {
    const canonical = normalizePath(path)
    byPath.set(canonical, [...(byPath.get(canonical) ?? []), index])
  }
  const ourKeys: Uint8Array[] = []
  for (const path of byPath.keys()) {
    const child = root.derive(path)
    if (child.publicKey !== null) ourKeys.push(child.publicKey)
  }
  const wasAlreadySigned = alreadySignedBy(tx, ourKeys)

  try {
    for (const [canonical, indexes] of byPath) {
      const child = root.derive(canonical)
      const privateKey = child.privateKey
      if (privateKey === null) {
        throw new PsbtError(`Derivation ${canonical} produced no private key.`)
      }

      // The allowed-sighash list is restricted to what the review accepted,
      // so what gets signed cannot differ from what was reviewed.
      //
      // Both SIGHASH_ALL and SIGHASH_DEFAULT are listed when the review passed,
      // because they are the same intent expressed differently: taproot encodes
      // "commits to everything" as 0 and omits the byte, while every other
      // script type encodes it as 1. Listing only one silently signs nothing
      // for the other half of the script types.
      const allowed = review.sighash.acceptable
        ? [SIGHASH_ALL, SIGHASH_DEFAULT]
        : [review.sighash.type]

      // ONE NAMED INPUT AT A TIME, and a failure is the caller's to see. The
      // library's whole-transaction sign also discards every per-input error,
      // so an owned input it could not sign was reported as nothing at all.
      for (const index of indexes) {
        if (index < 0 || index >= tx.inputsLength) {
          throw new PsbtError(`Input ${String(index)} does not exist in this transaction.`)
        }
        try {
          tx.signIdx(privateKey, index, allowed, AUX_RAND)
        } catch (err) {
          throw new PsbtError(
            `Input ${String(index)} could not be signed with ${canonical}, which usually means ` +
              `the transaction belongs to a different wallet. ${(err as Error).message}`
          )
        }
        inputsSigned += 1
      }
      signedWith.push(canonical)
    }
  } finally {
    // Best effort: the library holds key bytes in arrays this module does not
    // own. What limits a copy's life is no swap, scratch in RAM and the seed
    // disposed at lock (provisioning/HARDENING.md, INV-IDLE-2).
    root.wipePrivateData()
  }

  const signatures = signatureProgress(tx)

  return {
    psbt: tx.toPSBT(),
    inputsSigned,
    signedWith,
    signatures,
    wasAlreadySigned,
    // Finalised on a COPY. Finalising mutates, and the PSBT above has to remain
    // the un-finalised form a coordinator can still combine with; a device that
    // returned only a finalised transaction would have destroyed the artefact
    // every other wallet in the quorum expects.
    ...(signatures.complete ? finaliseCopy(tx) : {}),
  }
}

/**
 * Finalise a copy and describe it, or say nothing if finalising fails.
 *
 * Failure here is not an error the user can act on: the signatures are present
 * and the PSBT is valid, and the only consequence is that this device cannot
 * also hand over a broadcastable form. So the raw transaction is omitted rather
 * than the whole signing call failing at the last step, and the omission is
 * visible because `finalised` is simply absent.
 */
function finaliseCopy(
  tx: btc.Transaction
): { finalised: { hex: string; txid: string } } | Record<string, never> {
  try {
    const copy = btc.Transaction.fromPSBT(tx.toPSBT())
    copy.finalize()
    return { finalised: { hex: bytesToHex(copy.extract()), txid: copy.id } }
  } catch {
    return {}
  }
}
