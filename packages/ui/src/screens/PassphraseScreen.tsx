import { type ReactElement, type ReactNode, useState } from 'react'
import { Screen } from '../components/Screen.js'
import { Refusal } from '../components/Refusal.js'
import { Button } from '../components/Button.js'
import { TextKeyboard } from '../components/TextKeyboard.js'
import { Info } from '../components/Info.js'

/**
 * Setting a passphrase, and entering one.
 *
 * Spec: ui.screens.passphrase
 *
 * One component for both because the two screens must not drift: whatever the
 * set screen accepts, the enter screen has to accept, and a mismatch between
 * them locks a user out of their own wallet.
 *
 * The honesty problem on this screen is that a passphrase looks like a lock and
 * is really a delay. Argon2id makes each guess cost about half a second on this
 * hardware, so what a passphrase buys is that number multiplied by how many
 * guesses an attacker has to make. Six digits is a week of one machine. A
 * sentence is longer than anyone will be alive. The screen says this in those
 * terms rather than showing a coloured strength bar, because a bar that turns
 * green tells a user they are safe and a number of guesses tells them what they
 * actually have.
 *
 * There is no minimum length and no character-class rule. Both push people
 * toward short strings with a digit stuck on the end, which is the worst shape
 * for a memory-hard KDF, and neither can be enforced honestly on a device whose
 * threat model already says a stolen card is protected by the passphrase alone.
 */

export type PassphraseMode = 'set' | 'enter'

export interface PassphraseScreenProps {
  /**
   * The navigation menu, when leaving this screen is free.
   *
   * The only signal this device gives for that. It replaced a Home button in
   * the same corner meaning the same thing, which is how that corner came to
   * have three states and no rule.
   */
  readonly nav?: ReactNode
  readonly mode: PassphraseMode
  /** Shown in `enter` mode so a user knows how close the device is to erasing. */
  readonly attemptsRemaining?: number
  readonly maxAttempts?: number
  readonly onSubmit: (passphrase: string) => Promise<void>
  /** Absent in `enter` mode: there is nowhere to go back to from a locked device. */
  readonly onCancel?: (() => void) | undefined
  /** Where this screen sits in a journey, when it is part of one. */
  readonly steps?: ReactElement | null
  /** Who this device is and which wallet it has open. See `Identity`. */
  readonly identity?: ReactNode
  readonly banner?: ReactElement | null
}

/**
 * Roughly how long a guessing attack takes, in orders of magnitude.
 *
 * Deliberately crude and deliberately pessimistic. It assumes an attacker who
 * knows the exact shape of what was typed, which is the assumption that does
 * not flatter the user. The point is the difference between "days" and "longer
 * than that matters", not a precise figure that would be wrong anyway.
 */
function guessCost(passphrase: string): { label: string; tone: 'warn' | 'ok' } {
  const classes =
    (/[a-z]/.test(passphrase) ? 26 : 0) +
    (/[A-Z]/.test(passphrase) ? 26 : 0) +
    (/[0-9]/.test(passphrase) ? 10 : 0) +
    (/[^a-zA-Z0-9]/.test(passphrase) ? 33 : 0)
  if (classes === 0 || passphrase.length === 0) return { label: '', tone: 'warn' }

  // log2 of the search space, then seconds at roughly two guesses a second per
  // machine, which is what 64 MiB Argon2id costs on this class of hardware.
  const bits = passphrase.length * Math.log2(classes)
  const seconds = 2 ** (bits - 1) / 2

  const YEAR = 60 * 60 * 24 * 365
  if (seconds < 60 * 60) return { label: 'under an hour to guess', tone: 'warn' }
  if (seconds < 60 * 60 * 24) return { label: 'about a day to guess', tone: 'warn' }
  if (seconds < YEAR) return { label: 'months to guess', tone: 'warn' }
  if (seconds < YEAR * 1000) return { label: 'years to guess', tone: 'ok' }
  return { label: 'longer than is worth anyone trying', tone: 'ok' }
}

