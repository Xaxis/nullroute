/**
 * Tests for the seed screen.
 *
 * This is the only screen that displays key material, and confirming the backup
 * is irreversible. Both facts have to be visible to a user who is skimming.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SeedScreen } from '../src/screens/SeedScreen.js'

afterEach(cleanup)

const WORDS = 'legal winner thank year wave sausage worth useful legal winner thank yellow'.split(' ')

describe('ui.screens.seed', () => {
  it('shows-every-word-numbered', () => {
    render(<SeedScreen words={WORDS} fingerprint="b8688df1" onConfirm={vi.fn()} />)
    const container = screen.getByTestId('seed-words')
    for (const word of WORDS) expect(container.textContent).toContain(word)
    // Numbered, because order is what makes a mnemonic recoverable.
    expect(container.textContent).toContain('1')
    expect(container.textContent).toContain(String(WORDS.length))
  })

  // INV-UI-10: irreversible, so it takes an explicit acknowledgement.
  it('requires-acknowledgement', () => {
    const onConfirm = vi.fn()
    render(<SeedScreen words={WORDS} fingerprint="b8688df1" onConfirm={onConfirm} />)

    const confirm = screen.getByTestId<HTMLButtonElement>('seed-confirm')
    expect(confirm.disabled).toBe(true)
    fireEvent.click(confirm)
    expect(onConfirm).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('seed-ack'))
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('warns-that-this-is-the-only-showing', () => {
    render(<SeedScreen words={WORDS} fingerprint="b8688df1" onConfirm={vi.fn()} />)
    expect(document.body.textContent).toContain('only time they are shown')
    expect(document.body.textContent).toContain('Do not photograph')
    // The fingerprint is here too, because a mistyped passphrase is otherwise
    // silent.
    expect(screen.getByTestId('seed-fingerprint').textContent).toBe('b8688df1')
  })
})
