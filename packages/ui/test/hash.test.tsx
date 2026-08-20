/**
 * Tests for how a hash or a fingerprint is displayed.
 *
 * There was no test file for this component. `abbreviate` had unit coverage
 * through the screens that call it, and the component that actually renders
 * had none, which is exactly where the bug below lived.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Hash, abbreviate } from '../src/components/Hash.js'

afterEach(() => {
  cleanup()
})

/**
 * The guard that was in `abbreviate` all along, asserted directly so the two
 * halves cannot drift apart again.
 */
describe('abbreviate', () => {
  it('returns-a-short-value-untouched', () => {
    expect(abbreviate('73c5da0a')).toBe('73c5da0a')
  })

  it('shortens-a-full-manifest-root', () => {
    expect(abbreviate('a'.repeat(64))).toBe(`${'a'.repeat(8)}...${'a'.repeat(8)}`)
  })
})


/**
 * Short values are not abbreviated, because abbreviating them is wrong.
 *
 * The component sliced first-eight and last-eight unconditionally. For a 64
 * character manifest root that is the intent; for an eight character master
 * fingerprint it produced the same eight characters twice, rendered to look
 * like sixteen. `abbreviate` in the same file has always had the guard and the
 * component never used it.
 */
describe('Hash with a short value', () => {
  it('does-not-repeat-an-eight-character-fingerprint', () => {
    render(<Hash value="73c5da0a" testId="fp" />)
    const shown = screen.getByTestId('fp').textContent

    expect(shown).not.toContain('...')
    // Chunked in fours, which is how every value here is set, and once.
    expect(shown.replace(/\s/g, '')).toBe('73c5da0a')
  })

  /** And a real hash is still abbreviated, or the guard would have eaten it. */
  it('still-abbreviates-a-full-manifest-root', () => {
    const root = 'a'.repeat(64)
    render(<Hash value={root} testId="root" />)
    expect(screen.getByTestId('root').textContent).toContain('...')
  })
})
