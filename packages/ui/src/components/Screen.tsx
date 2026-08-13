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
  readonly banner?: ReactNode
  readonly children: ReactNode
  readonly actions?: ReactNode
  readonly testId?: string
}

export function Screen(props: ScreenProps): ReactElement {
  const { title, subtitle, banner, children, actions, testId } = props
  return (
    <section className="nr-screen" data-testid={testId}>
      <header className="nr-screen__head">
        <div>
          <h1 className="nr-screen__title">{title}</h1>
          {subtitle !== undefined && <p className="nr-screen__subtitle">{subtitle}</p>}
        </div>
        <div className="nr-spacer" />
        {banner}
      </header>
      <div className="nr-screen__body">{children}</div>
      {actions !== undefined && <footer className="nr-screen__actions">{actions}</footer>}
    </section>
  )
}
