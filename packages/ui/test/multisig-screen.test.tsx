/**
 * Tests for the multisig registration screen.
 *
 * Agreeing to a quorum is the dangerous step. A descriptor with the user's key
 * swapped out produces a wallet that receives forever and spends never, and
 * every screen after that point looks normal. The daemon refuses such a
 * descriptor, so what this screen has to get right is making the verified facts
 * legible and being honest about which parts were not verified.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  MultisigScreen,
  type OurKeyView,
  type RegistrationView,
} from '../src/screens/MultisigScreen.js'

afterEach(cleanup)

const OUR_KEY: OurKeyView = {
  xpub: 'xpub6E64WfdQwBGz85XhbZryr9gUGUPBgoSu5WV6tJWpzAvgAmpVpdPHkT3XYm',
  path: "m/48'/0'/0'/2'",
  masterFingerprint: '73c5da0a',
  keyExpression: "[73c5da0a/48'/0'/0'/2']xpub6E64WfdQwBGz85XhbZryr9gU",
}

function registration(overrides: Partial<RegistrationView> = {}): RegistrationView {
  return {
    descriptor: 'wsh(sortedmulti(2,a,b,c))#checksum',
    threshold: 2,
    total: 3,
    sorted: true,
    kind: 'wsh',
    ourPosition: 1,
    cosigners: [
      { position: 0, fingerprint: 'aabbccdd', origin: "m/48'/0'/0'/2'", xpub: 'xpub1...aaaa', isThisDevice: false },
      { position: 1, fingerprint: '73c5da0a', origin: "m/48'/0'/0'/2'", xpub: 'xpub2...bbbb', isThisDevice: true },
      { position: 2, fingerprint: undefined, origin: undefined, xpub: 'xpub3...cccc', isThisDevice: false },
    ],
    warnings: [],
    ...overrides,
  }
}

function setup(overrides: Partial<RegistrationView> = {}) {
  const onOurKey = vi.fn().mockResolvedValue(OUR_KEY)
  const onReview = vi.fn().mockResolvedValue(registration(overrides))
  const onRegister = vi.fn().mockResolvedValue(undefined)
  const onBack = vi.fn()
  render(
    <MultisigScreen
      onOurKey={onOurKey}
      onReview={onReview}
      onRegister={onRegister}
      onBack={onBack}
    />
  )
  return { onOurKey, onReview, onRegister, onBack }
}

async function reachReview(): Promise<void> {
  fireEvent.change(screen.getByTestId('multisig-input'), {
    target: { value: 'wsh(sortedmulti(2,a,b,c))#checksum' },
  })
  fireEvent.click(screen.getByTestId('multisig-review'))
  await waitFor(() => {
    expect(screen.getByTestId('multisig-cosigners')).toBeTruthy()
  })
}

describe('ui.screens.multisig', () => {
  // INV-UI-18: the device's own key is offered before anything is asked for,
  // because handing it over is the first half of the exchange.
  it('shows-this-devices-key-to-hand-over', async () => {
    setup()
    await waitFor(() => {
      expect(screen.getByTestId('multisig-our-key')).toBeTruthy()
    })
    const text = screen.getByTestId('multisig-our-key').textContent
    expect(text).toContain("m/48'/0'/0'/2'")
    expect(text).toContain('73c5da0a')
    // And says plainly that it cannot spend, so handing it over is not scary.
    expect(text).toContain('cannot spend')
  })

  it('will-not-check-an-empty-descriptor', () => {
    setup()
    expect(screen.getByTestId<HTMLButtonElement>('multisig-review').disabled).toBe(true)
  })

  // INV-UI-19: reviewing is separate from registering, and the review states
  // the quorum in words rather than leaving it in the descriptor text.
  it('does-not-register-when-checking', async () => {
    const { onRegister } = setup()
    await reachReview()
    expect(onRegister).not.toHaveBeenCalled()

    expect(screen.getByTestId('multisig-quorum').textContent).toContain('2 of 3 must sign')
    expect(screen.getByTestId('multisig-our-position').textContent).toContain('cosigner 2 of 3')
  })

  /**
   * INV-UI-20. The fingerprint beside a cosigner is four bytes chosen by
   * whoever wrote the descriptor. Showing one without saying it is unverified
   * would invite exactly the trust the daemon refuses to place in it.
   */
  it('marks-every-cosigner-except-ours-as-unverified', async () => {
    setup()
    await reachReview()
    const table = screen.getByTestId('multisig-cosigners').textContent

    expect(table).toContain('this device, verified')
    // Two others, both unverified, including the one with no fingerprint.
    expect(table.match(/unverified/g)).toHaveLength(2)
    expect(table).toContain('no fingerprint')
  })

  it('shows-warnings-about-the-quorum-shape', async () => {
    setup({
      threshold: 1,
      warnings: [
        { kind: 'threshold', message: 'This is a 1-of-3 quorum. Any single cosigner can spend.' },
      ],
    })
    await reachReview()
    expect(document.body.textContent).toContain('Any single cosigner can spend')
  })

  it('registers-only-what-was-reviewed', async () => {
    const { onRegister } = setup()
    await reachReview()
    fireEvent.click(screen.getByTestId('multisig-register'))

    await waitFor(() => {
      expect(onRegister).toHaveBeenCalledWith('wsh(sortedmulti(2,a,b,c))#checksum')
    })
    await waitFor(() => {
      expect(screen.getByTestId('multisig-registered')).toBeTruthy()
    })
    // And says the other cosigners must register the same string.
    expect(document.body.textContent).toContain('character for character')
  })

  // A refusal is the expected outcome for a quorum this device is not in, so
  // it has to be shown rather than swallowed, and must not leave a stale review.
  it('shows-a-refusal-and-keeps-nothing-stale', async () => {
    const onReview = vi
      .fn()
      .mockRejectedValue(new Error('This device holds no key in that quorum.'))
    render(
      <MultisigScreen
        onOurKey={vi.fn().mockResolvedValue(OUR_KEY)}
        onReview={onReview}
        onRegister={vi.fn()}
        onBack={vi.fn()}
      />
    )

    fireEvent.change(screen.getByTestId('multisig-input'), {
      target: { value: 'wsh(sortedmulti(2,x,y,z))#bad' },
    })
    fireEvent.click(screen.getByTestId('multisig-review'))

    await waitFor(() => {
      expect(screen.getByTestId('multisig-error').textContent).toContain('holds no key')
    })
    expect(screen.queryByTestId('multisig-cosigners')).toBeNull()
    expect(screen.queryByTestId('multisig-register')).toBeNull()
  })
})

