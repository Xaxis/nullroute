import { type ReactElement, type ReactNode } from 'react'

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
}

export function Screen(props: ScreenProps): ReactElement {
  const { title, steps, subtitle, identity, banner, nav, children, actions, testId } = props

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

      <div className="nr-screen__body">{children}</div>
      {actions !== undefined && <footer className="nr-screen__actions">{actions}</footer>}
    </section>
  )
}
