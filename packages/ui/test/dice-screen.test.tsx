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

/**
 * Letting the device roll for you.
 *
 * Rolling 100 dice by hand is ten minutes, and somebody who will not spend it
 * is better served by a device that offers this and says what it costs than by
 * one that pretends the option does not exist.
 *
 * What it costs is the whole point: you did not watch these land. The
 * arithmetic downstream stays checkable, and the roll string itself is as
 * trustworthy as the device, which is the thing dice exist to avoid trusting. A
 * device that wanted to hand you a seed it had chosen would do it exactly here.
 */
describe('ui.screens.dice rolling for you', () => {
  function withDevice(rolls = '4') {
    const onRollForMe = vi.fn(async (count: number) =>
      Promise.resolve({ rolls: rolls.repeat(count).slice(0, count) })
    )
    render(
      <DiceScreen
        onAccount={vi.fn(async (entered: string) =>
          Promise.resolve({
            accounting: {
              rolls: entered.length,
              bits: entered.length * 2,
              targetBits: 256,
              sufficient: entered.length >= 100,
              rollsRemaining: Math.max(0, 100 - entered.length),
            },
            warnings: [],
          })
        )}
        onComplete={vi.fn()}
        onCancel={vi.fn()}
        onRollForMe={onRollForMe}
      />
    )
    return onRollForMe
  }

  /**
   * INV-UI-76. One roll at a time, and the rest in one go, both from the
   * device's generator rather than anything in the browser.
   */
  it('rolls-one-and-rolls-the-rest', async () => {
    const onRollForMe = withDevice()

    fireEvent.click(screen.getByTestId('dice-roll-one'))
    await waitFor(() => {
      expect(onRollForMe).toHaveBeenCalledWith(1)
    })
    await waitFor(() => {
      expect(screen.getByTestId('dice-rolls').textContent).toBe('4')
    })

    fireEvent.click(screen.getByTestId('dice-roll-rest'))
    await waitFor(() => {
      expect(onRollForMe).toHaveBeenCalledWith(99)
    })
  })

  /**
   * INV-UI-76. The screen counts how many rolls it chose and says so, because a
   * string that is part hand-rolled and part device-rolled is neither, and only
   * the count makes that legible.
   */
  it('says-how-many-of-the-rolls-it-chose-itself', async () => {
    withDevice()

    // Two by hand first.
    fireEvent.click(screen.getByTestId('die-1'))
    fireEvent.click(screen.getByTestId('die-6'))
    expect(screen.queryByTestId('dice-device-warning')).toBeNull()

    fireEvent.click(screen.getByTestId('dice-roll-one'))
    await waitFor(() => {
      expect(screen.getByTestId('dice-device-warning')).toBeTruthy()
    })

    const said = screen.getByTestId('dice-device-warning').textContent
    expect(said).toContain('1 of 3 rolls came from the device')
    expect(said).toContain('did not watch those land')
    expect(said).toContain('Rolling by hand is the only version')
  })

  it('says-nothing-when-every-roll-was-entered-by-hand', () => {
    withDevice()
    fireEvent.click(screen.getByTestId('die-3'))
    expect(screen.queryByTestId('dice-device-warning')).toBeNull()
  })

  /**
   * A device that does not offer this at all renders no control for it, rather
   * than a disabled one that reads as a feature somebody forgot to finish.
   */
  it('offers-nothing-when-there-is-no-generator-to-ask', () => {
    render(
      <DiceScreen
        onAccount={vi.fn(async () =>
          Promise.resolve({
            accounting: { rolls: 0, bits: 0, targetBits: 256, sufficient: false, rollsRemaining: 100 },
            warnings: [],
          })
        )}
        onComplete={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    expect(screen.queryByTestId('dice-device')).toBeNull()
    expect(screen.queryByTestId('dice-roll-one')).toBeNull()
  })
})