/**
 * Tests for the two halves of registration that are not the descriptor: the
 * file a coordinator exported, and the bundle it needs back.
 *
 * Both were implemented in the daemon and reachable from nowhere. The export is
 * the one that costs money to forget: a quorum every device has agreed to is
 * still invisible to the software that builds the transactions, so the wallet
 * appears to work and shows no balance.
 */
describe('ui.screens.multisig coordinator files', () => {
  const IMPORTED = {
    format: 'coldcard',
    name: 'Family Vault',
    unverifiedClaims: ['Policy: 2 of 3', 'Derivation: m/48h/0h/0h/2h'],
    descriptors: [{ descriptor: 'wsh(sortedmulti(2,a,b,c))#checksum', change: false }],
  }

  function mount(over: Partial<React.ComponentProps<typeof MultisigScreen>> = {}) {
    const onOurKey = vi.fn().mockResolvedValue(OUR_KEY)
    const onReview = vi.fn().mockResolvedValue(registration())
    const onRegister = vi.fn().mockResolvedValue(undefined)
    const onImportFile = vi.fn().mockResolvedValue(IMPORTED)
    const onExportBundle = vi.fn().mockResolvedValue({ bundle: '{"format":"bundle"}' })
    render(
      <MultisigScreen
        onOurKey={onOurKey}
        onReview={onReview}
        onRegister={onRegister}
        onImportFile={onImportFile}
        onExportBundle={onExportBundle}
        registeredCount={1}
        onBack={vi.fn()}
        {...over}
      />
    )
    return { onOurKey, onReview, onRegister, onImportFile, onExportBundle }
  }

  /**
   * INV-UI-46. Reading a coordinator file registers nothing, and what the file
   * asserts about itself is shown as unverified.
   *
   * A coordinator states its policy and derivation in prose. Those lines are a
   * hint about intent and never evidence: only the descriptor decides an
   * address, and a device that treated the header as a fact would be trusting
   * whoever wrote the file.
   */
  it('reads-a-coordinator-file-without-believing-any-of-it', async () => {
    const { onImportFile, onReview, onRegister } = mount()

    fireEvent.change(screen.getByTestId('multisig-input'), { target: { value: 'Name: Family' } })
    fireEvent.click(screen.getByTestId('multisig-import'))

    await waitFor(() => {
      expect(onImportFile).toHaveBeenCalledWith('Name: Family')
    })
    expect(screen.getByTestId('multisig-imported-name').textContent).toBe('Family Vault')

    const claims = screen.getByTestId('multisig-imported-claims').textContent
    expect(claims).toContain('does not check it')
    expect(claims).toContain('Policy: 2 of 3')
    expect(claims).toContain('Only the descriptor decides an address')

    // Reading registered nothing and reviewed nothing.
    expect(onReview).not.toHaveBeenCalled()
    expect(onRegister).not.toHaveBeenCalled()

    // Choosing a descriptor from the file goes through the same review as one
    // typed by hand.
    fireEvent.click(screen.getByTestId('multisig-imported-pick-0'))
    await waitFor(() => {
      expect(onReview).toHaveBeenCalledWith('wsh(sortedmulti(2,a,b,c))#checksum')
    })
    expect(onRegister).not.toHaveBeenCalled()
  })

  /**
   * INV-UI-47. The bundle is offered once something is registered, and says
   * that a quorum every device agreed to is still invisible to the coordinator.
   */
  it('writes-the-bundle-and-says-why-it-matters', async () => {
    const { onExportBundle } = mount()

    fireEvent.click(screen.getByTestId('multisig-export'))
    await waitFor(() => {
      expect(onExportBundle).toHaveBeenCalledOnce()
    })

    expect(screen.getByTestId<HTMLTextAreaElement>('multisig-bundle-text').value).toContain(
      'bundle'
    )
    const note = screen.getByTestId('multisig-bundle-note').textContent
    expect(note).toContain('character for character')
    expect(note).toContain('invisible')
  })

  /**
   * Nothing to export is not an empty file, it is a button that should not be
   * there. Offering it would produce a bundle naming no quorum, which reads to
   * a coordinator as a wallet with nothing in it.
   */
  it('does-not-offer-a-bundle-with-no-quorum-in-it', () => {
    mount({ registeredCount: 0 })
    expect(screen.queryByTestId('multisig-export')).toBeNull()
  })

  it('leaves-both-out-when-there-is-nowhere-to-send-them', () => {
    render(
      <MultisigScreen
        onOurKey={vi.fn().mockResolvedValue(OUR_KEY)}
        onReview={vi.fn()}
        onRegister={vi.fn()}
        onBack={vi.fn()}
      />
    )
    expect(screen.queryByTestId('multisig-import')).toBeNull()
    expect(screen.queryByTestId('multisig-export')).toBeNull()
  })
})
