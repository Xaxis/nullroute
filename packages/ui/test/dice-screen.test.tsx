/**
 * Tests for the dice screen.
 *
 * The warning behaviour is the one that matters. A fair die can produce a
 * suspicious sequence, and a device that refused to proceed would be
 * substituting its judgement for the user's entropy, which is the exact failure
 * this project exists to prevent.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DiceScreen, type Accounting, type PatternWarning } from '../src/screens/DiceScreen.js'

afterEach(cleanup)

function accounting(rolls: number, sufficient: boolean): Accounting {
  return {
    rolls,
    bits: Math.floor(rolls * 2.584962500721156),
    targetBits: 256,
    sufficient,
    rollsRemaining: Math.max(0, 100 - rolls),
  }
}

function mount(options: {
  sufficient?: boolean
  warnings?: readonly PatternWarning[]
  onComplete?: (rolls: string, mix: boolean) => void
}) {
  const onComplete = options.onComplete ?? vi.fn()
  const onAccount = vi.fn(async (rolls: string) =>
    Promise.resolve({
      accounting: accounting(rolls.length, options.sufficient ?? false),
      warnings: options.warnings ?? [],
    })
  )
  render(
    <DiceScreen onAccount={onAccount} onComplete={onComplete} onCancel={vi.fn()} />
  )
  return { onComplete, onAccount }
}

describe('ui.screens.dice', () => {
  // INV-UI-7
  it('shows-accounting-from-the-daemon', async () => {
    mount({})
    fireEvent.click(screen.getByTestId('die-4'))
    fireEvent.click(screen.getByTestId('die-2'))
    await waitFor(() => {
      expect(screen.getByTestId('dice-bits').textContent).toContain('of 256 bits')
    })
    // Truncated, not rounded: two rolls is 5.16 bits, shown as 5.
    expect(screen.getByTestId('dice-bits').textContent).toContain('5 of 256')
  })

  it('blocks-continue-until-sufficient', async () => {
    mount({ sufficient: false })
    await waitFor(() => {
      expect(screen.getByTestId<HTMLButtonElement>('dice-continue').disabled).toBe(true)
    })
  })

  it('enables-continue-once-sufficient', async () => {
    const onComplete = vi.fn()
    mount({ sufficient: true, onComplete })
    fireEvent.click(screen.getByTestId('die-1'))
    await waitFor(() => {
      expect(screen.getByTestId<HTMLButtonElement>('dice-continue').disabled).toBe(false)
    })
    fireEvent.click(screen.getByTestId('dice-continue'))
    expect(onComplete).toHaveBeenCalledWith('1', false)
  })

  // INV-UI-8: the warning appears AND the user can still proceed.
  it('warns-without-blocking', async () => {
    mount({
      sufficient: true,
      warnings: [
        { kind: 'uniform', message: 'Every roll is the same value.', detail: 'All 100 rolls are 3.' },
      ],
    })
    fireEvent.click(screen.getByTestId('die-3'))
    await waitFor(() => {
      expect(screen.getByTestId('dice-warning').textContent).toContain('Every roll is the same')
    })
    // Still proceedable. This is the assertion that matters.
    expect(screen.getByTestId<HTMLButtonElement>('dice-continue').disabled).toBe(false)
    expect(screen.getByTestId('dice-warning').textContent).toContain('not a rejection')
  })

  // INV-UI-9
  it('keeps-the-rolls-visible', async () => {
    mount({})
    for (const face of ['1', '4', '2', '5']) fireEvent.click(screen.getByTestId(`die-${face}`))
    await waitFor(() => {
      expect(screen.getByTestId('dice-rolls').textContent).toBe('1425')
    })
    // Undo removes exactly one.
    fireEvent.click(screen.getByTestId('dice-undo'))
    await waitFor(() => {
      expect(screen.getByTestId('dice-rolls').textContent).toBe('142')
    })
  })

  it('accepts-keyboard-entry', async () => {
    mount({})
    fireEvent.keyDown(window, { key: '6' })
    fireEvent.keyDown(window, { key: '3' })
    await waitFor(() => {
      expect(screen.getByTestId('dice-rolls').textContent).toBe('63')
    })
    // A key that is not a die face is ignored rather than recorded.
    fireEvent.keyDown(window, { key: '9' })
    fireEvent.keyDown(window, { key: 'a' })
    await waitFor(() => {
      expect(screen.getByTestId('dice-rolls').textContent).toBe('63')
    })
  })

  it('labels-mixed-mode-as-not-hand-checkable', async () => {
    mount({ sufficient: true })
    const toggle = screen.getByTestId('dice-mix')
    expect(toggle.textContent).toContain('hand-checkable')
    fireEvent.click(toggle)
    await waitFor(() => {
      expect(toggle.textContent).toContain('not hand-checkable')
    })
  })
})
