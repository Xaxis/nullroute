/**
 * Tests for core.bip39.wordlist.
 *
 * Two kinds of assertion here. Facts about the list itself, which are checked
 * rather than trusted because the keyboard's whole design rests on them, and
 * behaviour of the search, which mostly comes down to refusing to commit to a
 * word while more than one is still possible.
 */

import { describe, expect, it } from 'vitest'
import {
  UNIQUE_PREFIX,
  WORDLIST,
  isWord,
  nextLetters,
  uniqueCompletion,
  wordsWithPrefix,
} from '../src/bip39/wordlist.js'

describe('core.bip39.wordlist', () => {
  /**
   * INV-WORDS-1. The properties the keyboard depends on.
   *
   * If the four letter rule ever failed, completion would commit to a word the
   * user did not choose, and nothing else in the interface would reveal it.
   */
  it('has-2048-words-uniquely-determined-by-four-letters', () => {
    expect(WORDLIST).toHaveLength(2048)

    const prefixes = new Set(WORDLIST.map((word) => word.slice(0, UNIQUE_PREFIX)))
    expect(prefixes.size).toBe(2048)

    // Sorted, which is what makes a prefix scan able to stop early and what
    // BIP-39 requires of the list.
    expect([...WORDLIST].sort()).toEqual([...WORDLIST])

    // Lowercase ASCII throughout, so folding case is safe.
    for (const word of WORDLIST) expect(word).toMatch(/^[a-z]{3,8}$/)
  })

  it('finds-words-by-prefix-and-nothing-for-an-empty-one', () => {
    expect(wordsWithPrefix('aban')).toEqual(['abandon'])
    expect(wordsWithPrefix('ab')).toEqual([
      'abandon',
      'ability',
      'able',
      'about',
      'above',
      'absent',
      'absorb',
      'abstract',
    ])

    // An empty prefix means nothing typed, which is an empty suggestion strip
    // rather than all 2048 words.
    expect(wordsWithPrefix('')).toEqual([])
    expect(wordsWithPrefix('   ')).toEqual([])
    expect(wordsWithPrefix('qqq')).toEqual([])
  })

  it('folds-case-and-trims', () => {
    expect(wordsWithPrefix('ABAN')).toEqual(['abandon'])
    expect(wordsWithPrefix('  aban  ')).toEqual(['abandon'])
    expect(isWord('  ABANDON ')).toBe(true)
    expect(isWord('abandonn')).toBe(false)
  })

  it('honours-the-limit', () => {
    expect(wordsWithPrefix('a', 3)).toHaveLength(3)
    expect(wordsWithPrefix('a', 100).length).toBeGreaterThan(3)
  })

  /**
   * INV-WORDS-2. The property that makes finger entry work: after a couple of
   * letters almost the whole alphabet is dead, and the keyboard can say so.
   */
  it('reports-which-letters-can-still-reach-a-word', () => {
    // Nothing typed: every letter that starts some word.
    expect(nextLetters('').length).toBeGreaterThan(20)

    // `zo` reaches only `zone` and `zoo`, so one live key.
    expect(nextLetters('zo')).toEqual(['n', 'o'])
    expect(nextLetters('zon')).toEqual(['e'])

    // A complete word with nothing after it has no continuations.
    expect(nextLetters('abandon')).toEqual([])
    // And a prefix that reaches nothing has none either.
    expect(nextLetters('qqq')).toEqual([])

    // Every letter offered actually leads somewhere, which is the contract.
    for (const letter of nextLetters('ab')) {
      expect(wordsWithPrefix(`ab${letter}`, 1).length).toBe(1)
    }
  })

  /**
   * INV-WORDS-3. Completion commits only when there is nothing to choose.
   *
   * Returning the first match of several would silently enter a word the user
   * did not pick, in the one place where a wrong word means lost money.
   */
  it('completes-only-when-a-prefix-is-unambiguous', () => {
    expect(uniqueCompletion('aban')).toBe('abandon')
    expect(uniqueCompletion('abandon')).toBe('abandon')

    // Three words start with `ab`, so this must not guess.
    expect(uniqueCompletion('ab')).toBeUndefined()
    expect(uniqueCompletion('')).toBeUndefined()
    expect(uniqueCompletion('qqq')).toBeUndefined()

    // A word that is a prefix of another must not complete to the longer one.
    // `add` is a word and so is `address`, so `add` is ambiguous.
    expect(wordsWithPrefix('add')).toContain('add')
    expect(wordsWithPrefix('add')).toContain('address')
    expect(uniqueCompletion('add')).toBeUndefined()
  })

  /**
   * The four letter rule says no two words share their first four letters. It
   * does NOT say four letters always identify a word, and the difference is the
   * trap this test exists to pin down.
   *
   * A word of four letters or more is fully determined by its first four. A
   * three letter word is not, because it can be a prefix of longer ones: `act`
   * is a word, and so are `action`, `actor`, `actress` and `actual`.
   */
  it('determines-any-word-of-four-letters-or-more-from-its-first-four', () => {
    for (const word of WORDLIST) {
      if (word.length < UNIQUE_PREFIX) continue
      expect(uniqueCompletion(word.slice(0, UNIQUE_PREFIX)), word).toBe(word)
    }
  })

  /**
   * INV-WORDS-4. A short word that is also a prefix must never auto-commit.
   *
   * This is the one case where a keyboard could silently enter the wrong word.
   * A user who typed `act` and meant `act` and a user who typed `act` on the
   * way to `actual` are indistinguishable, so the choice belongs to them. The
   * exact word is offered, alongside the longer ones, and neither is assumed.
   */
  it('never-auto-commits-a-short-word-that-is-also-a-prefix', () => {
    const ambiguous = WORDLIST.filter(
      (word) => WORDLIST.filter((other) => other.startsWith(word)).length > 1
    )
    // There really are such words, so this test is not vacuous.
    expect(ambiguous.length).toBeGreaterThan(10)
    expect(ambiguous).toContain('act')

    for (const word of ambiguous) {
      expect(uniqueCompletion(word), word).toBeUndefined()
      // But the exact word is always offered, so it remains reachable.
      expect(wordsWithPrefix(word, 2048), word).toContain(word)
    }
  })
})
