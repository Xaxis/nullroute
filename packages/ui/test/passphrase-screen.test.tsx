/**
 * Tests for the passphrase screen.
 *
 * One component serves both setting a passphrase and entering one, because the
 * two must not drift: anything the set screen accepts, the enter screen has to
 * accept, and a mismatch between them locks a user out of their own wallet.
 * These tests exercise both modes against the same component for that reason.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PassphraseScreen } from '../src/screens/PassphraseScreen.js'

afterEach(cleanup)

function type(testId: string, value: string): void {
  fireEvent.change(screen.getByTestId(testId), { target: { value } })
}

const submitButton = (): HTMLButtonElement => screen.getByTestId<HTMLButtonElement>('passphrase-submit')

describe('ui.screens.passphrase', () => {
  // INV-UI-15: setting a passphrase requires it twice and refuses a mismatch.
  // A wallet sealed under a typo is a wallet nobody can open.
  it('requires-the-passphrase-twice-when-setting', () => {
    render(<PassphraseScreen mode="set" onSubmit={vi.fn()} />)
    expect(submitButton().disabled).toBe(true)

    type('passphrase-input', 'correct horse battery staple')
    expect(submitButton().disabled).toBe(true)

    type('passphrase-confirm', 'correct horse battery stapl')
    expect(submitButton().disabled).toBe(true)
    expect(document.body.textContent).toContain('do not match')

    type('passphrase-confirm', 'correct horse battery staple')
    expect(submitButton().disabled).toBe(false)
  })

  it('does-not-ask-twice-when-unlocking', () => {
    render(<PassphraseScreen mode="enter" onSubmit={vi.fn()} />)
    expect(screen.queryByTestId('passphrase-confirm')).toBeNull()

    type('passphrase-input', 'anything')
    expect(submitButton().disabled).toBe(false)
  })

  // INV-UI-16: the passphrase is never rendered in a readable field. A device
  // used in the open must not put a seed's only protection on screen.
  it('never-shows-the-passphrase', () => {
    render(<PassphraseScreen mode="set" onSubmit={vi.fn()} />)
    for (const id of ['passphrase-input', 'passphrase-confirm']) {
      expect(screen.getByTestId<HTMLInputElement>(id).type).toBe('password')
    }
  })

  it('refuses-an-empty-passphrase', () => {
    render(<PassphraseScreen mode="enter" onSubmit={vi.fn()} />)
    expect(submitButton().disabled).toBe(true)
    type('passphrase-input', '   ')
    // Whitespace is a legitimate passphrase, so this is enabled. What must not
    // be possible is submitting nothing at all.
    expect(submitButton().disabled).toBe(false)
    type('passphrase-input', '')
    expect(submitButton().disabled).toBe(true)
  })

  /**
   * INV-UI-17. The screen states the cost of guessing rather than showing a
   * strength bar. A bar that turns green tells someone they are safe; a
   * duration tells them what they actually bought.
   */
  it('describes-the-cost-of-guessing-rather-than-a-score', () => {
    render(<PassphraseScreen mode="set" onSubmit={vi.fn()} />)

    type('passphrase-input', '1234')
    expect(document.body.textContent).toContain('to guess')
    const weak = document.body.textContent

    type('passphrase-input', 'a much longer passphrase that someone can actually remember')
    const strong = document.body.textContent
    expect(strong).not.toBe(weak)
    expect(strong).toContain('worth anyone trying')
  })

  // The count has to be visible before the last attempt, not after it.
  it('shows-how-many-attempts-remain', () => {
    render(
      <PassphraseScreen mode="enter" attemptsRemaining={3} maxAttempts={10} onSubmit={vi.fn()} />
    )
    expect(document.body.textContent).toContain('3 of 10 attempts left')
    // And says what running out costs, so erasure is never a surprise.
    expect(document.body.textContent).toContain('erases the wallet')
  })

  // The counter is not a defence against someone holding the card, and the
  // screen says so rather than implying the device is protecting itself.
  it('does-not-overstate-what-the-counter-protects', () => {
    render(<PassphraseScreen mode="enter" attemptsRemaining={9} onSubmit={vi.fn()} />)
    const text = document.body.textContent
    expect(text).toContain('copy it and guess')
    expect(text).toContain('passphrase itself is the real protection')
  })

  it('reports-a-failure-and-stays-put', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('That passphrase did not open the store.'))
    render(<PassphraseScreen mode="enter" onSubmit={onSubmit} />)

    type('passphrase-input', 'wrong')
    fireEvent.click(submitButton())

    await waitFor(() => {
      expect(screen.getByTestId('passphrase-error').textContent).toContain('did not open')
    })
    // Still on the screen, ready for another attempt.
    expect(screen.getByTestId('passphrase-input')).toBeTruthy()
  })

  it('clears-the-passphrase-after-a-successful-submit', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(<PassphraseScreen mode="set" onSubmit={onSubmit} />)

    type('passphrase-input', 'correct horse battery staple')
    type('passphrase-confirm', 'correct horse battery staple')
    fireEvent.click(submitButton())

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('correct horse battery staple')
    })
    // Nothing keeps it in component state past the moment it was needed.
    await waitFor(() => {
      expect(screen.getByTestId<HTMLInputElement>('passphrase-input').value).toBe('')
    })
  })

  it('allows-skipping-when-setting-and-not-when-unlocking', () => {
    const onCancel = vi.fn()
    const { unmount } = render(
      <PassphraseScreen mode="set" onSubmit={vi.fn()} onCancel={onCancel} />
    )
    fireEvent.click(screen.getByTestId('passphrase-cancel'))
    expect(onCancel).toHaveBeenCalledOnce()
    unmount()

    // No way out of the unlock screen: there is nowhere to go on a device whose
    // wallet is sealed.
    render(<PassphraseScreen mode="enter" onSubmit={vi.fn()} />)
    expect(screen.queryByTestId('passphrase-cancel')).toBeNull()
  })
})
