/**
 * PSBT review: turning a transaction into something a person can check.
 *
 * Spec: core.psbt.review
 *
 * The screen is the trust anchor. A user who reads it carefully must not be
 * defrauded, and every decision in this module follows from that sentence.
 *
 * The two rules that matter most are about what this module REFUSES to take on
 * trust:
 *
 *   1. An output is `change` only if its address re-derives from a registered
 *      descriptor at a valid change path and matches exactly. A PSBT can claim
 *      anything about its outputs. Believing it is how a user signs away their
 *      balance to an attacker's address that was labelled "change".
 *
 *   2. A sighash flag other than SIGHASH_ALL (or SIGHASH_DEFAULT for taproot)
 *      is refused. Those flags exist and have uses, but a signature that does
 *      not commit to the outputs is a signature over a transaction that can
 *      still be rewritten, and no ordinary user has asked for that.
 *
 * Amounts are bigint throughout. Satoshis exceed what a double represents
 * exactly at 2^53, which is only 90 million BTC, but a rounding error in a fee
 * calculation is not something to leave to chance.
 */

import * as btc from '@scure/btc-signer'
import { type Network } from '../network/networks.js'

export class PsbtError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PsbtError'
  }
}

/** How an output was classified, and why. */
export type OutputKind = 'payment' | 'change'

export interface ReviewedOutput {
  readonly index: number
  readonly address: string | undefined
  readonly amountSats: bigint
  readonly kind: OutputKind
  /** The path the change check matched, when it did. Shown so it is checkable. */
  readonly changePath?: string
  /**
   * Why this is not change, when the PSBT suggested it might be. Present when
   * the PSBT carried derivation data that did not verify.
   */
  readonly changeRejectedBecause?: string
}

export interface ReviewedInput {
  readonly index: number
  readonly txid: string
  readonly vout: number
  readonly amountSats: bigint
  readonly sighashType: number | undefined
  readonly derivationPath?: string
}

/** Sighash flags, named. Displayed in words rather than as a hex constant. */
export const SIGHASH_ALL = 0x01
export const SIGHASH_NONE = 0x02
export const SIGHASH_SINGLE = 0x03
export const SIGHASH_ANYONECANPAY = 0x80
/** Taproot's default, which commits to everything and is encoded as absent. */
export const SIGHASH_DEFAULT = 0x00

export interface SighashVerdict {
  readonly type: number
  readonly name: string
  /** Plain language, not a constant. What this signature does and does not commit to. */
  readonly meaning: string
  readonly acceptable: boolean
}

/**
 * Describe a sighash flag in terms a person can act on.
 *
 * The names are hex constants and mean nothing to most people. What a user
 * needs to know is which parts of the transaction their signature does not
 * cover, because that is what an attacker would change afterwards.
 */
export function describeSighash(type: number | undefined): SighashVerdict {
  const value = type ?? SIGHASH_DEFAULT
  const anyoneCanPay = (value & SIGHASH_ANYONECANPAY) !== 0
  const base = value & 0x1f

  if (value === SIGHASH_DEFAULT) {
    return {
      type: value,
      name: 'SIGHASH_DEFAULT',
      meaning: 'This signature commits to every input and every output.',
      acceptable: true,
    }
  }
  if (value === SIGHASH_ALL) {
    return {
      type: value,
      name: 'SIGHASH_ALL',
      meaning: 'This signature commits to every input and every output.',
      acceptable: true,
    }
  }

  const parts: string[] = []
  if (base === SIGHASH_NONE) {
    parts.push('This signature does NOT commit to the outputs, so where the money goes can be changed after you sign')
  } else if (base === SIGHASH_SINGLE) {
    parts.push('This signature commits to only ONE output, so the others can be changed after you sign')
  } else {
    parts.push('This signature uses a sighash flag nullroute does not recognise')
  }
  if (anyoneCanPay) {
    parts.push('and other inputs can be added')
  }

  const names: string[] = []
  if (base === SIGHASH_NONE) names.push('SIGHASH_NONE')
  else if (base === SIGHASH_SINGLE) names.push('SIGHASH_SINGLE')
  else names.push(`0x${value.toString(16)}`)
  if (anyoneCanPay) names.push('ANYONECANPAY')

  return {
    type: value,
    name: names.join(' | '),
    meaning: `${parts.join(', ')}.`,
    acceptable: false,
  }
}

