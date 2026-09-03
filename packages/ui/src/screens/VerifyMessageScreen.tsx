import { type ReactElement, type ReactNode, useCallback, useEffect, useState } from 'react'
import { Screen } from '../components/Screen.js'
import { Refusal } from '../components/Refusal.js'
import { Button } from '../components/Button.js'
import { TextKeyboard } from '../components/TextKeyboard.js'
import { Info } from '../components/Info.js'

/**
 * Checking somebody else's proof that they control an address.
 *
 * Spec: ui.screens.verify-message
 *
 * WHY THIS BELONGS ON AN AIR-GAPPED SIGNER. The device could sign proofs and
 * never check one, which is what it did. But the question "is this address
 * really theirs" arrives exactly where this device is useful and nothing else
 * is: an exchange or a counterparty hands over an address and a signature, and
 * the machine you would otherwise check it on is the networked one you do not
 * trust with the answer. Verification needs no key and no network.
 *
 * REACHABLE WITH THE WALLET LOCKED, on purpose. This is a public computation.
 * Making somebody type a passphrase to check a stranger's signature would be
 * asking for the most dangerous thing they own in exchange for arithmetic.
 *
 * WHAT A PASS MEANS, and the screen says it rather than leaving it implied:
 * whoever produced this signature held the key for this address, and agreed to
 * exactly these bytes. It does not say when, it does not say the address holds
 * money, and it does not say the person who handed it over is the person who
 * made it. A valid signature is evidence about a key, not about a human.
 *
 * A FAILURE IS NOT AN ACCUSATION. The commonest cause by far is a message that
 * differs by a space or a line ending, so the refusal says which part failed
 * rather than announcing fraud.
 */

export interface VerificationView {
  readonly valid: boolean
  readonly scriptType: string
  readonly reason?: string | null
}

/**
 * A whole proof, when the scanned text was an armoured block.
 *
 * Passed in rather than parsed here, so the frontend holds no format knowledge.
 * The parser is in core, tested against the format Electrum writes, and this
 * screen only decides where the three strings land.
 */
export interface ScannedProof {
  readonly address: string
  readonly message: string
  readonly signature: string
}

export interface VerifyMessageScreenProps {
  /**
   * The navigation menu, when leaving this screen is free.
   *
   * The only signal this device gives for that. It replaced a Home button in
   * the same corner meaning the same thing, which is how that corner came to
   * have three states and no rule.
   */
  readonly nav?: ReactNode
  readonly onVerify: (
    address: string,
    message: string,
    signature: string
  ) => Promise<VerificationView>
  readonly onScan?: (() => void) | undefined
  /** Text the camera already read, if the user arrived that way. */
  readonly scanned?: string | undefined
  /**
   * All three fields, when the scan was an armoured block.
   *
   * One QR instead of three fields typed on a panel with no keyboard, which is
   * the difference between this screen being used and not.
   */
  readonly scannedProof?: ScannedProof | undefined
  readonly onBack: () => void
  /** Who this device is and which wallet it has open. See `Identity`. */
  readonly identity?: ReactNode
  readonly banner?: ReactElement | null
}

/**
 * Which field the keyboard is filling.
 *
 * One at a time, because there is no hardware keyboard and the on-screen one
 * takes most of a 480px panel. Three fields with three keyboards would be a
 * screen nothing fits on; three fields and one keyboard is a tab bar.
 */
type Field = 'address' | 'message' | 'signature'

const FIELDS = [
  { id: 'address', label: 'Address', hint: 'The address they say is theirs.' },
  { id: 'message', label: 'Message', hint: 'Exactly what they signed, character for character.' },
  { id: 'signature', label: 'Signature', hint: 'The base64 they gave you. Scanning is easier.' },
] as const

