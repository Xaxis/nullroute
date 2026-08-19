/**
 * Tests for the quorum overview.
 *
 * The wallet screen shows a one-line summary and the multisig screen shows one
 * quorum at a time during registration. Neither answers the question somebody
 * holding the second of three devices has: what am I part of, who else is in
 * it, and is any of it finished.
 *
 * The last part is where this screen has to be careful. This device cannot know
 * whether the other cosigners registered, and cannot know whether the
 * coordinator imported the bundle. Both are facts about other machines and this
 * one has no network, so a tick beside "all cosigners registered" would be an
 * invented status. That matters because an unfinished quorum receives money
 * exactly like a finished one.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FleetScreen, type FleetQuorum } from '../src/screens/FleetScreen.js'

afterEach(cleanup)

function quorum(overrides: Partial<FleetQuorum> = {}): FleetQuorum {
  return {
    descriptor: 'wsh(sortedmulti(2,a,b,c))#q35wkfm7',
    checksum: 'q35wkfm7',
    threshold: 2,
    total: 3,
    ourPosition: 2,
    cosigners: [
      {
        position: 0,
        name: 'The attic Pi',
        fingerprint: 'aabbccdd',
        xpub: 'xpub1...aaaa',
        isThisDevice: false,
      },
      { position: 1, fingerprint: '73c5da0a', xpub: 'xpub2...bbbb', isThisDevice: true },
      { position: 2, fingerprint: '11223344', xpub: 'xpub3...cccc', isThisDevice: false },
    ],
    unreadable: null,
    ...overrides,
  }
}

describe('FleetScreen', () => {
  /**
   * INV-UI-82. Every quorum, with this device's position, the checksum the
   * fleet compares, and each cosigner by name where one was given.
   */
  it('shows-each-quorum-with-our-position-and-the-checksum', () => {
    render(<FleetScreen quorums={[quorum()]} deviceName="The one in the attic" onBack={vi.fn()} />)

    expect(screen.getByTestId('fleet-position').textContent).toContain('cosigner 2 of 3')
    expect(screen.getByTestId('fleet-checksum').textContent).toBe('q35wkfm7')

    const card = screen.getByTestId('fleet-quorum').textContent
    expect(card).toContain('2 of 3 must sign')
    expect(card).toContain('The attic Pi')
    expect(card).toContain('this device')
    // A cosigner with no name says so rather than being given one made up from
    // a fingerprint, which is four bytes chosen by whoever wrote the descriptor.
    expect(card).toContain('not named yet')
  })

  /**
   * INV-UI-82. The honest half. This device cannot see other machines, so the
   * outstanding work is a list to confirm rather than a status to read.
   */
  it('says-what-it-cannot-know-rather-than-inventing-a-status', () => {
    render(<FleetScreen quorums={[quorum()]} onBack={vi.fn()} />)

    const said = screen.getByTestId('fleet-cannot-know').textContent
    expect(said).toContain('cannot tell you')
    expect(said).toContain('Whether the other cosigners registered')
    expect(said).toContain('this one has no network')
    // The reason it matters, not just the fact.
    expect(said).toContain('receives money exactly like a finished one')

    // And nothing anywhere claims the quorum is complete.
    expect(document.body.textContent).not.toContain('all cosigners registered')
  })

  /**
   * INV-UI-83. A quorum this device cannot place itself in is shown with the
   * reason rather than omitted. A quorum the device cannot read is exactly what
   * somebody needs to see.
   */
  it('shows-an-unreadable-quorum-with-the-reason', () => {
    render(
      <FleetScreen
        quorums={[
          quorum({
            unreadable: 'This device holds no key in that quorum.',
            threshold: null,
            total: null,
            ourPosition: null,
            cosigners: [],
          }),
        ]}
        onBack={vi.fn()}
      />
    )
    const card = screen.getByTestId('fleet-quorum').textContent
    expect(card).toContain('Cannot be read')
    expect(card).toContain('holds no key in that quorum')
    expect(screen.queryByTestId('fleet-position')).toBeNull()
  })

  it('says-plainly-when-there-are-no-quorums', () => {
    render(<FleetScreen quorums={[]} onBack={vi.fn()} />)
    expect(screen.getByTestId('fleet-empty').textContent).toContain('not in any quorum yet')
    // And the caveat is absent, because there is nothing for it to caveat.
    expect(screen.queryByTestId('fleet-cannot-know')).toBeNull()
  })

  it('leaves-for-the-address-comparison-that-proves-agreement', () => {
    const onAddresses = vi.fn()
    const one = quorum()
    render(<FleetScreen quorums={[one]} onAddresses={onAddresses} onBack={vi.fn()} />)
    fireEvent.click(screen.getByTestId('fleet-addresses'))
    expect(onAddresses).toHaveBeenCalledWith(one)
  })
})
