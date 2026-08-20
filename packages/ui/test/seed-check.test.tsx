/**
 * Tests for checking the seed backup instead of trusting a checkbox.
 *
 * THE FAILURE THIS PREVENTS is total, silent, and discovered only when it is
 * too late. The screen used to show twenty four words, ask the user to tick "I
 * have written all of them down", and hide them forever. Somebody who mistyped
 * a word, skipped one, or wrote them out of order believed they had a backup,
 * and found out otherwise with the device already gone.
 *
 * The daemon has had `seed.checkWord` the whole time, written so it compares
 * one word and returns a boolean and the untrusted side never learns a word it
 * did not already have. Nothing called it, and the reachability exemption list
 * claimed it was used by a flow that did not exist.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SeedScreen } from '../src/screens/SeedScreen.js'

afterEach(() => {
  cleanup()
})

const WORDS = [
  'abandon', 'ability', 'able', 'about', 'above', 'absent',
  'absorb', 'abstract', 'absurd', 'abuse', 'access', 'accident',
]

function open(overrides: Record<string, unknown> = {}) {
  const onConfirm = vi.fn()
  const onCheckWord = vi.fn().mockResolvedValue(true)
  const onCheckPositions = vi.fn().mockResolvedValue([1, 4, 9])

  render(
    <SeedScreen
      words={WORDS}
      fingerprint="73c5da0a"
      onCheckWord={onCheckWord}
      onCheckPositions={onCheckPositions}
      onConfirm={onConfirm}
      {...overrides}
    />
  )
  return { onConfirm, onCheckWord, onCheckPositions }
}

/**
 * Enter a word the way the panel does: a few letters, then the suggestion.
 *
 * The keyboard completes from the BIP-39 list rather than accepting free text,
 * which is why the letter keys are shared and the suggestion is the commit.
 */
function typeWord(word: string): void {
  for (const letter of word) {
    // The keyboard auto-commits as soon as one BIP-39 word is left, so the key
    // for a later letter may already be gone. That is the commit, not a
    // failure, and it is why this stops rather than insisting on every letter.
    const key = screen.queryByTestId(`kb-key-${letter}`)
    if (key === null || key.hasAttribute('disabled')) break
    fireEvent.click(key)
    if (screen.getByTestId('kb-words').textContent.includes(word)) return
  }
  // Not unique from the prefix alone: commit through the suggestion strip.
  const suggestion = screen.queryByTestId(`kb-suggest-${word}`)
  if (suggestion !== null) fireEvent.click(suggestion)
}

describe('SeedScreen backup verification', () => {
  /**
   * INV-UI-90. Ticking the box no longer hides anything. It starts a check,
   * and the check is what hides them.
   */
  it('does-not-confirm-on-the-checkbox-alone', async () => {
    const { onConfirm, onCheckPositions } = open()

    fireEvent.click(screen.getByTestId('seed-ack'))
    fireEvent.click(screen.getByTestId('seed-confirm'))
    await waitFor(() => screen.getByTestId('seed-check'))

    expect(onCheckPositions).toHaveBeenCalledWith(3)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  /**
   * INV-UI-90. Every word asked has to be right, and only then are the words
   * hidden. Confirming after the first correct answer would be a check that
   * asks three questions and grades one.
   */
  it('confirms-only-after-every-asked-word-is-right', async () => {
    const { onConfirm, onCheckWord } = open()

    fireEvent.click(screen.getByTestId('seed-ack'))
    fireEvent.click(screen.getByTestId('seed-confirm'))
    await waitFor(() => screen.getByTestId('seed-check'))

    for (const [answered, position] of [1, 4, 9].entries()) {
      expect(onConfirm).not.toHaveBeenCalled()
      typeWord(WORDS[position] ?? '')
      fireEvent.click(screen.getByTestId('seed-check-submit'))
      await waitFor(() => {
        expect(onCheckWord).toHaveBeenCalledTimes(answered + 1)
      })
    }

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1)
    })
  })

  /**
   * INV-UI-90. A wrong word goes back to the list rather than letting somebody
   * guess at the same prompt. They do not have the backup they think they have,
   * and the useful thing is the words, not another attempt.
   */
  it('sends-a-wrong-answer-back-to-the-words-rather-than-to-another-guess', async () => {
    const { onConfirm } = open({ onCheckWord: vi.fn().mockResolvedValue(false) })

    fireEvent.click(screen.getByTestId('seed-ack'))
    fireEvent.click(screen.getByTestId('seed-confirm'))
    await waitFor(() => screen.getByTestId('seed-check'))

    typeWord('abandon')
    fireEvent.click(screen.getByTestId('seed-check-submit'))

    await waitFor(() => screen.getByTestId('seed-screen'))
    expect(onConfirm).not.toHaveBeenCalled()
    // And the acknowledgement is cleared, so it cannot be tapped straight
    // through a second time.
    expect(screen.getByTestId<HTMLInputElement>('seed-ack').checked).toBe(false)

    // And it SAYS what happened. Returning silently would read as a mistyped
    // key rather than as a wrong backup, which is the whole finding.
    expect(screen.getByTestId('seed-check-failed').textContent).toContain(
      'you do not have a working backup yet'
    )
  })

  /**
   * INV-UI-90. The words stay reachable during the check. They are still on
   * the device and nothing has been confirmed, so looking again costs nothing
   * and refusing would push somebody to guess.
   */
  it('lets-somebody-look-at-the-words-again-mid-check', async () => {
    open()
    fireEvent.click(screen.getByTestId('seed-ack'))
    fireEvent.click(screen.getByTestId('seed-confirm'))
    await waitFor(() => screen.getByTestId('seed-check'))

    fireEvent.click(screen.getByTestId('seed-check-back'))
    await waitFor(() => screen.getByTestId('seed-words'))
  })

  /**
   * INV-UI-90. A build with no check available must not hide the words on the
   * checkbox alone. That is the old behaviour wearing a new label.
   */
  it('will-not-hide-the-words-when-it-cannot-check-them', () => {
    const { onConfirm } = open({ onCheckWord: undefined, onCheckPositions: undefined })

    fireEvent.click(screen.getByTestId('seed-ack'))
    fireEvent.click(screen.getByTestId('seed-confirm'))

    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByTestId('seed-confirm').textContent).toContain('Cannot check')
  })
})
