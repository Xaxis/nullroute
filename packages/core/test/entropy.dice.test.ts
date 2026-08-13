/**
 * Tests for core.entropy.dice.
 *
 * Test names here are referenced by invariant bindings in dice.spec.yaml.
 * `make verify` asserts that every declared invariant names a test that exists
 * and passed, so renaming a test breaks the build rather than silently
 * unbinding an invariant.
 */

import { describe, expect, it } from 'vitest'
import { fc, test } from '@fast-check/vitest'
import { bytesToHex } from '@noble/hashes/utils.js'
import {
  BITS_PER_ROLL,
  DiceValidationError,
  MIN_ROLLS,
  TARGET_BITS,
  accountEntropy,
  detectPatterns,
  diceToEntropy,
  validateRolls,
} from '../src/entropy/dice.js'

/** A roll sequence that is long enough and not obviously patterned. */
const GOOD_ROLLS =
  '31545262413365142534612453126345216435124653214563142536451263542136451263542136'.padEnd(
    100,
    '4'
  )

const rollString = (n: number, fill = '3') => fill.repeat(n)

describe('core.entropy.dice', () => {
  // INV-DICE-1
  it('minimum-rolls', () => {
    // The arithmetic that fixes the bound, stated as a test so the constant
    // cannot drift from its justification.
    expect(BITS_PER_ROLL).toBeCloseTo(2.584962500721156, 15)
    expect(99 * BITS_PER_ROLL).toBeLessThan(TARGET_BITS)
    expect(100 * BITS_PER_ROLL).toBeGreaterThanOrEqual(TARGET_BITS)
    expect(MIN_ROLLS).toBe(100)
  })

  // INV-DICE-1: refuses to proceed below 256 bits.
  it('refuses-insufficient-entropy', () => {
    expect(() => diceToEntropy(rollString(99))).toThrow(DiceValidationError)
    expect(() => diceToEntropy(rollString(99))).toThrow(/short of the required 256/)
    // 99 rolls specifically, since the brief claimed this was enough.
    expect(accountEntropy(rollString(99)).sufficient).toBe(false)
    expect(accountEntropy(rollString(100)).sufficient).toBe(true)
  })

  // INV-DICE-2: strict canonical input.
  it('rejects-non-canonical-input', () => {
    expect(() => { validateRolls('') }).toThrow(DiceValidationError)
    expect(() => { validateRolls('1234 5612') }).toThrow(/not a d6 face/)
    expect(() => { validateRolls('123456\n') }).toThrow(/not a d6 face/)
    expect(() => { validateRolls('1,2,3') }).toThrow(/not a d6 face/)
    expect(() => { validateRolls('123407') }).toThrow(/not a d6 face/)
    expect(() => { validateRolls('12340a') }).toThrow(/not a d6 face/)
    // Reports which roll was wrong, so the UI can point at it.
    try {
      validateRolls('1237')
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(DiceValidationError)
      expect((err as DiceValidationError).index).toBe(3)
    }
  })

  // INV-DICE-3: the published encoding. This test IS the promise in
  // docs/ENTROPY.md. If it fails, the documentation is lying to users who are
  // checking by hand, which is worse than an ordinary regression.
  it('published-worked-example', () => {
    const rolls = '123456'.repeat(16) + '1234'
    expect(rolls).toHaveLength(100)

    using entropy = diceToEntropy(rolls)
    expect(bytesToHex(entropy.bytes)).toBe(
      'e56403e8522ddeae1b44a1e8148b1ba4d3b4c626ccf20980056eedcc7e0c0f35'
    )
    // Verified independently against coreutils:
    //   printf '%s' '<rolls>' | sha256sum
    // See docs/ENTROPY.md. The absence of a trailing newline is the whole
    // point, so it is asserted rather than assumed.
  })

  // INV-DICE-4: output width.
  it('output-length', () => {
    using entropy = diceToEntropy(GOOD_ROLLS)
    expect(entropy.length).toBe(32)
  })

  // INV-DICE-5: accounting truncates rather than rounds, so the display never
  // claims more entropy than has been collected.
  it('accounting-truncates', () => {
    const at99 = accountEntropy(rollString(99))
    expect(at99.exactBits).toBeCloseTo(255.911, 3)
    expect(at99.bits).toBe(255)
    expect(at99.rollsRemaining).toBe(1)

    const at100 = accountEntropy(rollString(100))
    expect(at100.bits).toBe(258)
    expect(at100.rollsRemaining).toBe(0)
  })

  // INV-DICE-6: warns but never rejects.
  it('warns-without-rejecting', () => {
    const uniform = rollString(100, '5')
    expect(detectPatterns(uniform).map((w) => w.kind)).toContain('uniform')
    // Critically, it still derives. Silently discarding real rolls would
    // substitute the device's judgement for the user's entropy.
    using entropy = diceToEntropy(uniform)
    expect(entropy.length).toBe(32)

    const cyclic = '123456'.repeat(16) + '1234'
    expect(detectPatterns(cyclic).map((w) => w.kind)).toContain('short-cycle')

    const clean = detectPatterns(GOOD_ROLLS)
    expect(clean.map((w) => w.kind)).not.toContain('uniform')
  })

  it('detects-monotonic-runs', () => {
    // A long ascending/descending walk: 1234565432123456543212...
    const walk = '123456543212345654321'.repeat(5).slice(0, 100)
    expect(detectPatterns(walk).map((w) => w.kind)).toContain('monotonic-run')
  })

  // INV-DICE-7: determinism. Same rolls, same bytes, always.
  test.prop([fc.stringMatching(/^[1-6]{100,120}$/)])('deterministic', (rolls) => {
    using a = diceToEntropy(rolls)
    using b = diceToEntropy(rolls)
    expect(bytesToHex(a.bytes)).toBe(bytesToHex(b.bytes))
  })

  // INV-DICE-8: avalanche. Changing any single roll changes the output.
  test.prop([
    fc.stringMatching(/^[1-6]{100}$/),
    fc.nat({ max: 99 }),
    fc.integer({ min: 1, max: 5 }),
  ])('avalanche', (rolls, index, shift) => {
    const original = rolls[index]
    if (original === undefined) return
    // Rotate the chosen roll to a different face within 1..6.
    const changed = String(((Number(original) - 1 + shift) % 6) + 1)
    const mutated = rolls.slice(0, index) + changed + rolls.slice(index + 1)

    using a = diceToEntropy(rolls)
    using b = diceToEntropy(mutated)
    expect(bytesToHex(a.bytes)).not.toBe(bytesToHex(b.bytes))
  })
})
