import { type ReactElement, useCallback, useState } from 'react'
import { Screen } from '../components/Screen.js'
import { Button } from '../components/Button.js'
import { TextKeyboard } from '../components/TextKeyboard.js'
import { QrDisplay } from '../components/QrDisplay.js'
import { Hash } from '../components/Hash.js'

/**
 * Proving you control an address, by signing a message with it.
 *
 * Spec: ui.screens.message
 *
 * THIS SCREEN IS SHAPED LIKE THE SIGNING SCREEN ON PURPOSE, because it carries
 * the same risk in a smaller package. A signature is a proof that whoever holds
 * the key agreed to a specific string. If somebody else chose that string, and
 * it means something elsewhere, the user has authorised it without ever seeing
 * a transaction.
 *
 * So the message is reviewed before it is signed, the review is a separate act
 * from signing, and the text is shown in full rather than truncated. A message
 * nobody read to the end is a message nobody agreed to.
 *
 * WHAT LEAVES IS AN ADDRESS AND A SIGNATURE, TOGETHER. A BIP-322 signature is
 * meaningless without the address it is about: a verifier needs the address, the
 * message and the signature, and this device is the only thing that knows which
 * address a derivation path produced. So all three go into the QR, and the
 * screen says so, because handing somebody a signature alone is handing them
 * nothing.
 */

export interface MessageReviewView {
  readonly message: string
  readonly hashHex: string
  readonly characters: number
  readonly bytes: number
  readonly refusals: readonly string[]
  readonly warnings: readonly string[]
}

export interface MessageSignatureView {
  readonly address: string
  readonly message: string
  readonly signature: string
  readonly path: string
}

/** Script types this device can sign a message for. */
export const MESSAGE_SCRIPT_TYPES = [
  { id: 'p2wpkh', label: 'Native segwit', note: 'bc1q. The default.' },
  { id: 'p2sh-p2wpkh', label: 'Nested segwit', note: 'Starts with 3.' },
] as const

export interface MessageScreenProps {
  readonly onReview: (message: string) => Promise<MessageReviewView>
  readonly onSign: (
    message: string,
    scriptType: string,
    path: string
  ) => Promise<MessageSignatureView>
  readonly onBack: () => void
  /** Back to the wallet, or the picker. Rendered in the header by Screen. */
  readonly onHome?: (() => void) | undefined
  readonly banner?: ReactElement | null
}

