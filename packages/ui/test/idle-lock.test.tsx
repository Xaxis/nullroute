/**
 * Tests for the idle lock hook.
 *
 * WHY THIS FILE EXISTS. The hook had no test, and it shipped a bug that made a
 * device unable to create a wallet at all: the heartbeat listeners were mounted
 * only while a wallet was open, so nothing during setup told the daemon a
 * person was there. On a device that had been on for longer than the window,
 * the daemon's clock was already expired, and the first request after
 * `entropy.fromDice` loaded the new seed locked it again before the words could
 * be read. A hundred dice rolls and a dead Continue button.
 *
 * The listeners are on the document rather than on a component, so these drive
 * real events at the document rather than firing React synthetic ones.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { type ReactElement } from 'react'
import { useIdleLock } from '../src/lib/idle.js'

afterEach(cleanup)

function Harness(props: {
  readonly unlocked: boolean
  readonly beat: () => Promise<{ seconds: number; warnAt: number } | null>
}): ReactElement {
  const state = useIdleLock({ unlocked: props.unlocked, beat: props.beat, lock: () => undefined })
  return <span data-testid="remaining">{String(state.remaining)}</span>
}

/** A real pointerdown at the document, which is where the hook listens. */
function touch(): void {
  document.dispatchEvent(new Event('pointerdown', { bubbles: true }))
}

describe('the idle lock', () => {
  /**
   * INV-UI-98. The window means "since a person last touched this", and that
   * sentence says nothing about whether a wallet is open.
   *
   * THE BUG THIS EXISTS FOR, exactly. Setting a device up happens with no
   * wallet open by definition: rolling a hundred dice, reading the words,
   * typing them back. All of that used to send no heartbeat at all, so the
   * daemon believed nobody had touched the device since it booted.
   */
  it('tells-the-daemon-a-person-is-here-even-with-no-wallet-open', async () => {
    const beat = vi.fn(async () => Promise.resolve({ seconds: 600, warnAt: 60 }))
    render(<Harness unlocked={false} beat={beat} />)
    beat.mockClear()

    touch()

    await waitFor(() => {
      expect(beat).toHaveBeenCalled()
    })
  })

  /**
   * INV-UI-98. And still does the thing it always did: one heartbeat the moment
   * a wallet opens, which is how the frontend learns the window at all.
   */
  it('tells-the-daemon-a-person-is-here-with-a-wallet-open', async () => {
    const beat = vi.fn(async () => Promise.resolve({ seconds: 600, warnAt: 60 }))
    render(<Harness unlocked beat={beat} />)

    await waitFor(() => {
      expect(beat).toHaveBeenCalled()
    })
  })

  /**
   * INV-UI-98. Throttled, because this fires on every touch of a touchscreen
   * and a heartbeat per tap would be a request storm on hardware this slow. The
   * daemon's window is ten minutes and the throttle is fifteen seconds, so
   * nothing is ever close to being late.
   *
   * Asserted here so the previous test's silence is understood rather than
   * assumed: with a wallet open the mount heartbeat has already fired, so a
   * touch immediately afterwards is meant to send nothing.
   */
  it('does-not-send-a-heartbeat-for-every-tap', async () => {
    const beat = vi.fn(async () => Promise.resolve({ seconds: 600, warnAt: 60 }))
    render(<Harness unlocked beat={beat} />)
    await waitFor(() => {
      expect(beat).toHaveBeenCalled()
    })
    beat.mockClear()

    touch()
    touch()
    touch()

    expect(beat).not.toHaveBeenCalled()
  })

  /**
   * INV-UI-98. The countdown is still about an open wallet, which is what the
   * `unlocked` flag is legitimately for. A device showing "locking in 42s" with
   * nothing to lock would be an alarm about nothing.
   */
  it('counts-down-only-when-there-is-a-wallet-to-lock', async () => {
    const beat = vi.fn(async () => Promise.resolve({ seconds: 600, warnAt: 60 }))
    const { getByTestId } = render(<Harness unlocked={false} beat={beat} />)

    touch()
    await waitFor(() => {
      expect(beat).toHaveBeenCalled()
    })

    expect(getByTestId('remaining').textContent).toBe('null')
  })
})