export interface FeeSummary {
  readonly feeSats: bigint
  readonly totalInSats: bigint
  readonly totalOutSats: bigint
  readonly vsize: number
  /** Rounded down to two places, computed in integer arithmetic. */
  readonly satsPerVbyte: number
  /** Fee as a percentage of what is being spent, to one decimal place. */
  readonly percentOfSpend: number
}

export interface ReviewWarning {
  readonly kind:
    | 'sighash'
    | 'high-fee'
    | 'high-fee-rate'
    | 'unknown-fields'
    | 'not-replaceable'
    | 'locktime'
    | 'no-change-verified'
  readonly message: string
  /** True when the device will refuse to sign rather than merely warn. */
  readonly blocking: boolean
}

export interface Review {
  readonly inputs: readonly ReviewedInput[]
  readonly outputs: readonly ReviewedOutput[]
  readonly fee: FeeSummary
  readonly sighash: SighashVerdict
  readonly warnings: readonly ReviewWarning[]
  readonly locktime: number
  /** True when every input signals replaceability (BIP-125). */
  readonly replaceable: boolean
  readonly network: Network
  /** True when nothing blocking was found. */
  readonly signable: boolean
}

export interface ReviewOptions {
  readonly network: Network
  /**
   * Decides whether an address belongs to the wallet, by re-deriving it.
   * Returning a path means verified change; returning undefined means the
   * output is a payment, whatever the PSBT claims.
   */
  readonly isChange: (address: string) => string | undefined
  /** Warn above this fee rate. Default 500 sat/vB. */
  readonly maxFeeRate?: number
  /** Warn above this share of the spend. Default 5 percent. */
  readonly maxFeePercent?: number
}

/**
 * Fee rate to two decimal places, without floating point in the division.
 *
 * Satoshi amounts are bigint and vsize is an integer; scaling by 100 before
 * dividing keeps the whole computation exact and rounds once, at the end.
 */
function satsPerVbyte(feeSats: bigint, vsize: number): number {
  if (vsize <= 0) return 0
  return Number((feeSats * 100n) / BigInt(vsize)) / 100
}

/**
 * Build the review a user reads before signing.
 *
 * Takes an already-parsed transaction so that parsing failures are handled by
 * the caller and this module has one job.
 */
