/**
 * Tests for the navigation menu.
 *
 * WHAT IT REPLACED. First there was no navigation model at all: every screen
 * was a full-screen takeover with its own action bar, and destinations ended up
 * wherever there was room. Then there was a fixed left rail, which fixed that
 * and could not appear on the lock screen, because a rail of wallet
 * destinations has nothing to show before a wallet is open. The first screen
 * anybody meets still had no navigation.
 *
 * A header menu costs nothing until it is opened, which is why it can be on
 * every screen including that one.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { NavMenu } from '../src/components/NavMenu.js'

afterEach(() => {
  cleanup()
})

describe('NavMenu', () => {
  /** INV-UI-91. Every destination goes somewhere, and says which. */
  it('reaches-every-destination', () => {
    const onNavigate = vi.fn()
    render(<NavMenu current="wallet" open onToggle={vi.fn()} onNavigate={onNavigate} />)

    for (const id of ['guide', 'wallet', 'sign', 'receive', 'quorums', 'more', 'lock'] as const) {
      fireEvent.click(screen.getByTestId(`nav-${id}`))
      expect(onNavigate, id).toHaveBeenCalledWith(id)
    }
  })

  /**
   * INV-UI-91. Guide me is a destination rather than a screen you stumble into.
   *
   * It was the entry point that mattered and it was the hardest to reach: an
   * opt-in screen you could dismiss permanently, plus a button on the lock
   * screen and nowhere else. Somebody three screens deep who wanted to know
   * what to do next had no way to ask.
   */
  it('carries-guide-me-as-a-destination', () => {
    const onNavigate = vi.fn()
    render(<NavMenu current="wallet" open onToggle={vi.fn()} onNavigate={onNavigate} />)

    const guide = screen.getByTestId('nav-guide')
    expect(guide.textContent).toContain('Guide me')
    fireEvent.click(guide)
    expect(onNavigate).toHaveBeenCalledWith('guide')
  })

  /**
   * INV-UI-91. Closed, it is one button and nothing else.
   *
   * This is the whole reason it replaced a rail: on a 800x480 panel where the
   * address list was already fighting for room, navigation that is always
   * visible is navigation paid for on every screen.
   */
  it('shows-nothing-until-it-is-opened', () => {
    render(<NavMenu current="wallet" open={false} onToggle={vi.fn()} onNavigate={vi.fn()} />)

    expect(screen.queryByTestId('nav-menu')).toBeNull()
    expect(screen.queryByTestId('nav-wallet')).toBeNull()
    expect(screen.getByTestId('nav-menu-button').getAttribute('aria-expanded')).toBe('false')
  })

  /**
   * INV-UI-91. Where you are is marked, and marked as navigation rather than
   * as a pressed button, so a screen reader says "current page".
   */
  it('marks-where-you-are-as-the-current-page', () => {
    render(<NavMenu current="receive" open onToggle={vi.fn()} onNavigate={vi.fn()} />)

    expect(screen.getByTestId('nav-receive').getAttribute('aria-current')).toBe('page')
    expect(screen.getByTestId('nav-wallet').getAttribute('aria-current')).toBeNull()
  })

  /**
   * INV-UI-91. A device in no quorum is not offered a dead destination. The
   * menu is meant to answer "where can I go", and an entry that leads to an
   * empty list is an answer that wastes a tap.
   */
  it('hides-quorums-on-a-device-that-is-in-none', () => {
    render(
      <NavMenu current="wallet" open onToggle={vi.fn()} onNavigate={vi.fn()} showQuorums={false} />
    )

    expect(screen.queryByTestId('nav-quorums')).toBeNull()
    expect(screen.getByTestId('nav-wallet')).toBeTruthy()
  })

  /**
   * INV-UI-91. Lock is the one entry here that does not take you somewhere, so
   * it is separated and last. Adjacent to a destination it would be one mis-tap
   * from ending the session.
   */
  it('separates-locking-from-the-destinations', () => {
    render(<NavMenu current="wallet" open onToggle={vi.fn()} onNavigate={vi.fn()} />)

    const items = [...screen.getByTestId('nav-menu').querySelectorAll('button')]
    expect(items[items.length - 1]?.getAttribute('data-testid')).toBe('nav-lock')
  })

  /**
   * INV-UI-91. A tap anywhere else closes it, rather than trapping somebody
   * behind a panel on a device with no Escape key.
   */
  it('closes-on-a-tap-outside-it', () => {
    const onToggle = vi.fn()
    render(<NavMenu current="wallet" open onToggle={onToggle} onNavigate={vi.fn()} />)

    fireEvent.click(screen.getByTestId('nav-menu-scrim'))
    expect(onToggle).toHaveBeenCalledOnce()
  })
})

/**
 * The menu only offers what works.
 *
 * Most destinations are ABOUT a wallet. With none open they lead to screens
 * with nothing to show, and a menu whose entries sometimes do nothing teaches
 * somebody not to trust it the time it matters.
 */
describe('NavMenu with no wallet open', () => {
  /** INV-UI-91. */
  it('hides-the-destinations-that-need-a-wallet', () => {
    render(<NavMenu open onToggle={vi.fn()} onNavigate={vi.fn()} walletOpen={false} />)

    for (const id of ['wallet', 'sign', 'receive', 'quorums']) {
      expect(screen.queryByTestId(`nav-${id}`), id).toBeNull()
    }
    // Guide and More both work without one: More is where switching wallets,
    // naming the device, picking a theme and checking the build live.
    expect(screen.getByTestId('nav-guide')).toBeTruthy()
    expect(screen.getByTestId('nav-more')).toBeTruthy()
  })

  /**
   * INV-UI-91. And no Lock, because there is no session to end. A control that
   * does nothing is one somebody learns to distrust.
   */
  it('offers-no-lock-when-there-is-no-session-to-end', () => {
    render(<NavMenu open onToggle={vi.fn()} onNavigate={vi.fn()} walletOpen={false} />)
    expect(screen.queryByTestId('nav-lock')).toBeNull()
  })

  /** INV-UI-91. And they come back when a wallet opens. */
  it('offers-them-again-once-a-wallet-is-open', () => {
    render(<NavMenu current="wallet" open onToggle={vi.fn()} onNavigate={vi.fn()} walletOpen />)
    for (const id of ['wallet', 'sign', 'receive', 'quorums', 'lock']) {
      expect(screen.getByTestId(`nav-${id}`), id).toBeTruthy()
    }
  })
})
