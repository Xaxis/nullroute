import { type ReactElement, useState } from 'react'
import { Screen } from '../components/Screen.js'
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

export interface PsbtOutputView {
  readonly index: number
  readonly address: string | null
  readonly amountBtc: string
  readonly amountSats: string
  readonly kind: 'payment' | 'change'
  readonly changePath: string | null
}

export interface PsbtInputView {
  readonly index: number
  readonly txid: string
  readonly vout: number
  readonly amountBtc: string
  readonly derivationPath: string | null
}

export interface PsbtWarningView {
  readonly kind: string
  readonly message: string
  readonly blocking: boolean
}

export interface PsbtReviewView {
  readonly signable: boolean
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
  readonly onSign: (
    psbt: string,
    override: boolean
  ) => Promise<{ psbt: string; inputsSigned: number; signedWith: readonly string[] }>
  readonly onBack: () => void
  readonly banner?: ReactElement | null
}

export function PsbtScreen(props: PsbtScreenProps): ReactElement {
  const { initialPsbt, onScan, onReview, onSign, onBack, banner } = props

  const [psbt, setPsbt] = useState(initialPsbt ?? '')
  const [review, setReview] = useState<PsbtReviewView | null>(null)
  const [signed, setSigned] = useState<string | null>(null)
  const [signedWith, setSignedWith] = useState<readonly string[]>([])
  const [override, setOverride] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const blocking = review?.warnings.filter((w) => w.blocking) ?? []

  const doReview = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setSigned(null)
    try {
      setReview(await onReview(psbt))
    } catch (err) {
      // Shown, never swallowed. A transaction that failed to load must not
      // leave a stale review from a previous one on screen.
      setReview(null)
      setError((err as Error).message)
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
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // --- After signing -------------------------------------------------------
  if (signed !== null) {
    return (
      <Screen
        title="Signed"
        subtitle="Carry this back to the machine that built it."
        banner={banner}
        testId="psbt-signed"
        actions={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setSigned(null)
                setReview(null)
                setPsbt('')
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
        <div className="nr-card nr-card--tight">
          <div className="nr-row">
            <span className="nr-label">Signed with</span>
            <span className="nr-value nr-mono">{signedWith.join(', ')}</span>
          </div>
          <p className="nr-hint">
            These bytes are a pure function of your seed and this transaction. Sign the same
            transaction again and you get the same string, character for character. Anyone holding
            the seed can recompute it and confirm nothing was hidden in the signature.
          </p>
        </div>

        {/* The QR comes before the text, because it is how this actually leaves
            the device. The textarea below it is the fallback for a machine with
            no camera, and for anyone who would rather read the bytes. */}
        <QrDisplay text={signed} fileType="psbt" testId="psbt-qr" />

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
      subtitle="Nothing is signed until you have read what is below."
      banner={banner}
      testId="psbt-screen"
      actions={
        <>
          <Button variant="ghost" onClick={onBack} testId="psbt-cancel">
            Cancel
          </Button>
          <div className="nr-spacer" />
          {review === null ? (
            <Button
              disabled={psbt.trim().length === 0 || busy}
              onClick={() => void doReview()}
              testId="psbt-review"
            >
              {busy ? 'Reading' : 'Review'}
            </Button>
          ) : (
            <Button
              variant="danger"
              disabled={busy || review.ownedInputs === 0 || (!review.signable && !override)}
              onClick={() => void doSign()}
              testId="psbt-sign"
            >
              {busy ? 'Signing' : 'Sign'}
            </Button>
          )}
        </>
      }
    >
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

      {error !== null && (
        <div className="nr-banner nr-banner--danger" data-testid="psbt-error">
          <strong>Not signed</strong>
          <span>{error}</span>
        </div>
      )}

      {review !== null && (
        <>
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
                      <div className="nr-mono nr-break">{o.address ?? 'no address (raw script)'}</div>
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

          {review.warnings.length > 0 && (
            <div data-testid="psbt-warnings">
              {review.warnings.map((w) => (
                <div
                  key={w.kind + w.message}
                  className={`nr-banner ${w.blocking ? 'nr-banner--danger' : 'nr-banner--testnet'}`}
                >
                  <strong>{w.blocking ? 'Will not sign' : 'Check this'}</strong>
                  <span>{w.message}</span>
                </div>
              ))}
            </div>
          )}

          {review.ownedInputs === 0 && (
            <div className="nr-banner nr-banner--danger">
              <strong>Nothing to sign</strong>
              <span>
                None of these inputs belong to this wallet. Either this transaction is for a
                different device, or the coordinator built it against the wrong descriptor.
              </span>
            </div>
          )}

          {blocking.length > 0 && review.ownedInputs > 0 && (
            <div className="nr-card nr-card--tight">
              <label className="nr-check">
                <input
                  type="checkbox"
                  checked={override}
                  onChange={(e) => {
                    setOverride(e.target.checked)
                  }}
                  data-testid="psbt-override"
                />
                <span className="nr-hint">
                  Sign anyway, this once. Applies to this signature only and is not remembered.
                  Do not tick this because a coordinator told you to.
                </span>
              </label>
            </div>
          )}
        </>
      )}
    </Screen>
  )
}
