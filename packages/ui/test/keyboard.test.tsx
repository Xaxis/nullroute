/**
 * Tests for the on-screen keyboards.
 *
 * The word keyboard's job is to make a wrong word hard to enter. The passphrase
 * keyboard's job is to change nothing the user did not ask for. Both are about
 * what does not happen, so most of what follows checks absences.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { WordKeyboard } from '../src/components/WordKeyboard.js'
import { TextKeyboard } from '../src/components/TextKeyboard.js'

afterEach(cleanup)

/** This repo does not load jest-dom, so disabledness is read off the element. */
function disabled(testId: string): boolean {
  return screen.getByTestId<HTMLButtonElement>(testId).disabled
}

/** Type letters into a freshly mounted word keyboard, collecting the words. */
function typeWord(letters: string): { words: readonly string[]; onChange: ReturnType<typeof vi.fn> } {
  const state: { words: readonly string[] } = { words: [] }
  const onChange = vi.fn((next: readonly string[]) => {
    state.words = next
  })
  const { rerender } = render(<WordKeyboard words={state.words} onChange={onChange} testId="kb" />)

  for (const letter of letters) {
    fireEvent.click(screen.getByTestId(`kb-key-${letter}`))
    rerender(<WordKeyboard words={state.words} onChange={onChange} testId="kb" />)
  }
  return { words: state.words, onChange }
}

describe('WordKeyboard', () => {
  /**
   * INV-UI-26. The property the whole layout is built on: after a couple of
   * letters most of the alphabet cannot reach a word, and those keys are out of
   * play rather than merely unhelpful.
   */
  it('disables-letters-that-cannot-reach-a-word', () => {
    const onChange = vi.fn()
    const { rerender } = render(<WordKeyboard words={[]} onChange={onChange} testId="kb" />)

    // With nothing typed, most letters are live.
    expect(disabled('kb-key-a')).toBe(false)

    fireEvent.click(screen.getByTestId('kb-key-z'))
    rerender(<WordKeyboard words={[]} onChange={onChange} testId="kb" />)
    fireEvent.click(screen.getByTestId('kb-key-o'))
    rerender(<WordKeyboard words={[]} onChange={onChange} testId="kb" />)

    // `zo` reaches only `zone` and `zoo`.
    expect(disabled('kb-key-n')).toBe(false)
    expect(disabled('kb-key-o')).toBe(false)
    expect(disabled('kb-key-a')).toBe(true)
    expect(disabled('kb-key-e')).toBe(true)

    // Disabled, not removed. A key that moves as you type is a key you mis-hit.
    expect(screen.getByTestId('kb-key-a')).toBeTruthy()
  })

  it('commits-a-word-as-soon-as-only-one-is-possible', () => {
    // `aba` can only be `abandon`, so three taps is a whole word.
    const { words } = typeWord('aba')
    expect(words).toEqual(['abandon'])
  })

  /**
   * INV-UI-27. The one way this could lose someone money.
   *
   * `act` is a word, and so are `action`, `actor`, `actress` and `actual`. A
   * user who typed `act` meaning `act` and one on their way to `actual` look
   * identical, so the keyboard must not choose. Both remain reachable.
   */
  it('never-commits-a-short-word-that-is-also-a-prefix', () => {
    const { words } = typeWord('act')
    expect(words).toEqual([])
    expect(screen.getByTestId('kb-prefix').textContent).toContain('act')

    // The exact word is offered, alongside the longer ones.
    expect(screen.getByTestId('kb-suggest-act')).toBeTruthy()
    expect(screen.getByTestId('kb-suggest-actual')).toBeTruthy()
  })

  it('commits-the-suggestion-the-user-taps', () => {
    const state: { words: readonly string[] } = { words: [] }
    const onChange = vi.fn((next: readonly string[]) => {
      state.words = next
    })
    const { rerender } = render(<WordKeyboard words={[]} onChange={onChange} testId="kb" />)

    for (const letter of 'act') {
      fireEvent.click(screen.getByTestId(`kb-key-${letter}`))
      rerender(<WordKeyboard words={state.words} onChange={onChange} testId="kb" />)
    }
    fireEvent.click(screen.getByTestId('kb-suggest-actor'))
    expect(onChange).toHaveBeenLastCalledWith(['actor'])
  })

  it('backspaces-into-the-prefix-first-and-then-the-words', () => {
    const state: { words: readonly string[] } = { words: ['abandon'] }
    const onChange = vi.fn((next: readonly string[]) => {
      state.words = next
    })
    const { rerender } = render(
      <WordKeyboard words={state.words} onChange={onChange} testId="kb" />
    )

    // Half a word typed: Back removes a letter, not the committed word.
    fireEvent.click(screen.getByTestId('kb-key-a'))
    rerender(<WordKeyboard words={state.words} onChange={onChange} testId="kb" />)
    fireEvent.click(screen.getByTestId('kb-key-c'))
    rerender(<WordKeyboard words={state.words} onChange={onChange} testId="kb" />)
    expect(screen.getByTestId('kb-prefix').textContent).toContain('ac')

    fireEvent.click(screen.getByTestId('kb-back'))
    rerender(<WordKeyboard words={state.words} onChange={onChange} testId="kb" />)
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByTestId('kb-prefix').textContent).toContain('a')

    fireEvent.click(screen.getByTestId('kb-back'))
    rerender(<WordKeyboard words={state.words} onChange={onChange} testId="kb" />)
    // Prefix empty now, so the next Back drops the committed word.
    fireEvent.click(screen.getByTestId('kb-back'))
    expect(onChange).toHaveBeenLastCalledWith([])
  })

  /** A mnemonic may legitimately repeat a word, so position is the identity. */
  it('allows-the-same-word-more-than-once', () => {
    const onChange = vi.fn()
    render(<WordKeyboard words={['abandon', 'abandon']} onChange={onChange} testId="kb" />)
    expect(screen.getByTestId('kb-words').textContent).toContain('1abandon2abandon')
  })

  it('counts-towards-a-target', () => {
    render(<WordKeyboard words={['abandon']} onChange={vi.fn()} target={12} testId="kb" />)
    expect(screen.getByTestId('kb-count').textContent).toBe('1 of 12 words')
  })
})

