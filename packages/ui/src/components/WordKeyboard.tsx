import { type ReactElement, useCallback, useMemo, useState } from 'react'
import { nextLetters, wordsWithPrefix } from '@nullroute/core'

/**
 * Entering a BIP-39 mnemonic with a finger.
 *
 * Spec: ui.screens.keyboard
 *
 * The device has a 7 inch touchscreen and no keyboard. Twenty-four words on a
 * full QWERTY layout is how people give up halfway through a recovery, and a
 * user who gives up halfway through a recovery still has the money at stake.
 *
 * So this is not a general keyboard with autocomplete bolted on. It is built
 * around the property that makes the wordlist tractable: after two or three
 * letters, almost the whole alphabet leads nowhere. Dead keys are disabled, so
 * the user is choosing between the few letters that can still reach a word
 * rather than aiming at 26 targets and hoping.
 *
 * THE ONE PLACE THIS COULD LOSE SOMEONE MONEY is committing a word they did not
 * choose. `act` is a word, and so are `action`, `actor`, `actress` and
 * `actual`. A user who typed `act` meaning `act` and one who typed `act` on the
 * way to `actual` are indistinguishable. So a word is committed when it is the
 * only possibility or when the user taps it, and never because it happened to
 * be first.
 *
 * Letters are laid out alphabetically rather than as QWERTY. There is no
 * muscle memory to preserve on a device someone uses a few times a year, and
 * alphabetical means a user can find a letter by reasoning instead of scanning.
 */

export interface WordKeyboardProps {
  /** Words entered so far. */
  readonly words: readonly string[]
  readonly onChange: (words: readonly string[]) => void
  /** How many words the user is aiming for, for the counter. */
  readonly target?: number
  /**
   * Somebody is working on this again, whether or not a word has been finished.
   *
   * `onChange` fires when the word LIST changes, which is once every four or
   * five keystrokes. A screen that wants to know a person has started typing
   * cannot use it: the import screen clears its refusal on input, and with only
   * onChange to go on the banner stayed up through most of a word, displacing
   * the keys somebody was in the middle of tapping.
   */
  readonly onTyping?: (() => void) | undefined
  readonly testId?: string
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'.split('')

export function WordKeyboard(props: WordKeyboardProps): ReactElement {
  const { words, onChange, target, onTyping, testId } = props
  const [prefix, setPrefix] = useState('')

  const live = useMemo(() => new Set(nextLetters(prefix)), [prefix])
  const suggestions = useMemo(() => wordsWithPrefix(prefix, 6), [prefix])

  /**
   * Commit a word and clear the prefix.
   *
   * Always explicit. Nothing here decides on the user's behalf which of several
   * possible words they meant.
   */
  const commit = useCallback(
    (word: string) => {
      onChange([...words, word])
      setPrefix('')
    },
    [words, onChange]
  )

  const type = useCallback(
    (letter: string) => {
      onTyping?.()
      const next = prefix + letter
      const matches = wordsWithPrefix(next, 2)
      // Exactly one word left and no longer word extends it: there is nothing
      // to choose, so commit rather than making the user tap a suggestion that
      // is the only suggestion.
      if (matches.length === 1 && matches[0] !== undefined) {
        commit(matches[0])
        return
      }
      setPrefix(next)
    },
    [prefix, commit, onTyping]
  )

  /** Backspace: into the prefix if there is one, otherwise the last word. */
  const back = useCallback(() => {
    onTyping?.()
    if (prefix.length > 0) {
      setPrefix(prefix.slice(0, -1))
      return
    }
    onChange(words.slice(0, -1))
  }, [prefix, words, onChange, onTyping])

  return (
    <div className="nr-kb" data-testid={testId}>
      <div className="nr-kb__entered" data-testid="kb-words">
        {words.map((word, index) => (
          // Position is the identity here: the same word can legitimately
          // appear several times in a mnemonic.
          <span className="nr-kb__word" key={`${String(index)}-${word}`}>
            <span className="nr-kb__wordnum">{index + 1}</span>
            {word}
          </span>
        ))}
        {/* NOT NUMBERED. It used to carry `words.length + 1`, so a half typed
            word appeared as a chip reading "1 top" while the counter below it
            said "0 of 1 words". Two numbers on one screen contradicting each
            other, and the button disabled, with nothing saying why.

            The number is what made it read as an entered word. Without it the
            chip is plainly something in progress and the counter is the only
            authority on how many words exist. */}
        {prefix.length > 0 && (
          <span className="nr-kb__word nr-kb__word--typing" data-testid="kb-prefix">
            {prefix}
          </span>
        )}
        {words.length === 0 && prefix.length === 0 && (
          <span className="nr-hint">Tap letters to begin.</span>
        )}

        {/* WHAT TO DO NEXT, when there is something to do and it is not obvious.
            49 of the 2048 words are a prefix of another one: act, add, car,
            top. Type one of those and the keyboard cannot commit it, because
            `topic` and `topple` are still reachable, so the only way forward is
            the suggestion strip. Nothing said so. A user saw their word on
            screen, a counter reading zero, and a dead button.

            That is 7% of wallet creations, where the backup check asks for
            three words, and 44% of twenty four word restores. */}
        {prefix.length > 0 && suggestions.length > 0 ? (
          <span className="nr-hint" data-testid="kb-pick">
            Tap the word below to enter it
          </span>
        ) : (
          <span className="nr-hint" data-testid="kb-hint-blank" />
        )}
        <span className="nr-hint nr-kb__count" data-testid="kb-count">
          {words.length}
          {target === undefined ? '' : ` of ${String(target)}`} words
        </span>
      </div>

      {/* The suggestion strip. Present whenever more than one word is possible,
          which is the only situation where a choice exists to be made. */}
      <div className="nr-kb__suggestions" data-testid="kb-suggestions">
        {suggestions.map((word) => (
          <button
            key={word}
            type="button"
            className="nr-kb__suggestion"
            onClick={() => {
              commit(word)
            }}
            data-testid={`kb-suggest-${word}`}
          >
            {word}
          </button>
        ))}
      </div>

      <div className="nr-kb__keys">
        {ALPHABET.map((letter) => {
          const enabled = live.has(letter)
          return (
            <button
              key={letter}
              type="button"
              className="nr-kb__key"
              // Disabled rather than hidden: a key that moves as you type is a
              // key you mis-hit. The layout is fixed and the dead ones go dim.
              disabled={!enabled}
              aria-disabled={!enabled}
              onClick={() => {
                type(letter)
              }}
              data-testid={`kb-key-${letter}`}
            >
              {letter}
            </button>
          )
        })}
        <button
          type="button"
          className="nr-kb__key nr-kb__key--wide"
          onClick={back}
          disabled={words.length === 0 && prefix.length === 0}
          data-testid="kb-back"
        >
          Back
        </button>
      </div>
    </div>
  )
}
