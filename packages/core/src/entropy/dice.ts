/**
 * Dice entropy collection, validation, and accounting.
 *
 * Spec: core.entropy.dice
 *
 * The encoding here is a published promise, not an implementation detail.
 * docs/ENTROPY.md tells users they can reproduce the result with:
 *
 *   printf '%s' '<rolls>' | sha256sum
 *
 * so changing the encoding silently breaks a claim the project makes about
 * itself, not just a test. If you need to change it, version it.
 */

import { sha256 } from '@noble/hashes/sha2.js'
import { utf8ToBytes } from '@noble/hashes/utils.js'
import { Secret } from '../util/secret.js'

/** Bits of entropy per fair d6 roll: log2(6). */
export const BITS_PER_ROLL = Math.log2(6)

/** Target entropy for a 24-word BIP-39 mnemonic. */
export const TARGET_BITS = 256

/**
 * Minimum rolls to reach 256 bits: ceil(256 / log2(6)) = 100.
 *
 * Note this is 100 and not 99. 99 rolls is 255.911 bits, which is short. The
 * original project brief says 99 is sufficient and it is wrong by 0.089 bits.
 * Academically irrelevant, but a project whose entire claim is checkable
 * arithmetic does not get to round in its own favour. See docs/ENTROPY.md.
 */
export const MIN_ROLLS = Math.ceil(TARGET_BITS / BITS_PER_ROLL)

/** Valid faces, as ASCII digits. The canonical encoding is these bytes exactly. */
const VALID_FACES = '123456'
const FACE_LIST: readonly string[] = ['1', '2', '3', '4', '5', '6']

export interface EntropyAccounting {
  readonly rolls: number
  /**
   * Truncated, never rounded, so the display cannot claim more entropy than
   * has actually been collected.
   */
  readonly bits: number
  readonly exactBits: number
  readonly targetBits: number
  readonly sufficient: boolean
  readonly rollsRemaining: number
}

export type PatternWarningKind = 'uniform' | 'short-cycle' | 'monotonic-run' | 'skewed-distribution'

export interface PatternWarning {
  readonly kind: PatternWarningKind
  readonly message: string
  readonly detail: string
}

export class DiceValidationError extends Error {
  /** Zero-based index of the offending roll, when the failure is positional. */
  readonly index: number | undefined

  // Written as an explicit field rather than a TypeScript parameter property:
  // `erasableSyntaxOnly` forbids the shorthand, because it is syntax that
  // cannot be stripped by a type-only transform. Node running TypeScript
  // directly is worth more here than the four saved lines.
  constructor(message: string, index?: number) {
    super(message)
    this.name = 'DiceValidationError'
    this.index = index
  }
}

/**
 * Validate a roll sequence. Throws on anything that is not a canonical
 * sequence of `1`-`6` with no separators.
 *
 * Strict on purpose. Accepting whitespace or commas "helpfully" would mean the
 * bytes we hash are not the bytes the user typed, and the whole hand-verifiable
 * story depends on those being the same.
 */
export function validateRolls(rolls: string): void {
  if (rolls.length === 0) {
    throw new DiceValidationError('No rolls entered.')
  }
  for (let i = 0; i < rolls.length; i += 1) {
    const ch = rolls[i]
    if (ch === undefined || !VALID_FACES.includes(ch)) {
      throw new DiceValidationError(
        `Roll ${String(i + 1)} is ${JSON.stringify(ch ?? '')}, which is not a d6 face. ` +
          `Rolls must be the digits 1 to 6 with no separators.`,
        i
      )
    }
  }
}

/** Live entropy accounting, for the "213 of 256 bits" display during collection. */
export function accountEntropy(rolls: string): EntropyAccounting {
  const n = rolls.length
  const exactBits = n * BITS_PER_ROLL
  return {
    rolls: n,
    // Truncate. A display that rounds 255.9 up to 256 tells the user they are
    // done when they are not.
    bits: Math.floor(exactBits),
    exactBits,
    targetBits: TARGET_BITS,
    sufficient: n >= MIN_ROLLS,
    rollsRemaining: Math.max(0, MIN_ROLLS - n),
  }
}

/**
 * Warn about sequences that do not look like fair dice.
 *
 * These are warnings and never rejections. A fair die genuinely can produce a
 * suspicious-looking sequence, and a device that silently discarded real rolls
 * would be substituting its own judgement for the user's entropy, which is the
 * exact failure this project exists to prevent. The user is told what looks
 * wrong and decides.
 */
