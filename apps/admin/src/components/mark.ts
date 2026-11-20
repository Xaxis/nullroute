/**
 * The nullroute mark: the empty-set slash. A route that goes nowhere, which is
 * the point of the name and of the device.
 *
 * ONE COPY OF THE GEOMETRY. The header, the footer, the favicon, the touch icon
 * and the social card all draw it, and a mark written out five times is five
 * marks that agree until somebody nudges one. The site imports this file, and
 * `tools/gen-brand.mjs` imports the same file under Node to write
 * `app/icon.svg` and render the PNGs, so there is nothing to keep in step by
 * hand. `make brand-check` fails when this file changes and the images do not.
 *
 * Plain erasable TypeScript with no imports, because Node loads it directly by
 * stripping the types. An enum, a namespace or an `@/` path would break the
 * generator without breaking the site.
 */

/** Everything is drawn in a 32 unit square, the favicon's native grid. */
export const MARK = {
  size: 32,
  /** Corner radius of the tile behind the glyph in the favicon. */
  tileRadius: 6,
  ring: { cx: 16, cy: 16, r: 8.5 },
  /** Corner to corner, and a little past the ring, so it reads as a slash
      through the set rather than a diameter inside it. */
  slash: { x1: 9.5, y1: 22.5, x2: 22.5, y2: 9.5 },
  stroke: 2.5,
} as const

/*
 * The glyph's own bounds: the ring's outer edge, which the slash's round caps
 * stay inside. The header draws the glyph without its tile, and a viewBox of
 * the whole 32 square would leave it floating in six units of empty margin
 * that no amount of flex alignment can see.
 */
const reach = MARK.ring.r + MARK.stroke / 2
const origin = MARK.ring.cx - reach
export const GLYPH_VIEWBOX = `${String(origin)} ${String(origin)} ${String(reach * 2)} ${String(reach * 2)}`

export interface MarkSvgOptions {
  /** The tile colour. */
  background: string
  /** The glyph colour. */
  foreground: string
  /** A square tile rather than a rounded one. iOS masks the touch icon to its
      own rounded shape, and a rounded tile inside that mask shows corners. */
  square?: boolean
}

/** The mark on its tile, as a standalone SVG document. */
export function markSvg({ background, foreground, square = false }: MarkSvgOptions): string {
  const { size, tileRadius, ring, slash, stroke } = MARK
  const rx = square ? 0 : tileRadius
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(size)} ${String(size)}" width="${String(size)}" height="${String(size)}">`,
    `  <rect width="${String(size)}" height="${String(size)}" rx="${String(rx)}" fill="${background}"/>`,
    `  <circle cx="${String(ring.cx)}" cy="${String(ring.cy)}" r="${String(ring.r)}" fill="none" stroke="${foreground}" stroke-width="${String(stroke)}"/>`,
    `  <line x1="${String(slash.x1)}" y1="${String(slash.y1)}" x2="${String(slash.x2)}" y2="${String(slash.y2)}" stroke="${foreground}" stroke-width="${String(stroke)}" stroke-linecap="round"/>`,
    `</svg>`,
    '',
  ].join('\n')
}
