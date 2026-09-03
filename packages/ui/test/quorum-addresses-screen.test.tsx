/**
 * Tests for the quorum addresses screen.
 *
 * This is the screen several devices compare against each other. A multisig
 * address is derived from every cosigner's key at once, so two devices showing
 * the same address at the same index is the only cheap proof that all of them
 * registered the same descriptor. What is checked here is that the comparison
 * cannot be got wrong: the index shown is the index derived, the branch is
 * explicit, and a stale page never sits under a fresh header.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QuorumAddressesScreen } from '../src/screens/QuorumAddressesScreen.js'

afterEach(cleanup)

const DESCRIPTOR = 'wsh(sortedmulti(2,[aaaaaaaa/48h/0h/0h/2h]xpub.../<0;1>/*,...))#abcdefgh'

function addressesFor(change: boolean, start: number, count: number) {
  return {
    change,
    addresses: Array.from({ length: count }, (_, i) => ({
      address: `${change ? 'change' : 'recv'}-${String(start + i)}`,
      index: start + i,
    })),
  }
}

function setup(overrides: Partial<React.ComponentProps<typeof QuorumAddressesScreen>> = {}) {
  const onAddresses = vi.fn(async (_d: string, change: boolean, start: number, count: number) =>
    Promise.resolve(addressesFor(change, start, count))
  )
  const onBack = vi.fn()
  render(
    <QuorumAddressesScreen
      descriptor={DESCRIPTOR}
      position={{ ours: 2, of: 3 }}
      onAddresses={onAddresses}
      onBack={onBack}
      {...overrides}
    />
  )
  return { onAddresses, onBack }
}

describe('QuorumAddressesScreen', () => {
  /**
   * INV-UI-45. The addresses are derived from the registered descriptor, and
   * the screen says what comparing them proves.
   */
  it('derives-from-the-descriptor-and-says-what-a-match-proves', async () => {
    const { onAddresses } = setup()
    await waitFor(() => {
      expect(onAddresses).toHaveBeenCalledWith(DESCRIPTOR, false, 0, 10)
    })

    expect(screen.getByTestId('quorum-rows').textContent).toContain('recv-0')
    // Which cosigner this device is, in the header, because three devices in a
    // quorum all show the same wallet name.
    expect(document.querySelector('.nr-screen__subtitle')?.textContent).toContain('cosigner 2 of 3')

    const note = screen.getByTestId('quorum-compare').textContent
    expect(note).toContain('another device in this quorum')
    expect(note).toContain('do not send anything')
  })

  it('shows-receive-and-change-separately-and-restarts-the-page', async () => {
    const { onAddresses } = setup()
    await waitFor(() => {
      expect(onAddresses).toHaveBeenCalledTimes(1)
    })

    fireEvent.click(screen.getByTestId('quorum-next'))
    await waitFor(() => {
      expect(onAddresses).toHaveBeenCalledWith(DESCRIPTOR, false, 10, 10)
    })

    // Switching branch goes back to index 0. Comparing a change address at
    // index 10 against a receive address at index 10 on another device would
    // disagree for a reason that has nothing to do with the descriptor.
    fireEvent.click(screen.getByTestId('quorum-branch-change'))
    await waitFor(() => {
      expect(onAddresses).toHaveBeenCalledWith(DESCRIPTOR, true, 0, 10)
    })
    expect(screen.getByTestId('quorum-rows').textContent).toContain('change-0')
  })

  /**
   * INV-UI-45. A page that failed to derive must not leave the previous one on
   * screen: a user reading index 0 under a header that says index 10 and
   * comparing it with another device is the exact mistake this screen exists to
   * prevent.
   */
  it('clears-the-page-rather-than-leaving-a-stale-one-under-a-new-header', async () => {
    let call = 0
    const onAddresses = vi.fn(async (_d: string, change: boolean, start: number, count: number) => {
      call += 1
      if (call === 2) throw new Error('That descriptor no longer parses.')
      return Promise.resolve(addressesFor(change, start, count))
    })
    setup({ onAddresses })

    await waitFor(() => {
      expect(screen.getByTestId('quorum-rows').textContent).toContain('recv-0')
    })

    fireEvent.click(screen.getByTestId('quorum-next'))
    await waitFor(() => {
      expect(screen.getByTestId('quorum-error').textContent).toContain('no longer parses')
    })
    // Nothing from the previous page survived.
    expect(screen.getByTestId('quorum-rows').textContent).not.toContain('recv-0')
  })

  it('says-nothing-about-a-position-it-was-not-given', () => {
    setup({ position: undefined })
    const subtitle = document.querySelector('.nr-screen__subtitle')?.textContent ?? ''
    expect(subtitle).not.toContain('cosigner')
    expect(subtitle).toContain('Derived on this device')
  })

  it('cannot-page-back-past-the-first-address', () => {
    setup()
    expect(screen.getByTestId<HTMLButtonElement>('quorum-prev').disabled).toBe(true)
  })
})
