import { type ReactElement, type ReactNode, useState } from 'react'
import { Screen } from '../components/Screen.js'
import { Button } from '../components/Button.js'
import { TextKeyboard } from '../components/TextKeyboard.js'

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
  const { mode, attemptsRemaining, maxAttempts, onSubmit, onCancel, steps, identity, banner, nav } = props

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
      <div className="nr-field">
        <span className="nr-field__label">Passphrase</span>
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
          data-testid="passphrase-input"
        />
        {value.length > 0 && (
          <span className={`nr-hint ${cost.tone === 'ok' ? 'nr-ok' : 'nr-warn'}`}>
            {value.length} characters, {cost.label}
          </span>
        )}
      </div>

      {setting && (
        <div className="nr-field">
          <span className="nr-field__label">Again</span>
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
            data-testid="passphrase-confirm"
          />
          {mismatch && <span className="nr-hint nr-warn">These do not match.</span>}
        </div>
      )}

      {/* The device has no keyboard, so this is the real input. The fields
          above stay editable for a workstation and for tests. */}
      {setting && (
        <div className="nr-tabs">
          {(['value', 'confirm'] as const).map((which) => (
            <button
              key={which}
              type="button"
              className="nr-tab"
              aria-pressed={field === which}
              onClick={() => {
                setField(which)
              }}
              data-testid={`passphrase-field-${which}`}
            >
              {which === 'value' ? 'Passphrase' : 'Again'}
            </button>
          ))}
        </div>
      )}
      <TextKeyboard
        value={field === 'confirm' ? confirm : value}
        onChange={field === 'confirm' ? setConfirm : setValue}
        onSubmit={() => {
          if (ready && !busy) void submit()
        }}
        testId="passphrase-keyboard"
      />

      {error !== null && (
        <div className="nr-banner nr-banner--danger" data-testid="passphrase-error">
          <strong>Not accepted</strong>
          <span>{error}</span>
        </div>
      )}

      {setting ? (
        <div className="nr-card nr-card--tight">
          <p className="nr-hint">
            This encrypts the seed on this device so the card is useless to whoever picks it up. It
            is not a second backup. If you forget it, the words you wrote down are the only way
            back, and there is no reset.
          </p>
          <p className="nr-hint">
            Length is what matters here, not symbols. Each guess costs an attacker about half a
            second of real work, so a sentence you can remember beats a short string you cannot.
          </p>
        </div>
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
