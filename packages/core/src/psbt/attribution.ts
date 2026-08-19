/**
 * Which cosigner still has to sign this.
 *
 * Spec: core.psbt.attribution
 *
 * THE QUESTION SOMEBODY HOLDING THE SECOND OF THREE DEVICES ACTUALLY HAS. The
 * signing screen could already say "two of three signatures present, carry this
 * to the next cosigner", which is true and is not an answer. It does not say
 * WHICH device to walk to, and on a fleet of identical Raspberry Pis in
 * different rooms that is the whole difficulty. The device knew: the PSBT names
 * every key that signed and the registered descriptor names every key in the
 * quorum. Nothing joined them.
 *
 * HOW THE JOIN WORKS. A PSBT carries, per input, a derivation record for each
 * key: the public key, the master fingerprint it came from, and the path. A
 * signature carries the public key that made it. So a signature can be traced
 * to a master fingerprint through the PSBT's own records, and that fingerprint
 * compared against the fingerprints in the registered descriptor.
 *
 * A FINGERPRINT IS FOUR BYTES AND IS NOT PROOF, and this module says so rather
 * than letting a screen imply otherwise. It is the first four bytes of a hash
 * of a public key, it is written into the descriptor by whoever assembled it,
 * and two distinct keys can collide in it. What it is good for is telling three
 * devices apart in a room, which is exactly what is being asked here and is a
 * long way from cryptographic identification. The device's own position, by
 * contrast, is established by re-deriving its key at registration, and that one
 * is proof.
 *
 * SO NOTHING HERE DECIDES ANYTHING. This produces labels for a screen. Whether
 * a transaction is finished is decided by `signatureProgress`, which counts
 * signatures against the script's own threshold and never consults a name.
 */

import * as btc from '@scure/btc-signer'
import { bytesToHex } from '@noble/hashes/utils.js'

/** A key in the quorum, and whether it has signed this transaction. */
export interface CosignerStatus {
  /** Zero-based, as the descriptor writes them. */
  readonly position: number
  /** The master fingerprint from the descriptor, hex, lower case. */
  readonly fingerprint: string
  /** The name the user gave this cosigner, if they gave one. */
  readonly name?: string
  /** Whether this is the device asking. Established by derivation, not by name. */
  readonly isThisDevice: boolean
  readonly signed: boolean
}

export interface Attribution {
  readonly cosigners: readonly CosignerStatus[]
  /**
   * Signatures that could not be traced to any cosigner in the quorum.
   *
   * Not necessarily an attack. A taproot key-path signature carries no public
   * key at all, and a PSBT that omitted its derivation records would produce
   * the same result. It is reported rather than hidden because a signature
   * nobody in the quorum made is worth a second look, and because a screen that
   * showed "2 of 3 signed" while one of them was unattributed would be adding
   * two numbers that do not belong together.
   */
  readonly unattributed: number
  /**
   * Why attribution could not be done at all, if it could not.
   *
   * Present rather than an empty result, because "nobody has signed" and "this
   * device cannot tell who signed" are different things and a screen must not
   * render the second as the first.
   */
  readonly unavailable?: string
}

/** A derivation record: which master fingerprint a public key came from. */
function fingerprintsByKey(tx: btc.Transaction): Map<string, string> {
  const found = new Map<string, string>()

  for (let index = 0; index < tx.inputsLength; index += 1) {
    const input = tx.getInput(index)

    // Segwit and legacy carry `bip32Derivation`; taproot carries its own field
    // with a different shape. Both are read, because a quorum may be either and
    // reading only the first silently attributes nothing on a taproot multisig.
    const classic: unknown = input.bip32Derivation
    if (Array.isArray(classic)) {
      for (const entry of classic as readonly (readonly unknown[])[]) {
        const pubkey = entry[0]
        const meta = entry[1] as { fingerprint?: unknown } | undefined
        if (pubkey instanceof Uint8Array && typeof meta?.fingerprint === 'number') {
          found.set(bytesToHex(pubkey), meta.fingerprint.toString(16).padStart(8, '0'))
        }
      }
    }

    const taproot: unknown = input.tapBip32Derivation
    if (Array.isArray(taproot)) {
      for (const entry of taproot as readonly (readonly unknown[])[]) {
        const pubkey = entry[0]
        const meta = entry[1] as { fingerprint?: unknown } | undefined
        if (pubkey instanceof Uint8Array && typeof meta?.fingerprint === 'number') {
          found.set(bytesToHex(pubkey), meta.fingerprint.toString(16).padStart(8, '0'))
        }
      }
    }
  }

  return found
}

