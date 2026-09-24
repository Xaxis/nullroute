/**
 * Tests for the one definition of text that does not render as it stores.
 *
 * Three hand-written lists drifted and all missed U+061C. These pin the
 * definition by category, so a character is refused for what it is rather
 * than for having been remembered.
 */

import { describe, expect, it } from 'vitest'
import { hasForgeable, stripForgeable } from '../src/labels/forgeable.js'

// Every one of these was absent from all three old lists.
const UNLISTED = ['؜', '᠎', '­', '⁪', '⁯']
// A sample of what the lists did name, which must stay refused.
const LISTED = ['\u0000', '\u007F', '​', '‏', '‮', ' ', '⁦', '﻿']

describe('core.labels forgeable characters', () => {
  /** INV-LABEL-6. */
  it('refuses-every-format-character-including-the-ones-no-list-named', () => {
    for (const char of [...UNLISTED, ...LISTED]) {
      const hex = char.codePointAt(0)?.toString(16) ?? ''
      expect(hasForgeable(`Rent ${char}paid`), `U+${hex}`).toBe(true)
      expect(hasForgeable(`Rent ${char}paid`, { allowLineBreaks: true }), `U+${hex}`).toBe(true)
    }
    // Ordinary text, including other scripts and emoji, is not.
    // An emoji is ordinary text in a label, and this has to prove it is not
    // refused, so the prose rule against emoji is waived for this one line.
    const emoji = 'cold storage \u{1F9CA}' // prose-check-ignore
    for (const fine of ['Rent paid', 'إيجار', 'Miete für März', emoji]) {
      expect(hasForgeable(fine), fine).toBe(false)
    }
  })

  /** INV-LABEL-6. */
  it('lets-a-message-keep-tab-and-newline-and-nothing-else-of-the-kind', () => {
    expect(hasForgeable('line one\nline two\tindented', { allowLineBreaks: true })).toBe(false)
    expect(hasForgeable('line one\nline two')).toBe(true)
    expect(hasForgeable('line one\r\nline two', { allowLineBreaks: true })).toBe(true)
  })

  /** INV-LABEL-6. */
  it('strips-rather-than-refuses-when-asked-to', () => {
    expect(stripForgeable('Cold؜ storage‮')).toBe('Cold storage')
    expect(stripForgeable('Cold storage')).toBe('Cold storage')
  })
})
