import { useEffect, useRef } from 'react'
import type { ReactElement, ReactNode } from 'react'

/**
 * The device would not do the thing, said where the person can see it.
 *
 * WHY THIS IS A COMPONENT AND NOT A CLASSNAME. Twenty four screens draw a
 * banner when a call is refused, and every one of them had written the same
 * markup by hand. Two properties matter about that banner and neither is
 * expressible in CSS:
 *
 *   1. It is the FIRST thing in the body. It sat last on nineteen screens, so
 *      on a 480px panel the user tapped a button in the fixed action bar, the
 *      device refused, and nothing they could see changed. The signing screen
 *      was the worst of them: the review failed and the screen was visually
 *      identical to before the tap.
 *
 *   2. It SCROLLS ITSELF INTO VIEW when it appears. Being first is not enough.
 *      Somebody who has scrolled down a long screen to reach a field, then
 *      tapped a button in the bar that is fixed and always reachable, is
 *      looking at the bottom of a body whose top is now 236px above the panel.
 *      Moving the banner to the top without this traded a refusal below the
 *      fold for a refusal above it.
 *
 * The second is why the effect lives here rather than being repeated: it is a
 * mount effect, and this element mounts exactly when a call is refused, so
 * "appeared" and "mounted" are the same event. A screen writing this by hand
 * would need to remember the ref, the effect and the dependency, and the cost
 * of forgetting is silent.
 *
 * `block: 'nearest'`, so a banner already on the panel does not move the screen
 * under the reader.
 *
 * This is the third of the three prose roles, beside Info (what a screen is
 * for) and the plain hint (micro-copy for one control). Info explains, this
 * refuses, and they are never the same box.
 */
export interface RefusalProps {
  /** What did not happen, in three or four words: "Not signed", "Not erased". */
  readonly title: string
  /** The reason, which is normally the caught error's message. */
  readonly children: ReactNode
  readonly testId?: string
  /**
   * How bad it is.
   *
   * `danger` for a refusal with consequences, which is the default and nearly
   * all of them. `warn` for one where nothing was at stake and nothing was
   * lost: a QR code that did not parse, a file that was not read.
   */
  readonly tone?: 'danger' | 'warn'
}

export function Refusal(props: RefusalProps): ReactElement {
  const { title, children, testId, tone = 'danger' } = props
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest' })
  }, [])

  return (
    <div
      ref={ref}
      data-must-see
      className={`nr-banner nr-banner--${tone === 'danger' ? 'danger' : 'testnet'}`}
      data-testid={testId}
    >
      <strong>{title}</strong>
      <span>{children}</span>
    </div>
  )
}
