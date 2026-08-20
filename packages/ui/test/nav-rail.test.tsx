/**
 * Tests for the navigation rail.
 *
 * WHAT IT REPLACED. There was no navigation model at all: every screen was a
 * full-screen takeover with its own action bar, and destinations ended up
 * wherever there was room. "More" was a tab inside the wallet screen, "Sign a
 * transaction" sat in an action bar beside "Lock" and beside pagination for a
 * list, and the one screen that oriented anybody offered to be dismissed
 * permanently.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { NavRail } from '../src/components/NavRail.js'

afterEach(() => {
  cleanup()
})

describe('NavRail', () => {
  /** INV-UI-91. Every destination goes somewhere, and says which. */
  it('reaches-every-destination', () => {
    const onNavigate = vi.fn()
    render(<NavRail current="wallet" onNavigate={onNavigate} />)

    for (const id of ['home', 'wallet', 'sign', 'receive', 'quorums', 'more'] as const) {
      fireEvent.click(screen.getByTestId(`nav-${id}`))
      expect(onNavigate, id).toHaveBeenCalledWith(id)
    }
  })

  /**
   * INV-UI-91. Where you are is marked, and marked as navigation rather than
   * as a pressed button, so a screen reader says "current page".
   */
  it('marks-where-you-are-as-the-current-page', () => {
    render(<NavRail current="receive" onNavigate={vi.fn()} />)

    expect(screen.getByTestId('nav-receive').getAttribute('aria-current')).toBe('page')
    expect(screen.getByTestId('nav-wallet').getAttribute('aria-current')).toBeNull()
  })

  /**
   * INV-UI-91. A device in no quorum is not offered a dead destination. The
   * rail is meant to answer "where can I go", and an entry that leads to an
   * empty list is an answer that wastes a tap.
   */
  it('hides-quorums-on-a-device-that-is-in-none', () => {
    render(<NavRail current="wallet" onNavigate={vi.fn()} showQuorums={false} />)

    expect(screen.queryByTestId('nav-quorums')).toBeNull()
    expect(screen.getByTestId('nav-wallet')).toBeTruthy()
  })

  /**
   * INV-UI-91. Lock is the one control here that does not take you somewhere,
   * so it is separated and last. Adjacent to a destination it would be one
   * mis-tap from ending the session.
   */
  it('separates-locking-from-the-destinations', () => {
    const onLock = vi.fn()
    render(<NavRail current="wallet" onNavigate={vi.fn()} onLock={onLock} />)

    const items = [...screen.getByTestId('nav-rail').querySelectorAll('button')]
    expect(items[items.length - 1]?.getAttribute('data-testid')).toBe('nav-lock')

    fireEvent.click(screen.getByTestId('nav-lock'))
    expect(onLock).toHaveBeenCalledOnce()
  })

  /** INV-UI-91. And a rail with nowhere to lock simply has no lock. */
  it('offers-no-lock-when-there-is-no-session-to-end', () => {
    render(<NavRail current="home" onNavigate={vi.fn()} />)
    expect(screen.queryByTestId('nav-lock')).toBeNull()
  })
})
