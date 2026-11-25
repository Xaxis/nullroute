import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { PANEL_FLOOR, fitsAPanel } from '../lib/panel.js'

/**
 * Draws the interface only on a screen at least as large as one it was
 * measured on (INV-UI-110).
 *
 * Every screen is checked for fit at the size of each supported panel, and
 * nowhere else. Below the smallest, controls fall off the edge and must-see
 * warnings land under the action bar, which is exactly the class of failure
 * those checks exist to stop. On a device that should never happen: the kiosk
 * picks the scale from the panel it finds. When it does happen, because a panel
 * is not in the table or the scale is wrong, the honest response is to say so
 * rather than to show a signing screen whose layout nobody has looked at.
 */
export function PanelGate(props: { readonly children: ReactNode }): ReactElement {
  const [size, setSize] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }))

  useEffect(() => {
    const measure = (): void => {
      setSize({ width: window.innerWidth, height: window.innerHeight })
    }
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('resize', measure)
    }
  }, [])

  if (fitsAPanel(size.width, size.height)) return <>{props.children}</>

  return (
    <div className="nr-toosmall" role="alert" data-testid="panel-too-small">
      <p className="nr-toosmall__title">This screen is too small</p>
      <p className="nr-toosmall__text">
        It shows {String(size.width)} by {String(size.height)} pixels, and the smallest panel this
        device is laid out for is {String(PANEL_FLOOR.width)} by {String(PANEL_FLOOR.height)}.
        Nothing is shown rather than a layout nobody has checked.
      </p>
    </div>
  )
}
