import { type ReactElement, useState } from 'react'
import { Screen } from '../components/Screen.js'
import { Button } from '../components/Button.js'
import { Choice } from '../components/Choice.js'
import { JOURNEYS, stepsFor, type Journey, type JourneyId } from '../journeys.js'

/**
 * What are you trying to do?
 *
 * Spec: ui.screens.start
 *
 * The rest of the device is organised by feature, because that is how the code
 * is shaped. Nobody arrives thinking in features. They arrive with a sentence:
 * get my three Pis onto one wallet, sign the thing my laptop just made, replace
 * the one that died. This screen is that list of sentences, and it is the only
 * screen on the device written from the outside in.
 *
 * WHAT IT DOES NOT DO. It does not hide anything. Every journey is a sequence
 * of screens that already work on their own and stay reachable directly, so a
 * user who knows the device can walk past this entirely. A hub that became the
 * only way in would make the device worse for the second week of owning it.
 *
 * THE PREAMBLE IS THE POINT. Tapping a goal does not start it. It shows what
 * the goal needs first, in plain language, because the expensive failure in
 * every one of these flows is discovering at step three that you needed a
 * second device in the room, a die, or somewhere to write 24 words. By then
 * there is a seed on the screen and stopping is not free.
 */

export interface StartScreenProps {
  /** True once a wallet is open. Journeys that need one are shown as needing one. */
  readonly walletOpen: boolean
  readonly onBegin: (id: JourneyId) => void
  readonly onSkip: () => void
  /** Back to the wallet, or the picker. Rendered in the header by Screen. */
  readonly onHome?: (() => void) | undefined
  readonly banner?: ReactElement | null
}

export function StartScreen(props: StartScreenProps): ReactElement {
  const { walletOpen, onBegin, onSkip, onHome, banner } = props
  const [chosen, setChosen] = useState<Journey | null>(null)

  // --- What this goal needs before it starts --------------------------------
  if (chosen !== null) {
    // The steps this will actually take, which include opening a wallet when
    // none is open. Nothing is refused: see Journey.operatesOnAWallet.
    const steps = stepsFor(chosen, walletOpen)
    return (
      <Screen
        title={chosen.goal}
        subtitle={chosen.summary}
        banner={banner}
        onHome={onHome}
        testId="start-preamble"
        actions={
          <>
            <Button
              onClick={() => {
                setChosen(null)
              }}
              testId="start-back"
            >
              Back
            </Button>
            <div className="nr-spacer" />
            <Button
              variant="primary"
              onClick={() => {
                onBegin(chosen.id)
              }}
              testId="start-begin"
            >
              Start, {steps.length} steps
            </Button>
          </>
        }
      >
        {chosen.needs.length > 0 && (
          <div className="nr-card nr-card--tight" data-testid="start-needs">
            <span className="nr-card__label">Before you start</span>
            <ul className="nr-list">
              {chosen.needs.map((need) => (
                <li key={need}>{need}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="nr-card nr-card--tight" data-testid="start-steps">
          <span className="nr-card__label">The steps</span>
          <ol className="nr-list nr-list--numbered">
            {steps.map((step, index) => (
              <li key={`${step.stage}-${String(index)}`}>{step.label}</li>
            ))}
          </ol>
        </div>

        {/* Said before starting as well as at the end. A flow whose last screen
            is the first mention of "this is not finished yet" has already let
            somebody believe it was. */}
        {chosen.thenWhat.length > 0 && (
          <div className="nr-banner nr-banner--testnet" data-testid="start-then">
            <strong>What this does not finish</strong>
            <span>{chosen.thenWhat.join(' ')}</span>
          </div>
        )}

        {chosen.operatesOnAWallet && !walletOpen && (
          <p className="nr-note" data-testid="start-opens-a-wallet">
            No wallet is open, so this starts by opening one. That is a step rather than an
            obstacle: everything below it works on a wallet, which is what this device is for.
          </p>
        )}
      </Screen>
    )
  }

  // --- The list of goals ----------------------------------------------------
  return (
    <Screen
      title="What do you want to do?"
      subtitle="Or skip this and use the device directly."
      banner={banner}
      onHome={onHome}
      testId="start-screen"
      actions={
        <>
          <div className="nr-spacer" />
          <Button onClick={onSkip} testId="start-skip">
            Skip, I know my way around
          </Button>
        </>
      }
    >
      {/* Not a nested scroller. `nr-wlist--scroll` has no bounded height, so in
          a flex column it grows past the panel and the body cannot scroll to
          reach it: with six goals the last two sat permanently under the action
          bar. The wallet picker gets away with it because it holds three rows
          and a hard limit of eight. Letting the screen body scroll is what the
          rest of the device does. */}
      <div className="nr-wlist" data-testid="start-goals">
        {JOURNEYS.map((journey) => (
          <Choice
            key={journey.id}
            title={journey.goal}
            description={journey.summary}
            selected={false}
            onSelect={() => {
              setChosen(journey)
            }}
            {...(journey.operatesOnAWallet && !walletOpen
              ? { tag: { text: 'opens a wallet first', tone: 'ok' as const } }
              : {})}
            testId={`start-goal-${journey.id}`}
          />
        ))}
      </div>
    </Screen>
  )
}
