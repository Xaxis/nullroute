/**
 * Tests for the screen that holds everything else.
 *
 * These moved here from the wallet screen's tests when "More" stopped being a
 * tab and became a rail destination. The contracts are unchanged and were worth
 * keeping: every destination reachable, each row saying what it does rather
 * than carrying a one-word label, and a handler that was not given leaving no
 * row rather than a row that does nothing.
 *
 * Why it moved: once the rail existed, "More" appeared in two places meaning
 * the same thing. It is not a view OF the wallet either. Switching wallets,
 * checking the device and naming the device are not about the open wallet, and
 * half of them lead away from it.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MoreScreen } from '../src/screens/MoreScreen.js'

afterEach(() => {
  cleanup()
})

function mount() {
  const handlers = {
    onMultisig: vi.fn(),
    onProveControl: vi.fn(),
    onCheckProof: vi.fn(),
    onBackup: vi.fn(),
    onLabels: vi.fn(),
    onManage: vi.fn(),
    onSwitchWallet: vi.fn(),
    onCheckDevice: vi.fn(),
    onNameDevice: vi.fn(),
    onChildSeed: vi.fn(),
    onBack: vi.fn(),
  }
  render(<MoreScreen {...handlers} />)
  return handlers
}

describe('MoreScreen', () => {
  /**
   * INV-UI-52. Every destination is reachable, and each says what it does
   * rather than carrying a one-word label.
   */
  it('reaches-every-destination', () => {
    const handlers = mount()

    for (const [testId, handler] of [
      ['wallet-multisig', handlers.onMultisig],
      ['wallet-prove', handlers.onProveControl],
      ['wallet-backup', handlers.onBackup],
      ['wallet-labels', handlers.onLabels],
      ['wallet-manage', handlers.onManage],
      ['wallet-child', handlers.onChildSeed],
    ] as const) {
      fireEvent.click(screen.getByTestId(testId))
      expect(handler, testId).toHaveBeenCalledOnce()
    }

    // Not one-word labels. "Manage" says nothing about erasing a wallet, and
    // this is the row somebody taps expecting a settings page.
    //
    // ERASE FIRST, in the title as well as the description. It read "Name or
    // erase this wallet", which leads with the cosmetic half of a screen
    // somebody arrives at looking for the destructive one, and a user who went
    // hunting for how to delete a wallet did not find it here.
    expect(screen.getByTestId('wallet-manage').textContent).toContain('Erase')
    expect(screen.getByTestId('wallet-manage').textContent).toContain(
      'Remove its seed from this device'
    )
    // And the one that ends in key material on screen says so before the tap.
    expect(screen.getByTestId('wallet-child').textContent).toContain('shows key material')
  })

  /**
   * A handler that was not given leaves no row rather than a row that does
   * nothing. The multisig route has no optional form and is always present.
   */
  it('leaves-out-a-destination-with-nowhere-to-go', () => {
    render(<MoreScreen onMultisig={vi.fn()} onBack={vi.fn()} />)

    expect(screen.getByTestId('wallet-multisig')).toBeTruthy()
    for (const testId of [
      'wallet-prove',
      'wallet-backup',
      'wallet-labels',
      'wallet-manage',
      'wallet-child',
    ]) {
      expect(screen.queryByTestId(testId), testId).toBeNull()
    }
  })

  /**
   * Guide me, Receive and Quorums are in the navigation menu, which is in the
   * header of this screen too, so listing them here offered the same
   * destination twice on the screen somebody had just used the menu to reach.
   * One of them wore a second name while it was here.
   *
   * The quorum gating that used to live on this screen lives on the menu:
   * nav-menu.test.tsx::hides-quorums-on-a-device-that-is-in-none.
   */
  it('does-not-repeat-what-the-menu-already-carries', () => {
    render(<MoreScreen onMultisig={vi.fn()} onBack={vi.fn()} />)

    expect(screen.queryByTestId('wallet-guide')).toBeNull()
    expect(screen.queryByTestId('wallet-receive')).toBeNull()
    expect(screen.queryByTestId('wallet-fleet')).toBeNull()
    // And the name that was only ever here.
    expect(screen.queryByText('Walk me through something')).toBeNull()
  })

  /**
   * The action bar carries a way back and nothing else. Every destination is
   * in the body, where a list of choices belongs, rather than split between a
   * body and a bar.
   */
  it('keeps-the-action-bar-to-the-way-back', () => {
    mount()
    const bar = document.querySelector('.nr-screen__actions')
    const buttons = [...(bar?.querySelectorAll('button') ?? [])].map((b) => b.textContent)
    expect(buttons).toEqual(['Back'])
  })
})
