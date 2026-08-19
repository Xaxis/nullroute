/**
 * Tests for the warning that comes before the wallet locks itself.
 *
 * The lock is tested in the daemon, which is where it happens. What is checked
 * here is that a person gets told before it does, because a lock that arrives
 * with no warning is indistinguishable from a crash.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { IdleBanner } from '../src/components/IdleBanner.js'

afterEach(() => {
  cleanup()
})

describe('IdleBanner', () => {
  /** INV-UI-85. The number is the point, and it has to be readable as English. */
  it('says-how-long-is-left-and-what-happens', () => {
    render(<IdleBanner remaining={42} onStayOpen={() => undefined} />)
    expect(screen.getByTestId('idle-countdown').textContent).toBe('Locking in 42s')
  })

  /**
   * INV-UI-85. It has to announce itself rather than only appear. A person
   * mid-review is looking at the body of the screen, not the header, and a
   * countdown that is merely present is a countdown nobody sees start.
   */
  it('announces-itself-rather-than-only-appearing', () => {
    render(<IdleBanner remaining={30} onStayOpen={() => undefined} />)
    expect(screen.getByTestId('idle-banner').getAttribute('role')).toBe('alert')
  })

  /**
   * INV-UI-85. The button exists for somebody looking at the screen rather than
   * touching it, which is the whole population this would otherwise interrupt.
   */
  it('offers-a-way-to-stay-open-without-losing-the-screen', () => {
    const stay = vi.fn()
    render(<IdleBanner remaining={30} onStayOpen={stay} />)
    fireEvent.click(screen.getByTestId('idle-stay-open'))
    expect(stay).toHaveBeenCalledTimes(1)
  })

  /**
   * INV-UI-85. It sits in a header that already holds a title, a device name, a
   * network tag and a wallet chip, on an 800px panel. Written as a paragraph it
   * pushed the transaction somebody was reading off the display, which is a
   * worse outcome than the lock it was warning about. Two elements, no prose.
   */
  it('stays-small-enough-for-a-header-that-is-already-full', () => {
    const { container } = render(<IdleBanner remaining={10} onStayOpen={() => undefined} />)
    const chip = screen.getByTestId('idle-banner')
    expect(chip.children).toHaveLength(2)
    expect(container.textContent).toBe('Locking in 10sStay open')
  })
})
