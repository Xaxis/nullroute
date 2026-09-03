import { type ReactElement, type ReactNode } from 'react'
import { Screen } from '../components/Screen.js'
import { Button } from '../components/Button.js'
import { type Journey } from '../journeys.js'
import { Info } from '../components/Info.js'

/**
 * The last step of a journey is done. Here is what is not.
 *
 * Spec: ui.screens.finish
 *
 * THE ONLY REASON THIS SCREEN EXISTS is the gap between "this device has
 * finished its part" and "the thing you set out to do is working". For the
 * multisig journey that gap is enormous: a registered quorum can receive and
 * cannot spend until every other cosigner registers the same descriptor
 * character for character, and it is invisible to the software that builds
 * transactions until the coordinator imports the bundle. A device that dropped
 * the user back on the wallet screen at that point would have said, by saying
 * nothing, that the job was done.
 *
 * The same sentences appear before the journey starts. That is deliberate
 * repetition rather than an oversight: read beforehand they are a warning about
 * scope, and read here they are a list of what to do next, and somebody who
 * skipped the first has not been told the second.
 *
 * A journey with nothing outstanding gets this screen too, saying so plainly.
 * "Nothing else is needed" is worth a sentence on a device where most things
 * have a caveat.
 */

export interface FinishScreenProps {
  /**
   * The navigation menu, when leaving this screen is free.
   *
   * The only signal this device gives for that. It replaced a Home button in
   * the same corner meaning the same thing, which is how that corner came to
   * have three states and no rule.
   */
  readonly nav?: ReactNode
  readonly journey: Journey
  readonly onDone: () => void
  readonly steps?: ReactElement | null
  /** Who this device is and which wallet it has open. See `Identity`. */
  readonly identity?: ReactNode
  readonly banner?: ReactElement | null
}

export function FinishScreen(props: FinishScreenProps): ReactElement {
  const { journey, onDone, steps, identity, banner, nav } = props
  const outstanding = journey.thenWhat

  return (
    <Screen
      title={outstanding.length === 0 ? 'Done' : 'This device has done its part'}
      subtitle={journey.goal}
      banner={banner}
      nav={nav}
      identity={identity}
      steps={steps}
      testId="finish-screen"
      actions={
        <>
          <div className="nr-spacer" />
          <Button variant="primary" onClick={onDone} testId="finish-done">
            {outstanding.length === 0 ? 'Done' : 'Got it'}
          </Button>
        </>
      }
    >
      {outstanding.length === 0 ? (
        <Info testId="finish-complete">
          Nothing else is needed. That is worth saying out loud on a device where most things have a
          next step attached.
        </Info>
      ) : (
        <>
          {/* A banner rather than a note. The whole point is that somebody is
              about to walk away believing this is finished. */}
          <div className="nr-banner nr-banner--caution" data-testid="finish-outstanding">
            <strong>Still to do</strong>
            <span>
              {outstanding.length === 1
                ? 'One thing is not finished by this device.'
                : `${String(outstanding.length)} things are not finished by this device.`}
            </span>
          </div>

          {/* WHAT IS LEFT AND WHAT IS DONE, SIDE BY SIDE.

              Two numbered lists rendered identically, one above the other, on a
              screen somebody reaches at the end of a flow and reads for five
              seconds. Stacked they ran 111px past the bottom of the panel, and
              the one below the fold was the list of things still outstanding,
              which is the only reason this screen exists.

              Left is what is not finished, because that is what somebody has to
              act on. Right is what is. */}
          <div className="nr-split nr-split--even">
            <div className="nr-card nr-card--tight">
              <span className="nr-card__label">Still outstanding</span>
              <ol className="nr-list nr-list--numbered" data-testid="finish-steps">
                {outstanding.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
            </div>

            <div className="nr-card nr-card--tight" data-testid="finish-recap">
              <span className="nr-card__label">What just happened</span>
              <ol className="nr-list nr-list--numbered">
                {journey.steps.map((step, index) => (
                  <li key={`${step.stage}-${String(index)}`}>{step.label}</li>
                ))}
              </ol>
            </div>
          </div>
        </>
      )}

      {outstanding.length === 0 && (
        <div className="nr-card nr-card--tight" data-testid="finish-recap">
          <span className="nr-card__label">What just happened</span>
          <ol className="nr-list nr-list--numbered">
            {journey.steps.map((step, index) => (
              <li key={`${step.stage}-${String(index)}`}>{step.label}</li>
            ))}
          </ol>
        </div>
      )}
    </Screen>
  )
}
