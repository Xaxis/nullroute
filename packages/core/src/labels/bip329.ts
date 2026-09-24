/**
 * BIP-329: labels, in the format every other wallet reads.
 *
 * Spec: core.labels
 *
 * Labels are the part of a wallet that no seed can recreate. A mnemonic
 * restores every key and every address and knows nothing about which output was
 * the rent, which was a gift, or which one must never be spent. That knowledge
 * exists only in whatever the user wrote down, and it is the first thing lost
 * when somebody moves between wallets. BIP-329 exists so it moves with them.
 *
 * THE FORMAT IS JSON LINES, deliberately. One object per line, no wrapping
 * array, so a file can be appended to and a corrupt line can be skipped without
 * losing the ones around it. This module reads it that way: a line it cannot
 * parse is reported and the rest still import.
 *
 * WHAT A LABEL IS NOT. It is not a claim about ownership and nothing here
 * verifies one. A file can say an address is yours, and importing it does not
 * make that true: this device decides what is its own by re-deriving from the
 * seed, and that is the only thing it will ever act on. A label is text shown
 * beside a thing the device already recognises.
 *
 * SO LABELS ARE HOSTILE INPUT. They arrive on a card from software that may
 * have been compromised, and they are rendered on the screen a user reads
 * before signing. Everything here treats them as such: bounded in size, refused
 * if they carry characters that can forge a rendering, and never allowed to
 * decide anything.
 */

import { hasForgeable } from './forgeable.js'

export class LabelError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LabelError'
  }
}

/** The reference types BIP-329 defines. */
export const LABEL_TYPES = ['tx', 'addr', 'pubkey', 'input', 'output', 'xpub'] as const
export type LabelType = (typeof LABEL_TYPES)[number]

export interface Label {
  readonly type: LabelType
  /** What the label is attached to: a txid, an address, an outpoint. */
  readonly ref: string
  readonly label: string
  /**
   * Present only for outputs. True means "do not spend this".
   *
   * Carried through import and export because dropping it turns a coin the user
   * deliberately froze into an ordinary one, and nothing on screen would say
   * the instruction had been lost.
   */
  readonly spendable?: boolean
}

/**
 * The largest label file this device will read.
 *
 * A megabyte is tens of thousands of labels, which is more than any human
 * wrote. The bound exists because this is a file from a card and the parser
 * runs on a Pi.
 */
export const MAX_FILE_BYTES = 1_000_000

/** The longest a single label may be. Beyond this it is not read, it is scrolled. */
export const MAX_LABEL_LENGTH = 255

/** The longest a reference may be. An xpub is 112; an outpoint is 71. */
const MAX_REF_LENGTH = 200

export interface ImportResult {
  readonly labels: readonly Label[]
  /**
   * Lines that could not be read, with the reason.
   *
   * Reported rather than thrown, because one bad line in a file of four
   * thousand must not cost the user the other three thousand nine hundred and
   * ninety nine. Surfaced rather than swallowed, because a silent partial
   * import is a user believing they have labels they do not have.
   */
  readonly skipped: readonly { readonly line: number; readonly reason: string }[]
}

function isLabelType(value: unknown): value is LabelType {
  return typeof value === 'string' && (LABEL_TYPES as readonly string[]).includes(value)
}

/**
 * Read a BIP-329 file.
 *
 * Never throws on a single bad line. Throws only when the input is not a label
 * file at all, or is too large to be one.
 */
export function importLabels(text: string): ImportResult {
  if (text.length > MAX_FILE_BYTES) {
    throw new LabelError(
      `That label file is ${String(text.length)} bytes and this device reads up to ` +
        `${String(MAX_FILE_BYTES)}. A file that large is not a set of labels somebody wrote.`
    )
  }

  const labels: Label[] = []
  const skipped: { line: number; reason: string }[] = []
  const seen = new Set<string>()

  text.split('\n').forEach((raw, index) => {
    const line = raw.trim()
    // Blank lines are structure, not an error. JSON Lines files routinely end
    // with a newline and are routinely concatenated.
    if (line.length === 0) return

    const number = index + 1
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      skipped.push({ line: number, reason: 'not readable as JSON' })
      return
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      skipped.push({ line: number, reason: 'not a JSON object' })
      return
    }

    const record = parsed as Record<string, unknown>
    if (!isLabelType(record['type'])) {
      skipped.push({
        line: number,
        reason: `type ${JSON.stringify(record['type'])} is not one BIP-329 defines`,
      })
      return
    }
    const type = record['type']

    const ref = record['ref']
    if (typeof ref !== 'string' || ref.length === 0 || ref.length > MAX_REF_LENGTH) {
      skipped.push({ line: number, reason: 'ref is missing, empty or too long' })
      return
    }

    // A label MAY be absent, which BIP-329 uses to carry a spendable flag with
    // no text. Absent is not the same as empty and both are kept as written.
    const rawLabel = record['label']
    if (rawLabel !== undefined && typeof rawLabel !== 'string') {
      skipped.push({ line: number, reason: 'label is present but not a string' })
      return
    }
    const label = rawLabel ?? ''

    if (label.length > MAX_LABEL_LENGTH) {
      skipped.push({
        line: number,
        reason: `label is ${String(label.length)} characters, over the ${String(MAX_LABEL_LENGTH)} limit`,
      })
      return
    }
    if (hasForgeable(label)) {
      // Refused rather than stripped. A label that displays differently from
      // what it contains sits next to an amount on the signing screen, and
      // quietly repairing it would hide that somebody tried.
      skipped.push({
        line: number,
        reason: 'label contains characters that can make it render as something else',
      })
      return
    }

    const spendable = record['spendable']
    if (spendable !== undefined && typeof spendable !== 'boolean') {
      skipped.push({ line: number, reason: 'spendable is present but not a boolean' })
      return
    }

    // Later lines win, which is what appending to a JSON Lines file means. The
    // earlier one is not reported as skipped: it was read, and then replaced.
    const key = `${type}:${ref}`
    if (seen.has(key)) {
      const at = labels.findIndex((existing) => `${existing.type}:${existing.ref}` === key)
      if (at >= 0) labels.splice(at, 1)
    }
    seen.add(key)

    labels.push({
      type,
      ref,
      label,
      ...(spendable === undefined ? {} : { spendable }),
    })
  })

  return { labels, skipped }
}

/**
 * Write a BIP-329 file.
 *
 * Keys in the order the standard lists them and one object per line, so the
 * output is diffable and so two exports of the same labels are byte identical.
 * A file that changed every time it was written would be one a user could not
 * check against the last one.
 */
export function exportLabels(labels: readonly Label[]): string {
  const lines = labels.map((entry) => {
    const record: Record<string, unknown> = {
      type: entry.type,
      ref: entry.ref,
      label: entry.label,
    }
    if (entry.spendable !== undefined) record['spendable'] = entry.spendable
    return JSON.stringify(record)
  })
  // Trailing newline, because JSON Lines files are appended to and a file
  // without one silently joins its last record to the next thing written.
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`
}

/**
 * Look up a label, without letting the file decide anything.
 *
 * Callers pass a reference this device already recognised. Nothing here checks
 * whether the reference is ours: that is decided by re-deriving from the seed,
 * and a label is only ever text shown beside a thing already recognised.
 */
export function findLabel(
  labels: readonly Label[],
  type: LabelType,
  ref: string
): Label | undefined {
  return labels.find((entry) => entry.type === type && entry.ref === ref)
}
