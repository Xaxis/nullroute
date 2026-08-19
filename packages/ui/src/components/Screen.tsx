import { type ReactElement, type ReactNode } from 'react'

/**
 * The screen scaffold: fixed header, scrolling body, fixed action bar.
 *
 * 480px of height is not much, and the constraint that follows is that the
 * primary action must never scroll out of reach. A user hunting for a button
 * on a security screen is a user who stops reading the screen.
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
   * Back to the wallet, or to the picker when no wallet is open.
   *
   * In the header, on every screen that has one, because a device with no
   * consistent way home is a device where getting out depends on remembering
   * which button this particular screen calls it. The setup screen had no way
   * out at all: tapping "add a wallet" and changing your mind left you there.
   *
   * Deliberately ABSENT from the screens where leaving discards something that
   * cannot be recovered, rather than present and guarded by a dialog. A
   * confirmation on a 7 inch panel is a second tap in the place the last one
   * was, and the screens in question are the seed words and the transaction
   * review. On those, the way out is the action that says what it costs.
   */
  readonly onHome?: (() => void) | undefined
  readonly banner?: ReactNode
  readonly children: ReactNode
  readonly actions?: ReactNode
  readonly testId?: string
}

export function Screen(props: ScreenProps): ReactElement {
  const { title, steps, subtitle, banner, children, actions, onHome, testId } = props
  return (
    <section className="nr-screen" data-testid={testId}>
      <header className="nr-screen__head">
        <div>
          {steps}
          <h1 className="nr-screen__title">{title}</h1>
          {subtitle !== undefined && <p className="nr-screen__subtitle">{subtitle}</p>}
        </div>
        <div className="nr-spacer" />
        {banner}
        {onHome !== undefined && (
          <button
            type="button"
            className="nr-home"
            onClick={onHome}
            aria-label="Back to the wallet"
            data-testid="screen-home"
          >
            Home
          </button>
        )}
      </header>
      <div className="nr-screen__body">{children}</div>
      {actions !== undefined && <footer className="nr-screen__actions">{actions}</footer>}
    </section>
  )
}