export function VerifyMessageScreen(props: VerifyMessageScreenProps): ReactElement {
  const { onVerify, onScan, scanned, scannedProof, onBack, identity, banner, nav } = props

  const [address, setAddress] = useState('')
  const [message, setMessage] = useState('')
  const [signature, setSignature] = useState(scanned ?? '')
  const [editing, setEditing] = useState<Field>(scannedProof === undefined ? 'address' : 'message')
  const [result, setResult] = useState<VerificationView | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A whole proof from one scan. Fills every field, and lands on the message,
  // which is the one worth reading before deciding anything.
  useEffect(() => {
    if (scannedProof === undefined) return
    setAddress(scannedProof.address)
    setMessage(scannedProof.message)
    setSignature(scannedProof.signature)
    setResult(null)
  }, [scannedProof])

  /**
   * A pass, and nothing else read as one.
   *
   * `=== true`, not truthiness, because this crosses a JSON boundary. The same
   * class of bug has been found twice on this device: the lock screen treated
   * an unrecognised attestation status as a pass, and the signing screen
   * trusted a `signable` flag it received rather than the reasons behind it.
   * Anything that is not exactly `true` here means the verifier did not say
   * yes, and the only safe reading of that is no. See INV-UI-53.
   */
  const passed = result?.valid === true

  const ready = address.trim().length > 0 && signature.trim().length > 0

  const run = useCallback(async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      setResult(await onVerify(address.trim(), message, signature.trim()))
    } catch (err) {
      // Never swallowed. A verification that failed to run is not a
      // verification that failed, and showing the second for the first is how
      // somebody rejects a good proof.
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }, [onVerify, address, message, signature])

  const values: Record<Field, string> = { address, message, signature }
  const setters: Record<Field, (next: string) => void> = {
    address: setAddress,
    message: setMessage,
    signature: setSignature,
  }
  const active = FIELDS.find((field) => field.id === editing) ?? FIELDS[0]

  return (
    <Screen
      title="Check a proof"
      subtitle="Whether an address is really theirs."
      banner={banner}
      nav={nav}
      identity={identity}
      testId="verify-message"
      actions={
        <>
          <Button onClick={onBack} testId="verify-back">
            Back
          </Button>
          <div className="nr-spacer" />
          <Button
            variant="primary"
            disabled={!ready || busy}
            onClick={() => {
              void run()
            }}
            testId="verify-run"
          >
            {busy ? 'Checking' : 'Check it'}
          </Button>
        </>
      }
    >
      {/* FIRST IN THE BODY, because a refusal nobody sees is a refusal that
          did not happen. This sat last, under everything the screen holds, on
          a 480px panel: tapping the button and being refused changed nothing
          the user could see. Measured rather than asserted, because jsdom
          computes no box and every test on it passed throughout. */}
      {error !== null && (
        <Refusal title="Could not check it" testId="verify-error">
          {error}
        </Refusal>
      )}

      {result !== null && (
        <div
          className={`nr-banner ${passed ? 'nr-banner--ok' : 'nr-banner--danger'}`}
          data-testid="verify-result"
        >
          <strong>{passed ? 'The proof checks out' : 'That proof does not check out'}</strong>
          <span>
            {passed
              ? 'Whoever made this signature held the key for that address, and agreed to exactly ' +
                'the message above. It does not say when they held it, that the address holds ' +
                'anything, or that the person who gave it to you is the person who made it.'
              : (result.reason ?? 'The signature does not match this address and this message.')}
          </span>
        </div>
      )}

      {result !== null && !passed && (
        <Info label="Where to look first" testId="verify-usual-cause">
          The commonest cause is the message, not the signature. A trailing space, a missing line
          break, or a smart quote where a straight one was signed all produce this. Compare the
          message character for character before concluding anything about the other party.
        </Info>
      )}

      {/* Which field the keyboard fills. Each tab shows whether that field has
          anything in it, because the check button being disabled is otherwise
          the only clue about which one was missed. */}
      {/* The tabs and the line about the field they picked, on one row. Stacked
          they cost 34px above a keyboard that needs 190 of a 287px body once
          the network banner is on screen. */}
      <div className="nr-beside">
        <div className="nr-tabs">
          {FIELDS.map((field) => (
            <button
              key={field.id}
              type="button"
              className="nr-tab"
              aria-pressed={editing === field.id}
              onClick={() => {
                setEditing(field.id)
                // AND BACK TO EDITING. While a result is showing, the keyboard is
                // replaced by the three values that were checked, so a tab that
                // only changed which field is active would have moved a highlight
                // and offered no way to type. That is the dead end this screen
                // used to avoid by keeping a keyboard nobody could use.
                //
                // Clearing here is the same rule the keyboard already follows: a
                // verdict about a field somebody has gone back to is a verdict
                // about something that is no longer settled.
                setResult(null)
              }}
              data-testid={`verify-tab-${field.id}`}
            >
              {values[field.id].length > 0 ? `${field.label} set` : field.label}
            </button>
          ))}
          {onScan !== undefined && (
            <>
              <div className="nr-spacer" />
              <button type="button" className="nr-tab" onClick={onScan} data-testid="verify-scan">
                Scan
              </button>
            </>
          )}
        </div>
        <span className="nr-field__label">{active.hint}</span>
      </div>

      {/* WHAT WAS CHECKED, WHERE THE KEYBOARD WOULD BE.

          A verdict used to appear above a full keyboard, which is 196px of
          this panel spent on a control nobody can use while reading the answer:
          the first key pressed clears the result, by design, because a verdict
          under a changed field is a verdict about something that is no longer
          on the screen.

          Worse than wasted. A failure here says the commonest cause is the
          message rather than the signature, and tells the user to compare it
          character for character. The screen then showed them a keyboard
          instead of the message. Now it shows the three values, and a tab
          takes them back to editing whichever one is wrong. */}
      {result !== null ? (
        <div className="nr-card nr-card--tight nr-fill" data-testid="verify-checked">
          {FIELDS.map((field) => (
            <div className="nr-field" key={field.id}>
              <span className="nr-field__label">{field.label}</span>
              <span className="nr-address nr-break">
                {values[field.id].length === 0 ? '(empty)' : values[field.id]}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <>
          <TextKeyboard
            // NOT SECRET. None of the three is: an address, a signature, and the
            // message somebody signed are all things the other party handed over in
            // the open. They were masked because this keyboard was built for the
            // passphrase gate and masks by default, which put bullets under a label
            // reading "exactly what they signed, character for character".
            secret={false}
            value={values[active.id]}
            onChange={(next) => {
              setters[active.id](next)
              // Cleared, because a result sitting under a changed field is a result
              // about something that is no longer on the screen. The refusal goes
              // with it: it is about the last attempt, and it is 50px at the top of
              // a body that has a keyboard in it.
              setResult(null)
              setError(null)
            }}
            testId="verify-keyboard"
          />
        </>
      )}

      <Info label="What this checks" testId="verify-no-key">
        This uses no key and needs no wallet open. It is arithmetic on what you typed, which is why
        it works on a device with no network and why it can be done before unlocking anything.
      </Info>
    </Screen>
  )
}
