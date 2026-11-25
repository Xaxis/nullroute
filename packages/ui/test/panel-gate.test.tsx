/**
 * Tests that the interface is drawn only on a screen it was measured on.
 *
 * Every screen is checked for fit at each supported panel's size and nowhere
 * else (provisioning/units/panels.tsv, check-screen-fit). Below the smallest,
 * the signing screens would be drawn in a layout nobody has looked at, so the
 * gate shows a plain refusal instead.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { PanelGate } from '../src/components/PanelGate.js'

const original = { width: window.innerWidth, height: window.innerHeight }

function viewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
}

afterEach(() => {
  cleanup()
  viewport(original.width, original.height)
})

function gate() {
  return render(
    <PanelGate>
      <p data-testid="the-interface">signing screen</p>
    </PanelGate>
  )
}

describe('ui the panel floor', () => {
  /** INV-UI-110. Every panel in the table gets the interface. */
  it('draws-on-every-listed-panel', () => {
    for (const [width, height] of [
      [800, 480],
      [480, 853],
      [360, 601],
      [360, 640],
    ] as const) {
      viewport(width, height)
      gate()
      expect(screen.getByTestId('the-interface')).toBeTruthy()
      expect(screen.queryByTestId('panel-too-small')).toBeNull()
      cleanup()
    }
  })

  /**
   * INV-UI-110. Narrower than every panel, or shorter, and the interface is
   * not drawn at all: a 320 pixel wide signing screen was never measured.
   */
  it('refuses-a-screen-smaller-than-every-panel', () => {
    for (const [width, height] of [
      [320, 533],
      [800, 400],
    ] as const) {
      viewport(width, height)
      gate()
      expect(screen.queryByTestId('the-interface')).toBeNull()
      expect(screen.getByTestId('panel-too-small').textContent).toContain(
        `${String(width)} by ${String(height)}`
      )
      cleanup()
    }
  })

  /** INV-UI-110. It follows the viewport, not the size it started at. */
  it('follows-a-resize-in-both-directions', () => {
    viewport(800, 480)
    gate()
    expect(screen.getByTestId('the-interface')).toBeTruthy()
    act(() => {
      viewport(300, 480)
      window.dispatchEvent(new Event('resize'))
    })
    expect(screen.getByTestId('panel-too-small')).toBeTruthy()
    act(() => {
      viewport(360, 640)
      window.dispatchEvent(new Event('resize'))
    })
    expect(screen.getByTestId('the-interface')).toBeTruthy()
  })
})
