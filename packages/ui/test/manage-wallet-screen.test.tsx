/**
 * Tests for the manage wallet screen.
 *
 * Two actions sit one tap apart and have nothing else in common. Renaming is
 * cosmetic and reversible. Erasing removes the only copy of a seed this device
 * holds, and for anyone who did not write the mnemonic down it removes the
 * money.
 *
 * So what is checked here is mostly the difference between them: that erasing
 * cannot happen on a tap, that it says what it costs before it is possible at
 * all, and that renaming says out loud that a wrong passphrase here is free.
 * That last one is not decoration. The unlock screen shows an attempt counter
 * prominently enough that a user would reasonably assume it applies everywhere,
 * and a user who is afraid to rename a wallet keeps eight called "Wallet".
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ManageWalletScreen, WALLET_COLOUR_NAMES } from '../src/screens/ManageWalletScreen.js'

afterEach(cleanup)

const button = (testId: string): HTMLButtonElement => screen.getByTestId<HTMLButtonElement>(testId)

function setup(overrides: Partial<React.ComponentProps<typeof ManageWalletScreen>> = {}) {
  const onRename = vi.fn().mockResolvedValue(undefined)
  const onDestroy = vi.fn().mockResolvedValue(undefined)
  const onBack = vi.fn()
  render(
    <ManageWalletScreen
      wallet={{ label: 'Family Vault', colour: 'teal' }}
      onRename={onRename}
      onDestroy={onDestroy}
      onBack={onBack}
      {...overrides}
    />
  )
  return { onRename, onDestroy, onBack }
}

describe('ManageWalletScreen', () => {
  /**
   * INV-UI-42. Erasing needs the name typed out.
   *
   * A confirmation that is a second tap is not a confirmation on a 7 inch
   * panel: the button lands where the previous screen's button was, and muscle
   * memory does the rest.
   */
  it('will-not-erase-on-a-tap', async () => {
    const { onDestroy } = setup()

    fireEvent.click(screen.getByTestId('manage-choose-destroy'))
    expect(button('manage-destroy-submit').disabled).toBe(true)

    // A near miss is still a miss.
    fireEvent.change(screen.getByTestId('manage-destroy-confirm'), {
      target: { value: 'Family Vaul' },
    })
    expect(button('manage-destroy-submit').disabled).toBe(true)

    fireEvent.change(screen.getByTestId('manage-destroy-confirm'), {
      target: { value: 'Family Vault' },
    })
    expect(button('manage-destroy-submit').disabled).toBe(false)

    fireEvent.click(screen.getByTestId('manage-destroy-submit'))
    await waitFor(() => {
      expect(onDestroy).toHaveBeenCalledOnce()
    })
  })

  /**
   * A touchscreen keyboard adds trailing spaces the user cannot see, and
   * refusing over an invisible character teaches nothing.
   */
  it('ignores-whitespace-around-the-typed-name', () => {
    setup()
    fireEvent.click(screen.getByTestId('manage-choose-destroy'))
    fireEvent.change(screen.getByTestId('manage-destroy-confirm'), {
      target: { value: '  Family Vault ' },
    })
    expect(button('manage-destroy-submit').disabled).toBe(false)
  })

  it('says-what-erasing-costs-before-it-is-possible', () => {
    setup()
    fireEvent.click(screen.getByTestId('manage-choose-destroy'))
    const warning = screen.getByTestId('manage-destroy-warning').textContent
    // Both halves. The mnemonic still works, and if there is no mnemonic the
    // money is gone. Saying only the first is the reassuring lie.
    expect(warning).toContain('wrote the mnemonic down')
    expect(warning).toContain('gone')
  })

  /**
   * INV-UI-43. Renaming reseals, so it needs the passphrase, and the screen
   * says that a wrong one costs nothing. INV-MW-5 is what makes that true.
   */
  it('renames-with-the-passphrase-and-says-a-wrong-one-is-free', async () => {
    const { onRename } = setup()

    fireEvent.click(screen.getByTestId('manage-choose-rename'))
    expect(screen.getByTestId('manage-rename-safe').textContent).toContain(
      'does not count against the attempts'
    )

    // Nothing happens without a passphrase, whatever the name says.
    expect(button('manage-rename-submit').disabled).toBe(true)

    fireEvent.change(screen.getByTestId('manage-label'), { target: { value: 'Cold' } })
    fireEvent.click(screen.getByTestId('manage-colour-amber'))
    // The on-screen keyboard, since that is the only way in on the device.
    fireEvent.click(screen.getByTestId('pk-key-a'))
    fireEvent.click(screen.getByTestId('pk-key-b'))

    fireEvent.click(screen.getByTestId('manage-rename-submit'))
    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith('Cold', 'amber', 'ab')
    })
  })

  it('offers-every-colour-the-daemon-accepts', () => {
    setup()
    fireEvent.click(screen.getByTestId('manage-choose-rename'))
    for (const colour of WALLET_COLOUR_NAMES) {
      expect(screen.queryByTestId(`manage-colour-${colour}`)).not.toBeNull()
    }
    // The wallet's own colour starts selected, so saving a name does not
    // silently change it.
    expect(screen.getByTestId('manage-colour-teal').getAttribute('aria-pressed')).toBe('true')
  })

  /**
   * A wallet migrated from a v1 store sealed no name. Presenting its
   * placeholder as a name somebody chose would be the picker's dishonesty
   * moved one screen along.
   */
  it('says-when-the-name-was-never-confirmed', () => {
    setup({ labelVerified: false })
    expect(screen.getByTestId('manage-unnamed').textContent).toContain('no confirmed name')

    // And it does not prefill the placeholder as though it were a name.
    fireEvent.click(screen.getByTestId('manage-choose-rename'))
    expect(screen.getByTestId<HTMLInputElement>('manage-label').value).toBe('')
  })

  it('reports-a-refused-rename-and-clears-the-passphrase', async () => {
    const onRename = vi.fn().mockRejectedValue(new Error('That passphrase does not open it.'))
    setup({ onRename })

    fireEvent.click(screen.getByTestId('manage-choose-rename'))
    fireEvent.click(screen.getByTestId('pk-key-a'))
    fireEvent.click(screen.getByTestId('manage-rename-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('manage-error').textContent).toContain('does not open it')
    })
    // Still on the rename screen, and the field is empty so a retry starts from
    // nothing rather than from a value the user has already seen refused.
    expect(screen.getByTestId('pk-length').textContent).toBe('0')
  })

  it('reports-a-refused-erase-without-claiming-it-happened', async () => {
    const onDestroy = vi.fn().mockRejectedValue(new Error('No stored wallet is open.'))
    setup({ onDestroy })

    fireEvent.click(screen.getByTestId('manage-choose-destroy'))
    fireEvent.change(screen.getByTestId('manage-destroy-confirm'), {
      target: { value: 'Family Vault' },
    })
    fireEvent.click(screen.getByTestId('manage-destroy-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('manage-error').textContent).toContain('No stored wallet is open')
    })
    expect(screen.queryByTestId('manage-destroy')).not.toBeNull()
  })
})
