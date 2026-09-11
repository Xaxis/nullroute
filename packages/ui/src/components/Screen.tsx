import { useCallback, useEffect, useRef, type ReactElement, type ReactNode } from 'react'

/**
 * The screen scaffold: fixed header, scrolling body, fixed action bar.
 *
 * 480px of height is not much, and the constraint that follows is that the
 * primary action must never scroll out of reach. A user hunting for a button on
 * a security screen is a user who stops reading the screen.
 *
 * THE HEADER IS A SYSTEM NOW RATHER THAN A SET OF PER-SCREEN DECISIONS. A
 * contact sheet of all thirty six states showed what it had become: the top
 * right held nothing, or Home, or Menu, with no rule anybody could learn, and
 * "Sign a transaction" appeared four times with three different answers. The
 * top left held the screen title and nothing else, so a device with no browser
 * chrome and no title bar had no fixed point anywhere on it. Banners were
 * injected between the title and the controls, and on the idle-warning state
 * they pushed the title into a three line wrap and shoved the device name off
 * the panel entirely.
 *
 * The rule: brand leftmost, title beside it, identity to the right of that,
 * navigation in the corner. Always, on every screen. Banners get a full width
 * strip underneath, where growing costs the header nothing.
 */
export interface ScreenProps {
  readonly title: string
  readonly subtitle?: string
  /**
   * Where this screen sits in a journey, when it is part of one.
   *
   * Above the title rather than below it. A user scanning a screen reads the
   * title first and stops, so the thing that says "you are three steps into
   * something with an irreversible step at the end" has to come before it.
   */
  readonly steps?: ReactNode
  /**
   * Who this device is and which wallet it has open. See `Identity`.
   *
   * One control in one place, rather than the two chips this replaced: a
   * device name that could not be tapped, and a wallet name that lived in the
   * banner slot and vanished whenever the idle warning wanted the room, which
   * is to say exactly when somebody had been away long enough to forget what
   * was on the screen.
   */
  readonly identity?: ReactNode
  /**
   * Warnings about the session rather than about this screen: the idle
   * countdown, the network.
   *
   * A strip BELOW the header rather than a slot inside it. Inside, a second
   * banner competed with the title for one row and won.
   */
  readonly banner?: ReactNode
  /**
   * The navigation menu, on screens it is safe to leave.
   *
   * ABSENT WHERE LEAVING DESTROYS SOMETHING THAT CANNOT BE MADE AGAIN: the
   * seed words, which are shown once; a signed PSBT, which exists only on the
   * screen that produced it until it is carried off; and the two gates that
   * have to be read, the passphrase prompt and the screen naming the wallet
   * that just opened.
   *
   * PRESENT where leaving costs work that can be redone. A hundred dice rolls
   * is real work and rolling them again is a tedious afternoon rather than a
   * loss, and that screen has offered a way out since before this menu
   * existed. Removing one would be a regression dressed up as consistency.
   *
   * ITS PRESENCE IS THE ONLY SIGNAL this device gives for either. There used
   * to be a second, a Home button in the same corner meaning the same thing,
   * which is how that corner came to have three states and no rule. The
   * identity chip follows it: where there is no menu, the wallet name is not
   * tappable either, since switching wallets is the same exit.
   */
  readonly nav?: ReactNode
  readonly children: ReactNode
  readonly actions?: ReactNode
  readonly testId?: string
  /**
   * Called with whether the body has been scrolled to its end.
   *
   * For the one screen that has to know. PsbtScreen's subtitle says "Nothing
   * is signed until you have read it", and Sign lives in the fixed action bar,
   * so a transaction could be signed while its amounts had never been on the
   * panel: the review runs 800px past the fold and the button does not care.
   * Asserting a thing on a subtitle and letting the interface contradict it is
   * the shape of defect this project treats as a bug rather than a nicety.
   *
   * Reported rather than enforced here, because what to do about it belongs to
   * the screen. Called once on mount too, so a body short enough not to scroll
   * counts as read.
   */
  readonly onScrolledToEnd?: ((atEnd: boolean) => void) | undefined
}

export function Screen(props: ScreenProps): ReactElement {
  const {
    title,
    steps,
    subtitle,
    identity,
    banner,
    nav,
    children,
    actions,
    testId,
    onScrolledToEnd,
  } = props

  const body = useRef<HTMLDivElement | null>(null)

  /**
   * Whether the body is at its end, with a pixel of slack.
   *
   * Fractional scroll heights are normal at browser zoom and on a
   * high-density panel, so an exact comparison never becomes true and the
   * screen asking the question would wait forever for a scroll that finished.
   */
  const report = useCallback(() => {
    if (onScrolledToEnd === undefined) return
    const el = body.current
    if (el === null) return
    onScrolledToEnd(el.scrollTop + el.clientHeight >= el.scrollHeight - 1)
  }, [onScrolledToEnd])

  // Once on mount, so a body short enough not to scroll counts as read rather
  // than leaving the caller waiting for an event that cannot arrive.
  useEffect(() => {
    report()
  }, [report, children])

  /**
   * A NEW SCREEN STARTS AT THE TOP OF ITSELF.
   *
   * React reconciles the several panels a screen returns as the same element in
   * the same position, so this body is one DOM node across all of them and kept
   * whatever scroll offset the last one had. Every screen here is reached by
   * tapping a control, and a control low in a list is one the user scrolled to,
   * so the panel that replaced it opened part way down.
   *
   * MEASURED, not supposed. Tapping "Change the passphrase" on the manage menu
   * arrived at the passphrase panel scrolled 58px: its row of three fields sat
   * at 77..145 against a body that starts at 121, so forty four of its sixty
   * eight pixels were above the top of the visible area, labels first. Tapping
   * a quorum to forget arrived with the caution banner saying what forgetting
   * costs already scrolled off.
   *
   * KEYED ON testId AND NOTHING ELSE. Not on `children`, which changes on every
   * keystroke: PsbtScreen refuses to sign until the body has reached its end,
   * and resetting there would make that gate unreachable and would throw away
   * the reading position of somebody halfway down a transaction.
   */
  useEffect(() => {
    const el = body.current
    if (el !== null) el.scrollTop = 0
  }, [testId])

  return (
    <section className="nr-screen" data-testid={testId}>
      <header className="nr-screen__head">
        {/* THE FIXED POINT. Everything else in this header changes with the
            screen, and on a panel with no browser chrome, no title bar and no
            way to see what is running, somebody four screens into a flow had
            nothing at all telling them where they were.

            Not a button. Making it one would put an exit on the dice screen
            and on the seed screen, which is precisely what `nav` is careful
            not to do. This is identity, not navigation. */}
        <span className="nr-brand" data-testid="brand">
          nullroute
        </span>

        <div className="nr-screen__titles">
          {steps}
          <h1 className="nr-screen__title">{title}</h1>
          {subtitle !== undefined && <p className="nr-screen__subtitle">{subtitle}</p>}
        </div>

        <div className="nr-spacer" />
        {identity}
        {nav}
      </header>

      {banner !== undefined && banner !== null && (
        <div className="nr-screen__banners" data-testid="screen-banners">
          {banner}
        </div>
      )}

      <div
        className="nr-screen__body"
        ref={body}
        onScroll={
          onScrolledToEnd === undefined
            ? undefined
            : () => {
                report()
              }
        }
      >
        {children}
      </div>
      {actions !== undefined && <footer className="nr-screen__actions">{actions}</footer>}
    </section>
  )
}
