import { type ReactElement, useCallback, useEffect, useState } from 'react'
import { Screen } from '../components/Screen.js'
import { Button } from '../components/Button.js'

/**
 * Dice entropy collection.
 *
 * Spec: ui.screens.dice
 *
 * This is the screen the project exists for. Everything else could be replaced
 * by another wallet; this is the one that lets a user prove where their key came
 * from. Three rules follow from that, and each is visible in the layout:
 *
 *   1. The accounting is TRUNCATED, never rounded. A display that rounds 255.9
 *      up to 256 tells the user they are finished when they are not. The
 *      arithmetic comes from the daemon, which is the side that decides.
 *
 *   2. Warnings never block. A fair die genuinely can produce a suspicious
 *      sequence, and a device that discarded real rolls would be substituting
 *      its judgement for the user's entropy, which is the exact failure this
 *      project exists to prevent. The user is told what looks wrong and decides.
 *
 *   3. The rolls stay visible. The user is going to check the result against
 *      `sha256sum` on another machine, so they need to be able to read back
 *      exactly what they entered, in order, with nothing hidden or reformatted.
 */

export interface Accounting {
  readonly rolls: number
  readonly bits: number
  readonly targetBits: number
  readonly sufficient: boolean
  readonly rollsRemaining: number
}

export interface PatternWarning {
  readonly kind: string
  readonly message: string
  readonly detail: string
}

export interface DiceScreenProps {
  /** Asks the daemon to account for the rolls entered so far. */
  readonly onAccount: (rolls: string) => Promise<{
    accounting: Accounting
    warnings: readonly PatternWarning[]
  }>
  readonly onComplete: (rolls: string, mixMachine: boolean) => void
  /**
   * Ask the device to roll for you.
   *
   * Optional, and never the default. Rolling 100 dice by hand is ten minutes,
   * and somebody who will not spend it is better served by a device that offers
   * this and says what it costs than by one that pretends the option does not
   * exist. What it costs: you did not watch these land, so the roll string is
   * as trustworthy as the device, which is the thing dice exist to avoid
   * trusting.
   */
  readonly onRollForMe?: (count: number) => Promise<{ rolls: string }>
  readonly onCancel: () => void
  /** Where this screen sits in a journey, when it is part of one. */
  readonly steps?: ReactElement | null
  /** Back to the wallet, or the picker. Rendered in the header by Screen. */
  readonly onHome?: (() => void) | undefined
  readonly banner?: ReactElement | null
}

const FACES = ['1', '2', '3', '4', '5', '6'] as const

