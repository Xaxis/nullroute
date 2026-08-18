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
import { cleanup, render, screen } from '@testing-library/react'
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
    withQuorums([{ threshold: 2, total: 3, ourPosition: 2, unreadable: null }])

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
    withQuorums([{ threshold: null, total: null, ourPosition: null, unreadable: 'no key of ours' }])

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
      { threshold: 2, total: 3, ourPosition: 1, unreadable: null },
      { threshold: 3, total: 5, ourPosition: 4, unreadable: null },
    ])
    const shown = screen.getByTestId('wallet-quorums').textContent
    expect(shown).toContain('2 of 3, you are cosigner 1')
    expect(shown).toContain('3 of 5, you are cosigner 4')
  })
})
