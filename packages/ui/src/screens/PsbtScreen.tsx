import { type ReactElement, type ReactNode, useState } from 'react'
import { type ReviewWarning } from '@nullroute/core'
import { Screen } from '../components/Screen.js'
import { Refusal } from '../components/Refusal.js'
import { Info } from '../components/Info.js'
import { Button } from '../components/Button.js'
import { QrDisplay } from '../components/QrDisplay.js'

/**
 * The screen the whole device exists for.
 *
 * Spec: ui.screens.psbt
 *
 * Everything else here is preparation. This is the one screen where a user
 * commits money, and it is the last place anything can be caught, so it is
 * built around a single rule: NOTHING IS APPROVED THAT IS NOT SHOWN.
 *
 * Consequences of that rule, all of which are load-bearing rather than
 * stylistic:
 *
 *   - Reviewing and signing are separate steps with separate buttons. A user
 *     must be able to look at a transaction and walk away, so looking cannot be
 *     the thing that risks signing.
 *   - Change is labelled change ONLY when the daemon re-derived the address
 *     from the seed, and the path it matched is printed next to it. An
 *     attacker's address in the change position is shown as a payment, in the
 *     same red as any other money leaving.
 *   - The fee is shown in BTC, in satoshis, as a rate, and as a percentage of
 *     what is being spent. Fee-stuffing attacks work by being unremarkable in
 *     whichever single unit the wallet happens to display.
 *   - Amounts arrive as decimal strings and are rendered as received. They are
 *     never parsed into a JavaScript number here, because 21 million BTC in
 *     satoshis exceeds what a double represents exactly and this is the last
 *     screen on which to discover that.
 *   - A blocking warning disables the sign button outright. The override is a
 *     separate checkbox that says what it does.
 */

/**
 * Everything `psbt.sign` returns.
 *
 * Named and exported rather than written inline on the prop, so App.tsx can
 * declare the same shape for its `call<T>()` instead of a narrower one written
 * out by hand. That drift has happened three times on this device: a caller
 * types the two or three fields it remembers, the daemon returns more, the
 * screen reads them, and it all works because `call<T>()` casts JSON and an
 * extra key survives. What breaks is the reader, who concludes the field never
 * arrives.
 */
export interface PsbtSignedView {
  readonly psbt: string
  readonly inputsSigned: number
  readonly signedWith: readonly string[]
  readonly signatures?: SignatureProgressView
  /** Who still has to sign, when the quorum is registered on this device. */
  readonly attribution?: AttributionView
  readonly wasAlreadySigned?: boolean
  readonly finalised?: { readonly hex: string; readonly txid: string }
}

/** Who has signed and who has not, when the quorum is registered. */
export interface AttributionView {
  readonly cosigners: readonly {
    readonly position: number
    readonly fingerprint: string
    readonly name?: string
    readonly isThisDevice: boolean
    readonly signed: boolean
  }[]
  readonly unattributed: number
  /** One sentence, written in core so its awkward cases are tested. */
  readonly waiting: string
}

export interface PsbtOutputView {
  readonly index: number
  /**
   * The user's own note about this address, from a loaded label file.
   *
   * Never a reason to trust an output. Whether an output is change is decided
   * by re-deriving it from a registered descriptor, and a label is text that
   * arrived in a file from software this device knows nothing about. It is here
   * because an output labelled "Rent, March" is recognisable and an unlabelled
   * one to an address nobody knows is worth a second look.
   */
  readonly label?: string | null
  readonly address: string | null
  readonly amountBtc: string
  readonly amountSats: string
  readonly kind: 'payment' | 'change'
  readonly changePath: string | null
  /**
   * Why an output the transaction claimed was yours is shown as leaving.
   *
   * The daemon sends null when there was no claim to reject, which is the
   * ordinary case: a coordinator has no key information for a stranger's
   * address, so the absence of a derivation record says nothing.
   */
  readonly changeRejectedBecause?: string | null
}

export interface PsbtInputView {
  readonly index: number
  readonly txid: string
  readonly vout: number
  readonly amountBtc: string
  readonly derivationPath: string | null
}

export interface PsbtWarningView {
  /**
   * The core union, not `string`.
   *
   * It was `string`, which is what let a machine identifier reach the action
   * bar as prose (see WARNING_LABELS), and what let the screen gallery render
   * a `fee-high` warning that this device cannot produce, since the kind is
   * `high-fee`. A fixture showing an impossible state is a fixture that is not
   * checking the real one.
   */
  readonly kind: ReviewWarning['kind']
  readonly message: string
  readonly blocking: boolean
}

