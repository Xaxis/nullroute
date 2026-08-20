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
    />
  )
}

describe('WalletScreen quorum position', () => {
  /**
   * INV-UI-37. The number that tells three identical devices apart.
   *
   * In the SUBTITLE now. It used to be a card at the top of the body, seventy
   * pixels for one line and a button, on the screen named after an address
   * list that then began below the fold. The header is fixed and already on
   * every screen, so the fact rides for free.
   *
   * The sentence explaining why the number exists moved to the Quorums screen
   * and Name this device, which are about that. It was being charged here on
   * every visit to a screen about something else.
   */
  it('says-which-cosigner-of-how-many-this-device-is', () => {
    withQuorums([{ descriptor: 'wsh(sortedmulti(2,...))#aaaaaaaa', threshold: 2, total: 3, ourPosition: 2, unreadable: null }])

    const shown = document.querySelector('.nr-screen__subtitle')?.textContent
    expect(shown).toContain('2 of 3')
    expect(shown).toContain('cosigner 2')
  })

  /**
   * A quorum this device cannot place itself in is shown as exactly that. A
   * position it had to guess at would be worse than none: the whole value of
   * the number is that it is derived from the keys.
   */
  it('says-when-it-cannot-place-itself-rather-than-showing-a-number', () => {
    withQuorums([{ descriptor: 'wsh(unreadable)#bbbbbbbb', threshold: null, total: null, ourPosition: null, unreadable: 'no key of ours' }])

    const shown = document.querySelector('.nr-screen__subtitle')?.textContent
    expect(shown).toContain('cannot read')
    expect(shown).not.toContain('cosigner')
    // And not "in 1 quorums", which is what a count would have said here and
    // which hides that the device does not know whether it holds a key in it.
    expect(shown).not.toContain('1 quorum')
  })

  it('shows-nothing-for-a-single-signature-wallet', () => {
    withQuorums([])
    const shown = document.querySelector('.nr-screen__subtitle')?.textContent
    expect(shown).toContain('Fingerprint')
    expect(shown).not.toContain('cosigner')
    expect(shown).not.toContain('quorum')
  })

  /**
   * Several quorums are counted rather than listed, and the Quorums
   * destination lists them properly with positions. Three positions in a
   * subtitle is a subtitle nobody reads.
   */
  it('counts-them-when-a-device-is-in-more-than-one', () => {
    withQuorums([
      { descriptor: 'wsh(sortedmulti(2,...))#aaaaaaaa', threshold: 2, total: 3, ourPosition: 1, unreadable: null },
      { descriptor: 'wsh(sortedmulti(3,...))#aaaaaaaa', threshold: 3, total: 5, ourPosition: 4, unreadable: null },
    ])
    expect(document.querySelector('.nr-screen__subtitle')?.textContent).toContain('in 2 quorums')
  })

  /** And an unreadable one among them is counted separately rather than hidden. */
  it('says-how-many-of-several-quorums-it-cannot-read', () => {
    withQuorums([
      { descriptor: 'wsh(sortedmulti(2,...))#aaaaaaaa', threshold: 2, total: 3, ourPosition: 1, unreadable: null },
      { descriptor: 'wsh(unreadable)#bbbbbbbb', threshold: null, total: null, ourPosition: null, unreadable: 'no key of ours' },
    ])
    const shown = document.querySelector('.nr-screen__subtitle')?.textContent
    expect(shown).toContain('in 2 quorums')
    expect(shown).toContain('1 unreadable')
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
        {...handlers}
        {...over}
      />
    )
    return handlers
  }

  /**
   * The action bar carries what acts on THIS screen and nothing else.
   *
   * It used to hold Lock, Sign a transaction, and the address pagination:
   * a session control, a task and a pager at equal weight. Lock and Sign are
   * destinations, so they moved to the navigation rail, which is reachable
   * from every screen rather than from this one.
   */
  it('keeps-the-action-bar-to-what-acts-on-this-screen', () => {
    mount()
    const bar = document.querySelector('.nr-screen__actions')
    const buttons = [...(bar?.querySelectorAll('button') ?? [])].map((b) => b.textContent)
    expect(buttons).toEqual(['Previous', 'Next'])
  })
})
