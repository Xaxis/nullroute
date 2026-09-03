/**
 * Build a multisig descriptor from a set of keys, on the device.
 *
 * Spec: core.descriptor.assemble
 *
 * WHY THIS EXISTS. Forming a quorum used to require coordinator software: this
 * device could export its own key and import a finished descriptor, and nothing
 * in between. For a fleet of air-gapped devices that made a networked machine
 * mandatory to create the wallet, which is a strange requirement for a design
 * whose whole point is that the signing devices never touch a network. Three
 * Pis in a room could not agree on a wallet without a fourth computer.
 *
 * Assembling is not signing and not deriving. It is string construction plus a
 * checksum, and every part of it is checkable: the descriptor this produces is
 * the same descriptor a coordinator would produce from the same keys, and the
 * eight characters after the `#` are what every device compares.
 *
 * WHAT IT REFUSES, and each is a way to end up with a wallet you cannot spend
 * from rather than an inconvenience:
 *
 *   A key that is not an extended key with an origin. A quorum member written
 *   as a bare xpub with no `[fingerprint/path]` cannot be traced back to a
 *   seed, so a device restoring later cannot tell whether it holds that key.
 *
 *   The same key twice. A 2-of-3 with a duplicated key is a 2-of-2 with a
 *   spare, and the descriptor looks completely normal.
 *
 *   A threshold that is not spendable, or that is spendable by one. Both are
 *   valid descriptors and neither is a multisig anybody meant to build.
 *
 *   Keys whose derivation suffixes disagree. A quorum where one key is ranged
 *   and another is not produces addresses on one branch only.
 *
 * SORTEDMULTI, NOT MULTI, and not configurable here. `multi` makes the address
 * depend on the ORDER the keys were written, so every cosigner has to enter
 * them identically or their addresses silently differ. `sortedmulti` sorts them
 * at derivation, which removes that entire class of error. BIP-67 exists
 * because people kept making it.
 *
 * THE WRITTEN ORDER IS ALSO CANONICAL, and that is a separate decision from
 * sortedmulti. Sorting at derivation makes the ADDRESSES agree whatever order
 * the keys were typed in; it does nothing about the descriptor STRING, which
 * still differs, and therefore about the checksum.
 *
 * That matters because docs/FLEET.md tells people to compare the eight
 * characters after the `#` on every device and treat a difference as proof that
 * one of them has a different wallet. Without canonical ordering that advice
 * fires on three devices that agree perfectly, purely because somebody scanned
 * the keys in a different sequence. A check that cries wolf is a check people
 * learn to wave through, and this is the check standing between a fleet and a
 * wallet they cannot spend from.
 *
 * So the keys are sorted by their extended key before the string is built. Any
 * device given the same set in any order produces byte-identical output.
 */

import { parseKeyExpression, type ExtendedKey, type KeyExpression } from './parse.js'
import { withChecksum } from './checksum.js'

export class AssembleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AssembleError'
  }
}

/** The script types a quorum can be built as. */
export type QuorumScript = 'wsh' | 'sh-wsh'

export interface AssembleOptions {
  /** How many signatures spend it. */
  readonly threshold: number
  /** Key expressions, as written by each device. Order does not matter. */
  readonly keys: readonly string[]
  /** Native segwit by default. Nested only for software too old to read bech32. */
  readonly script?: QuorumScript
}

export interface AssembledQuorum {
  readonly descriptor: string
  /** The eight characters every device compares. Split out so a screen can shout it. */
  readonly checksum: string
  readonly threshold: number
  readonly total: number
  readonly script: QuorumScript
  /**
   * Each key as it was written into the descriptor, in canonical order.
   *
   * Not the order they were given: see the note on canonical ordering above.
   * Returned so a screen can show what actually went in rather than what was
   * typed, which is the same reason a sealed wallet label is returned.
   */
  readonly keys: readonly string[]
}

/** The consensus limit on keys in a script. Beyond it the script cannot be spent. */
const MAX_KEYS = 20

