import { type ReactElement } from 'react'

/**
 * Where you are in a journey, and what this step is.
 *
 * Sits in the screen header, above the title, because on a 480px panel the
 * header is the only thing guaranteed to be on screen. Every one of these flows
 * has an irreversible action in it somewhere, and a user who cannot tell how
 * far along they are cannot tell whether they have passed it.
 *
 * Deliberately not a progress bar. A bar reads as "how much is left" and these
 * steps are not the same size: rolling 100 dice is ten minutes and setting a
 * passphrase is ten seconds. A count and a name say the true thing.
 */
export interface StepsProps {
  /** One-based, because it is read aloud and compared with a printed guide. */
  readonly current: number
  readonly total: number
  readonly label: string
  readonly testId?: string
}

export function Steps(props: StepsProps): ReactElement {
  const { current, total, label, testId } = props
  return (
    <p className="nr-steps" data-testid={testId ?? 'steps'}>
      <span className="nr-steps__count">
        Step {current} of {total}
      </span>
      <span className="nr-steps__label">{label}</span>
    </p>
  )
}