export function DiceScreen(props: DiceScreenProps): ReactElement {
  const { onAccount, onComplete, onCancel, onRollForMe, steps, onHome, banner } = props

  const [rolls, setRolls] = useState('')
  const [accounting, setAccounting] = useState<Accounting | null>(null)
  const [warnings, setWarnings] = useState<readonly PatternWarning[]>([])
  const [mixMachine, setMixMachine] = useState(false)

  // The daemon owns the arithmetic. The frontend could compute bits itself, and
  // deliberately does not: the number a user reads has to come from the side
  // that decides whether there is enough, or the two could disagree.
  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      const result = await onAccount(rolls)
      if (!cancelled) {
        setAccounting(result.accounting)
        setWarnings(result.warnings)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [rolls, onAccount])

  const push = useCallback((face: string) => {
    setRolls((current) => current + face)
  }, [])

  const undo = useCallback(() => {
    setRolls((current) => current.slice(0, -1))
    // Device rolls are appended in a block, so the last character removed is a
    // device roll exactly when every remaining roll past the hand-entered ones
    // came from the device. Clamped rather than allowed to go negative, which
    // would understate how much of the string the device chose.
    setFromDevice((current) => Math.max(0, Math.min(current, rolls.length - 1)))
  }, [rolls])

  // A physical keypad or a numeric keyboard should work as well as the buttons.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (FACES.includes(event.key as (typeof FACES)[number])) push(event.key)
      else if (event.key === 'Backspace') undo()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [push, undo])

  /**
   * How many of the rolls on screen came from the device.
   *
   * Counted rather than inferred from a flag, because the two can be mixed: a
   * user who rolls sixty by hand and asks the device for the rest has a string
   * that is neither one thing nor the other, and the screen has to be able to
   * say so.
   */
  const [fromDevice, setFromDevice] = useState(0)

  const rollForMe = async (count: number): Promise<void> => {
    if (onRollForMe === undefined) return
    const result = await onRollForMe(count)
    setRolls((current) => current + result.rolls)
    setFromDevice((current) => current + result.rolls.length)
  }

  const bits = accounting?.bits ?? 0
  const target = accounting?.targetBits ?? 256
  const sufficient = accounting?.sufficient ?? false
  const progress = Math.min(100, (bits / target) * 100)

  return (
    <Screen
      title="Roll the dice"
      subtitle="A d6, one roll at a time. 100 rolls."
      banner={banner}
      onHome={onHome}
      steps={steps}
      testId="dice-screen"
      actions={
        <>
          <Button onClick={onCancel} testId="dice-cancel">
            Cancel
          </Button>
          <Button onClick={undo} disabled={rolls.length === 0} testId="dice-undo">
            Undo
          </Button>
          <div className="nr-spacer" />
          <span className="nr-hint" data-testid="dice-remaining">
            {sufficient
              ? 'Enough entropy collected'
              : `${String(accounting?.rollsRemaining ?? 100)} more`}
          </span>
          <Button
            variant="primary"
            disabled={!sufficient}
            onClick={() => {
              onComplete(rolls, mixMachine)
            }}
            testId="dice-continue"
          >
            Continue
          </Button>
        </>
      }
    >
      <div className="nr-dice">
        <div className="nr-dice__pad">
          {FACES.map((face) => (
            <button
              key={face}
              type="button"
              className="nr-die"
              onClick={() => {
                push(face)
              }}
              data-testid={`die-${face}`}
              aria-label={`Roll ${face}`}
            >
              {face}
            </button>
          ))}
        </div>

        <div className="nr-dice__side">
          {onRollForMe !== undefined && (
            <div className="nr-card nr-card--tight" data-testid="dice-device">
              <span className="nr-label">Or let the device roll</span>
              <div className="nr-row">
                <Button
                  onClick={() => {
                    void rollForMe(1)
                  }}
                  testId="dice-roll-one"
                >
                  Roll one
                </Button>
                <Button
                  disabled={sufficient}
                  onClick={() => {
                    void rollForMe(Math.max(1, accounting?.rollsRemaining ?? 100))
                  }}
                  testId="dice-roll-rest"
                >
                  Roll the rest
                </Button>
              </div>
              <p className="nr-hint">
                Unbiased: the device discards draws that would favour some faces over others.
              </p>
            </div>
          )}

          {fromDevice > 0 && (
            <div className="nr-banner nr-banner--testnet" data-testid="dice-device-warning">
              <strong>
                {fromDevice} of {rolls.length} rolls came from the device
              </strong>
              <span>
                You did not watch those land. The arithmetic below is still checkable, and the
                rolls themselves are not: a device that wanted to hand you a seed it had chosen
                would do it exactly here, and you could not tell. Rolling by hand is the only
                version of this that does not require trusting the device.
              </span>
            </div>
          )}

          <div className="nr-card nr-card--tight">
            <div className="nr-row">
              <span className="nr-label">Entropy</span>
              <span className="nr-value nr-mono" data-testid="dice-bits">
                {bits} of {target} bits
              </span>
            </div>
            <div className="nr-meter">
              <div
                className={`nr-meter__fill${sufficient ? ' nr-meter__fill--done' : ''}`}
                style={{ width: `${String(progress)}%` }}
              />
            </div>
            <p className="nr-hint">
              {accounting?.rolls ?? 0} rolls. Truncated, never rounded, so this never claims more
              than you have collected.
            </p>
          </div>

          <div className="nr-card nr-card--tight">
            <span className="nr-label">Rolls entered</span>
            <div className="nr-rolls" data-testid="dice-rolls">
              {rolls.length === 0 ? 'Nothing yet.' : rolls}
            </div>
            <p className="nr-hint">
              Check these against what you rolled. You will hash this exact string later.
            </p>
          </div>
        </div>
      </div>

      {warnings.map((warning) => (
        <div key={warning.kind} className="nr-banner nr-banner--warn" data-testid="dice-warning">
          <strong>Check</strong>
          <span>
            {warning.message} {warning.detail} This is a warning, not a rejection: the device does
            not discard your rolls.
          </span>
        </div>
      ))}

      <button
        type="button"
        className="nr-choice"
        aria-pressed={mixMachine}
        onClick={() => {
          setMixMachine((v) => !v)
        }}
        data-testid="dice-mix"
      >
        <span className="nr-choice__title">
          Also mix in machine entropy
          <span className={`nr-tag nr-tag--${mixMachine ? 'warn' : 'ok'}`}>
            {mixMachine ? 'not hand-checkable' : 'hand-checkable'}
          </span>
        </span>
        <span className="nr-choice__desc">
          Combines your dice with the machine random number generator. The result stays safe if
          either source is good, but it is no longer reproducible by hand unless you record every
          source, so the check you can perform with sha256sum no longer applies.
        </span>
      </button>
    </Screen>
  )
}
