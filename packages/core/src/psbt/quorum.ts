/**
 * How far along a transaction's signatures are.
 *
 * Spec: core.psbt.quorum
 *
 * THIS EXISTS BECAUSE OF THE FLEET CASE. A 2-of-3 held on three nullroute
 * devices is signed by walking a PSBT from one to the next. The second device
 * needs to know something the first did not: whether its signature COMPLETES
 * the transaction. That is the difference between "carry this to the third
 * device" and "this is done, broadcast it", and a device that cannot tell the
 * user which one they are holding has left the most consequential fact off the
 * screen.
 *
 * Everything here is read out of the PSBT itself. A `wsh(multi)` input carries
 * its witness script, which encodes m and n, and its partial signatures, which
 * name the public keys that produced them. So progress needs no registration,
 * no coordinator, and no state: a device that has never seen this wallet before
 * can still say "one of two signatures present".
 *
 * WHAT IS NOT INFERRED. Where the required count cannot be read it is reported
 * as unknown rather than guessed. A taproot script path carries its leaves
 * differently, and guessing "probably one signature is enough" on an input this
 * code does not understand would be the device telling a user they are finished
 * when they are not.
 */

import * as btc from '@scure/btc-signer'
import { bytesToHex } from '@noble/hashes/utils.js'

export interface InputSignatures {
  readonly index: number
  /**
   * How many signatures this input needs, when that can be read from the PSBT.
   *
   * Undefined for an input whose script this code cannot decompose. Undefined
   * is not "one": it means the device does not know, and a screen has to say so
   * rather than imply completion.
   */
  readonly required: number | undefined
  /** How many cosigners the script names, when readable. */
  readonly cosigners: number | undefined
  /** Signatures already attached, whoever produced them. */
  readonly present: number
  /** Public keys that have signed, hex, in the order the PSBT holds them. */
  readonly signedBy: readonly string[]
  /** True when this input has everything it needs. */
  readonly satisfied: boolean
}

export interface SignatureProgress {
  readonly inputs: readonly InputSignatures[]
  /**
   * Every input has the signatures it needs, so nothing else has to sign.
   *
   * False when any input is short OR when any input's requirement could not be
   * read. An unknown requirement is treated as unmet, because the alternative
   * is telling somebody they are done on the strength of a script this code did
   * not understand.
   */
  readonly complete: boolean
  /** No input carries any signature yet. */
  readonly untouched: boolean
  /** Total signatures present across every input. */
  readonly present: number
  /** Total required across every input, when all of them are readable. */
  readonly required: number | undefined
}

/**
 * The m and n of a multisig input, from whichever script the PSBT carries.
 *
 * A `wsh(multi)` input has a witness script; a `sh(multi)` has a redeem script;
 * a `sh(wsh(multi))` has both, and the witness script is the one that holds the
 * quorum. Checked in that order for that reason.
 */
function quorumOf(input: ReturnType<btc.Transaction['getInput']>): {
  required: number | undefined
  cosigners: number | undefined
} {
  for (const script of [input.witnessScript, input.redeemScript]) {
    if (script === undefined) continue
    try {
      const decoded = btc.OutScript.decode(script) as {
        type: string
        m?: number
        pubkeys?: readonly unknown[]
      }
      if (decoded.type === 'ms' && typeof decoded.m === 'number') {
        return { required: decoded.m, cosigners: decoded.pubkeys?.length }
      }
    } catch {
      // A script this build cannot decode leaves the requirement unknown, which
      // is reported rather than guessed.
    }
  }

  // A single-key input needs exactly one signature, and that IS readable: the
  // previous output's script is a key hash with no accompanying script that
  // could add conditions.
  const script = input.witnessUtxo?.script
  if (
    script !== undefined &&
    input.witnessScript === undefined &&
    input.redeemScript === undefined
  ) {
    try {
      const kind = (btc.OutScript.decode(script) as { type: string }).type
      if (kind === 'wpkh' || kind === 'pkh' || kind === 'tr') return { required: 1, cosigners: 1 }
    } catch {
      // Same as above.
    }
  }

  return { required: undefined, cosigners: undefined }
}

