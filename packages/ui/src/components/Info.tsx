import type { ReactElement, ReactNode } from 'react'

/**
 * What this screen is for, and what to do on it.
 *
 * ONE OF THREE ROLES, and the one that was missing. Explanation on this device
 * was written three ways with no rule about which: `nr-note` at 14px, `nr-hint`
 * at 13px, and a toned `nr-banner`. The first two are the same thing at two
 * brightnesses and were used interchangeably for the same job. The third is a
 * warning box, and using it for guidance is how a red box stops meaning danger.
 *
 *   Banner  something is wrong, or is about to be. Toned.
 *   Info    what this screen is for and what to do. Neutral. This.
 *   Hint    micro-copy belonging to one control. Unboxed, beside it.
 *
 * A LEFT RULE, NOT A BORDER. The panel is 480px tall and most screens already
 * run past the fold, so a box with a top and bottom border and symmetric
 * padding would cost twenty pixels on every screen to say the same words. A
 * rule down the side reads as one element, costs almost nothing vertically, and
 * cannot be confused with a banner.
 *
 * Spec: ui.components.info
 */
export interface InfoProps {
  /**
   * An optional two or three word label.
   *
   * Only where the box answers a question somebody is actually asking. Most
   * screens do not need one, and a label on every box turns into noise that
   * gets skipped along with the text under it.
   */
  readonly label?: string | undefined
  readonly children: ReactNode
  readonly testId?: string | undefined
}

export function Info(props: InfoProps): ReactElement {
  const { label, children, testId } = props
  return (
    <div className="nr-info" data-testid={testId}>
      {label !== undefined && <span className="nr-info__label">{label}</span>}
      <div className="nr-info__body">{children}</div>
    </div>
  )
}
