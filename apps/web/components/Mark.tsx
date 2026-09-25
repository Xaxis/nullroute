import { GLYPH_VIEWBOX, MARK } from '../lib/mark'

/**
 * The mark, inline, in the current text colour.
 *
 * Inline rather than an <img> of icon.svg, so it takes `currentColor` and
 * follows the link it sits in on hover like the wordmark beside it does, and
 * costs no request. Presentation attributes rather than `style`, because an
 * inline style attribute would force `style-src 'unsafe-inline'` into the CSP
 * (`make web-isolation`).
 *
 * Decorative by default. Beside the word "nullroute" a second accessible name
 * would have a screen reader say it twice; pass `label` where the mark stands
 * alone.
 */
export function Mark({ className, label }: { className?: string; label?: string }) {
  const { ring, slash, stroke } = MARK
  return (
    <svg
      viewBox={GLYPH_VIEWBOX}
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      focusable="false"
      className={className}
      {...(label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
    >
      <circle cx={ring.cx} cy={ring.cy} r={ring.r} />
      <line x1={slash.x1} y1={slash.y1} x2={slash.x2} y2={slash.y2} />
    </svg>
  )
}