/** Signatures attached to one input, however they are carried. */
function signaturesOn(input: ReturnType<btc.Transaction['getInput']>): readonly string[] {
  const keys: string[] = []

  const partial: unknown = input.partialSig
  if (Array.isArray(partial)) {
    for (const entry of partial as readonly (readonly unknown[])[]) {
      const pubkey = entry[0]
      if (pubkey instanceof Uint8Array) keys.push(bytesToHex(pubkey))
    }
  }

  // Taproot key path carries one signature and no public key with it, because
  // the key is the output. Recorded as a signature with no signer named, since
  // pretending to know which key produced it would be inventing information.
  const tapKeySig: unknown = input.tapKeySig
  if (tapKeySig instanceof Uint8Array) keys.push('taproot-key-path')

  const tapScriptSig: unknown = input.tapScriptSig
  if (Array.isArray(tapScriptSig)) {
    for (const entry of tapScriptSig as readonly (readonly unknown[])[]) {
      const meta = entry[0] as { pubKey?: unknown } | undefined
      const pubkey = meta?.pubKey
      keys.push(pubkey instanceof Uint8Array ? bytesToHex(pubkey) : 'taproot-script-path')
    }
  }

  return keys
}

/** Read how far along a transaction is, using nothing but the PSBT. */
export function signatureProgress(tx: btc.Transaction): SignatureProgress {
  const inputs: InputSignatures[] = []

  for (let index = 0; index < tx.inputsLength; index += 1) {
    const input = tx.getInput(index)
    const { required, cosigners } = quorumOf(input)
    const signedBy = signaturesOn(input)

    inputs.push({
      index,
      required,
      cosigners,
      present: signedBy.length,
      signedBy,
      // Unknown requirement is unmet. Saying otherwise would mean reporting
      // completion on the strength of a script this code did not decode.
      satisfied: required !== undefined && signedBy.length >= required,
    })
  }

  const present = inputs.reduce((sum, input) => sum + input.present, 0)
  const allKnown = inputs.every((input) => input.required !== undefined)

  return {
    inputs,
    complete: inputs.length > 0 && inputs.every((input) => input.satisfied),
    untouched: present === 0,
    present,
    required: allKnown ? inputs.reduce((sum, input) => sum + (input.required ?? 0), 0) : undefined,
  }
}

/**
 * Whether one of these public keys has already signed every input it could.
 *
 * For telling a user that the transaction in front of them is one they already
 * signed, which happens whenever a QR sequence is scanned back or a card is
 * read twice. Signing again is harmless because the result is byte-identical,
 * but a device that says nothing leaves the user unsure whether it worked.
 */
export function alreadySignedBy(tx: btc.Transaction, pubkeys: readonly Uint8Array[]): boolean {
  if (pubkeys.length === 0) return false
  const ours = new Set(pubkeys.map((key) => bytesToHex(key)))
  /*
   * The same keys x-only, for the taproot case below.
   *
   * A compressed public key is a parity byte and 32 bytes of x. Taproot drops
   * the parity byte, so the two encodings of one key never compare equal and a
   * set built from the compressed form cannot recognise the x-only form.
   */
  const oursXOnly = new Set(
    pubkeys.filter((key) => key.length === 33).map((key) => bytesToHex(key.slice(1)))
  )

  let signedSomething = false
  for (let index = 0; index < tx.inputsLength; index += 1) {
    const input = tx.getInput(index)
    for (const signer of signaturesOn(input)) {
      if (ours.has(signer)) signedSomething = true
    }

    /*
     * THE KEY-PATH CASE, WHICH THE LOOP ABOVE CANNOT SEE.
     *
     * A taproot key-path spend carries `tapKeySig` and no public key beside
     * it, because the key is the output. signaturesOn records that as the
     * literal "taproot-key-path" rather than naming a signer, deliberately:
     * for the progress report, which is about who has signed, inventing an
     * attribution would be worse than admitting there is none.
     *
     * That answer is right there and wrong here. This function is not asking
     * who signed, it is asking whether WE did, and it holds our keys. So
     * "taproot-key-path" is compared against a set of hex public keys it can
     * never equal, and this returned false for every BIP-86 wallet this device
     * makes. The invariant it serves says a device recognises a transaction it
     * has already signed, and its test is a 2-of-3 witness script using
     * partialSig, so the property held for every wallet type except the one
     * the taproot path produces. A user scanning a QR sequence back was told
     * nothing, every time.
     *
     * The input names the signer in `tapInternalKey`, which is the field the
     * signer read to build the spend in the first place. Matching against it is
     * reading what the PSBT says rather than inferring: no attribution is
     * invented and signaturesOn is left as conservative as it was.
     */
    const tapKeySig: unknown = input.tapKeySig
    const internal: unknown = input.tapInternalKey
    if (
      tapKeySig instanceof Uint8Array &&
      internal instanceof Uint8Array &&
      oursXOnly.has(bytesToHex(internal))
    ) {
      signedSomething = true
    }
  }
  return signedSomething
}