/**
 * What to call each refusal in the space beside a button.
 *
 * WHY THIS EXISTS. The action bar interpolated `warning.kind` directly, so a
 * device that would not sign said "Will not sign: high-fee" on the one screen
 * where somebody has to decide what to do about it. That is an enum leaking
 * through the last surface before a signature: it reads as a fault code, and a
 * fault code is something you work around rather than something you read.
 *
 * SHORT, because this sits beside the button in a bar that also holds Cancel,
 * and the full sentence with the actual numbers in it is already in the
 * warnings list a few hundred pixels above. This says which refusal; that says
 * how much.
 *
 * Typed against the core union, so adding a warning kind in
 * packages/core/src/psbt/review.ts fails this build until somebody decides
 * what the device should call it. The alternative is a fallback that silently
 * prints the slug again, which is where this started.
 */
const WARNING_LABELS: Record<ReviewWarning['kind'], string> = {
  sighash: 'an unusual sighash flag',
  'high-fee': 'the fee is high',
  'high-fee-rate': 'the fee rate is high',
  'unknown-fields': 'unknown fields in the file',
  'not-replaceable': 'this cannot be replaced',
  locktime: 'a locktime is set',
  'no-change-verified': 'change could not be verified',
  'unverified-amount': 'input amounts could not be checked',
}

/**
 * How far along the signatures are.
 *
 * The fleet case, and the most consequential thing on this screen after the
 * amounts. Three devices holding one 2-of-3 means a PSBT walks from one to the
 * next, and each device has to answer "does my signature finish this". Getting
 * that wrong in the optimistic direction means a user broadcasts nothing and
 * believes they are done.
 */
export interface SignatureProgressView {
  readonly present: number
  readonly required: number | null
  readonly complete: boolean
  readonly inputs: readonly {
    readonly index: number
    readonly required: number | null
    readonly cosigners: number | null
    readonly present: number
    readonly satisfied: boolean
  }[]
}

export interface PsbtReviewView {
  readonly signable: boolean
  /**
   * Registered quorums this device could not read while building the review.
   *
   * Absent or zero on almost every transaction. When it is not, every address
   * belonging to those quorums is missing from the owned index, so change
   * returning from one of them is described below as money going to a
   * stranger. The daemon used to drop them in silence, which is the safe
   * direction for the label and the worst one for behaviour: it teaches
   * somebody that the warning on this screen is noise.
   */
  readonly unreadableRegistrations?: number
  readonly signatures?: SignatureProgressView
  readonly replaceable: boolean
  readonly locktime: number
  readonly ownedInputs: number
  readonly sighash: { name: string; meaning: string; acceptable: boolean }
  readonly fee: {
    feeBtc: string
    feeSats: string
    vsize: number
    satsPerVbyte: number
    percentOfSpend: number
  }
  readonly inputs: readonly PsbtInputView[]
  readonly outputs: readonly PsbtOutputView[]
  readonly warnings: readonly PsbtWarningView[]
}

export interface PsbtScreenProps {
  /** Prefilled when a transaction arrived by camera rather than by hand. */
  readonly initialPsbt?: string
  /** Opens the scanner. Absent on a build with no camera. */
  readonly onScan?: () => void
  readonly onReview: (psbt: string) => Promise<PsbtReviewView>
  readonly onSign: (psbt: string, override: boolean) => Promise<PsbtSignedView>
  readonly onBack: () => void
  /** Where this screen sits in a journey, when it is part of one. */
  readonly steps?: ReactElement | null
  /** Who this device is and which wallet it has open. See `Identity`. */
  readonly identity?: ReactNode
  /**
   * The header identity WITHOUT the wallet switcher, for the signed screen.
   *
   * NavMenu's own rule says it will not offer an exit where leaving destroys
   * something that cannot be made again, names "a signed transaction, which
   * exists only on the screen that made it", and says those screens pass no
   * menu and no switchable wallet name because that is the same exit in
   * different clothes. The seed screen honours it. This one did not: it was
   * handed the menu and the switchable chip unconditionally and forwarded both
   * into the signed view, so two taps threw away a signature that only exists
   * here.
   *
   * Falls back to `identity` when absent, so a caller that has not thought
   * about it gets the old behaviour rather than a header with nothing in it.
   */
  readonly identityFixed?: ReactNode
  readonly banner?: ReactElement | null
  /**
   * The navigation rail.
   *
   * Rendered on the screens where leaving costs nothing, and NOT once this
   * device has signed. A signed PSBT exists only here until it is carried off
   * by camera or by file, so a rail beside it is an invitation to walk away
   * from the one artefact this device was asked to produce.
   */
  readonly nav?: ReactElement | null
}

