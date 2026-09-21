/**
 * Tests for core.entropy.combiner.
 *
 * Test names here are referenced by invariant bindings in combine.spec.yaml.
 */

import { describe, expect, it } from 'vitest'
import { fc, test } from '@fast-check/vitest'
import { bytesToHex } from '@noble/hashes/utils.js'
import { Secret } from '../src/util/secret.js'
import {
  EntropyCombinerError,
  MAX_SOURCES,
  SEED_LENGTH,
  combineEntropy,
  type EntropySource,
} from '../src/entropy/combine.js'

/** Build a source from a repeating byte pattern. Caller disposes. */
function source(id: string, fill: number, length = 32): EntropySource {
  return { id, material: Secret.fromBytes(new Uint8Array(length).fill(fill), id) }
}

function combineHex(sources: EntropySource[]): string {
  using seed = combineEntropy(sources)
  return bytesToHex(seed.bytes)
}

describe('core.entropy.combiner', () => {
  // INV-ENT-1: output is exactly 32 bytes for any valid input.
  it('length', () => {
    for (let n = 1; n <= MAX_SOURCES; n += 1) {
      const sources = Array.from({ length: n }, (_, i) => source(`src-${String(i)}`, i + 1))
      using seed = combineEntropy(sources)
      expect(seed.length).toBe(SEED_LENGTH)
      for (const s of sources) s.material.dispose()
    }
  })

  // INV-ENT-2: changing any single input byte changes the output.
  test.prop([fc.nat({ max: 31 }), fc.integer({ min: 1, max: 255 })])(
    'avalanche',
    (index, delta) => {
      const base = new Uint8Array(32).fill(7)
      const mutated = Uint8Array.from(base)
      mutated[index] = ((mutated[index] ?? 0) + delta) % 256
      if (mutated[index] === base[index]) return

      const a = combineHex([{ id: 'dice', material: Secret.fromBytes(base, 'dice') }])
      const b = combineHex([{ id: 'dice', material: Secret.fromBytes(mutated, 'dice') }])
      expect(a).not.toBe(b)
    }
  )

  // INV-ENT-3: source ordering is canonical, so combining is deterministic.
  it('ordering', () => {
    const forward = [source('alpha', 1), source('beta', 2), source('gamma', 3)]
    const reverse = [source('gamma', 3), source('beta', 2), source('alpha', 1)]
    const shuffled = [source('beta', 2), source('alpha', 1), source('gamma', 3)]

    const a = combineHex(forward)
    const b = combineHex(reverse)
    const c = combineHex(shuffled)

    expect(a).toBe(b)
    expect(a).toBe(c)

    for (const s of [...forward, ...reverse, ...shuffled]) s.material.dispose()
  })

  // INV-ENT-4: a zeroed or stuck source cannot reduce the entropy of the result.
  it('stuck-source', () => {
    const dice = source('dice', 0xab)
    const stuck = source('hwrng', 0x00)

    const withStuck = combineHex([dice, stuck])
    const diceOnly = combineHex([dice])

    // Adding a dead source changes the output (it is part of the input), but
    // the result is still a full-width derivation from the good source. What
    // must NOT happen is the stuck source dominating: the combined result is
    // not the all-zero-derived value.
    const stuckOnly = combineHex([stuck])
    expect(withStuck).not.toBe(stuckOnly)
    expect(withStuck).not.toBe(diceOnly)
    expect(withStuck).not.toMatch(/^0+$/)

    dice.material.dispose()
    stuck.material.dispose()
  })

  /**
   * INV-ENT-5: the length-prefixed encoding is unambiguous.
   *
   * THE PAIR HAS TO ACTUALLY COLLIDE, and the pair here did not. The comment
   * described the right construction, ("a","bc") against ("ab","c"), and the
   * values underneath it were ("a", "bcbcbcbc...") against ("ab", "cccc...").
   * Flattened without prefixes those are "abcbcbcbc..." and "abcccc...", which
   * are different strings, so the assertion held whether the prefixes existed
   * or not. Deleting the encoding entirely, which the module's own header calls
   * "load-bearing, not decoration", left all eight tests in this file green.
   *
   * A real collision needs id_a ++ material_a to equal id_b ++ material_b as a
   * flat byte string. Material is 16 to 64 bytes, so moving one byte across the
   * boundary is legal on both sides: 17 bytes on the left, 16 on the right.
   */
  it('no-concatenation-collision', () => {
    const TAIL = 'c'.repeat(16)
    const a: EntropySource[] = [
      { id: 'a', material: Secret.fromBytes(new TextEncoder().encode(`b${TAIL}`), 'a') },
    ]
    const b: EntropySource[] = [
      { id: 'ab', material: Secret.fromBytes(new TextEncoder().encode(TAIL), 'ab') },
    ]

    // The premise, asserted rather than assumed, so this cannot quietly stop
    // being a collision pair the way the last one did.
    const flat = (source: EntropySource) =>
      `${source.id}${new TextDecoder().decode(source.material.bytes)}`
    expect(flat(a[0]!)).toBe(flat(b[0]!))

    // And the encoding tells them apart anyway, which is the invariant.
    expect(combineHex(a)).not.toBe(combineHex(b))
  })

  // INV-ENT-6: the source id is mixed in, so identical bytes from a different
  // origin derive a different seed.
  it('source-id-is-bound', () => {
    const asDice = combineHex([source('dice', 0x42)])
    const asHwrng = combineHex([source('hwrng', 0x42)])
    expect(asDice).not.toBe(asHwrng)
  })

  it('rejects-invalid-input', () => {
    expect(() => combineEntropy([])).toThrow(EntropyCombinerError)

    const tooMany = Array.from({ length: MAX_SOURCES + 1 }, (_, i) =>
      source(`s${String(i)}`, i + 1)
    )
    expect(() => combineEntropy(tooMany)).toThrow(/At most 8/)
    for (const s of tooMany) s.material.dispose()

    const tooShort = source('short', 1, 15)
    expect(() => combineEntropy([tooShort])).toThrow(/outside the allowed/)
    tooShort.material.dispose()

    const tooLong = source('long', 1, 65)
    expect(() => combineEntropy([tooLong])).toThrow(/outside the allowed/)
    tooLong.material.dispose()

    // Duplicate ids would make canonical ordering ambiguous.
    const dupA = source('dice', 1)
    const dupB = source('dice', 2)
    expect(() => combineEntropy([dupA, dupB])).toThrow(/Duplicate entropy source id/)
    dupA.material.dispose()
    dupB.material.dispose()
  })

  it('is-deterministic-across-runs', () => {
    const build = () => [source('dice', 0x11), source('urandom', 0x22)]
    const first = build()
    const second = build()
    expect(combineHex(first)).toBe(combineHex(second))
    for (const s of [...first, ...second]) s.material.dispose()
  })
})
