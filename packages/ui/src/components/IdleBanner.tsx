import { type ReactElement } from 'react'

/**
 * The wallet is about to close itself.
 *
 * Spec: ui.idle
 *
 * BEFORE, NOT AFTER. A lock that arrives with no warning is indistinguishable
 * from a crash, and somebody who has just spent five minutes checking a
 * transaction against a coordinator will read it as one. The countdown is the
 * difference between a device that looks after itself and a device that loses
 * your work.
 *
 * A CHIP, NOT A PARAGRAPH, for exactly the reason NetworkBanner is one: this
 * sits in an 800px header that already holds a title, a device name, a network
 * tag and a wallet chip, and the panel underneath is 480px tall. Written as a
 * block with the full explanation it did not fit on the screen at all, which the
 * fit harness caught, and the failure mode of a warning that does not fit is
 * that it pushes the thing somebody was reading off the display.
 *
 * So the chip carries the two things needed at that moment: how long is left,
 * and a way to stay. What it means, that the seed goes and only this screen is
 * lost, is in docs/USING.md, next to the rest of what the device does when you
 * are not looking at it.
 *
 * ONE TOUCH ANYWHERE IS ENOUGH. The button exists for somebody looking at the
 * screen rather than touching it, which is the population this would otherwise
 * interrupt, but the heartbeat listens to the whole document and any tap clears
 * the warning.
 *
 * It says what happens rather than what to do. "Locking in 42s" is checkable
 * against the number that follows it; "session expiring" is a phrase somebody
 * has to already know the meaning of.
 */

export interface IdleBannerProps {
  readonly remaining: number
  readonly onStayOpen: () => void
}

export function IdleBanner(props: IdleBannerProps): ReactElement {
  const { remaining, onStayOpen } = props
  return (
    // role="alert" rather than "status", unlike the network chip. This is not a
    // standing fact about the wallet, it is a thing about to happen, and it
    // appears while somebody may be reading rather than at a screen change.
    <div className="nr-idlechip" role="alert" data-testid="idle-banner">
      <strong className="nr-idlechip__count" data-testid="idle-countdown">
        Locking in {remaining}s
      </strong>
      <button
        type="button"
        className="nr-idlechip__stay"
        onClick={onStayOpen}
        data-testid="idle-stay-open"
      >
        Stay open
      </button>
    </div>
  )
}