export function detectPatterns(rolls: string): PatternWarning[] {
  const warnings: PatternWarning[] = []
  if (rolls.length < 2) return warnings

  const faces = Array.from({ length: rolls.length }, (_, i) => rolls.charAt(i))

  // Every roll the same.
  const first = faces[0]
  if (first !== undefined && faces.every((f) => f === first)) {
    warnings.push({
      kind: 'uniform',
      message: 'Every roll is the same value.',
      detail: `All ${String(faces.length)} rolls are ${first}. If the die really did this, roll again with a different die.`,
    })
    return warnings
  }

  // A short repeating cycle. The worked example in docs/ENTROPY.md trips this,
  // which is intentional: the doc's example must look obviously unusable.
  for (let period = 1; period <= 6 && period < faces.length; period += 1) {
    let repeats = true
    for (let i = period; i < faces.length; i += 1) {
      if (faces[i] !== faces[i - period]) {
        repeats = false
        break
      }
    }
    if (repeats) {
      warnings.push({
        kind: 'short-cycle',
        message: `The sequence repeats every ${String(period)} rolls.`,
        detail: `A cycle this short carries far less entropy than ${String(faces.length)} independent rolls.`,
      })
      break
    }
  }

  // A long strictly ascending or descending run.
  const RUN_THRESHOLD = 10
  let runLength = 1
  let longestRun = 1
  for (let i = 1; i < faces.length; i += 1) {
    const prev = faces[i - 1]
    const cur = faces[i]
    if (prev === undefined || cur === undefined) break
    const ascending = Number(cur) === Number(prev) + 1
    const descending = Number(cur) === Number(prev) - 1
    runLength = ascending || descending ? runLength + 1 : 1
    longestRun = Math.max(longestRun, runLength)
  }
  if (longestRun >= RUN_THRESHOLD) {
    warnings.push({
      kind: 'monotonic-run',
      message: `There is a run of ${String(longestRun)} consecutive ascending or descending values.`,
      detail: 'This is possible with fair dice but rare. Check you entered the rolls correctly.',
    })
  }

  // Chi-squared goodness of fit against a uniform d6, with a deliberately wide
  // band. At 5 degrees of freedom the 0.999 critical value is 20.515, so this
  // fires on roughly 1 in 1000 fair sequences. Wide is correct here: a warning
  // the user learns to ignore is worse than no warning.
  if (faces.length >= 30) {
    const counts = new Map<string, number>()
    for (const f of faces) counts.set(f, (counts.get(f) ?? 0) + 1)
    const expected = faces.length / 6
    let chiSquared = 0
    for (const face of FACE_LIST) {
      const observed = counts.get(face) ?? 0
      chiSquared += (observed - expected) ** 2 / expected
    }
    const CRITICAL_999 = 20.515
    if (chiSquared > CRITICAL_999) {
      const summary = FACE_LIST.map((f) => `${f}:${String(counts.get(f) ?? 0)}`).join(' ')
      warnings.push({
        kind: 'skewed-distribution',
        message: 'The distribution of faces is unusually uneven.',
        detail: `Counts were ${summary} over ${String(faces.length)} rolls (chi-squared ${chiSquared.toFixed(1)}, expected under 20.5). This happens by chance about 1 time in 1000.`,
      })
    }
  }

  return warnings
}

/**
 * Derive 256 bits of entropy from a dice roll sequence.
 *
 * The canonical encoding, which docs/ENTROPY.md publishes and users check by
 * hand: the ASCII bytes of the rolls, concatenated in entry order, with no
 * separators and no trailing newline, hashed once with SHA-256.
 *
 * `printf`, not `echo`. The trailing newline `echo` appends is the single most
 * common reason a user's hand check disagrees with the device.
 *
 * Hashing rather than base-6 conversion is a deliberate choice: `sha256sum`
 * exists on every machine, whereas a base-6 to binary conversion of a 100-digit
 * number requires trusting some other tool's bignum arithmetic, which
 * reintroduces the problem this design removes. With 100 rolls the input
 * carries 258.5 bits and the output is 256 wide, so nothing that matters is
 * lost. See docs/ENTROPY.md.
 */
export function diceToEntropy(rolls: string): Secret {
  validateRolls(rolls)

  const accounting = accountEntropy(rolls)
  if (!accounting.sufficient) {
    throw new DiceValidationError(
      `${String(accounting.rolls)} rolls is ${String(accounting.bits)} bits of entropy, ` +
        `short of the required ${String(TARGET_BITS)}. Roll ${String(accounting.rollsRemaining)} more ` +
        `(${String(MIN_ROLLS)} total).`
    )
  }

  const encoded = utf8ToBytes(rolls)
  return Secret.fromBytes(sha256(encoded), 'dice-entropy')
}
