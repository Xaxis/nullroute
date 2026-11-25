/**
 * Tests for the note a screen shows while the device is working.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Working } from '../src/components/Working.js'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Working', () => {
  /**
   * INV-UI-111. It appears inside a screen that is already open and may be
   * scrolled, so it moves itself into view rather than relying on the screen.
   * jsdom lays nothing out, so this reads the request rather than the result;
   * check-journeys sees the result at both panel sizes.
   */
  it('brings-itself-into-view-when-it-appears', () => {
    const scrolled = vi.spyOn(HTMLElement.prototype, 'scrollIntoView')
    render(<Working label="Deriving the key" testId="working" />)
    expect(scrolled).toHaveBeenCalledOnce()
    expect(scrolled.mock.contexts[0]).toBe(screen.getByTestId('working'))
    expect(scrolled).toHaveBeenCalledWith({ block: 'nearest' })
  })
})
