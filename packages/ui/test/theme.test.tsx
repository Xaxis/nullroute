/**
 * Tests for the theme layer.
 *
 * WHAT THESE GUARD. A colour whose only definition sits inside a theme block
 * renders one theme's text on the other theme's ground, which is the classic
 * way a themed stylesheet breaks. The stylesheet is checked as text here
 * rather than through a rendered component, because that failure is a property
 * of the CSS and jsdom computes no cascade worth trusting.
 */

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Resolved from the working directory, not from `import.meta.url`.
 *
 * These run in jsdom, where `import.meta.url` is not a file: URL and
 * fileURLToPath throws. Vitest runs from the repository root rather than from
 * this package, which the assertion below caught on the first try. It is
 * asserted rather than assumed so a moved stylesheet fails loudly instead of
 * leaving every assertion here checking an empty string and passing.
 */
const CSS_PATH = resolve(process.cwd(), 'packages/ui/src/styles.css')
if (!existsSync(CSS_PATH)) {
  throw new Error(`theme tests cannot find the stylesheet at ${CSS_PATH}`)
}
const CSS = readFileSync(CSS_PATH, 'utf8')

/** The token names each theme block defines. */
function tokensIn(selector: string): Set<string> {
  const start = CSS.indexOf(selector)
  if (start === -1) throw new Error(`no ${selector} block in styles.css`)
  const block = CSS.slice(start, CSS.indexOf('\n}', start))
  return new Set([...block.matchAll(/(--color-[a-z0-9-]+)\s*:/g)].map((m) => m[1] ?? ''))
}

describe('the theme layer', () => {
  /**
   * INV-UI-93. Every colour the stylesheet reads is defined in the DEFAULT
   * block. A token defined only under [data-theme] is undefined in the
   * un-stamped state, which is what the document has before the daemon
   * answers.
   */
  it('defines-every-colour-in-the-default-block', () => {
    const base = tokensIn(':root {')
    const used = new Set(
      [...CSS.matchAll(/var\((--color-[a-z0-9-]+)/g)].map((m) => m[1] ?? '')
    )

    const missing = [...used].filter((token) => !base.has(token))
    expect(missing, `defined only in a theme block: ${missing.join(', ')}`).toEqual([])
  })

  /**
   * INV-UI-93. Light redefines exactly what dark defines, no more and no less.
   * A token dark has and light does not keeps its dark value on a light
   * ground, which is the same bug wearing a different hat.
   */
  it('redefines-the-same-tokens-in-light', () => {
    const base = tokensIn(':root {')
    const light = tokensIn(":root[data-theme='light']")

    const onlyDark = [...base].filter((t) => !light.has(t))
    const onlyLight = [...light].filter((t) => !base.has(t))
    expect(onlyDark, `not redefined for light: ${onlyDark.join(', ')}`).toEqual([])
    expect(onlyLight, `light invents: ${onlyLight.join(', ')}`).toEqual([])
  })

  /**
   * INV-UI-93. Text on the orange fill stays dark in both themes. It happened
   * to equal the dark ground, which is why it read as the same token, and
   * inverting it would have put near-white type on an orange button.
   */
  it('keeps-text-on-the-accent-dark-in-both-themes', () => {
    const value = (selector: string): string => {
      const start = CSS.indexOf(selector)
      const block = CSS.slice(start, CSS.indexOf('\n}', start))
      return /--color-on-accent:\s*([^;]+);/.exec(block)?.[1]?.trim() ?? ''
    }
    expect(value(':root {')).toBe(value(":root[data-theme='light']"))
  })

  /**
   * INV-UI-93. The ground is painted explicitly rather than inherited. A
   * transparent body borrows whatever is behind the app, which on a kiosk is
   * whatever Chromium last drew.
   */
  it('paints-the-ground-from-a-token', () => {
    const body = CSS.slice(CSS.indexOf('\nbody {'), CSS.indexOf('}', CSS.indexOf('\nbody {')))
    expect(body).toContain('var(--color-bg)')
  })

  /**
   * INV-UI-93. No palette rungs left. The ladder only made sense in one
   * direction: ink-950 is the ground when the ground is nearly black and means
   * nothing when it is nearly white.
   */
  it('names-no-palette-rungs', () => {
    const rungs = [...CSS.matchAll(/var\(--color-(ink|signal|caution|verify|danger)-\d+\)/g)]
    expect(rungs.map((m) => m[0])).toEqual([])
  })
})
