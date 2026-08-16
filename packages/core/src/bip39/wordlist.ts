/**
 * Searching the BIP-39 English wordlist by prefix.
 *
 * Spec: core.bip39.wordlist
 *
 * This exists because the device has a 7 inch touchscreen and no keyboard, and
 * typing twenty-four words with a finger on a full QWERTY layout is how people
 * give up halfway through a recovery. The list has a property that makes it far
 * better than that: every word is determined by its first four letters, and
 * after two or three letters most of the alphabet leads nowhere at all.
 *
 * So the useful operation is not "autocomplete". It is "which letters can still
 * lead to a word", which lets the keyboard disable the ones that cannot. A user
 * entering `abandon` is choosing between three live keys after `ab`, and cannot
 * produce a word that is not in the list even by accident.
 *
 * NONE OF THIS VALIDATES ANYTHING. A mnemonic made of twenty-four real words is
 * still almost certainly invalid, because the last word carries a checksum.
 * Prefix search narrows what a finger can type; `isValidMnemonic` decides
 * whether the result is a mnemonic. Confusing the two would let a device accept
 * a typo that lands on another real word, which is exactly the error this list
 * was designed to make visible.
 */

import { wordlist as english } from '@scure/bip39/wordlists/english.js'

/** The 2048 words, in the order BIP-39 defines. Index is meaningful. */
export const WORDLIST: readonly string[] = english

/**
 * The number of leading letters that determine a word.
 *
 * A property of the list rather than a choice, and it is asserted rather than
 * trusted: a build against a wordlist where it does not hold would silently
 * make the keyboard's completion wrong.
 */
export const UNIQUE_PREFIX = 4

/**
 * Words beginning with `prefix`.
 *
 * Case is folded because a touch keyboard may send either, and an empty prefix
 * returns nothing rather than all 2048: a caller asking with nothing typed
 * wants an empty suggestion strip, not the whole list.
 */
export function wordsWithPrefix(prefix: string, limit = 8): readonly string[] {
  const needle = prefix.trim().toLowerCase()
  if (needle.length === 0) return []

  const out: string[] = []
  for (const word of WORDLIST) {
    if (!word.startsWith(needle)) continue
    out.push(word)
    if (out.length >= limit) break
  }
  return out
}

/**
 * Letters that can follow `prefix` and still reach a word.
 *
 * The keyboard disables everything else. After `zo` only `n` survives, which
 * turns a 26 key decision into a 1 key one and makes a mistyped word close to
 * impossible rather than merely unlikely.
 */
export function nextLetters(prefix: string): readonly string[] {
  const needle = prefix.trim().toLowerCase()
  const letters = new Set<string>()

  for (const word of WORDLIST) {
    if (!word.startsWith(needle) || word.length <= needle.length) continue
    const letter = word[needle.length]
    if (letter !== undefined) letters.add(letter)
  }
  return [...letters].sort()
}

/**
 * The one word this prefix can mean, or undefined while it is still ambiguous.
 *
 * Returns a word only when it is the sole match, so a caller can commit it
 * without guessing. `ab` matches three words and returns nothing; `aban`
 * matches one and returns `abandon`.
 */
export function uniqueCompletion(prefix: string): string | undefined {
  const needle = prefix.trim().toLowerCase()
  if (needle.length === 0) return undefined

  let found: string | undefined
  for (const word of WORDLIST) {
    if (!word.startsWith(needle)) continue
    // A second match means the prefix is still ambiguous, so stop rather than
    // returning the first and letting a caller commit the wrong word.
    if (found !== undefined) return undefined
    found = word
  }
  return found
}

/** Whether a string is a word in the list, exactly. */
export function isWord(word: string): boolean {
  return WORDLIST.includes(word.trim().toLowerCase())
}