export function MessageScreen(props: MessageScreenProps): ReactElement {
  const { onReview, onSign, onBack, onHome, banner } = props

  const [message, setMessage] = useState('')
  const [review, setReview] = useState<MessageReviewView | null>(null)
  const [signed, setSigned] = useState<MessageSignatureView | null>(null)
  const [scriptType, setScriptType] = useState<string>('p2wpkh')
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const path = `m/${scriptType === 'p2wpkh' ? '84' : '49'}'/0'/0'/0/${String(index)}`

  const doReview = useCallback(async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setSigned(null)
    try {
      setReview(await onReview(message))
    } catch (err) {
      // Shown, never swallowed. A message that failed to review must not leave
      // a stale review from a previous one on screen to be signed instead.
      setReview(null)
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }, [message, onReview])

  const doSign = useCallback(async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setSigned(await onSign(message, scriptType, path))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }, [message, scriptType, path, onSign])

  // --- After signing --------------------------------------------------------
  if (signed !== null) {
    // All three, because a signature without the address and the message proves
    // nothing and cannot be checked by anybody.
    const proof = JSON.stringify(
      { address: signed.address, message: signed.message, signature: signed.signature },
      null,
      2
    )

    return (
      <Screen
        title="Signed"
        subtitle="Give all three of these to whoever asked."
        banner={banner}
        onHome={onHome}
        testId="message-signed"
        actions={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setSigned(null)
                setReview(null)
                setMessage('')
              }}
              testId="message-another"
            >
              Sign another
            </Button>
            <div className="nr-spacer" />
            <Button onClick={onBack} testId="message-done">
              Done
            </Button>
          </>
        }
      >
        <div className="nr-card nr-card--tight">
          <div className="nr-row">
            <span className="nr-label">Address</span>
            <span className="nr-value nr-mono nr-break" data-testid="message-address">
              {signed.address}
            </span>
          </div>
          <div className="nr-row">
            <span className="nr-label">Path</span>
            <span className="nr-value nr-mono">{signed.path}</span>
          </div>
          <p className="nr-hint">
            A signature on its own proves nothing. Whoever checks this needs the address, the
            message and the signature together, which is what the code below carries.
          </p>
        </div>

        <QrDisplay text={proof} fileType="json" testId="message-qr" />

        <details className="nr-details">
          <summary className="nr-details__summary">Show it as text</summary>
          <div className="nr-field">
            <textarea
              className="nr-input nr-input--area nr-break"
              readOnly
              rows={8}
              value={proof}
              data-testid="message-proof"
            />
          </div>
        </details>
      </Screen>
    )
  }

  // --- Write and review -----------------------------------------------------
  const blocked = review !== null && review.refusals.length > 0

  return (
    <Screen
      title="Prove you control an address"
      subtitle="Sign a message with one of your keys."
      banner={banner}
      onHome={onHome}
      testId="message-screen"
      actions={
        <>
          <Button variant="ghost" onClick={onBack} testId="message-cancel">
            Cancel
          </Button>
          <div className="nr-spacer" />
          {review === null ? (
            <Button
              disabled={message.length === 0 || busy}
              onClick={() => void doReview()}
              testId="message-review"
            >
              {busy ? 'Reading' : 'Review'}
            </Button>
          ) : (
            <Button
              variant="danger"
              disabled={busy || blocked}
              onClick={() => void doSign()}
              testId="message-sign"
            >
              {busy ? 'Signing' : 'Sign it'}
            </Button>
          )}
        </>
      }
    >
      {review === null && (
        <>
          <span className="nr-field__label">The message</span>
          <TextKeyboard value={message} onChange={setMessage} testId="message-keyboard" />
          <p className="nr-hint">
            Type exactly what you were asked to sign. A signature is a proof that you agreed to this
            specific text, so if somebody else chose the wording, read it twice.
          </p>
        </>
      )}

      {review !== null && (
        <>
          {/* The message in full, before anything else. This is the thing being
              agreed to, and truncating it would be truncating the agreement. */}
          <div className="nr-card">
            <span className="nr-card__label">What you are agreeing to</span>
            <pre className="nr-message" data-testid="message-text">
              {review.message}
            </pre>
            <div className="nr-row">
              <span className="nr-label">Length</span>
              <span className="nr-value nr-mono">
                {review.characters} characters, {review.bytes} bytes
              </span>
            </div>
          </div>

          {review.refusals.map((refusal) => (
            <div
              className="nr-banner nr-banner--danger"
              key={refusal}
              data-testid="message-refusal"
            >
              <strong>Will not sign this</strong>
              <span>{refusal}</span>
            </div>
          ))}

          {review.warnings.map((warning) => (
            <p className="nr-note" key={warning} data-testid="message-warning">
              {warning}
            </p>
          ))}

          <div className="nr-tabs">
            {MESSAGE_SCRIPT_TYPES.map((type) => (
              <button
                key={type.id}
                type="button"
                className="nr-tab"
                aria-pressed={scriptType === type.id}
                onClick={() => {
                  setScriptType(type.id)
                }}
                data-testid={`message-script-${type.id}`}
              >
                {type.label}
              </button>
            ))}
            <div className="nr-spacer" />
            <button
              type="button"
              className="nr-tab"
              onClick={() => {
                setIndex(index === 0 ? 1 : 0)
              }}
              data-testid="message-index"
            >
              Address {index}
            </button>
          </div>

          <div className="nr-card nr-card--tight">
            <div className="nr-row">
              <span className="nr-label">Signing with</span>
              <span className="nr-value nr-mono">{path}</span>
            </div>
            <div className="nr-row">
              <span className="nr-label">Commitment</span>
              <span className="nr-value nr-mono">
                <Hash value={review.hashHex} />
              </span>
            </div>
            <p className="nr-hint">
              The commitment is what a verifier recomputes from the message. It does not depend on
              your keys, so you can check it against whatever asked you to sign.
            </p>
          </div>
        </>
      )}

      {error !== null && (
        <div className="nr-banner nr-banner--danger" data-testid="message-error">
          <strong>Not signed</strong>
          <span>{error}</span>
        </div>
      )}
    </Screen>
  )
}
