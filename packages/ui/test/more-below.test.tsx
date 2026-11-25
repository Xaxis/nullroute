/**
 * Tests for the mark a scrolling region carries while it holds more than it
 * shows, which the stylesheet turns into a shadow over its bottom edge.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { useMoreBelow } from '../src/lib/scroll.js'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** A region 100 pixels tall whose content is 60 pixels per child. */
function Region(props: { readonly rows: number }): ReactElement {
  const moreBelow = useMoreBelow()
  return (
    <div ref={moreBelow} data-testid="region">
      {Array.from({ length: props.rows }, (_, i) => (
        <p key={i}>row {i}</p>
      ))}
    </div>
  )
}

/* happy-dom lays nothing out, so the heights are given: the region shows 100
   pixels and holds 60 for each child it has at the moment it is asked. */
function giveHeights(): void {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(100)
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (
    this: HTMLElement
  ) {
    return this.children.length * 60
  })
}

describe('useMoreBelow', () => {
  /**
   * INV-UI-112. The export tab's region opened holding one card and received
   * the descriptor afterwards. Its own size did not change and nothing it was
   * already watching did, so the mark was never set.
   */
  it('marks-a-region-when-content-arrives-later', async () => {
    giveHeights()
    const { rerender } = render(<Region rows={1} />)
    const region = screen.getByTestId('region')
    expect(region.hasAttribute('data-more-below')).toBe(false)

    rerender(<Region rows={3} />)
    await waitFor(() => {
      expect(region.hasAttribute('data-more-below')).toBe(true)
    })
  })

  it('clears-the-mark-at-the-end', () => {
    giveHeights()
    render(<Region rows={3} />)
    const region = screen.getByTestId('region')
    expect(region.hasAttribute('data-more-below')).toBe(true)

    act(() => {
      region.scrollTop = 80
      fireEvent.scroll(region)
    })
    expect(region.hasAttribute('data-more-below')).toBe(false)
  })
})
