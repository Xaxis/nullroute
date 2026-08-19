/**
 * Tests for the wallet screen's quorum panel.
 *
 * The fleet problem stated plainly: three identical Raspberry Pis holding one
 * 2-of-3 all show the same wallet name, because they hold the same wallet.
 * Without a cosigner number there is nothing on any screen that tells them
 * apart, and that is how somebody signs with the wrong device or carries the
 * wrong one somewhere.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WalletScreen, type QuorumView } from '../src/screens/WalletScreen.js'

afterEach(cleanup)

function withQuorums(quorums: readonly QuorumView[]) {
  render(
    <WalletScreen
      fingerprint="73c5da0a"
      quorums={quorums}
      onAddresses={vi.fn(async () => Promise.resolve({ addresses: [] }))}
      onDescriptor={vi.fn(async () => Promise.resolve({ descriptor: 'x', checksum: 'y' }))}
      onVerifyAddress={vi.fn(async () => Promise.resolve({ found: false }))}
      onSignTransaction={vi.fn()}
      onMultisig={vi.fn()}
      onLock={vi.fn()}
    />
  )
}

describe('WalletScreen quorum position', () => {
  // INV-UI-37. The number that tells three identical devices apart.
  it('says-which-cosigner-of-how-many-this-device-is', () => {
    withQuorums([{ descriptor: 'wsh(sortedmulti(2,...))#aaaaaaaa', threshold: 2, total: 3, ourPosition: 2, unreadable: null }])

    const shown = screen.getByTestId('wallet-quorums').textContent
    expect(shown).toContain('2 of 3')
    expect(shown).toContain('you are cosigner 2')
    // And says why the number is there at all, since a bare number invites
    // the reader to ignore it.
    expect(shown).toContain('same wallet name')
  })

  /**
   * A quorum this device cannot place itself in is shown as exactly that. A
   * position it had to guess at would be worse than none: the whole value of
   * the number is that it is derived from the keys.
   */
  it('says-when-it-cannot-place-itself-rather-than-showing-a-number', () => {
    withQuorums([{ descriptor: 'wsh(unreadable)#bbbbbbbb', threshold: null, total: null, ourPosition: null, unreadable: 'no key of ours' }])

    const shown = screen.getByTestId('wallet-quorums').textContent
    expect(shown).toContain('cannot place itself')
    expect(shown).not.toContain('you are cosigner')
  })

  it('shows-nothing-for-a-single-signature-wallet', () => {
    withQuorums([])
    expect(screen.queryByTestId('wallet-quorums')).toBeNull()
  })

  it('lists-every-quorum-when-a-device-is-in-more-than-one', () => {
    withQuorums([
      { descriptor: 'wsh(sortedmulti(2,...))#aaaaaaaa', threshold: 2, total: 3, ourPosition: 1, unreadable: null },
      { descriptor: 'wsh(sortedmulti(3,...))#aaaaaaaa', threshold: 3, total: 5, ourPosition: 4, unreadable: null },
    ])
    const shown = screen.getByTestId('wallet-quorums').textContent
    expect(shown).toContain('2 of 3, you are cosigner 1')
    expect(shown).toContain('3 of 5, you are cosigner 4')
  })
})

/**
 * Tests for the xpub export.
 *
 * The descriptor is the export. An xpub is the one that does not carry its own
 * script type, so software that guesses a different one builds a watch-only
 * wallet showing a zero balance for a wallet that has coins in it, and nothing
 * about that looks like an error. It exists because some software still asks
 * for exactly this, and it is placed and worded so nobody reaches for it first.
 */