function assertExtendedWithOrigin(parsed: KeyExpression, raw: string): ExtendedKey {
  if (parsed.kind !== 'extended') {
    throw new AssembleError(
      `"${raw.slice(0, 24)}..." is a raw public key. A quorum member has to be an extended key, ` +
        `because a raw key produces exactly one address and a wallet needs a range of them.`
    )
  }
  if (parsed.origin === undefined) {
    throw new AssembleError(
      `One key has no origin in brackets. Without [fingerprint/path] in front of it, a device ` +
        `restoring this wallet later cannot tell whether the key is one of its own, so it cannot ` +
        `know it is able to sign.`
    )
  }
  return parsed
}

/**
 * Build the descriptor.
 *
 * Deliberately returns the checksum separately as well as inside the string.
 * Comparing quorums between devices is comparing those eight characters, and a
 * screen that had to slice them out of a 300 character line would be a screen
 * that gets it wrong once.
 */
export function assembleQuorum(options: AssembleOptions): AssembledQuorum {
  const script = options.script ?? 'wsh'
  const { threshold, keys } = options

  if (keys.length < 2) {
    throw new AssembleError(
      `A quorum needs at least two keys. One key is a single-signature wallet, which this device ` +
        `already makes without any of this.`
    )
  }
  if (keys.length > MAX_KEYS) {
    throw new AssembleError(
      `${String(keys.length)} keys exceeds the ${String(MAX_KEYS)} key consensus limit. A script ` +
        `with more cannot be spent.`
    )
  }
  if (!Number.isInteger(threshold) || threshold < 1) {
    throw new AssembleError('The threshold has to be a whole number of signatures, at least one.')
  }
  if (threshold > keys.length) {
    throw new AssembleError(
      `A ${String(threshold)}-of-${String(keys.length)} needs more signatures than there are ` +
        `keys, so nothing could ever spend it.`
    )
  }

  const parsed = keys.map((raw, index) => {
    let expression: KeyExpression
    try {
      expression = parseKeyExpression(raw.trim())
    } catch (err) {
      throw new AssembleError(
        `Key ${String(index + 1)} could not be read: ${(err as Error).message}`
      )
    }
    return assertExtendedWithOrigin(expression, raw)
  })

  // Duplicates by xpub, not by the whole string: the same key written with two
  // different origins is still one key, and a 2-of-3 holding it twice is a
  // 2-of-2 with a spare that looks completely normal on every screen.
  const seen = new Map<string, number>()
  for (const [index, key] of parsed.entries()) {
    const previous = seen.get(key.xpub)
    if (previous !== undefined) {
      throw new AssembleError(
        `Keys ${String(previous + 1)} and ${String(index + 1)} are the same extended key. A ` +
          `quorum that lists one key twice needs fewer distinct devices than it appears to.`
      )
    }
    seen.set(key.xpub, index)
  }

  // Every key has to cover the same branches. One ranged key beside one that is
  // not produces a wallet with addresses on one branch only, which receives and
  // never finds its own change.
  const shapes = new Set(
    parsed.map((key) => `${key.ranged ? 'ranged' : 'fixed'}:${(key.multipath ?? []).join(';')}`)
  )
  if (shapes.size > 1) {
    throw new AssembleError(
      `These keys do not have matching derivation suffixes. Every key in a quorum has to cover ` +
        `the same branches, or the wallet derives addresses on one branch and not the other. ` +
        `Use the same suffix on all of them, conventionally /<0;1>/*.`
    )
  }

  // Sorted by extended key, so the same set of keys in any order produces the
  // same string and therefore the same checksum on every device. See above.
  const written = parsed
    .map((key, index) => ({ xpub: key.xpub, text: keys[index]?.trim() ?? '' }))
    .sort((left, right) => (left.xpub < right.xpub ? -1 : left.xpub > right.xpub ? 1 : 0))
    .map((entry) => entry.text)

  const inner = `sortedmulti(${String(threshold)},${written.join(',')})`
  const body = script === 'wsh' ? `wsh(${inner})` : `sh(wsh(${inner}))`
  const descriptor = withChecksum(body)

  return {
    descriptor,
    checksum: descriptor.slice(descriptor.lastIndexOf('#') + 1),
    threshold,
    total: keys.length,
    script,
    keys: written,
  }
}