describe('TextKeyboard', () => {
  /**
   * INV-UI-28. Nothing is transformed that the user did not ask for.
   *
   * A keyboard that capitalised a first letter or corrected a word would build
   * a different wallet, silently, with no way to discover which character it
   * changed.
   */
  it('types-exactly-what-was-tapped', () => {
    let value = ''
    const onChange = vi.fn((next: string) => {
      value = next
    })
    const { rerender } = render(<TextKeyboard value={value} onChange={onChange} testId="pk" />)

    for (const key of ['c', 'a', 't']) {
      fireEvent.click(screen.getByTestId(`pk-key-${key}`))
      rerender(<TextKeyboard value={value} onChange={onChange} testId="pk" />)
    }
    // Lowercase, uncorrected, exactly as tapped.
    expect(value).toBe('cat')
  })

  it('applies-shift-once-and-then-releases-it', () => {
    let value = ''
    const onChange = vi.fn((next: string) => {
      value = next
    })
    const { rerender } = render(<TextKeyboard value={value} onChange={onChange} testId="pk" />)

    fireEvent.click(screen.getByTestId('pk-shift'))
    rerender(<TextKeyboard value={value} onChange={onChange} testId="pk" />)
    fireEvent.click(screen.getByTestId('pk-key-A'))
    rerender(<TextKeyboard value={value} onChange={onChange} testId="pk" />)

    // Back to lowercase, so the next tap is not also a capital.
    fireEvent.click(screen.getByTestId('pk-key-b'))
    rerender(<TextKeyboard value={value} onChange={onChange} testId="pk" />)
    expect(value).toBe('Ab')
  })

  it('reaches-digits-and-symbols', () => {
    let value = ''
    const onChange = vi.fn((next: string) => {
      value = next
    })
    const { rerender } = render(<TextKeyboard value={value} onChange={onChange} testId="pk" />)

    fireEvent.click(screen.getByTestId('pk-symbols'))
    rerender(<TextKeyboard value={value} onChange={onChange} testId="pk" />)
    fireEvent.click(screen.getByTestId('pk-key-7'))
    rerender(<TextKeyboard value={value} onChange={onChange} testId="pk" />)
    fireEvent.click(screen.getByTestId('pk-key-!'))
    rerender(<TextKeyboard value={value} onChange={onChange} testId="pk" />)
    expect(value).toBe('7!')
  })

  /**
   * INV-UI-29. A passphrase on a lit panel is readable across a room, so it is
   * hidden until the user asks. Length shows either way, because a user needs
   * to know a key registered without exposing the value.
   */
  it('hides-the-value-until-asked-and-always-shows-the-length', () => {
    const { rerender } = render(
      <TextKeyboard value="hunter2" onChange={vi.fn()} testId="pk" />
    )

    expect(screen.queryByTestId('pk-plain')).toBeNull()
    expect(screen.getByTestId('pk-hidden').textContent).toBe('•••••••')
    expect(screen.getByTestId('pk-length').textContent).toBe('7')

    fireEvent.click(screen.getByTestId('pk-reveal'))
    rerender(<TextKeyboard value="hunter2" onChange={vi.fn()} testId="pk" />)
    expect(screen.getByTestId('pk-plain').textContent).toBe('hunter2')
  })

  it('backspaces-and-refuses-to-when-empty', () => {
    let value = 'ab'
    const onChange = vi.fn((next: string) => {
      value = next
    })
    const { rerender } = render(<TextKeyboard value={value} onChange={onChange} testId="pk" />)

    fireEvent.click(screen.getByTestId('pk-back'))
    expect(value).toBe('a')

    rerender(<TextKeyboard value="" onChange={onChange} testId="pk" />)
    expect(disabled('pk-back')).toBe(true)
  })

  it('offers-a-return-key-only-when-there-is-somewhere-to-go', () => {
    const onSubmit = vi.fn()
    const { rerender } = render(<TextKeyboard value="x" onChange={vi.fn()} testId="pk" />)
    expect(screen.queryByTestId('pk-enter')).toBeNull()

    rerender(<TextKeyboard value="x" onChange={vi.fn()} onSubmit={onSubmit} testId="pk" />)
    fireEvent.click(screen.getByTestId('pk-enter'))
    expect(onSubmit).toHaveBeenCalled()
  })

  it('types-a-space-without-trimming-it', () => {
    let value = 'a'
    const onChange = vi.fn((next: string) => {
      value = next
    })
    render(<TextKeyboard value={value} onChange={onChange} testId="pk" />)
    fireEvent.click(screen.getByTestId('pk-space'))
    // A passphrase may legitimately end in a space, and silently dropping it
    // would produce a different wallet with no indication why.
    expect(value).toBe('a ')
  })
})