export function PsbtScreen(props: PsbtScreenProps): ReactElement {
  const {
    initialPsbt,
    onScan,
    onReview,
    onSign,
    onBack,
    identity,
    identityFixed,
    steps,
    banner,
    nav,
  } = props

  const [psbt, setPsbt] = useState(initialPsbt ?? '')
  /**
   * Whether the review has been read to the end.
   *
   * WHY THE SUBTITLE NEEDED HELP. This screen says "Nothing is signed until
   * you have read it", and Sign sits in the fixed action bar. The review runs
   * about 800px past the fold on a 480px panel, so a transaction could be
   * signed while its amounts, its fee and its inputs had never been on the
   * screen at all: tick the override, press Sign, done. The claim was on the
   * subtitle and the interface contradicted it.
   *
   * Reset whenever a new review arrives, because reading one transaction is
   * not having read the next.
   */
  const [read, setRead] = useState(false)
  const [review, setReview] = useState<PsbtReviewView | null>(null)
  const [signed, setSigned] = useState<string | null>(null)
  const [signedWith, setSignedWith] = useState<readonly string[]>([])
  const [progress, setProgress] = useState<SignatureProgressView | null>(null)
  const [finalised, setFinalised] = useState<{ hex: string; txid: string } | null>(null)
  const [wasAlready, setWasAlready] = useState(false)
  const [attribution, setAttribution] = useState<AttributionView | null>(null)
  const [override, setOverride] = useState(false)
  const [busy, setBusy] = useState(false)
  /*
   * The last failure, and which step it came from. The step decides the title:
   * a review that failed has signed nothing, and titling it "Signing failed"
   * told somebody holding an unreadable transaction that a signature had been
   * attempted.
   */
  const [error, setError] = useState<{
    readonly during: 'review' | 'sign'
    readonly message: string
  } | null>(null)

  const blocking = review?.warnings.filter((w) => w.blocking) ?? []
  /* Split, because the two go in different places now. A blocking warning is
     this device refusing and belongs above the evidence; an advisory one is
     something to look at while reading it, and belongs beside what it is
     about. */
  const advisory = review?.warnings.filter((w) => !w.blocking) ?? []

  /**
   * Whether signing is allowed, decided here rather than taken on trust.
   *
   * `signable` arrives as a boolean over JSON. In core it is defined as "no
   * blocking warning" (see review.ts), and this screen used to rely on that
   * coupling holding, which meant a review carrying a blocking warning and
   * `signable: true` would have enabled the button with the warning on screen.
   * Nothing enforces the coupling across the boundary: not TypeScript, which
   * sees whatever the response is typed as, and not the daemon, which cannot
   * know what this screen assumes.
   *
   * So both are required, the same way the lock screen requires a status it
   * recognises rather than merely not recognising a failure. The override is
   * the user's decision and is the only thing that gets past either.
   */
  const refused = review !== null && (review.signable !== true || blocking.length > 0)
  const maySign = review !== null && review.ownedInputs > 0 && (!refused || override) && read

  const doReview = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setSigned(null)
    try {
      setRead(false)
      // AND THE OVERRIDE, for the reason `read` is reset on the line above:
      // agreeing to sign past one transaction's blocking warning is not
      // agreeing to sign past the next one's. Every route that loads a review
      // clears it, here and in "Sign another" below, so no future way back to
      // the textarea can reintroduce the carry-over. The route that exists
      // today is the one below, and it is the one the test drives.
      setOverride(false)
      setReview(await onReview(psbt))
    } catch (err) {
      // Shown, never swallowed. A transaction that failed to load must not
      // leave a stale review from a previous one on screen.
      setReview(null)
      setError({ during: 'review', message: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const doSign = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await onSign(psbt, override)
      setSigned(result.psbt)
      setSignedWith(result.signedWith)
      setProgress(result.signatures ?? null)
      setAttribution(result.attribution ?? null)
      setFinalised(result.finalised ?? null)
      setWasAlready(result.wasAlreadySigned === true)
    } catch (err) {
      setError({ during: 'sign', message: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  // --- After signing -------------------------------------------------------
  if (signed !== null) {
    return (
      <Screen
        title="Signed"
        /* Where this goes next depends on whether it is finished, and the
           subtitle is what gets read on a 480px panel. It said "carry this back
           to the machine that built it" unconditionally, which is the wrong
           instruction for the second device of three and contradicted the
           banner further down the same screen. */
        subtitle={
          progress !== null && progress.complete !== true
            ? 'Not finished. Carry this to the next cosigner.'
            : 'Carry this back to the machine that built it.'
        }
        banner={banner}
        /* NO MENU AND NO SWITCHABLE NAME, which is NavMenu's own rule for a
           screen holding something that cannot be made again. This forwarded
           both, so Menu > Wallet, or a tap on the wallet name two inches away,
           discarded a signature that exists nowhere else. The seed screen has
           always done this; this screen is named in the same sentence of the
           same comment and did not. */
        nav={null}
        identity={identityFixed ?? identity}
        steps={steps}
        testId="psbt-signed"
        actions={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setSigned(null)
                setReview(null)
                setPsbt('')
                // Belt and braces with doReview above. This path leads back to
                // an empty box rather than straight to a review, so clearing
                // here also means the checkbox is not drawn pre-ticked for a
                // transaction nobody has pasted yet.
                setOverride(false)
                setRead(false)
              }}
              testId="psbt-another"
            >
              Sign another
            </Button>
            <div className="nr-spacer" />
            <Button onClick={onBack} testId="psbt-done">
              Done
            </Button>
          </>
        }
      >
        {/* THE CODE BESIDE THE EXPLANATION, NOT UNDER IT.

            This screen is the outbound half of the air gap: a signed
            transaction exists here and nowhere else until somebody photographs
            it. The code was last in a stack of three text blocks, which left
            30px of a 220px square above the action bar. A code three quarters
            hidden looks scannable, because it is square and it has its quiet
            zone on the sides you can see, so the user points a phone at it,
            gets nothing, and concludes the light is wrong.

            Held by the QR rule in tools/checks/check-screen-fit.mjs. */}
        <div className="nr-split nr-split--note" data-testid="psbt-signed-split">
          <div className="nr-split__col">
            <div className="nr-card nr-card--tight">
              <div className="nr-row">
                <span className="nr-label">Signed with</span>
                <span className="nr-value nr-mono">{signedWith.join(', ')}</span>
              </div>
              {/* SHOWN WHEN THERE IS NOTHING MORE URGENT TO SAY.

                  What this paragraph says is true and worth saying, and it is a
                  thing to know rather than a thing to do. Underneath it on an
                  unfinished transaction sit two things that are the opposite:
                  which cosigners have still to sign, and whether a signature on
                  this transaction belongs to nobody in the quorum. Those were
                  110px under the fold, on the screen where somebody decides
                  what to carry where.

                  So it yields. A finished transaction has room for it, an
                  unfinished one does not, and the ordering between an
                  explanation and a warning is not a close call. */}
              {progress?.complete === true && (
                <p className="nr-hint">
                  A pure function of your seed and this transaction: signing again gives the same
                  bytes, so anyone with the seed can recompute them and see nothing was hidden.
                </p>
              )}
            </div>

            {/* THE FLEET ANSWER, above everything else on this screen. A user
            holding the second of three devices needs to know whether they are
            finished or carrying this onward, and that is more urgent than the
            bytes. */}
            {progress !== null &&
              // `=== true`, so anything else shows "Not finished". Telling somebody
              // nothing else has to sign a transaction that is not finished is the
              // failure that matters on this screen.
              (progress.complete === true ? (
                <div className="nr-card nr-card--tight" data-testid="psbt-complete">
                  <div className="nr-row">
                    <span className="nr-label">Signatures</span>
                    <span className="nr-status nr-status--ok">
                      {progress.present} of {progress.required ?? '?'}, complete
                    </span>
                  </div>
                  <p className="nr-hint">
                    Nothing else has to sign this. Take it to whatever will broadcast it.
                  </p>
                </div>
              ) : (
                <div className="nr-banner nr-banner--caution" data-testid="psbt-incomplete">
                  <strong>Not finished</strong>
                  {/* Three lines became two. The left column here is half the
                      panel, the right half is a QR, and under this sits the
                      note about a signature belonging to nobody in the quorum,
                      which has to be on screen. */}
                  <span>
                    {progress.present} of {progress.required ?? 'an unknown number of'} signatures,
                    and it cannot be broadcast yet: carry it to the next cosigner and sign there
                    too.
                  </span>

                  {/* WHICH cosigner, not just that there is one. On a fleet of
                  identical devices in different rooms, "the next cosigner" is
                  true and is not an answer. Built in core so the awkward
                  phrasings, one unnamed cosigner against three, are tested
                  rather than concatenated here. */}
                  {attribution !== null && (
                    <span data-testid="psbt-waiting-on">{attribution.waiting}</span>
                  )}
                </div>
              ))}

            {/* A signature nobody in the quorum made, which is worth a second look
            even though it is usually a taproot key-path spend naming no key.
            Kept out of the count above rather than added to it: "2 of 3 signed"
            with one of them unattributed is two numbers that do not belong
            together. */}
            {attribution !== null && attribution.unattributed > 0 && (
              <p className="nr-note nr-warn" data-must-see data-testid="psbt-unattributed">
                {attribution.unattributed} signature
                {attribution.unattributed === 1 ? '' : 's'} on this transaction could not be traced
                to a cosigner in your quorum. Expected for a taproot key-path spend, which names no
                key. Anywhere else, ask who produced it.
              </p>
            )}

            {wasAlready && (
              <p className="nr-note" data-testid="psbt-already-signed">
                This device had already signed this transaction. Signing again produced exactly the
                same bytes, which is why doing it twice is safe rather than merely tolerated.
              </p>
            )}
          </div>

          {/* Last in the DOM, first on the screen. A reader meets what was
              signed and whether it is finished before the code; a camera meets
              the only white square on a dark panel immediately. The textarea
              further down is the fallback for a machine with no camera, and for
              anyone who would rather read the bytes. */}
          <QrDisplay text={signed} fileType="psbt" testId="psbt-qr" />
        </div>

        {finalised !== null && (
          <details className="nr-details" data-testid="psbt-finalised">
            <summary className="nr-details__summary">
              Show the finished transaction, for broadcasting
            </summary>
            <div className="nr-field">
              <span className="nr-field__label">Transaction id</span>
              <span className="nr-value nr-mono nr-break">{finalised.txid}</span>
              <textarea
                className="nr-input nr-input--area nr-break"
                readOnly
                rows={4}
                value={finalised.hex}
                data-testid="psbt-final-hex"
              />
              <p className="nr-hint">
                This is the raw transaction a node accepts. The PSBT above is what a coordinator
                wants. Both describe the same spend.
              </p>
            </div>
          </details>
        )}

        <details className="nr-details">
          <summary className="nr-details__summary">Show the signed PSBT as text</summary>
          <div className="nr-field">
            <textarea
              className="nr-input nr-input--area nr-break"
              readOnly
              rows={6}
              value={signed}
              data-testid="psbt-output"
            />
          </div>
        </details>
      </Screen>
    )
  }

  // --- Paste and review ----------------------------------------------------
  return (
    <Screen
      title="Sign a transaction"
      subtitle="Nothing is signed until you have read it."
      banner={banner}
      /* Safe to leave: nothing has been produced yet. The SIGNED state above
         gets no rail, because a signed PSBT exists only on this screen until
         it is carried off by camera or by file. */
      nav={nav}
      identity={identity}
      steps={steps}
      testId="psbt-screen"
      /* Latched, not tracked. Reading is something somebody DID, not somewhere
         they are: scrolling back up to look at the amounts again would
         otherwise disable Sign, which is absurd on the screen whose whole
         claim is that you read it first. It also removes a race, since a
         review that grows by a pixel after it has been read stops un-reading
         itself. Cleared in doReview, because a new transaction is a new thing
         to read.

         ONLY WHILE A REVIEW IS WHAT IS ON SCREEN. The body reports whenever
         its children change, and the busy render of the paste panel is a
         change: a panel scrolled to its end reported "at end" while the
         daemon was still parsing, and `read` latched on a transaction that
         had not been drawn yet. A report counts only when it measures the
         review itself. */
      onScrolledToEnd={(atEnd) => {
        if (atEnd && review !== null && !busy) setRead(true)
      }}
      actions={
        <>
          <Button variant="ghost" onClick={onBack} testId="psbt-cancel">
            Cancel
          </Button>
          <div className="nr-spacer" />
          {review === null ? (
            <Button
              /* Primary, unlike Sign below it, and that is the point rather
                 than an inconsistency. This screen's whole claim is that
                 nothing is signed until you have read what it does, and Review
                 is the control that shows you. It renders nothing irreversible:
                 it parses bytes this device already holds. Sign wears `danger`
                 two states later for the opposite reason.
                 
                 It used to be a ghost button the same weight as Cancel, so the
                 screen offered leaving and reading as equally good ideas. */
              variant="primary"
              disabled={psbt.trim().length === 0 || busy}
              onClick={() => void doReview()}
              testId="psbt-review"
            >
              {busy ? 'Reading' : 'Review'}
            </Button>
          ) : (
            <>
              {/* Why the button is dead, beside the button. A disabled control
                  with its reason scrolled two screens away is a control that
                  reads as broken software rather than as a refusal, and this
                  one refuses for reasons somebody needs to act on. */}
              {(refused || review.ownedInputs === 0 || !read) && (
                <span className="nr-status nr-status--fail" data-testid="psbt-refusal">
                  {review.ownedInputs === 0
                    ? 'No input here is yours'
                    : refused && override
                      ? read
                        ? `Overriding ${String(blocking.length)}`
                        : 'Scroll to the end first'
                      : refused
                        ? blocking.length === 1 && blocking[0] !== undefined
                          ? `Will not sign: ${WARNING_LABELS[blocking[0].kind]}`
                          : `Will not sign: ${String(blocking.length)} blocking warnings`
                        : /* Not refused, merely unread. Says which, because a
                             disabled Sign with no reason beside it is the
                             defect this line exists to prevent. */
                          'Scroll to the end first'}
                </span>
              )}
              {/* THE GATE BESIDE THE THING IT GATES.

                  MachineEntropyScreen already carries this argument in these
                  words: a tick that ungates a greyed-out button, placed in the
                  body, is a control somebody has to go looking for while the
                  button and its refusal sit in the bar. Here it was worse than
                  awkward. Moving the verdict to the top of the body brought
                  73px of override hint with it, and that pushed the outputs
                  table off the panel: the screen that authorises a payment
                  opened with three boxes of commentary and no amounts.

                  Short label here, full sentence in the body next to the
                  warning it overrides. The bar has room for a phrase and this
                  is a 7 inch panel. */}
              {blocking.length > 0 && review.ownedInputs > 0 && (
                <label className="nr-check">
                  <input
                    type="checkbox"
                    checked={override}
                    onChange={(e) => {
                      setOverride(e.target.checked)
                    }}
                    data-testid="psbt-override"
                  />
                  <span className="nr-hint">Sign anyway, this once</span>
                </label>
              )}
              <Button
                variant="danger"
                disabled={busy || !maySign}
                onClick={() => void doSign()}
                testId="psbt-sign"
              >
                {busy ? 'Signing' : 'Sign'}
              </Button>
            </>
          )}
        </>
      }
    >
      {/* ABOVE THE INPUT IT IS ABOUT, AND IT HAS TO BE ON THE PANEL.

          This sat after the paste field, the scan button and a three line hint,
          which put it below the fold. The code was already correct: the review
          handler catches, clears any stale review and sets the message rather
          than swallowing it. The panel showed nothing. Somebody tapped Review,
          the screen did not change, and the reason was off the bottom, on the
          screen where the rule is that an error fails loudly.

          It was never rendered here at all until the gallery got a state whose
          handlers reject. Nineteen screens have one of these and jsdom cannot
          see any of them. */}
      {/* "Signing failed", not "Not signed", which is the pattern every other
          refusal on this device follows. This one renders directly above the
          review's own "Will not sign" now, and two red banners reading "Not
          signed" and "Will not sign" are not two sentences somebody separates
          while deciding what to do about them. They are different things: one is
          the device declining before it tried, the other is the attempt coming
          back with an error.

          And only for a signature. A review that failed never reached signing,
          so it says that it was not read and that nothing was signed. */}
      {error !== null && (
        <Refusal
          title={error.during === 'sign' ? 'Signing failed' : 'Not read, nothing signed'}
          testId="psbt-error"
        >
          {error.message}
        </Refusal>
      )}

      {review === null && (
        <div className="nr-field">
          <span className="nr-field__label">Paste the PSBT</span>
          <textarea
            className="nr-input nr-input--area nr-break"
            rows={6}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder="cHNidP8B..."
            value={psbt}
            onChange={(e) => {
              setPsbt(e.target.value)
            }}
            data-testid="psbt-input"
          />
          {onScan !== undefined && (
            <Button onClick={onScan} testId="psbt-scan">
              Scan a QR code instead
            </Button>
          )}
          <p className="nr-hint">
            Base64, as exported by your coordinator, by camera or on an SD card. This device has no
            network and never fetches anything about this transaction, so everything below is
            computed from these bytes and your seed alone.
          </p>
        </div>
      )}

      {review !== null && (
        <>
          {/* THE VERDICT ABOVE THE EVIDENCE.

              This device says "Will not sign" here, and it said it last: under
              the quorum card, the outputs table, the fee breakdown and the
              inputs card, 819px past the fold on a 480px panel. The Sign button
              in the bar was greyed out and the sentence explaining why was two
              and a half screens down, along with the tick that ungates it. So
              the screen a person actually saw refused and gave no reason.

              MachineEntropyScreen already carries this exact argument, in the
              same words, about 223px. This is the same shape on the screen that
              authorises spending money, and moving one did not move the other.

              The evidence still matters and is still here: it is what somebody
              judges the verdict against, and it can be scrolled to. Whether
              this device is going to sign cannot. */}
          {review.ownedInputs === 0 && (
            <div
              data-must-see
              className="nr-banner nr-banner--danger"
              data-testid="psbt-nothing-to-sign"
            >
              <strong>Nothing to sign</strong>
              <span>
                None of these inputs belong to this wallet. Either this transaction is for a
                different device, or the coordinator built it against the wrong descriptor.
              </span>
            </div>
          )}

          {/* WHAT THIS REVIEW COULD NOT SEE, above the amounts it is describing.

              A registered quorum that no longer parses contributes none of its
              addresses to the owned index, so its change is rendered as a
              payment out. The user cannot tell that from a real payment out,
              and the difference is the whole question they are being asked.
              First in the body, with the refusals, because it qualifies
              everything below it rather than being one more row. */}
          {(review.unreadableRegistrations ?? 0) > 0 && (
            <div
              data-must-see
              className="nr-banner nr-banner--caution"
              data-testid="psbt-unreadable-registrations"
            >
              <strong>Read this review with care</strong>
              <span>
                {review.unreadableRegistrations} registered{' '}
                {review.unreadableRegistrations === 1 ? 'quorum' : 'quorums'} could not be read on
                this device, so none of {review.unreadableRegistrations === 1 ? 'its' : 'their'}{' '}
                addresses were recognised. Change coming back from{' '}
                {review.unreadableRegistrations === 1 ? 'it' : 'them'} is shown below as money going
                to a stranger. Check the quorum list before deciding what this transaction does.
              </span>
            </div>
          )}

          {blocking.length > 0 && (
            <div data-must-see data-testid="psbt-blocking">
              {blocking.map((w) => (
                <div key={w.kind + w.message} className="nr-banner nr-banner--danger">
                  <strong>Will not sign</strong>
                  <span>{w.message}</span>
                </div>
              ))}
            </div>
          )}

          {/* ADVISORY WARNINGS ABOVE THE EVIDENCE TOO, and marked.

              These are the ones the device will sign despite, which makes their
              placement worse rather than better: a blocking warning at least
              greys the button out. This fixture's reads "Output 2 has no
              address this device can render, and nothing here can tell you
              where that money goes", and it sat 900px below the outputs table
              it is about. A caveat nobody reads on a transaction the device
              will sign is the combination that costs money. */}
          {advisory.length > 0 && (
            <div data-must-see data-testid="psbt-warnings">
              {advisory.map((w) => (
                <div key={w.kind + w.message} className="nr-banner nr-banner--caution">
                  <strong>Check this</strong>
                  <span>{w.message}</span>
                </div>
              ))}
            </div>
          )}

          {/* What overriding means, beside the refusal it would override, with
              the control itself in the action bar next to Sign. Splitting them
              is deliberate: the reasoning belongs with the reason, and the tick
              belongs with the button, and putting both here cost the outputs
              table its place on the panel. */}
          {blocking.length > 0 && review.ownedInputs > 0 && (
            <Info label="What signing anyway means" testId="psbt-override-note">
              The tick is in the bar below, beside the button it releases. It applies to this
              signature only and is not remembered, so the next transaction refuses again for the
              same reason. Do not tick it because a coordinator told you to.
            </Info>
          )}

          {/* Where this device sits in the quorum, BEFORE the amounts. Signing a
              2-of-3 as the first cosigner and as the last are different acts:
              one produces something that has to travel, the other produces
              something spendable. A user is entitled to know which they are
              about to do. */}
          {review.signatures?.required != null && (
            <div className="nr-card nr-card--tight" data-testid="psbt-quorum">
              <div className="nr-row">
                <span className="nr-label">Signatures</span>
                <span className="nr-value">
                  {review.signatures.present} of {review.signatures.required} present
                  {review.signatures.inputs[0]?.cosigners != null &&
                    `, ${String(review.signatures.inputs[0].cosigners)} cosigners`}
                </span>
              </div>
              <p className="nr-hint">
                {review.signatures.present + 1 >= review.signatures.required
                  ? 'Yours would be the last signature needed, so this becomes spendable.'
                  : `Yours would not be the last. After signing, this still has to reach ${String(
                      review.signatures.required - review.signatures.present - 1
                    )} more cosigner${
                      review.signatures.required - review.signatures.present - 1 === 1 ? '' : 's'
                    }.`}
              </p>
            </div>
          )}

          {/* Money leaving first. It is what the user is actually approving. */}
          <div className="nr-card">
            <span className="nr-card__label">Where the money goes</span>
            <table className="nr-table" data-testid="psbt-outputs">
              <thead>
                <tr>
                  <th>Amount</th>
                  <th>To</th>
                </tr>
              </thead>
              <tbody>
                {review.outputs.map((o) => (
                  <tr key={o.index} data-testid={`psbt-output-${String(o.index)}`}>
                    <td className="nr-mono">{o.amountBtc}</td>
                    <td>
                      {/* BELOW the address, never above it, and marked as a
                          note. The address is what the money goes to; the
                          label is a string from a file this device did not
                          write. Putting it first would let a familiar word
                          stand in for reading the characters, which is the one
                          thing this screen exists to make people do. */}
                      <div className="nr-mono nr-break">
                        {o.address ?? 'no address (raw script)'}
                      </div>
                      {o.label !== undefined && o.label !== null && (
                        <div
                          className="nr-hint"
                          data-testid={`psbt-output-label-${String(o.index)}`}
                        >
                          Your note: {o.label}
                        </div>
                      )}
                      {o.kind === 'change' ? (
                        <div className="nr-hint nr-ok">
                          Change, re-derived at {o.changePath}. Verified against your seed, not
                          taken from the transaction.
                        </div>
                      ) : (
                        <div className="nr-hint nr-warn">
                          Leaves this wallet. Check this address against where you meant to send.
                        </div>
                      )}
                      {/* THE CLAIM THIS DEVICE REFUSED. An output the
                          transaction said was yours, which does not derive
                          from your seed, looks exactly like an ordinary
                          payment without this line. It is either a coordinator
                          disagreeing about a gap limit or the substitution
                          this screen exists to refuse. */}
                      {o.changeRejectedBecause != null && (
                        <div
                          className="nr-hint nr-warn"
                          data-testid={`psbt-out-claimed-${String(o.index)}`}
                        >
                          {o.changeRejectedBecause}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Four units, because fee-stuffing hides in whichever one is absent. */}
          <div className="nr-card nr-card--tight">
            <div className="nr-row">
              <span className="nr-label">Fee</span>
              <span className="nr-value nr-mono" data-testid="psbt-fee">
                {review.fee.feeBtc} BTC
              </span>
            </div>
            <div className="nr-row">
              <span className="nr-label">In satoshis</span>
              <span className="nr-value nr-mono">{review.fee.feeSats}</span>
            </div>
            <div className="nr-row">
              <span className="nr-label">Rate</span>
              <span className="nr-value nr-mono">
                {review.fee.satsPerVbyte} sat/vB, about {review.fee.vsize} vB
              </span>
            </div>
            <div className="nr-row">
              <span className="nr-label">Share of the spend</span>
              <span className="nr-value nr-mono">{review.fee.percentOfSpend}%</span>
            </div>
            <p className="nr-hint">
              Computed as inputs minus outputs. It is never read from the transaction, because a
              transaction that stated its own fee could state any fee at all. The size is an
              estimate until the signatures exist, so the rate is approximate and the absolute fee
              is exact.
            </p>
          </div>

          <div className="nr-card nr-card--tight">
            <div className="nr-row">
              <span className="nr-label">Inputs</span>
              <span className="nr-value nr-mono">
                {review.inputs.length}, of which {review.ownedInputs}{' '}
                {review.ownedInputs === 1 ? 'is' : 'are'} yours
              </span>
            </div>
            <div className="nr-row">
              <span className="nr-label">Signature covers</span>
              <span className="nr-value nr-mono">{review.sighash.name}</span>
            </div>
            <p className="nr-hint">{review.sighash.meaning}</p>
            <div className="nr-row">
              <span className="nr-label">Replaceable</span>
              <span className="nr-value nr-mono">
                {review.replaceable ? 'yes, fee can be bumped' : 'no'}
              </span>
            </div>
          </div>
        </>
      )}
    </Screen>
  )
}
