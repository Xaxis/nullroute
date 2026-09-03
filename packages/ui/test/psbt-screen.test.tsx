/**
 * Tests for the signing screen.
 *
 * This is the screen where a user commits money, so these are written as
 * questions about what the user can see and what the user can do, not about
 * what the component stores. The rule under test throughout is that nothing is
 * approved that is not shown, and that a reassuring label is never applied to
 * something the device did not verify.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PsbtScreen, type PsbtReviewView, type PsbtWarningView } from '../src/screens/PsbtScreen.js'

afterEach(cleanup)

/**
 * fireEvent rather than user-event, deliberately. user-event models a real
 * pointer and keyboard more faithfully, and it is not a dependency of this
 * project: every package added here is attack surface and goes into the
 * reproducible build manifest, so a nicer test API is not a good enough reason
 * to take one on. The existing screen tests use fireEvent for the same reason.
 */
function type(el: HTMLElement, value: string): void {
  fireEvent.change(el, { target: { value } })
}

const CHANGE_PATH = "m/84'/0'/0'/1/0"

function review(overrides: Partial<PsbtReviewView> = {}): PsbtReviewView {
  return {
    signable: true,
    replaceable: true,
    locktime: 0,
    ownedInputs: 1,
    sighash: {
      name: 'SIGHASH_ALL',
      meaning: 'Commits to every input and every output.',
      acceptable: true,
    },
    fee: {
      feeBtc: '0.00005000',
      feeSats: '5000',
      vsize: 141,
      satsPerVbyte: 35.46,
      percentOfSpend: 4.1,
    },
    inputs: [
      {
        index: 0,
        txid: 'a'.repeat(64),
        vout: 0,
        amountBtc: '0.00200000',
        derivationPath: "m/84'/0'/0'/0/0",
      },
    ],
    outputs: [
      {
        index: 0,
        address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
        amountBtc: '0.00120000',
        amountSats: '120000',
        kind: 'payment',
        changePath: null,
      },
      {
        index: 1,
        address: 'bc1qchange00000000000000000000000000000000',
        amountBtc: '0.00075000',
        amountSats: '75000',
        kind: 'change',
        changePath: CHANGE_PATH,
      },
    ],
    warnings: [],
    ...overrides,
  }
}

function setup(overrides: Partial<PsbtReviewView> = {}) {
  const onReview = vi.fn().mockResolvedValue(review(overrides))
  const onSign = vi
    .fn()
    .mockResolvedValue({ psbt: 'cHNidP8BSIGNED', inputsSigned: 1, signedWith: ["m/84'/0'/0'/0/0"] })
  const onBack = vi.fn()
  render(<PsbtScreen onReview={onReview} onSign={onSign} onBack={onBack} />)
  return { onReview, onSign, onBack }
}

async function reachReview(): Promise<void> {
  type(screen.getByTestId('psbt-input'), 'cHNidP8B')
  fireEvent.click(screen.getByTestId('psbt-review'))
  await waitFor(() => {
    expect(screen.getByTestId('psbt-outputs')).toBeTruthy()
  })
}