export function reviewTransaction(tx: btc.Transaction, options: ReviewOptions): Review {
  const { network, isChange } = options
  const maxFeeRate = options.maxFeeRate ?? 500
  const maxFeePercent = options.maxFeePercent ?? 5

  const inputs: ReviewedInput[] = []
  let totalIn = 0n
  let sighashType: number | undefined
  let mixedSighash = false
  let replaceable = true

  for (let i = 0; i < tx.inputsLength; i += 1) {
    const input = tx.getInput(i)
    // Narrowed explicitly rather than inferred. The library types these fields
    // loosely, and an `any` flowing into a running total of satoshis is exactly
    // what the strict lint rules exist to stop in this package.
    const amount = inputAmount(input)
    if (amount === undefined) {
      throw new PsbtError(
        `Input ${String(i)} has no amount. A PSBT without input amounts cannot be reviewed: ` +
          `the fee would be unknown, and a wallet that guesses the fee can be made to pay any fee.`
      )
    }
    totalIn += amount

    // A mixed sighash set is refused outright. It is not a scenario an ordinary
    // signer encounters, and reviewing "some of these commit to the outputs" is
    // not something a screen can convey honestly.
    if (sighashType === undefined) sighashType = input.sighashType
    else if (input.sighashType !== sighashType) mixedSighash = true

    // BIP-125: a sequence below 0xfffffffe signals replaceability.
    const sequence = input.sequence ?? 0xffffffff
    if (sequence >= 0xfffffffe) replaceable = false

    const txid = input.txid === undefined ? '' : Buffer.from(input.txid).toString('hex')

    inputs.push({
      index: i,
      txid,
      vout: typeof input.index === 'number' ? input.index : 0,
      amountSats: amount,
      sighashType: typeof input.sighashType === 'number' ? input.sighashType : undefined,
    })
  }

  const outputs: ReviewedOutput[] = []
  let totalOut = 0n

  for (let i = 0; i < tx.outputsLength; i += 1) {
    const output = tx.getOutput(i)
    const amount = output.amount ?? 0n
    totalOut += amount

    let address: string | undefined
    try {
      address =
        output.script === undefined
          ? undefined
          : btc.Address({
              bech32: network.bech32,
              pubKeyHash: network.pubKeyHash,
              scriptHash: network.scriptHash,
              wif: network.wif,
            }).encode(btc.OutScript.decode(output.script))
    } catch {
      // A script with no standard address form. Shown as a payment with no
      // address rather than hidden, because an unrenderable output is exactly
      // the kind a user should be told about.
      address = undefined
    }

    // THE RULE. Change is established by re-derivation, never by what the PSBT
    // asserts about the output.
    const changePath = address === undefined ? undefined : isChange(address)

    outputs.push({
      index: i,
      address,
      amountSats: amount,
      kind: changePath === undefined ? 'payment' : 'change',
      ...(changePath === undefined ? {} : { changePath }),
    })
  }

  const feeSats = totalIn - totalOut
  if (feeSats < 0n) {
    throw new PsbtError(
      `This transaction spends more than its inputs provide, by ${String(-feeSats)} satoshis. ` +
        `It is invalid and will not be signed.`
    )
  }

  const vsize = estimateVsize(tx)
  const spendSats = outputs
    .filter((o) => o.kind === 'payment')
    .reduce((sum, o) => sum + o.amountSats, 0n)

  const rate = satsPerVbyte(feeSats, vsize)
  // Percentage of what is actually leaving the wallet. Against total spend
  // including change, a large self-send would make any fee look negligible.
  const percentOfSpend =
    spendSats > 0n ? Number((feeSats * 1000n) / spendSats) / 10 : feeSats > 0n ? 100 : 0

  const sighash = describeSighash(sighashType)
  const warnings: ReviewWarning[] = []

  if (mixedSighash) {
    warnings.push({
      kind: 'sighash',
      message:
        'The inputs of this transaction do not all use the same sighash flag. nullroute will not ' +
        'sign it: a screen cannot honestly convey that some of your signatures commit to the ' +
        'outputs and others do not.',
      blocking: true,
    })
  } else if (!sighash.acceptable) {
    // INV-PSBT-3.
    warnings.push({
      kind: 'sighash',
      message: `${sighash.name}. ${sighash.meaning} nullroute refuses this unless advanced sighash mode is enabled for this one signature.`,
      blocking: true,
    })
  }

  if (rate > maxFeeRate) {
    warnings.push({
      kind: 'high-fee-rate',
      message: `The fee rate is ${String(rate)} sat/vB, above the ${String(maxFeeRate)} sat/vB warning threshold. Confirm this is what you meant.`,
      blocking: false,
    })
  }

  if (percentOfSpend > maxFeePercent) {
    warnings.push({
      kind: 'high-fee',
      message: `The fee is ${String(percentOfSpend)} percent of what you are sending. Confirm this is what you meant.`,
      blocking: false,
    })
  }

  if (!replaceable) {
    warnings.push({
      kind: 'not-replaceable',
      message:
        'This transaction does not signal replaceability. If it stalls in the mempool you will ' +
        'not be able to bump its fee, and your only option is to wait.',
      blocking: false,
    })
  }

  const locktime = tx.lockTime
  if (locktime > 0) {
    warnings.push({
      kind: 'locktime',
      message:
        locktime < 500000000
          ? `This transaction cannot confirm until block ${String(locktime)}.`
          : `This transaction cannot confirm until ${new Date(locktime * 1000).toISOString().slice(0, 10)}.`,
      blocking: false,
    })
  }

  // Fields this device does not model.
  //
  // BIP-174 requires unknown key-value pairs to be preserved rather than
  // dropped, and the signer does preserve them. The point of saying so is not
  // that they are dangerous in themselves: PSBT metadata is not covered by the
  // signature, so an unknown field cannot change where money goes or what is
  // committed to. The point is that the transaction was produced by something
  // this device does not fully understand, and a user comparing against their
  // coordinator deserves to know the device is not showing them everything the
  // file contains. Non-blocking, because treating an unmodelled field as an
  // attack would make the device refuse ordinary transactions from newer
  // coordinators.
  const unknownFields = countUnknownFields(tx)
  if (unknownFields > 0) {
    warnings.push({
      kind: 'unknown-fields',
      message:
        `This transaction carries ${String(unknownFields)} field${unknownFields === 1 ? '' : 's'} ` +
        `this device does not understand. They are preserved and passed through, and they are ` +
        `metadata: your signature does not cover them, so they cannot change where the money ` +
        `goes. Everything shown above is computed from the parts that are understood.`,
      blocking: false,
    })
  }

  // An output that could not be checked at all is worth saying out loud.
  if (outputs.some((o) => o.address === undefined)) {
    warnings.push({
      kind: 'no-change-verified',
      message:
        'One or more outputs use a script with no standard address form, so it could not be ' +
        'checked against your wallet. It is shown as a payment.',
      blocking: false,
    })
  }

  return {
    inputs,
    outputs,
    fee: {
      feeSats,
      totalInSats: totalIn,
      totalOutSats: totalOut,
      vsize,
      satsPerVbyte: rate,
      percentOfSpend,
    },
    sighash,
    warnings,
    locktime,
    replaceable,
    network,
    signable: !warnings.some((w) => w.blocking),
  }
}

