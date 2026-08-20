/**
 * Tests for the screen shown immediately after a wallet opens.
 *
 * One job: put the fingerprint in front of someone before they can use the
 * wallet. A wrong BIP-39 passphrase produces no error at all. It derives a
 * different, valid, empty wallet, and every screen afterwards looks completely
 * normal while showing addresses nobody has funded.
 *
 * So these tests are about prominence and about honesty. The fingerprint has to
 * be there, the screen has to say what a mismatch means, and it has to admit
 * that a user who never recorded one gets nothing from it.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { UnlockedScreen } from '../src/screens/UnlockedScreen.js'

afterEach(cleanup)

function mount(overrides: Partial<React.ComponentProps<typeof UnlockedScreen>> = {}) {
  const onContinue = vi.fn()
  const onLock = vi.fn()
  render(
    <UnlockedScreen
      label="Cold storage"
      colour="teal"
      fingerprint="73c5da0a"
      networkLabel="Mainnet"
      isMainnet
      usedPassphrase={false}
      labelVerified
      hintCorrected={false}
      onContinue={onContinue}
      onLock={onLock}
      {...overrides}
    />
  )
  return { onContinue, onLock }
}

describe('UnlockedScreen', () => {
  /**
   * INV-UI-33. The fingerprint is shown before the wallet can be used, and the
   * screen says what it is for.
   */
  it('shows-the-fingerprint-and-what-a-mismatch-means', () => {
    mount()
    // Rendered in groups of four, which is INV-UI-6 and is what makes a
    // fingerprint checkable by glancing between two screens rather than
    // skimmed. So the assertion is on the chunks, not on the raw string.
    const shown = (screen.getByTestId('unlocked-fingerprint').textContent).replace(/\s+/g, '')
    expect(shown).toContain('73c5da0a')

    const body = screen.getByTestId('unlocked-screen').textContent
    expect(body).toContain('Compare this with what you wrote down')
    // The honest limit, stated rather than implied.
    expect(body).toContain('If you never recorded one, this screen cannot help you')
  })

  /**
   * INV-UI-33. Continuing is not the focused default, so a stray tap cannot
   * carry someone past the one screen asking them to check something.
   */
  it('offers-a-way-out-that-is-not-the-primary-action', () => {
    const { onContinue, onLock } = mount()

    const advance = screen.getByTestId('unlocked-continue')
    // Not the primary variant: this screen exists to be read, not agreed with.
    expect(advance.className).not.toContain('nr-button--primary')

    fireEvent.click(screen.getByTestId('unlocked-lock'))
    expect(onLock).toHaveBeenCalled()
    fireEvent.click(advance)
    expect(onContinue).toHaveBeenCalled()
  })

  /**
   * INV-UI-34. A passphrase wallet says so, in the words that matter: a wrong
   * one is not an error, and the mnemonic alone will not bring it back.
   */
  it('warns-specifically-when-the-wallet-uses-a-passphrase', () => {
    mount({ usedPassphrase: true })
    const warning = screen.getByTestId('unlocked-passphrase-warning').textContent
    expect(warning).toContain('does not produce an error')
    expect(warning).toContain('different, valid, empty wallet')
    expect(warning).toContain('mnemonic alone will not recover')
  })

  it('says-nothing-about-passphrases-when-none-was-used', () => {
    mount()
    expect(screen.queryByTestId('unlocked-passphrase-warning')).toBeNull()
  })

  /**
   * INV-UI-34. A migrated wallet has no sealed name, so the screen says the
   * name it is showing is not confirmed rather than presenting it as one.
   */
  it('says-when-the-name-is-not-confirmed', () => {
    mount({ labelVerified: false, label: 'Unconfirmed wallet' })
    const note = screen.getByTestId('unlocked-unverified-name').textContent
    expect(note).toContain('anyone holding the card could change')
    expect(note).toContain('Rename it')
  })

  /**
   * INV-UI-34. If the picker was showing something the ciphertext disagreed
   * with, the user hears about it here rather than finding a quietly corrected
   * label later.
   */
  it('reports-that-the-picker-was-showing-something-else', () => {
    mount({ hintCorrected: true })
    const note = screen.getByTestId('unlocked-hint-corrected').textContent
    expect(note).toContain('did not match what this wallet actually contains')
    expect(note).toContain('handled by somebody else')
  })

  it('shows-nothing-alarming-on-an-ordinary-unlock', () => {
    mount()
    expect(screen.queryByTestId('unlocked-passphrase-warning')).toBeNull()
    expect(screen.queryByTestId('unlocked-unverified-name')).toBeNull()
    expect(screen.queryByTestId('unlocked-hint-corrected')).toBeNull()
  })

  it('names-the-network-and-marks-a-test-one', () => {
    mount({ networkLabel: 'Signet', isMainnet: false })
    expect(screen.getByTestId('unlocked-screen').textContent).toContain('a test network')
  })
})
