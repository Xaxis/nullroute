/**
 * BIP-322: proving you control an address, by signing a message with it.
 *
 * Spec: core.message.bip322
 *
 * The construction is a pair of transactions that are never broadcast. `to_spend`
 * pays zero satoshis to the address's own script, from an input that cannot
 * exist, committing to the message. `to_sign` spends that output. Signing
 * `to_sign` therefore requires the key behind the address, and verifying it
 * requires nothing but the address and the message.
 *
 * WHY IT IS SHAPED LIKE A TRANSACTION. Because every script type already has
 * exactly one right answer for "how is a spend of this authorised", and it has
 * been reviewed for a decade. A message signing scheme that invented its own
 * rules would need a new answer per script type, and would get taproot wrong.
 *
 * THE DANGER, AND IT IS NOT THEORETICAL. A signature is a proof that whoever
 * holds the key agreed to a specific string. If a user can be induced to sign a
 * string chosen by somebody else, and that string means something elsewhere,
 * they have authorised it. This device therefore treats a message as untrusted
 * text to be READ, bounds it, refuses anything that can render differently from
 * what it contains, and never signs one the user has not seen in full. The
 * review screen for a message exists for the same reason the one for a
 * transaction does.
 *
 * DETERMINISM IS NOT OPTIONAL HERE EITHER. The same key and the same message
 * produce byte-identical output, for the reason INV-SIG-1 exists: a randomised
 * signature has room in it to leak the key a few bits at a time, and a message
 * signature is the easiest thing in the world to ask somebody for repeatedly.
 */

import { sha256 } from '@noble/hashes/sha2.js'
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { hasForgeable } from '../labels/forgeable.js'

export class MessageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MessageError'
  }
}

/**
 * The longest message this device will sign.
 *
 * Not a protocol limit. It is a reading limit: a message nobody scrolled to the
 * end of is a message nobody agreed to, and a 7 inch panel does not show more
 * than this without becoming a scroll nobody finishes.
 */
export const MAX_MESSAGE_LENGTH = 1024

/**
 * The prefix a BIP-322 simple signature carries.
 *
 * Added by BIP-322 1.0.0 (2026-04-15) as a breaking change: "Signers MUST
 * prefix the signature with the variant that was used to create the
 * signature." Before it this device wrote bare base64, which matched the
 * earlier vectors and not the finished BIP. Verifiers may still accept a
 * signature with no prefix as simple, for backward compatibility.
 */
export const SIMPLE_PREFIX = 'smp'

/**
 * The BIP-340 style tagged hash BIP-322 uses to commit to a message.
 *
 * SHA256(SHA256(tag) || SHA256(tag) || message). The doubled tag hash is what
 * makes a commitment under one tag unusable under another, so a BIP-322 message
 * hash can never be mistaken for a transaction sighash. Getting this wrong in
 * the direction of using a bare SHA256 would mean a signature over a message
 * could be replayed as a signature over something else entirely.
 */
export function taggedHash(tag: string, message: Uint8Array): Uint8Array {
  const tagHash = sha256(utf8ToBytes(tag))
  return sha256(concatBytes(tagHash, tagHash, message))
}

/** The tag BIP-322 specifies. Written out because it is what a reviewer checks. */
const TAG = 'BIP0322-signed-message'

/**
 * The message hash BIP-322 commits to.
 *
 * Exported because it is the value a third party recomputes to verify without
 * this code, and because it is the one number in the scheme that can be checked
 * by hand against the standard.
 */
export function messageHash(message: string): Uint8Array {
  return taggedHash(TAG, utf8ToBytes(message))
}

export interface MessageReview {
  readonly message: string
  /** The exact bytes that will be committed to, as hex, for comparison. */
  readonly hashHex: string
  readonly characters: number
  readonly bytes: number
  /**
   * Why this message must not be signed. Empty when it is safe to show.
   *
   * Blocking rather than advisory: every one of these means the screen cannot
   * be trusted to show what the signature would cover.
   */
  readonly refusals: readonly string[]
  /** Things worth saying that do not stop the user. */
  readonly warnings: readonly string[]
}

/**
 * Read a message before signing it, the way a PSBT is read before signing it.
 *
 * Returns what will be committed to and what is wrong with it. Nothing here
 * signs, and nothing here decides: a caller shows this to a human and the human
 * decides, which is the only part of the process that is not arithmetic.
 */
export function reviewMessage(message: string): MessageReview {
  const refusals: string[] = []
  const warnings: string[] = []

  const bytes = utf8ToBytes(message)

  if (message.length === 0) {
    refusals.push('There is no message. An empty signature proves nothing and commits to nothing.')
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    refusals.push(
      `That message is ${String(message.length)} characters and this device signs up to ` +
        `${String(MAX_MESSAGE_LENGTH)}. A message nobody read to the end is a message nobody ` +
        `agreed to.`
    )
  }
  if (hasForgeable(message, { allowLineBreaks: true })) {
    refusals.push(
      'That message contains characters that can make it display differently from what would ' +
        'be signed. The signature commits to the bytes, not to what the screen shows, so this ' +
        'is refused rather than cleaned up.'
    )
  }

  // Not refused. A multi-line message is legitimate and common, and the screen
  // shows it in full; this exists so a user is told the shape of what they are
  // about to read rather than discovering a second page.
  const lines = message.split('\n').length
  if (lines > 1) {
    warnings.push(`This message is ${String(lines)} lines. Read all of them before signing.`)
  }
  if (bytes.length !== message.length) {
    warnings.push(
      'This message contains characters outside plain ASCII. Check it renders the way you ' +
        'expect, since what is signed is the bytes.'
    )
  }
  if (message !== message.trim()) {
    warnings.push(
      'This message begins or ends with whitespace, which is signed and is easy to miss.'
    )
  }

  let hashHex = ''
  for (const byte of messageHash(message)) hashHex += byte.toString(16).padStart(2, '0')

  return {
    message,
    hashHex,
    characters: message.length,
    bytes: bytes.length,
    refusals,
    warnings,
  }
}

/**
 * Refuse outright rather than returning a review.
 *
 * For callers on the signing path, which must not be able to proceed past a
 * refusal by forgetting to look at the list.
 */
export function assertSignable(message: string): void {
  const review = reviewMessage(message)
  if (review.refusals.length > 0) {
    throw new MessageError(review.refusals.join(' '))
  }
}