describe('ui.screens.wallet xpub', () => {
  const XPUB = {
    xpub: 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj',
    path: "m/84'/0'/0'",
    masterFingerprint: '73c5da0a',
  }

  function withXpub(onXpub = vi.fn().mockResolvedValue(XPUB)) {
    render(
      <WalletScreen
        fingerprint="73c5da0a"
        onAddresses={vi.fn(async () => Promise.resolve({ addresses: [] }))}
        onDescriptor={vi.fn(async () =>
          Promise.resolve({ descriptor: "wpkh([73c5da0a/84'/0'/0']xpub.../0/*)#abcdefgh", checksum: 'abcdefgh' })
        )}
        onXpub={onXpub}
        onVerifyAddress={vi.fn()}
        onSignTransaction={vi.fn()}
        onMultisig={vi.fn()}
        onLock={vi.fn()}
      />
    )
    return onXpub
  }

  /**
   * INV-UI-51. The xpub is behind a disclosure, second to the descriptor, and
   * shown with the origin and with what an xpub cannot say about itself.
   */
  it('shows-the-origin-and-says-what-an-xpub-leaves-out', async () => {
    const onXpub = withXpub()
    fireEvent.click(screen.getByTestId('tab-export'))
    await waitFor(() => {
      expect(screen.getByTestId('descriptor')).toBeTruthy()
    })

    // Nothing is derived until it is asked for.
    expect(onXpub).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('xpub-show'))
    await waitFor(() => {
      expect(onXpub).toHaveBeenCalledWith('p2wpkh')
    })

    // The origin, in the brackets a descriptor needs around it, because an
    // xpub pasted without one loses the derivation as well as the type.
    expect(screen.getByTestId('xpub-origin').textContent).toBe("[73c5da0a/84'/0'/0']")

    const note = screen.getByTestId('xpub-note').textContent
    expect(note).toContain('does not say which kind of address')
    expect(note).toContain('zero balance')
    expect(note).toContain('Give the descriptor instead')
  })

  /**
   * An xpub read under the wrong script type is the whole hazard, so changing
   * the type cannot leave the previous one on screen.
   */
  it('drops-the-xpub-when-the-script-type-changes', async () => {
    withXpub()
    fireEvent.click(screen.getByTestId('tab-export'))
    await waitFor(() => {
      expect(screen.getByTestId('descriptor')).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('xpub-show'))
    await waitFor(() => {
      expect(screen.getByTestId('xpub')).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('script-p2tr'))
    expect(screen.queryByTestId('xpub')).toBeNull()
    expect(screen.getByTestId('xpub-show')).toBeTruthy()
  })

  it('is-absent-rather-than-dead-when-there-is-nowhere-to-get-one', async () => {
    render(
      <WalletScreen
        fingerprint="73c5da0a"
        onAddresses={vi.fn(async () => Promise.resolve({ addresses: [] }))}
        onDescriptor={vi.fn(async () =>
          Promise.resolve({ descriptor: 'wpkh(xpub.../0/*)#abcdefgh', checksum: 'abcdefgh' })
        )}
        onVerifyAddress={vi.fn()}
        onSignTransaction={vi.fn()}
        onMultisig={vi.fn()}
        onLock={vi.fn()}
      />
    )
    fireEvent.click(screen.getByTestId('tab-export'))
    await waitFor(() => {
      expect(screen.getByTestId('descriptor')).toBeTruthy()
    })
    expect(screen.queryByTestId('xpub-show')).toBeNull()
  })
})

/**
 * Tests for the destinations tab.
 *
 * These six routes are the only way to reach six features, and until this tab
 * existed they were buttons in the action bar. That bar reached eight buttons
 * one addition at a time and the last two ended up off the right edge of an
 * 800px panel: not clipped, not scrollable, simply absent, on a device with no
 * way to scroll a document or resize a window.
 *
 * Nothing here could see that, and nothing here can: jsdom computes no box
 * model. tools/check-screen-fit.mjs measures the real layout. What these tests
 * hold is the other half, that each route exists at all and that an absent
 * handler leaves no dead control behind.
 */
describe('ui.screens.wallet destinations', () => {
  function mount(over: Partial<React.ComponentProps<typeof WalletScreen>> = {}) {
    const handlers = {
      onMultisig: vi.fn(),
      onProveControl: vi.fn(),
      onBackup: vi.fn(),
      onLabels: vi.fn(),
      onManage: vi.fn(),
      onChildSeed: vi.fn(),
    }
    render(
      <WalletScreen
        fingerprint="73c5da0a"
        onAddresses={vi.fn(async () => Promise.resolve({ addresses: [] }))}
        onDescriptor={vi.fn(async () =>
          Promise.resolve({ descriptor: 'wpkh(xpub.../0/*)#abcdefgh', checksum: 'abcdefgh' })
        )}
        onVerifyAddress={vi.fn()}
        onSignTransaction={vi.fn()}
        onLock={vi.fn()}
        {...handlers}
        {...over}
      />
    )
    return handlers
  }

  /**
   * INV-UI-52. Every destination is reachable, and each says what it does
   * rather than carrying a one-word label.
   */
  it('reaches-every-destination-from-the-more-tab', () => {
    const handlers = mount()
    fireEvent.click(screen.getByTestId('tab-more'))

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
    expect(screen.getByTestId('wallet-manage').textContent).toContain(
      'remove its seed from this device'
    )
    // And the one that ends in key material on screen says so before the tap.
    expect(screen.getByTestId('wallet-child').textContent).toContain('shows key material')
  })

  /**
   * A handler that was not given leaves no row rather than a row that does
   * nothing. The multisig route has no optional form and is always present.
   */
  it('leaves-out-a-destination-with-nowhere-to-go', () => {
    render(
      <WalletScreen
        fingerprint="73c5da0a"
        onAddresses={vi.fn(async () => Promise.resolve({ addresses: [] }))}
        onDescriptor={vi.fn(async () =>
          Promise.resolve({ descriptor: 'wpkh(xpub.../0/*)#abcdefgh', checksum: 'abcdefgh' })
        )}
        onVerifyAddress={vi.fn()}
        onSignTransaction={vi.fn()}
        onMultisig={vi.fn()}
        onLock={vi.fn()}
      />
    )
    fireEvent.click(screen.getByTestId('tab-more'))

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
   * The action bar keeps the way out and the primary action, and nothing else.
   * That is the whole reason the tab exists, so it is worth holding in place.
   */
  it('keeps-the-action-bar-to-the-way-out-and-the-primary-action', () => {
    mount()
    const bar = document.querySelector('.nr-screen__actions')
    const buttons = [...(bar?.querySelectorAll('button') ?? [])].map((b) => b.textContent)
    // Lock, Sign a transaction, and the address pagination. Nothing else.
    expect(buttons).toEqual(['Lock', 'Sign a transaction', 'Previous', 'Next'])
  })
})
