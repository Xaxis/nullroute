/**
 * Tests for the labels screen.
 *
 * A label decides nothing, and this screen's whole job is to keep that true on
 * the way through. Two things are checked: that a partial import is reported as
 * partial with the reason for every dropped line, and that the sentence saying
 * a label changes nothing about which coins are the device's own comes from the
 * daemon rather than being written here, where a screen could forget it.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LabelsScreen } from '../src/screens/LabelsScreen.js'

afterEach(cleanup)

const TXID = '00'.repeat(32)

const NOTE =
  'A label is a note. Nothing here decides whether an address is yours; only the descriptor does.'

function setup(overrides: Partial<React.ComponentProps<typeof LabelsScreen>> = {}) {
  const onImport = vi.fn().mockResolvedValue({
    labels: [
      { type: 'tx', ref: TXID, label: 'Rent' },
      { type: 'output', ref: `${TXID}:0`, label: 'Cold storage', spendable: false },
    ],
    skipped: [
      { line: 2, reason: 'not readable as JSON' },
      { line: 5, reason: 'the label could render as something else' },
    ],
    note: NOTE,
  })
  const onExport = vi.fn().mockResolvedValue({ text: '{"type":"tx"}\n' })
  const onBack = vi.fn()
  render(
    <LabelsScreen onImport={onImport} onExport={onExport} onBack={onBack} {...overrides} />
  )
  return { onImport, onExport, onBack }
}

async function importSomething(): Promise<void> {
  fireEvent.change(screen.getByTestId('labels-input'), { target: { value: '{"type":"tx"}' } })
  fireEvent.click(screen.getByTestId('labels-import'))
  await waitFor(() => {
    expect(screen.getByTestId('labels-result')).toBeTruthy()
  })
}

describe('LabelsScreen', () => {
  /**
   * INV-UI-48. A partial import is reported as partial, with the reason for
   * every dropped line.
   *
   * JSON Lines exists so a file can be appended to and partially recovered, so
   * a partial import is a normal outcome. A user who is not told assumes a
   * label is missing because they never wrote it, and one of those reasons is
   * that something tried to make a label render as text it does not contain.
   */
  it('says-how-many-lines-were-dropped-and-why', async () => {
    setup()
    await importSomething()

    expect(screen.getByTestId('labels-result').textContent).toContain('2 labels')
    expect(screen.getByTestId('labels-skipped-count').textContent).toContain('2 lines')

    const skipped = screen.getByTestId('labels-skipped').textContent
    expect(skipped).toContain('line 2')
    expect(skipped).toContain('not readable as JSON')
    expect(skipped).toContain('line 5')
    expect(skipped).toContain('render as something else')
  })

  /**
   * INV-UI-48. The sentence saying a label decides nothing comes from the
   * daemon, so a screen cannot quietly stop showing it.
   */
  it('shows-the-daemons-own-words-about-what-a-label-does-not-do', async () => {
    setup()
    await importSomething()
    expect(screen.getByTestId('labels-note').textContent).toBe(NOTE)
  })

  it('shows-what-was-read-including-the-do-not-spend-flag', async () => {
    setup()
    await importSomething()
    const rows = screen.getByTestId('labels-rows').textContent
    expect(rows).toContain('Rent')
    expect(rows).toContain('Cold storage')
    // The flag survives, and says what it means rather than showing a boolean.
    expect(rows).toContain('marked do not spend')
  })

  it('writes-back-exactly-what-was-read', async () => {
    const { onExport } = setup()
    await importSomething()

    fireEvent.click(screen.getByTestId('labels-export'))
    await waitFor(() => {
      expect(onExport).toHaveBeenCalledWith([
        { type: 'tx', ref: TXID, label: 'Rent' },
        { type: 'output', ref: `${TXID}:0`, label: 'Cold storage', spendable: false },
      ])
    })
    expect(screen.getByTestId<HTMLTextAreaElement>('labels-export-text').value).toBe(
      '{"type":"tx"}\n'
    )
  })

  /**
   * A file whose every line was dropped exports nothing. Offering the button
   * would write an empty file over the user's labels.
   */
  it('will-not-export-when-nothing-was-read', async () => {
    const onImport = vi.fn().mockResolvedValue({
      labels: [],
      skipped: [{ line: 1, reason: 'not readable as JSON' }],
      note: NOTE,
    })
    setup({ onImport })
    await importSomething()
    expect(screen.getByTestId<HTMLButtonElement>('labels-export').disabled).toBe(true)
  })

  it('reports-a-refused-file-rather-than-showing-an-empty-import', async () => {
    const onImport = vi.fn().mockRejectedValue(new Error('That file is far larger than any wallet export.'))
    setup({ onImport })

    fireEvent.change(screen.getByTestId('labels-input'), { target: { value: 'x' } })
    fireEvent.click(screen.getByTestId('labels-import'))

    await waitFor(() => {
      expect(screen.getByTestId('labels-error').textContent).toContain('far larger')
    })
    // No result card, so nothing implies a file was read.
    expect(screen.queryByTestId('labels-result')).toBeNull()
  })
})
