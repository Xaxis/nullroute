import { type ReactElement, type ReactNode, useCallback, useEffect, useState } from 'react'
import { Screen } from '../components/Screen.js'
import { Button } from '../components/Button.js'

/**
 * Letting the device choose the seed, and being honest about what that costs.
 *
 * Spec: ui.screens.machine-entropy
 *
 * This is the mode every other hardware wallet uses by default, and it is the
 * mode whose failure prompted this project. It is not broken. It is
 * UNVERIFIABLE, which is different and here worse: a correct generator and a
 * backdoored one look identical from outside, because both hand you 24 words.
 *
 * So the screen does two things. It shows what the device could and could not
 * check about its own generator, which is a real but weak claim, and it makes
 * the user say out loud that they understand the result cannot be reproduced by
 * hand. The daemon refuses without that acknowledgement, so this cannot be
 * reached by tapping through.
 *
 * THE HEALTH REPORT IS NOT REASSURANCE. It catches a stuck generator, an
 * unseeded pool and a device generating a seed in its first minute of boot. It
 * cannot catch a generator that produces well-formed, predictable output, which
 * is the attack the dice path exists to make impossible. The screen says that
 * rather than letting three green ticks imply otherwise.
 */

export interface HealthCheckView {
  readonly name: string
  readonly verdict: 'ok' | 'failed' | 'unknown'
  readonly detail: string
}

export interface HealthReportView {
  readonly healthy: boolean
  readonly unknown: boolean
  readonly checks: readonly HealthCheckView[]
}

export interface MachineEntropyScreenProps {
  /**
   * The navigation menu, when leaving this screen is free.
   *
   * The only signal this device gives for that. It replaced a Home button in
   * the same corner meaning the same thing, which is how that corner came to
   * have three states and no rule.
   */
  readonly nav?: ReactNode
  readonly onHealth: () => Promise<HealthReportView>
  /** Generates the seed. Refused by the daemon unless acknowledged is true. */
  readonly onGenerate: (acknowledged: boolean) => Promise<void>
  readonly onBack: () => void
  readonly steps?: ReactElement | null
  /** Who this device is and which wallet it has open. See `Identity`. */
  readonly identity?: ReactNode
  readonly banner?: ReactElement | null
}

export function MachineEntropyScreen(props: MachineEntropyScreenProps): ReactElement {
  const { onHealth, onGenerate, onBack, steps, identity, banner, nav } = props

  const [health, setHealth] = useState<HealthReportView | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      setHealth(await onHealth())
    } catch (err) {
      setError((err as Error).message)
    }
  }, [onHealth])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Screen
      title="Let the device choose"
      subtitle="No dice. Nothing here can be checked by hand."
      banner={banner}
      steps={steps}
      nav={nav}
      identity={identity}
      testId="machine-entropy"
      actions={
        <>
          <Button onClick={onBack} testId="machine-back">
            Back
          </Button>

          {/* THE GATE BESIDE THE THING IT GATES, as on the seed screen.

              This was the last element in the body, under a danger banner, a
              health table, a paragraph about what those checks do not mean, and
              up to two more banners, on a screen running 302px past the fold.
              So the primary action was greyed out and the control that ungates
              it was off the panel, along with the reasons. Somebody arriving
              here saw a refusal and nothing to do about it.

              The whole label is the target, not the 18px box: this is a finger
              on a 7 inch panel, and it gates something irreversible. */}
          <label className="nr-check">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => {
                setAcknowledged(e.target.checked)
              }}
              data-testid="machine-acknowledge"
            />
            <span className="nr-hint">
              I understand this seed cannot be checked by hand, and my written words are the only
              record of it.
            </span>
          </label>
          <div className="nr-spacer" />
          <Button
            variant="danger"
            disabled={!acknowledged || busy || health?.healthy !== true}
            onClick={() => {
              void (async () => {
                setBusy(true)
                setError(null)
                try {
                  await onGenerate(true)
                } catch (err) {
                  setError((err as Error).message)
                } finally {
                  setBusy(false)
                }
              })()
            }}
            testId="machine-generate"
          >
            {busy ? 'Generating' : 'Generate the seed'}
          </Button>
        </>
      }
    >
      {/* First, and not behind a disclosure. Somebody arrives here having tapped
          past one warning already, and this is the last screen before a seed
          exists that nobody can audit. */}
      <div data-must-see className="nr-banner nr-banner--danger" data-testid="machine-warning">
        <strong>A seed you cannot check</strong>
        <span>
          The dice path can be reproduced with a die and any machine that has sha256sum. That is
          the property this device exists to give you, and this path has none of it. A correct
          generator and a backdoored one look identical from out here: both hand you 24 words.
        </span>
      </div>

      {health !== null && (
        <>
          {/* THE REFUSAL ABOVE THE EVIDENCE.

              These two say the seed will not be generated, and they sat under a
              five row table and a paragraph about what that table does not
              prove: 223px past the fold on a panel where the button they
              explain is greyed out in the bar. The table is why, and it can be
              scrolled to. Whether the device is going to do the thing cannot. */}

          {health.unknown && (
            <div data-must-see className="nr-banner nr-banner--testnet" data-testid="machine-unknown">
              <strong>Some sources could not be checked here</strong>
              <span>
                The rows marked unknown were not observed, which is not the same as being fine.
                This happens off a real device, where the Linux paths these checks read do not
                exist. The seed will not be generated while anything is unknown.
              </span>
            </div>
          )}

          {/* `!== true`, not `!healthy`. This banner is the one that stops
              somebody generating a seed from sources the device could not
              vouch for, and a health report whose `healthy` field arrived as
              anything other than a boolean would have hidden it. See
              nullroute/no-truthy-verdict. */}
          {health.healthy !== true && health.unknown !== true && (
            <div data-must-see className="nr-banner nr-banner--danger" data-testid="machine-unhealthy">
              <strong>This device will not generate a seed from these sources</strong>
              <span>Roll dice instead. That path does not depend on any of this.</span>
            </div>
          )}
          <table className="nr-table nr-table--dense" data-testid="machine-health">
            <thead>
              <tr>
                <th>Source</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {health.checks.map((check) => (
                <tr key={check.name}>
                  <td className="nr-mono">{check.name}</td>
                  <td>
                    <span
                      className={`nr-status ${
                        check.verdict === 'ok' ? 'nr-status--ok' : 'nr-status--fail'
                      }`}
                    >
                      {check.verdict}
                    </span>
                    <div className="nr-hint">{check.detail}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* The limit of what those rows mean, next to the rows. Three green
              ticks otherwise read as "the device checked its randomness", which
              is not what happened. */}
          <p className="nr-note" data-testid="machine-health-limit">
            Those checks catch a stuck generator, an unseeded kernel pool, and a device making a
            seed in its first minute of boot. They say nothing about the quality of the numbers. A
            generator producing well-formed but predictable output passes all of them, and that is
            precisely the attack rolling dice makes impossible.
          </p>
        </>
      )}

      {error !== null && (
        <div className="nr-banner nr-banner--danger" data-testid="machine-error">
          <strong>Not generated</strong>
          <span>{error}</span>
        </div>
      )}
    </Screen>
  )
}