describe('ui.screens.psbt', () => {
  // INV-UI-11: reviewing and signing are separate acts. Looking at a
  // transaction must never be the thing that signs it.
  /*
   * A review the daemon could only partly build.
   *
   * The daemon used to drop a registration it could not read and say nothing,
   * so this screen described a wallet smaller than the user's and called their
   * own change a payment to a stranger. The count is on the review now, and
   * this is where it has to become a sentence.
   */
  it('says-when-a-quorum-could-not-be-read', async () => {
    setup({ unreadableRegistrations: 2 })
    await reachReview()

    const said = screen.getByTestId('psbt-unreadable-registrations').textContent
    expect(said).toContain('2 registered')
    // The consequence, not just the count. A number with no sentence beside it
    // is a fault code.
    expect(said).toContain('stranger')
  })

  // Silent when there is nothing to say, which is almost every transaction.
  it('says-nothing-when-every-quorum-was-read', async () => {
    setup({ unreadableRegistrations: 0 })
    await reachReview()
    expect(screen.queryByTestId('psbt-unreadable-registrations')).toBeNull()
  })

  it('does-not-sign-when-reviewing', async () => {
    const { onSign } = setup()
    await reachReview()
    expect(onSign).not.toHaveBeenCalled()
    // The sign button exists only after a review has been read.
    expect(screen.getByTestId('psbt-sign')).toBeTruthy()
  })

  it('will-not-review-an-empty-field', () => {
    setup()
    expect(screen.getByTestId<HTMLButtonElement>('psbt-review').disabled).toBe(true)
  })

  // INV-UI-12: change is shown as change only with the path it re-derived at,
  // and a payment is never dressed up as change.
  it('shows-the-change-path-it-verified', async () => {
    setup()
    await reachReview()

    const change = screen.getByTestId('psbt-output-1')
    expect(change.textContent).toContain(CHANGE_PATH)
    expect(change.textContent).toContain('re-derived')

    const payment = screen.getByTestId('psbt-output-0')
    expect(payment.textContent).toContain('Leaves this wallet')
    expect(payment.textContent).not.toContain('re-derived')
  })

  // The fee in four units. Fee-stuffing hides in whichever one is missing.
  it('shows-the-fee-in-several-units', async () => {
    setup()
    await reachReview()
    const body = document.body.textContent
    expect(body).toContain('0.00005000 BTC')
    expect(body).toContain('5000')
    expect(body).toContain('35.46 sat/vB')
    expect(body).toContain('4.1%')
  })

  // INV-UI-13: a blocking warning stops signing outright.
  it('refuses-to-sign-when-a-warning-is-blocking', async () => {
    const { onSign } = setup({
      signable: false,
      warnings: [
        {
          kind: 'sighash',
          message: 'SIGHASH_NONE does not commit to the outputs.',
          blocking: true,
        },
      ],
    })
    await reachReview()

    expect(screen.getByTestId<HTMLButtonElement>('psbt-sign').disabled).toBe(true)
    fireEvent.click(screen.getByTestId('psbt-sign'))
    expect(onSign).not.toHaveBeenCalled()
  })

  // The override exists, is explicit, and applies to one signature.
  it('allows-an-explicit-override-of-a-blocking-warning', async () => {
    const { onSign } = setup({
      signable: false,
      warnings: [{ kind: 'sighash', message: 'SIGHASH_NONE.', blocking: true }],
    })
    await reachReview()

    fireEvent.click(screen.getByTestId('psbt-override'))
    expect(screen.getByTestId<HTMLButtonElement>('psbt-sign').disabled).toBe(false)
    fireEvent.click(screen.getByTestId('psbt-sign'))
    await waitFor(() => {
      expect(onSign).toHaveBeenCalledWith('cHNidP8B', true)
    })
  })

  // INV-UI-14: a transaction with nothing of ours in it cannot be signed, and
  // says why rather than failing silently.
  it('will-not-sign-a-transaction-it-does-not-own', async () => {
    const { onSign } = setup({ ownedInputs: 0 })
    await reachReview()

    expect(screen.getByTestId<HTMLButtonElement>('psbt-sign').disabled).toBe(true)
    expect(document.body.textContent).toContain('None of these inputs belong to this wallet')
    fireEvent.click(screen.getByTestId('psbt-sign'))
    expect(onSign).not.toHaveBeenCalled()
  })

  it('shows-the-signed-psbt-and-the-paths-used', async () => {
    setup()
    await reachReview()
    fireEvent.click(screen.getByTestId('psbt-sign'))

    await waitFor(() => {
      expect(screen.getByTestId('psbt-signed')).toBeTruthy()
    })
    expect(screen.getByTestId<HTMLTextAreaElement>('psbt-output').value).toBe('cHNidP8BSIGNED')
    expect(document.body.textContent).toContain("m/84'/0'/0'/0/0")
  })

  // A failure is shown, never swallowed, and must not leave a stale review from
  // a previous transaction on screen for the user to act on.
  it('shows-an-error-and-clears-the-stale-review', async () => {
    const onReview = vi.fn().mockRejectedValue(new Error('That PSBT could not be decoded.'))
    const onSign = vi.fn()
    render(<PsbtScreen onReview={onReview} onSign={onSign} onBack={vi.fn()} />)

    type(screen.getByTestId('psbt-input'), 'garbage')
    fireEvent.click(screen.getByTestId('psbt-review'))

    await waitFor(() => {
      expect(screen.getByTestId('psbt-error').textContent).toContain('could not be decoded')
    })
    expect(screen.queryByTestId('psbt-outputs')).toBeNull()
    expect(screen.queryByTestId('psbt-sign')).toBeNull()
  })

  it('reports-a-signing-failure-rather-than-appearing-to-succeed', async () => {
    const onReview = vi.fn().mockResolvedValue(review())
    const onSign = vi.fn().mockRejectedValue(new Error('Refusing to sign.'))
    render(<PsbtScreen onReview={onReview} onSign={onSign} onBack={vi.fn()} />)

    type(screen.getByTestId('psbt-input'), 'cHNidP8B')
    fireEvent.click(screen.getByTestId('psbt-review'))
    await waitFor(() => {
      expect(screen.getByTestId('psbt-sign')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('psbt-sign'))

    await waitFor(() => {
      expect(screen.getByTestId('psbt-error').textContent).toContain('Refusing to sign')
    })
    // Still on the review screen, with nothing presented as signed.
    expect(screen.queryByTestId('psbt-signed')).toBeNull()
  })
})

/**
 * The fleet case: several of these devices holding one multisig wallet.
 *
 * A 2-of-3 is signed by walking a PSBT from device to device, so each one has to
 * answer a question the single-signature flow never asks: does MY signature
 * finish this? Getting that wrong in the optimistic direction is the expensive
 * failure. The user stops carrying the transaction onward, believes they are
 * done, and nothing was ever broadcast.
 */
describe('PsbtScreen quorum progress', () => {
  function progress(present: number, required: number, cosigners = 3) {
    return {
      present,
      required,
      complete: present >= required,
      inputs: [{ index: 0, required, cosigners, present, satisfied: present >= required }],
    }
  }

  function quorumSetup(options: {
    reviewProgress?: ReturnType<typeof progress>
    signProgress?: ReturnType<typeof progress>
    finalised?: { hex: string; txid: string }
    wasAlreadySigned?: boolean
  }) {
    const onReview = vi
      .fn()
      .mockResolvedValue(
        review(options.reviewProgress === undefined ? {} : { signatures: options.reviewProgress })
      )
    const onSign = vi.fn().mockResolvedValue({
      psbt: 'cHNidP8BSIGNED',
      inputsSigned: 1,
      signedWith: ["m/48'/0'/0'/2'/0/0"],
      signatures: options.signProgress,
      wasAlreadySigned: options.wasAlreadySigned ?? false,
      ...(options.finalised === undefined ? {} : { finalised: options.finalised }),
    })
    render(<PsbtScreen onReview={onReview} onSign={onSign} onBack={vi.fn()} />)
    return { onReview, onSign }
  }

  /**
   * INV-UI-35. Before signing, the review says where this device sits in the
   * quorum and whether its signature would be the last.
   */
  it('says-before-signing-that-yours-is-not-the-last-signature', async () => {
    quorumSetup({ reviewProgress: progress(0, 2) })
    await reachReview()

    const shown = screen.getByTestId('psbt-quorum').textContent
    expect(shown).toContain('0 of 2 present')
    expect(shown).toContain('3 cosigners')
    expect(shown).toContain('would not be the last')
    expect(shown).toContain('1 more cosigner')
  })

  it('says-before-signing-when-yours-completes-it', async () => {
    quorumSetup({ reviewProgress: progress(1, 2) })
    await reachReview()

    const shown = screen.getByTestId('psbt-quorum').textContent
    expect(shown).toContain('1 of 2 present')
    expect(shown).toContain('last signature needed')
    expect(shown).toContain('becomes spendable')
  })

  /**
   * INV-UI-36. After signing, a transaction that is NOT finished says so
   * unmissably. This is the message whose absence loses money by inaction.
   */
  it('says-after-signing-that-the-transaction-cannot-be-broadcast-yet', async () => {
    quorumSetup({ reviewProgress: progress(0, 2), signProgress: progress(1, 2) })
    await reachReview()
    fireEvent.click(screen.getByTestId('psbt-sign'))

    await waitFor(() => {
      expect(screen.getByTestId('psbt-incomplete')).toBeTruthy()
    })
    const shown = screen.getByTestId('psbt-incomplete').textContent
    expect(shown).toContain('Not finished')
    expect(shown).toContain('1 of 2 signatures')
    expect(shown).toContain('carry it to the next cosigner')
    // And it does not offer a finished transaction, because there is not one.
    expect(screen.queryByTestId('psbt-finalised')).toBeNull()
  })

  /**
   * INV-UI-36. And a transaction that IS finished offers the raw form, because
   * that is what a node takes. The PSBT is still there for a coordinator.
   */
  it('offers-the-finished-transaction-when-nothing-else-has-to-sign', async () => {
    quorumSetup({
      reviewProgress: progress(1, 2),
      signProgress: progress(2, 2),
      finalised: { hex: '02000000abcd', txid: 'f'.repeat(64) },
    })
    await reachReview()
    fireEvent.click(screen.getByTestId('psbt-sign'))

    await waitFor(() => {
      expect(screen.getByTestId('psbt-complete')).toBeTruthy()
    })
    expect(screen.getByTestId('psbt-complete').textContent).toContain('2 of 2, complete')
    expect(screen.getByTestId('psbt-complete').textContent).toContain('broadcast')

    const finalised = screen.getByTestId('psbt-finalised').textContent
    expect(finalised).toContain('f'.repeat(64))
    // The PSBT is still offered: a coordinator wants that, a node wants the hex.
    expect(screen.getByTestId('psbt-qr')).toBeTruthy()
    expect(screen.queryByTestId('psbt-incomplete')).toBeNull()
  })

  /**
   * Scanning a QR sequence back, or reading a card twice, is routine. Signing
   * again is safe because the bytes are identical, but silence leaves the user
   * unsure whether anything happened.
   */
  it('says-when-this-device-had-already-signed', async () => {
    quorumSetup({
      reviewProgress: progress(1, 2),
      signProgress: progress(1, 2),
      wasAlreadySigned: true,
    })
    await reachReview()
    fireEvent.click(screen.getByTestId('psbt-sign'))

    await waitFor(() => {
      expect(screen.getByTestId('psbt-already-signed')).toBeTruthy()
    })
    expect(screen.getByTestId('psbt-already-signed').textContent).toContain('same bytes')
  })

  /**
   * A single-signature wallet has no quorum to report, and the screen must not
   * grow a confusing "1 of 1" panel for the ordinary case.
   */
  it('shows-no-quorum-panel-when-there-is-nothing-to-say', async () => {
    quorumSetup({})
    await reachReview()
    expect(screen.queryByTestId('psbt-quorum')).toBeNull()
  })
})

/**
 * Tests for the refusal to sign, and for saying why.
 *
 * `signable` arrives as a boolean over JSON. In core it is DEFINED as "no
 * blocking warning", and this screen used to rely on that coupling holding
 * across the boundary. Nothing enforces it there: not TypeScript, which sees
 * whatever the response is typed as, and not the daemon, which cannot know what
 * this screen assumes. A review carrying a blocking warning and `signable: true`
 * would have enabled the button with the warning on screen.
 *
 * That is the same shape as the lock screen's fail-open verdict, on the screen
 * that spends money.
 */
describe('ui.screens.psbt refusal', () => {
  // Typed as the view rather than as a loose shape, so a kind this device
  // cannot emit fails the build here. All three of these fixtures used to
  // invent one: `fee-high` for `high-fee`, `sighash-odd` for `sighash`, and
  // `output-unrecognised` for nothing at all. The refusal path was being
  // exercised entirely against warnings the daemon never sends.
  const withWarnings = (
    warnings: readonly PsbtWarningView[],
    signable: boolean
  ): PsbtReviewView => ({
    ...review(),
    signable,
    warnings,
  })

  const FEE_WARNING: PsbtWarningView = {
    kind: 'high-fee',
    message: 'The fee is 8.4 percent of what this transaction spends.',
    blocking: true,
  }

  async function reachReview(view: PsbtReviewView) {
    const onSign = vi.fn().mockResolvedValue({ psbt: 'x', inputsSigned: 1, signedWith: [] })
    render(
      <PsbtScreen
        onReview={vi.fn().mockResolvedValue(view)}
        onSign={onSign}
        onBack={vi.fn()}
        initialPsbt="cHNidP8="
      />
    )
    fireEvent.click(screen.getByTestId('psbt-review'))
    await waitFor(() => {
      expect(screen.getByTestId('psbt-sign')).toBeTruthy()
    })
    return onSign
  }

  /**
   * INV-UI-62. A blocking warning refuses the signature even when the review
   * claims the transaction is signable.
   */
  it('refuses-a-blocking-warning-even-when-told-it-is-signable', async () => {
    const onSign = await reachReview(withWarnings([FEE_WARNING], true))

    expect(screen.getByTestId<HTMLButtonElement>('psbt-sign').disabled).toBe(true)
    fireEvent.click(screen.getByTestId('psbt-sign'))
    expect(onSign).not.toHaveBeenCalled()
  })

  /**
   * INV-UI-62. The reason sits beside the button. A disabled control whose
   * reason is scrolled two screens away reads as broken software rather than as
   * a refusal, and this one refuses for reasons somebody has to act on.
   */
  it('says-beside-the-button-why-it-will-not-sign', async () => {
    await reachReview(withWarnings([FEE_WARNING], false))
    // The human phrase, not the enum. It said "Will not sign: fee-high" on the
    // last screen before a signature, which reads as a fault code rather than
    // as a reason.
    const refusal = screen.getByTestId('psbt-refusal').textContent
    expect(refusal).toContain('Will not sign: the fee is high')
    expect(refusal).not.toContain('high-fee')

    cleanup()
    await reachReview(withWarnings([FEE_WARNING, { ...FEE_WARNING, kind: 'sighash' }], false))
    expect(screen.getByTestId('psbt-refusal').textContent).toContain('2 blocking warnings')
  })

  /**
   * The override is the user's decision and is the only thing that gets past
   * the refusal. It says so beside the button rather than leaving the row
   * looking the same as an ordinary signature.
   */
  it('signs-once-the-user-overrides-and-says-that-is-what-happened', async () => {
    const onSign = await reachReview(withWarnings([FEE_WARNING], false))

    fireEvent.click(screen.getByTestId('psbt-override'))
    expect(screen.getByTestId('psbt-refusal').textContent).toContain('Overriding 1')
    expect(screen.getByTestId<HTMLButtonElement>('psbt-sign').disabled).toBe(false)

    fireEvent.click(screen.getByTestId('psbt-sign'))
    await waitFor(() => {
      expect(onSign).toHaveBeenCalledWith('cHNidP8=', true)
    })
  })

  /**
   * A non-blocking warning is a thing to read, not a refusal. Treating every
   * warning as blocking would make the blocking ones mean nothing.
   */
  it('does-not-refuse-a-warning-that-is-not-blocking', async () => {
    await reachReview(
      withWarnings([{ kind: 'unknown-fields', message: 'Bare script.', blocking: false }], true)
    )
    expect(screen.getByTestId<HTMLButtonElement>('psbt-sign').disabled).toBe(false)
    expect(screen.queryByTestId('psbt-refusal')).toBeNull()
  })

  it('says-when-no-input-belongs-to-this-device', async () => {
    await reachReview({ ...review(), ownedInputs: 0, warnings: [] })
    expect(screen.getByTestId('psbt-refusal').textContent).toContain('No input here is yours')
    expect(screen.getByTestId<HTMLButtonElement>('psbt-sign').disabled).toBe(true)
  })
})

/**
 * Where the transaction goes next, which is not the same answer twice.
 *
 * A quorum walks a PSBT from device to device. The second of three has to carry
 * it onward and the last one takes it to whatever broadcasts, and the subtitle
 * is what gets read on a 480px panel: it said "carry this back to the machine
 * that built it" unconditionally, contradicting the banner further down its own
 * screen.
 */
describe('ui.screens.psbt what to do next', () => {
  async function signWith(signatures: {
    present: number
    required: number | null
    complete: boolean
  }) {
    render(
      <PsbtScreen
        onReview={vi.fn().mockResolvedValue(review())}
        onSign={vi.fn().mockResolvedValue({
          psbt: 'signed',
          inputsSigned: 1,
          signedWith: ["m/84'/0'/0'/0/0"],
          signatures: { ...signatures, inputs: [] },
        })}
        onBack={vi.fn()}
        initialPsbt="cHNidP8="
      />
    )
    fireEvent.click(screen.getByTestId('psbt-review'))
    await waitFor(() => {
      expect(screen.getByTestId('psbt-sign')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('psbt-sign'))
    await waitFor(() => {
      expect(screen.getByTestId('psbt-signed')).toBeTruthy()
    })
  }

  /**
   * INV-UI-63. An unfinished transaction says so where it is read first, and
   * points at the next cosigner rather than at a broadcaster.
   */
  it('points-an-unfinished-transaction-at-the-next-cosigner', async () => {
    await signWith({ present: 2, required: 3, complete: false })

    const subtitle = document.querySelector('.nr-screen__subtitle')?.textContent
    expect(subtitle).toContain('Not finished')
    expect(subtitle).toContain('next cosigner')
    expect(subtitle).not.toContain('machine that built it')

    // And the banner agrees with it rather than saying something else.
    expect(screen.getByTestId('psbt-incomplete').textContent).toContain('cannot be broadcast yet')
  })

  it('points-a-finished-transaction-back-at-the-machine-that-built-it', async () => {
    await signWith({ present: 3, required: 3, complete: true })

    const subtitle = document.querySelector('.nr-screen__subtitle')?.textContent
    expect(subtitle).toContain('machine that built it')
    expect(subtitle).not.toContain('Not finished')
    expect(screen.getByTestId('psbt-complete').textContent).toContain('complete')
  })
})
