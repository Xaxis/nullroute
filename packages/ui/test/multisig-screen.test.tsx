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
      {
        position: 0,
        fingerprint: 'aabbccdd',
        origin: "m/48'/0'/0'/2'",
        xpub: 'xpub1...aaaa',
        isThisDevice: false,
      },
      {
        position: 1,
        fingerprint: '73c5da0a',
        origin: "m/48'/0'/0'/2'",
        xpub: 'xpub2...bbbb',
        isThisDevice: true,
      },
      {
        position: 2,
        fingerprint: undefined,
        origin: undefined,
        xpub: 'xpub3...cccc',
        isThisDevice: false,
      },
    ],
    warnings: [],
    ...overrides,
  }
}

function setup(overrides: Partial<RegistrationView> = {}) {
  const onOurKey = vi.fn().mockResolvedValue(OUR_KEY)
  const onReview = vi.fn().mockResolvedValue(registration(overrides))
  const onRegister = vi.fn().mockResolvedValue({ persisted: false })
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
    const onRegister = vi.fn().mockResolvedValue({ persisted: false })
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
      expect(screen.getByTestId('multisig-imported-name').textContent).toBe('Family Vault')
    })
    expect(onImportFile).toHaveBeenCalledWith('Name: Family')

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
      expect(screen.getByTestId<HTMLTextAreaElement>('multisig-bundle-text').value).toContain(
        'bundle'
      )
    })
    expect(onExportBundle).toHaveBeenCalledOnce()
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

/**
 * Naming the other keys.
 *
 * The cosigner table was a list of anonymous extended keys. On the second
 * device of three you were looking at two strings and trying to remember which
 * physical object each one was, which is the exact question a fleet has and the
 * one nothing on the device answered.
 */
describe('ui.screens.multisig cosigner names', () => {
  const FULL_XPUB = 'xpub6DwwuunwScQuscvvkT8Q2gRUcvV8DXcnpXhcnVFP6EPq6MTfWSJ9zJdWi1S8mvNMj'

  function named(overrides: Partial<RegistrationView> = {}): RegistrationView {
    return {
      ...registration(),
      cosigners: [
        {
          position: 0,
          name: 'The attic Pi',
          fullXpub: FULL_XPUB,
          fingerprint: 'aabbccdd',
          origin: "m/48'/0'/0'/2'",
          xpub: 'xpub1...aaaa',
          isThisDevice: false,
        },
        {
          position: 1,
          fullXpub: `${FULL_XPUB}b`,
          fingerprint: '73c5da0a',
          origin: "m/48'/0'/0'/2'",
          xpub: 'xpub2...bbbb',
          isThisDevice: true,
        },
      ],
      ...overrides,
    }
  }

  async function reach(
    onNameCosigner?: (xpub: string, name: string) => Promise<{ persisted: boolean }>
  ) {
    render(
      <MultisigScreen
        onOurKey={vi.fn().mockResolvedValue(OUR_KEY)}
        onReview={vi.fn().mockResolvedValue(named())}
        onRegister={vi.fn()}
        onBack={vi.fn()}
        {...(onNameCosigner === undefined ? {} : { onNameCosigner })}
      />
    )
    fireEvent.change(screen.getByTestId('multisig-input'), {
      target: { value: 'wsh(sortedmulti(2,a,b))#checksum' },
    })
    fireEvent.click(screen.getByTestId('multisig-review'))
    await waitFor(() => {
      expect(screen.getByTestId('multisig-cosigners')).toBeTruthy()
    })
  }

  /**
   * INV-UI-81. A name is shown above the key, and marked as the user's own
   * rather than presented as a fact. It says nothing about who controls that
   * key: only the key does.
   */
  it('shows-a-name-above-the-key-and-marks-it-as-the-users-own', async () => {
    await reach()
    const cell = screen.getByTestId('cosigner-name-0').textContent
    expect(cell).toContain('The attic Pi')
    expect(cell).toContain('your name for it')
    // The unverified line for the key itself is still there. A name does not
    // upgrade a fingerprint.
    expect(screen.getByTestId('multisig-cosigners').textContent).toContain('unverified')
  })

  /**
   * INV-UI-81. Naming sends the FULL extended key, not the abbreviation on
   * screen. Two different keys can share their first and last eight
   * characters, and a name attached to the wrong key is worse than no name.
   */
  it('names-a-key-by-its-full-value-not-the-abbreviation', async () => {
    const onNameCosigner = vi.fn().mockResolvedValue({ persisted: false })
    await reach(onNameCosigner)

    const field = screen.getByTestId('cosigner-rename-0')
    fireEvent.change(field, { target: { value: 'Office' } })
    fireEvent.blur(field)

    await waitFor(() => {
      expect(onNameCosigner).toHaveBeenCalledWith(FULL_XPUB, 'Office')
    })
  })

  /**
   * INV-UI-104. A name the daemon held for the session is not shown as saved.
   * The screen sends no passphrase with a name, so the daemon answers
   * `persisted: false`, and the line under the table repeats that answer
   * rather than letting a name that goes at the next lock look kept.
   */
  it('says-a-name-lasts-until-the-lock-when-the-daemon-did-not-save-it', async () => {
    await reach(vi.fn().mockResolvedValue({ persisted: false }))
    const field = screen.getByTestId('cosigner-rename-0')
    fireEvent.change(field, { target: { value: 'Office' } })
    fireEvent.blur(field)
    await waitFor(() => {
      expect(screen.getByTestId('multisig-name-outcome').textContent).toContain(
        'lasts until the device locks'
      )
    })
  })

  it('says-a-name-is-saved-only-when-the-daemon-said-so', async () => {
    await reach(vi.fn().mockResolvedValue({ persisted: true }))
    const field = screen.getByTestId('cosigner-rename-0')
    fireEvent.change(field, { target: { value: 'Office' } })
    fireEvent.blur(field)
    await waitFor(() => {
      expect(screen.getByTestId('multisig-name-outcome').textContent).toContain(
        'saved with this wallet'
      )
    })
  })

  /**
   * This device is not named: it is identified by re-deriving its key, which
   * is a stronger claim than a nickname, and offering to rename it would
   * invite treating the two as the same kind of thing.
   */
  it('does-not-offer-to-name-this-device', async () => {
    await reach(vi.fn())
    expect(screen.queryByTestId('cosigner-rename-1')).toBeNull()
    expect(screen.getByTestId('multisig-cosigners').textContent).toContain('this device, verified')
  })

  it('shows-no-naming-field-when-there-is-nowhere-to-send-it', async () => {
    await reach()
    expect(screen.queryByTestId('cosigner-rename-0')).toBeNull()
  })
})