export function PassphraseScreen(props: PassphraseScreenProps): ReactElement {
  const { mode, attemptsRemaining, maxAttempts, onSubmit, onCancel, steps, identity, banner, nav } =
    props

  const [value, setValue] = useState('')
  const [confirm, setConfirm] = useState('')
  /**
   * Which field the on-screen keyboard types into.
   *
   * One keyboard rather than two, because 480px of height does not hold two and
   * a user who cannot see both fields cannot tell why they do not match.
   */
  const [field, setField] = useState<'value' | 'confirm'>('value')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setting = mode === 'set'
  const mismatch = setting && confirm.length > 0 && value !== confirm
  const ready = value.length > 0 && (!setting || (confirm === value && confirm.length > 0))
  const cost = guessCost(value)

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await onSubmit(value)
      // Cleared on success. Nothing keeps a passphrase in component state past
      // the moment it was needed.
      setValue('')
      setConfirm('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen
      title={setting ? 'Protect this wallet' : 'Unlock'}
      subtitle={
        setting
          ? 'A passphrase encrypts the wallet on this device.'
          : 'Enter the passphrase for the wallet stored here.'
      }
      banner={banner}
      nav={nav}
      identity={identity}
      steps={steps}
      testId="passphrase-screen"
      actions={
        <>
          {onCancel !== undefined && (
            <Button variant="ghost" onClick={onCancel} testId="passphrase-cancel">
              {setting ? 'Skip' : 'Cancel'}
            </Button>
          )}
          {mode === 'enter' && attemptsRemaining !== undefined && (
            <span className={attemptsRemaining <= 3 ? 'nr-status nr-status--fail' : 'nr-hint'}>
              {attemptsRemaining} of {maxAttempts ?? attemptsRemaining} attempts left
            </span>
          )}
          <div className="nr-spacer" />
          <Button
            variant="primary"
            disabled={!ready || busy}
            onClick={() => void submit()}
            testId="passphrase-submit"
          >
            {busy ? 'Working' : setting ? 'Encrypt and save' : 'Unlock'}
          </Button>
        </>
      }
    >
      {/* WHAT IS HAPPENING DURING THE PAUSE, and FIRST for the same reason the
          refusal below is first: it landed under the keyboard, which is off the
          bottom of an 800x480 panel, so the one explanation a user needs while
          they wait was the one thing they could not see.
          
          The work is Argon2id at 64 MiB and three passes, measured at 643ms on
          a machine considerably faster than a Pi, so several seconds here. A
          disabled button and nothing else, for several seconds, on a panel with
          no other feedback, is where somebody decides it has frozen and pulls
          the power in the middle of a write.
          
          It says WHY it is slow, because the slowness is the feature: the same
          arithmetic runs on every guess an attacker makes. */}
      {busy && (
        <Info label="Deriving the key" testId="passphrase-working">
          This takes a few seconds, and it is meant to. The same arithmetic runs on every guess an
          attacker makes, so a key that is slow to derive once is expensive to attack repeatedly. Do
          not power the device off while it is working.
        </Info>
      )}

      {/* FIRST IN THE BODY, because a refusal nobody sees is a refusal that
          did not happen. This sat last, under everything the screen holds, on
          a 480px panel: tapping the button and being refused changed nothing
          the user could see. Measured rather than asserted, because jsdom
          computes no box and every test on it passed throughout. */}
      {error !== null && (
        <Refusal title="Not accepted" testId="passphrase-error">
          {error}
        </Refusal>
      )}

      {/* BOTH FIELDS ON ONE ROW, AND THE ROW IS ALSO THE SELECTOR.

          This screen stacked two labelled fields and then a pair of tabs to say
          which one the on-screen keyboard was filling: four controls for two
          values, costing 180px of a 317px body on a screen whose keyboard needs
          196px on its own. Measured on the real device, 271px of it was below
          the fold, including every key. Step 4 of 4 of setting a wallet up, and
          you could not type.

          The tabs are gone because tapping a field is what selects it, and the
          field that the keyboard is filling says so rather than a separate
          control saying it on the field's behalf. */}
      <div className={setting ? 'nr-split nr-split--even' : ''}>
        <div className={`nr-field${setting && field === 'value' ? ' nr-field--active' : ''}`}>
          {/* The readout shares the label's line. See `.nr-field__labelrow`: on
              its own line it grows the field the moment somebody types, and the
              keyboard below it has no room to give. */}
          <div className="nr-field__labelrow">
            <span className="nr-field__label">Passphrase</span>
            {value.length > 0 && (
              <span className={`nr-hint ${cost.tone === 'ok' ? 'nr-ok' : 'nr-warn'}`}>
                {value.length} characters, {cost.label}
              </span>
            )}
          </div>
          <input
            className="nr-input"
            type="password"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
            }}
            onFocus={() => {
              setField('value')
            }}
            onClick={() => {
              setField('value')
            }}
            data-testid="passphrase-input"
          />
        </div>

        {setting && (
          <div className={`nr-field${field === 'confirm' ? ' nr-field--active' : ''}`}>
            <div className="nr-field__labelrow">
              <span className="nr-field__label">Again</span>
              {mismatch && <span className="nr-hint nr-warn">These do not match.</span>}
            </div>
            <input
              className="nr-input"
              type="password"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value)
              }}
              onFocus={() => {
                setField('confirm')
              }}
              onClick={() => {
                setField('confirm')
              }}
              data-testid="passphrase-confirm"
            />
          </div>
        )}
      </div>

      {/* NO KEYBOARD WHILE IT WORKS.
          
          Nothing can be typed during derivation, and a full keyboard that looks
          tappable and does nothing is the worst possible thing to show somebody
          who is already wondering whether the device has frozen. Hiding it also
          collapses the body, which is what finally made the explanation above
          visible: the panel is 800x480 and the message kept landing under a
          keyboard that filled the rest of it. */}
      {!busy && (
        <TextKeyboard
          value={field === 'confirm' ? confirm : value}
          onChange={(next) => {
            setError(null)
            if (field === 'confirm') setConfirm(next)
            else setValue(next)
          }}
          onSubmit={() => {
            // No `!busy` here any more: this keyboard is not rendered while the
            // key is being derived, so the guard could never be false and the
            // compiler says so.
            if (ready) void submit()
          }}
          testId="passphrase-keyboard"
        />
      )}

      {setting ? (
        <Info label="What a passphrase is for" testId="passphrase-info">
          This encrypts the seed on this device so the card is useless to whoever picks it up. It is
          not a second backup: if you forget it, the words you wrote down are the only way back, and
          there is no reset. Length is what matters, not symbols. Each guess costs an attacker about
          half a second of real work, so a sentence you can remember beats a short string you
          cannot.
        </Info>
      ) : (
        <div className="nr-card nr-card--tight">
          <p className="nr-hint">
            After {maxAttempts ?? 10} wrong attempts this device erases the wallet, and your written
            mnemonic is what restores it.
          </p>
          <p className="nr-hint">
            That counter only stops someone guessing at this screen. Anyone who takes the card can
            copy it and guess at their leisure, so the passphrase itself is the real protection.
          </p>
        </div>
      )}
    </Screen>
  )
}
