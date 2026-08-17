/**
 * Tests for core.labels.
 *
 * A label file arrives on a card from software this device knows nothing about,
 * and its contents end up rendered beside amounts on the screen a user reads
 * before signing. So the tests are in two halves: does it round-trip in the
 * format other wallets actually read, and can a hostile file make the screen say
 * something other than what it contains.
 */

import { describe, expect, it } from 'vitest'
import {
  LabelError,
  MAX_FILE_BYTES,
  MAX_LABEL_LENGTH,
  exportLabels,
  findLabel,
  importLabels,
  type Label,
} from '../src/labels/bip329.js'

const TXID = '0000000000000000000000000000000000000000000000000000000000000001'
const ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'

function jsonl(...objects: Record<string, unknown>[]): string {
  return `${objects.map((o) => JSON.stringify(o)).join('\n')}\n`
}

describe('core.labels', () => {
  /**
   * INV-LABEL-1. The format is what BIP-329 specifies, so a file written here
   * is read by other wallets and the other way round.
   */
  it('round-trips-through-the-published-format', () => {
    const labels: Label[] = [
      { type: 'tx', ref: TXID, label: 'Rent, March' },
      { type: 'addr', ref: ADDRESS, label: 'Donations' },
      { type: 'output', ref: `${TXID}:0`, label: 'Cold storage', spendable: false },
    ]

    const written = exportLabels(labels)
    // One JSON object per line, and a trailing newline so the file can be
    // appended to without joining two records together.
    expect(written.split('\n').filter(Boolean)).toHaveLength(3)
    expect(written.endsWith('\n')).toBe(true)
    expect(JSON.parse(written.split('\n')[0] ?? '{}')).toEqual({
      type: 'tx',
      ref: TXID,
      label: 'Rent, March',
    })

    const read = importLabels(written)
    expect(read.skipped).toEqual([])
    expect(read.labels).toEqual(labels)

    // And writing what was read gives the same bytes, so a user can compare an
    // export against the last one.
    expect(exportLabels(read.labels)).toBe(written)
  })

  /**
   * INV-LABEL-2. A bad line costs that line and nothing else.
   *
   * JSON Lines exists so a file can be appended to and partially recovered. One
   * corrupt record in a file of thousands must not cost the user the rest, and
   * the ones that were dropped must be reported rather than silently missing.
   */
  it('skips-only-the-lines-it-cannot-read-and-says-which', () => {
    const text = [
      JSON.stringify({ type: 'tx', ref: TXID, label: 'Good' }),
      'this is not json',
      JSON.stringify({ type: 'nonsense', ref: TXID, label: 'Bad type' }),
      JSON.stringify({ type: 'addr', label: 'No ref' }),
      JSON.stringify(['not', 'an', 'object']),
      JSON.stringify({ type: 'addr', ref: ADDRESS, label: 'Also good' }),
      '',
    ].join('\n')

    const read = importLabels(text)
    expect(read.labels.map((l) => l.label)).toEqual(['Good', 'Also good'])
    expect(read.skipped.map((s) => s.line)).toEqual([2, 3, 4, 5])
    expect(read.skipped[0]?.reason).toContain('not readable as JSON')
    expect(read.skipped[1]?.reason).toContain('not one BIP-329 defines')
    expect(read.skipped[2]?.reason).toContain('ref is missing')
    expect(read.skipped[3]?.reason).toContain('not a JSON object')
  })

  /**
   * INV-LABEL-3. A label cannot be made to render as something other than what
   * it contains.
   *
   * This is the one that matters. A label sits next to an amount on the signing
   * screen, so a bidi override that reverses the rendered order, or zero-width
   * characters that hide part of the text, is a way to make a payment read as
   * something it is not.
   */
  it('refuses-a-label-that-can-render-as-something-else', () => {
    const forgeable = [
      'Rent‮march',
      'Cold​storage',
      'Alice⁦⁩Bob',
      'Tab	here',
      'Bom﻿',
    ]

    for (const label of forgeable) {
      const read = importLabels(jsonl({ type: 'tx', ref: TXID, label }))
      expect(read.labels, JSON.stringify(label)).toHaveLength(0)
      expect(read.skipped[0]?.reason).toContain('render as something else')
    }

    // Refused, not repaired. Quietly stripping would hide that somebody tried.
    const read = importLabels(jsonl({ type: 'tx', ref: TXID, label: 'Rent‮march' }))
    expect(read.labels).toHaveLength(0)
  })

  it('accepts-ordinary-text-including-other-scripts', () => {
    // Non-Latin scripts and punctuation are ordinary label text and must pass.
    // No emoji here, and not because the parser would refuse one: `make prose`
    // bans them repository wide, and a test fixture is not worth an exception.
    for (const label of ['Rent, March', 'Café', '家賃', 'Подарок', 'a-b_c.d/e']) {
      const read = importLabels(jsonl({ type: 'tx', ref: TXID, label }))
      expect(read.skipped, label).toEqual([])
      expect(read.labels[0]?.label).toBe(label)
    }
  })

  it('bounds-what-it-will-read', () => {
    const long = 'x'.repeat(MAX_LABEL_LENGTH + 1)
    const read = importLabels(jsonl({ type: 'tx', ref: TXID, label: long }))
    expect(read.labels).toHaveLength(0)
    expect(read.skipped[0]?.reason).toContain('over the')

    // At the limit exactly, it is fine.
    const atLimit = importLabels(
      jsonl({ type: 'tx', ref: TXID, label: 'x'.repeat(MAX_LABEL_LENGTH) })
    )
    expect(atLimit.labels).toHaveLength(1)

    // A ref longer than any real reference is refused.
    expect(
      importLabels(jsonl({ type: 'addr', ref: 'x'.repeat(500), label: 'y' })).labels
    ).toHaveLength(0)

    // And a file too large to be a set of labels somebody wrote is refused
    // outright, because this parser runs on a Pi.
    expect(() => importLabels('x'.repeat(MAX_FILE_BYTES + 1))).toThrow(LabelError)
  })

  /**
   * INV-LABEL-4. The spendable flag survives.
   *
   * Dropping it turns a coin the user deliberately froze into an ordinary one,
   * and nothing on any screen would say the instruction had been lost.
   */
  it('carries-the-do-not-spend-flag-in-both-directions', () => {
    const text = jsonl(
      { type: 'output', ref: `${TXID}:0`, label: 'Frozen', spendable: false },
      { type: 'output', ref: `${TXID}:1`, label: 'Normal', spendable: true },
      { type: 'output', ref: `${TXID}:2`, label: 'Unsaid' }
    )

    const read = importLabels(text)
    expect(read.labels[0]?.spendable).toBe(false)
    expect(read.labels[1]?.spendable).toBe(true)
    // Absent stays absent. It is not the same as true, and inventing a value
    // would be this device deciding something the file did not say.
    expect(read.labels[2]?.spendable).toBeUndefined()
    expect(Object.hasOwn(read.labels[2] ?? {}, 'spendable')).toBe(false)

    expect(exportLabels(read.labels)).toBe(text)

    // A non-boolean is refused rather than coerced.
    const bad = importLabels(jsonl({ type: 'output', ref: TXID, label: 'x', spendable: 'no' }))
    expect(bad.labels).toHaveLength(0)
    expect(bad.skipped[0]?.reason).toContain('not a boolean')
  })

  /**
   * Appending to a JSON Lines file is how BIP-329 files are edited, so a later
   * line replaces an earlier one for the same reference rather than producing
   * two labels for one thing.
   */
  it('lets-a-later-line-replace-an-earlier-one', () => {
    const read = importLabels(
      jsonl(
        { type: 'tx', ref: TXID, label: 'First guess' },
        { type: 'addr', ref: ADDRESS, label: 'Unrelated' },
        { type: 'tx', ref: TXID, label: 'Corrected' }
      )
    )

    expect(read.labels).toHaveLength(2)
    expect(findLabel(read.labels, 'tx', TXID)?.label).toBe('Corrected')
    expect(findLabel(read.labels, 'addr', ADDRESS)?.label).toBe('Unrelated')
    // Replacing is not an error: the file was read as written.
    expect(read.skipped).toEqual([])
  })

  it('finds-nothing-for-a-reference-it-does-not-hold', () => {
    const read = importLabels(jsonl({ type: 'tx', ref: TXID, label: 'Rent' }))
    expect(findLabel(read.labels, 'tx', TXID)?.label).toBe('Rent')
    // Type and ref both matter: the same string can be a txid and an address in
    // two different files.
    expect(findLabel(read.labels, 'addr', TXID)).toBeUndefined()
    expect(findLabel(read.labels, 'tx', ADDRESS)).toBeUndefined()
  })

  it('reads-an-empty-file-as-no-labels-rather-than-an-error', () => {
    for (const empty of ['', '\n', '\n\n\n', '   \n  \n']) {
      const read = importLabels(empty)
      expect(read.labels).toEqual([])
      expect(read.skipped).toEqual([])
    }
    expect(exportLabels([])).toBe('')
  })
})
