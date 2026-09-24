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
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

/**
 * Forgetting a quorum.
 *
 * A quorum registered by mistake was permanent, which is a strange property for
 * the step the documentation calls the dangerous one. A descriptor with a typo,
 * or one for a wallet somebody stopped using, sat there deciding which outputs
 * this device calls change.
 */
/**
 * Type on the device's own keyboard, the way somebody holding it has to.
 *
 * NOT `fireEvent.change`, which is what these tests did. This screen has no
 * field any more: the keyboard's own readout is the field, because a labelled
 * input above the keys showed the same eight characters twice and cost 82px on
 * a panel with 70 to spend. Setting an input's value was also a route the
 * hardware does not have, which is how five fields on another screen came to be
 * fillable in a browser and nowhere else.
 */
function tapOut(text: string): void {
  for (const character of text) {
    if (character === ' ') {
      fireEvent.click(screen.getByTestId('pk-space'))
      continue
    }
    const letter = /[a-zA-Z]/.test(character)
    const onSymbols = screen.getByTestId('pk-symbols').textContent === 'abc'
    if (letter === onSymbols) fireEvent.click(screen.getByTestId('pk-symbols'))
    if (/[A-Z]/.test(character)) fireEvent.click(screen.getByTestId('pk-shift'))
    fireEvent.click(screen.getByTestId(`pk-key-${character}`))
  }
}

describe('FleetScreen forgetting', () => {
  function reachConfirm(persisted = false) {
    const onForget = vi.fn().mockResolvedValue({ persisted })
    render(<FleetScreen quorums={[quorum()]} onForget={onForget} onBack={vi.fn()} />)
    fireEvent.click(screen.getByTestId('fleet-forget-start'))
    return onForget
  }

  /**
   * INV-UI-84. Confirmed by typing the checksum, not by a second tap. On a 7
   * inch panel the second tap lands where the first one did.
   */
  it('will-not-forget-on-a-tap', async () => {
    const onForget = reachConfirm()

    expect(screen.getByTestId<HTMLButtonElement>('fleet-forget-submit').disabled).toBe(true)
    // Seven of the eight is still a miss, and it is tapped out on the keys,
    // which is the only way in on this hardware.
    tapOut('q35wkfm')
    expect(screen.getByTestId<HTMLButtonElement>('fleet-forget-submit').disabled).toBe(true)

    tapOut('7')
    expect(screen.getByTestId<HTMLButtonElement>('fleet-forget-submit').disabled).toBe(false)
    fireEvent.click(screen.getByTestId('fleet-forget-submit'))
    await waitFor(() => {
      expect(onForget).toHaveBeenCalledOnce()
    })
  })

  /**
   * INV-UI-84. It says what forgetting actually costs, which is not what people
   * assume. A registration is not a key, so nothing here loses money: what is
   * lost is the device recognising that quorum's change as its own.
   */
  it('says-what-forgetting-costs-and-what-it-does-not', () => {
    reachConfirm()
    const said = screen.getByTestId('fleet-forget-cost').textContent
    expect(said).toContain('does not lose any money')
    expect(said).toContain('A registration is not a key')
    expect(said).toContain('read as a payment to a stranger')
    // And how to undo it.
    expect(said).toContain('register the descriptor again')
    // What to do about it is advice rather than warning, so it sits below the
    // keys. The warning above them is a heading and two lines because the
    // panel holds a keyboard and the budget above it is 70px.
    expect(screen.getByTestId('fleet-forget-keep').textContent).toContain('Keep the descriptor')
  })

  /**
   * INV-UI-84. The checksum stays on the panel while it is being copied.
   *
   * IT USED TO BE A PLACEHOLDER AND NOTHING ELSE, on the field and on the
   * keyboard, so the eight characters somebody was asked to reproduce vanished
   * the moment they typed the first one. The header does not scroll.
   */
  it('keeps-the-checksum-on-screen-while-it-is-being-typed', () => {
    reachConfirm()
    expect(screen.getByTestId('fleet-forget').textContent).toContain('q35wkfm7')
    tapOut('q35')
    // Still there, with three characters typed against it.
    expect(screen.getByTestId('fleet-forget').textContent).toContain('q35wkfm7')
    // And what was typed is readable rather than masked, because comparing it
    // against the header is the whole gesture and dots compare to nothing.
    expect(screen.getByTestId('pk-plain').textContent).toBe('q35')
  })

  it('reports-a-refusal-rather-than-claiming-it-went', async () => {
    const onForget = vi.fn().mockRejectedValue(new Error('This device has no registration.'))
    render(<FleetScreen quorums={[quorum()]} onForget={onForget} onBack={vi.fn()} />)
    fireEvent.click(screen.getByTestId('fleet-forget-start'))
    tapOut('q35wkfm7')
    fireEvent.click(screen.getByTestId('fleet-forget-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('fleet-forget-error').textContent).toContain('no registration')
    })
    expect(screen.getByTestId('fleet-forget')).toBeTruthy()
  })

  /**
   * INV-UI-104. A removal the daemon held for the session is reported as that.
   * The saved wallet still holds the quorum, so it is back at the next unlock,
   * and a list that quietly lost it would read as permanent.
   */
  it('says-a-removal-lasts-for-the-session-when-the-daemon-did-not-save-it', async () => {
    reachConfirm(false)
    tapOut('q35wkfm7')
    fireEvent.click(screen.getByTestId('fleet-forget-submit'))
    await waitFor(() => {
      expect(screen.getByTestId('fleet-forgot').textContent).toContain('back at the next unlock')
    })
    expect(screen.getByTestId('fleet-forgot').textContent).toContain('for this session')
  })

  it('says-a-removal-is-saved-only-when-the-daemon-said-so', async () => {
    reachConfirm(true)
    tapOut('q35wkfm7')
    fireEvent.click(screen.getByTestId('fleet-forget-submit'))
    await waitFor(() => {
      expect(screen.getByTestId('fleet-forgot').textContent).toContain('removed from the saved')
    })
    expect(screen.getByTestId('fleet-forgot').textContent).not.toContain('next unlock')
  })

  it('offers-nothing-when-there-is-nowhere-to-send-it', () => {
    render(<FleetScreen quorums={[quorum()]} onBack={vi.fn()} />)
    expect(screen.queryByTestId('fleet-forget-start')).toBeNull()
  })
})