/**
 * The amount an input spends, in satoshis.
 *
 * Read from the witness UTXO where present, otherwise from the referenced
 * output of the full previous transaction. Returns undefined when the PSBT
 * states neither, which the caller treats as a refusal rather than a zero: a
 * wallet that assumed zero could be made to pay an arbitrary fee.
 */
function inputAmount(input: ReturnType<btc.Transaction['getInput']>): bigint | undefined {
  const witness: unknown = input.witnessUtxo
  if (witness !== null && typeof witness === 'object' && 'amount' in witness) {
    const amount: unknown = (witness).amount
    if (typeof amount === 'bigint') return amount
  }

  const previous: unknown = input.nonWitnessUtxo
  const index = typeof input.index === 'number' ? input.index : 0
  if (previous !== null && typeof previous === 'object' && 'outputs' in previous) {
    const outputs: unknown = (previous).outputs
    if (Array.isArray(outputs)) {
      const output: unknown = outputs[index]
      if (output !== null && typeof output === 'object' && 'amount' in output) {
        const amount: unknown = (output).amount
        if (typeof amount === 'bigint') return amount
      }
    }
  }
  return undefined
}

/**
 * Virtual size, for the fee rate.
 *
 * Uses the library's own estimate where the transaction can be serialised, and
 * falls back to a conservative structural estimate where it cannot (an unsigned
 * PSBT has no witnesses yet). A fee rate is a sanity check rather than a
 * consensus value, and it is better to show an approximate one than none.
 */
function estimateVsize(tx: btc.Transaction): number {
  try {
    return tx.vsize
  } catch {
    // Roughly: 68 vbytes per segwit input, 31 per output, 11 overhead.
    return 11 + tx.inputsLength * 68 + tx.outputsLength * 31
  }
}

/** Satoshis rendered as BTC, exactly, without floating point. */
export function formatBtc(sats: bigint): string {
  const negative = sats < 0n
  const value = negative ? -sats : sats
  const whole = value / 100000000n
  const fraction = (value % 100000000n).toString().padStart(8, '0')
  return `${negative ? '-' : ''}${String(whole)}.${fraction}`
}

/**
 * How many key-value pairs the PSBT carries that this device does not model.
 *
 * Counted across every input and every output. The signer keeps them under
 * `unknown`, as an array of entries, so the count is the sum of those lengths.
 *
 * Global-level unknown pairs are NOT counted, and that is a real limit rather
 * than an oversight: the library keeps the global map private, and reaching
 * into it would mean depending on an internal that can change under a patch
 * release. Undercounting is the safe direction here, because the count drives a
 * non-blocking note and never a refusal. The limit is stated in the spec.
 *
 * Read defensively rather than cast. This walks attacker-supplied structure,
 * and a shape that is not what we expect must produce a count rather than an
 * exception: throwing here would turn an odd but harmless PSBT into one that
 * cannot be reviewed at all, which is a worse failure than a missed note.
 */
function countUnknownFields(tx: btc.Transaction): number {
  const bag = (owner: unknown): number => {
    if (owner === null || typeof owner !== 'object') return 0
    const entries: unknown = (owner as { unknown?: unknown }).unknown
    return Array.isArray(entries) ? entries.length : 0
  }

  let total = 0
  for (let i = 0; i < tx.inputsLength; i += 1) total += bag(tx.getInput(i))
  for (let i = 0; i < tx.outputsLength; i += 1) total += bag(tx.getOutput(i))
  return total
}