export interface QuorumKey {
  readonly position: number
  readonly fingerprint: string
  readonly name?: string
  readonly isThisDevice: boolean
}

/**
 * Match the signatures on a transaction to the keys in a quorum.
 *
 * `signedBy` comes from `signatureProgress` and holds the public keys that have
 * signed, plus the two placeholders it uses when a signature names no key.
 * Those placeholders are counted as unattributed rather than dropped: a taproot
 * key-path spend genuinely cannot say who signed it, and silently omitting it
 * would make a signed transaction look unsigned.
 */
export function attributeSignatures(
  tx: btc.Transaction,
  quorum: readonly QuorumKey[],
  signedBy: readonly string[]
): Attribution {
  if (quorum.length === 0) {
    return {
      cosigners: [],
      unattributed: signedBy.length,
      unavailable:
        'No quorum is registered for this transaction, so this device has no list of cosigners to ' +
        'match against. Register the descriptor to see who still has to sign.',
    }
  }

  const byKey = fingerprintsByKey(tx)

  const signedFingerprints = new Set<string>()
  let unattributed = 0
  for (const key of signedBy) {
    const fingerprint = byKey.get(key)
    if (fingerprint === undefined) {
      unattributed += 1
      continue
    }
    signedFingerprints.add(fingerprint.toLowerCase())
  }

  const cosigners = quorum.map((key) => ({
    position: key.position,
    fingerprint: key.fingerprint.toLowerCase(),
    ...(key.name === undefined ? {} : { name: key.name }),
    isThisDevice: key.isThisDevice,
    signed: signedFingerprints.has(key.fingerprint.toLowerCase()),
  }))

  // A signature traced to a fingerprint that is in the PSBT and NOT in the
  // quorum is still unattributed. Counting it as attributed because it resolved
  // to something would be reporting a signature by a key the quorum does not
  // contain as though it were one of ours.
  const known = new Set(quorum.map((key) => key.fingerprint.toLowerCase()))
  for (const fingerprint of signedFingerprints) {
    if (!known.has(fingerprint)) unattributed += 1
  }

  return { cosigners, unattributed }
}

/**
 * One sentence naming who is still waited on.
 *
 * Built here rather than in the frontend so the phrasing is tested, and so the
 * awkward cases, one unnamed cosigner, several of them, a device that cannot
 * tell, produce a sentence somebody wrote rather than one assembled by string
 * concatenation on a screen.
 */
export function describeWaiting(attribution: Attribution): string {
  if (attribution.unavailable !== undefined) return attribution.unavailable

  const waiting = attribution.cosigners.filter((cosigner) => !cosigner.signed)
  if (waiting.length === 0) return 'Every cosigner in this quorum has signed.'

  // THIS DEVICE IS NAMEABLE WHETHER OR NOT IT HAS A NAME, and that is the case
  // this got wrong first time round: it was folded in with the named ones, so
  // a device the user had not labelled came out as "one cosigner you have not
  // named". Telling somebody to go and find a device they are holding is the
  // one output here that is actively unhelpful.
  const describable = waiting.filter(
    (cosigner) => cosigner.isThisDevice || cosigner.name !== undefined
  )
  const unnamed = waiting.length - describable.length

  const parts = describable.map((cosigner) =>
    cosigner.isThisDevice ? 'this device' : (cosigner.name ?? '')
  )
  if (unnamed === 1) parts.push('one cosigner you have not named')
  if (unnamed > 1) parts.push(`${String(unnamed)} cosigners you have not named`)

  const list =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1] ?? ''}`

  return `Still to sign: ${list ?? ''}.`
}