/**
 * Whether a registration outlives the next lock.
 *
 * The daemon writes a registration into the sealed wallet only when it is given
 * the wallet's passphrase, and otherwise holds it for the session and answers
 * `persisted: false`. The screen sent no passphrase and ignored the answer, and
 * said the device would recognise the quorum from now on. Every quorum
 * registered on the device went at the next lock, the idle one included.
 */
describe('ui.screens.multisig saving with the wallet', () => {
  function mount(
    storedWallet: boolean,
    onRegister: (descriptor: string, passphrase?: string) => Promise<{ persisted: boolean }>
  ) {
    render(
      <MultisigScreen
        onOurKey={vi.fn().mockResolvedValue(OUR_KEY)}
        onReview={vi.fn().mockResolvedValue(registration())}
        onRegister={onRegister}
        storedWallet={storedWallet}
        onBack={vi.fn()}
      />
    )
  }

  function tap(text: string): void {
    for (const character of text) fireEvent.click(screen.getByTestId(`pk-key-${character}`))
  }

  /**
   * INV-UI-104. With a saved wallet open, registering asks for its passphrase
   * on the device's own keyboard, and cannot be tapped until one is typed.
   */
  it('will-not-register-into-a-saved-wallet-without-its-passphrase', async () => {
    const onRegister = vi.fn().mockResolvedValue({ persisted: true })
    mount(true, onRegister)
    await reachReview()
    // No way to register straight from the review: agreeing leads to the field.
    expect(screen.queryByTestId('multisig-register')).toBeNull()
    fireEvent.click(screen.getByTestId('multisig-agree'))

    expect(screen.getByTestId('multisig-save').textContent).toContain('Passphrase for this wallet')
    expect(screen.getByTestId('multisig-passphrase-keyboard')).toBeTruthy()
    const register = screen.getByTestId<HTMLButtonElement>('multisig-register')
    expect(register.disabled).toBe(true)
    fireEvent.click(register)
    expect(onRegister).not.toHaveBeenCalled()

    tap('abc')
    // Masked, because it is the wallet's passphrase on a lit panel.
    expect(screen.getByTestId('pk-hidden').textContent).toBe('•••')
    expect(screen.queryByTestId('pk-plain')).toBeNull()
    expect(screen.getByTestId<HTMLButtonElement>('multisig-register').disabled).toBe(false)
  })

  /** INV-UI-104. What was typed is what reaches the daemon, with the reviewed descriptor. */
  it('sends-the-typed-passphrase-with-the-reviewed-descriptor', async () => {
    const onRegister = vi.fn().mockResolvedValue({ persisted: true })
    mount(true, onRegister)
    await reachReview()
    fireEvent.click(screen.getByTestId('multisig-agree'))
    tap('abc')
    fireEvent.click(screen.getByTestId('multisig-register'))
    await waitFor(() => {
      expect(onRegister).toHaveBeenCalledWith('wsh(sortedmulti(2,a,b,c))#checksum', 'abc')
    })
  })

  /** INV-UI-104. Saved is said only when the daemon said it wrote it. */
  it('says-saved-when-the-daemon-persisted-it', async () => {
    mount(true, vi.fn().mockResolvedValue({ persisted: true }))
    await reachReview()
    fireEvent.click(screen.getByTestId('multisig-agree'))
    tap('abc')
    fireEvent.click(screen.getByTestId('multisig-register'))
    await waitFor(() => {
      expect(screen.getByTestId('multisig-registered')).toBeTruthy()
    })
    expect(screen.getByTestId('multisig-outcome-saved').textContent).toContain(
      'after the device locks'
    )
    expect(screen.queryByTestId('multisig-outcome-session')).toBeNull()
  })

  /**
   * INV-UI-104. The same path with the daemon answering `persisted: false`
   * says session only. The panel follows the answer, not the route that led to
   * it, so a passphrase having been typed is not taken as the quorum saved.
   */
  it('says-session-only-when-the-daemon-did-not-persist-it', async () => {
    mount(true, vi.fn().mockResolvedValue({ persisted: false }))
    await reachReview()
    fireEvent.click(screen.getByTestId('multisig-agree'))
    tap('abc')
    fireEvent.click(screen.getByTestId('multisig-register'))
    await waitFor(() => {
      expect(screen.getByTestId('multisig-outcome-session').textContent).toContain(
        'gone at the next lock'
      )
    })
    expect(screen.queryByTestId('multisig-outcome-saved')).toBeNull()
  })

  /**
   * INV-UI-104. A wrong passphrase is shown, not swallowed. The user stays on
   * the panel with the field, nothing reads as registered, and the refused
   * passphrase is not left in the field to be retried by accident.
   */
  it('shows-a-wrong-passphrase-and-registers-nothing', async () => {
    const onRegister = vi.fn().mockRejectedValue(new Error('Wrong passphrase.'))
    mount(true, onRegister)
    await reachReview()
    fireEvent.click(screen.getByTestId('multisig-agree'))
    tap('abc')
    fireEvent.click(screen.getByTestId('multisig-register'))

    await waitFor(() => {
      expect(screen.getByTestId('multisig-error').textContent).toContain('Wrong passphrase.')
    })
    expect(screen.queryByTestId('multisig-registered')).toBeNull()
    expect(screen.getByTestId('multisig-save')).toBeTruthy()
    expect(screen.getByTestId('pk-length').textContent).toBe('0')
    expect(screen.getByTestId<HTMLButtonElement>('multisig-register').disabled).toBe(true)
    // Retyping clears the refusal, so the keys are the whole panel again.
    tap('a')
    expect(screen.queryByTestId('multisig-error')).toBeNull()
  })

  /**
   * INV-UI-104. With no saved wallet there is nowhere to write a
   * registration: no passphrase is asked for or sent, the review says the
   * quorum lasts until the lock before anybody agrees, and the finished panel
   * says it again from the daemon's answer.
   */
  it('asks-no-passphrase-and-says-session-only-without-a-saved-wallet', async () => {
    const onRegister = vi.fn().mockResolvedValue({ persisted: false })
    mount(false, onRegister)
    await reachReview()
    expect(screen.queryByTestId('multisig-agree')).toBeNull()
    expect(screen.queryByTestId('multisig-passphrase-keyboard')).toBeNull()
    expect(screen.getByTestId('multisig-session-only').textContent).toContain(
      'lasts until the device locks'
    )

    fireEvent.click(screen.getByTestId('multisig-register'))
    await waitFor(() => {
      expect(screen.getByTestId('multisig-outcome-session')).toBeTruthy()
    })
    expect(onRegister).toHaveBeenCalledWith('wsh(sortedmulti(2,a,b,c))#checksum')
    expect(onRegister.mock.calls[0]).toHaveLength(1)
  })
})
