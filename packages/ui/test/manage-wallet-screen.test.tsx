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

/**
 * Type on the device's own keyboard, the way somebody holding it has to.
 *
 * NOT `fireEvent.change`, which is what these tests used and is the reason the
 * screen shipped with fields nobody could fill. Setting an input's value is
 * what a workstation with a real keyboard does; this hardware installs no
 * virtual keyboard and cage provides none, so the only way in is the keys on
 * the panel. A test that types the other way passes against a screen a user
 * cannot operate, which is exactly what happened here on four screens.
 *
 * Shift is one-shot and the symbol layer is sticky, so this handles them the
 * way a finger does.
 */
function tapOut(text: string): void {
  for (const character of text) {
    if (character === ' ') {
      fireEvent.click(screen.getByTestId('pk-space'))
      continue
    }
    const letter = /[a-zA-Z]/.test(character)
    const onSymbols = screen.getByTestId('pk-symbols').textContent === 'abc'
    if (letter === onSymbols) fireEvent.click(screen.getByTestId('pk-symbols'))
    if (/[A-Z]/.test(character)) fireEvent.click(screen.getByTestId('pk-shift'))
    fireEvent.click(screen.getByTestId(`pk-key-${character}`))
  }
}

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

    // A near miss is still a miss, and it is typed on the keyboard the device
    // actually has rather than pushed into an input.
    tapOut('Family Vaul')
    expect(button('manage-destroy-submit').disabled).toBe(true)

    tapOut('t')
    expect(button('manage-destroy-submit').disabled).toBe(false)

    fireEvent.click(screen.getByTestId('manage-destroy-submit'))
    await waitFor(() => {
      expect(onDestroy).toHaveBeenCalledOnce()
    })
  })

  /**
   * The confirmation has to be completable on the panel it ships on.
   *
   * THE DEFECT THIS REPLACED. This screen had a labelled input and no keyboard
   * bound to it, so the name could be typed in a browser under `make dev` and
   * nowhere on the hardware: a wallet that could not be erased by the person
   * holding it. Typing it out is the whole gesture, so the gesture has to work.
   */
  it('is-confirmed-on-the-on-screen-keyboard-and-nothing-else', () => {
    setup()
    fireEvent.click(screen.getByTestId('manage-choose-destroy'))
    // There is no field to fill. The keyboard's own readout is the field.
    expect(screen.queryByTestId('manage-destroy-confirm')).toBeNull()
    tapOut('Family Vault')
    // Shown in plain text, because the gesture is comparing it against the name
    // in the header and a row of dots compares to nothing.
    expect(screen.getByTestId('pk-plain').textContent).toBe('Family Vault')
    expect(button('manage-destroy-submit').disabled).toBe(false)
  })

  /**
   * Case is not part of the proof, and on this keyboard it is expensive.
   *
   * What the gesture proves is that you know which wallet this is. Shift is
   * one-shot on the on-screen keyboard, so requiring exact capitalisation adds
   * failures rather than proof, and somebody who cannot finish it cannot erase
   * a wallet they own. Whitespace is collapsed for the same reason the daemon
   * collapses it in `normaliseLabel`.
   */
  it('ignores-case-and-whitespace-around-the-typed-name', () => {
    setup()
    fireEvent.click(screen.getByTestId('manage-choose-destroy'))
    tapOut('family vault ')
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

  /**
   * The name is typeable on the device, and the keyboard says which field it is
   * filling.
   *
   * ONE KEYBOARD, TWO FIELDS, because 480px of panel holds one: the body is
   * 287px and the keyboard is 188 of it. Tapping a field is what selects it,
   * the same way the unlock gate does it, and the field says so about itself
   * rather than a pair of tabs saying it on the field's behalf.
   */
  it('fills-whichever-field-was-tapped', async () => {
    const { onRename } = setup({ labelVerified: false })

    fireEvent.click(screen.getByTestId('manage-choose-rename'))
    // The name starts empty on a wallet whose label was never sealed, and
    // before this there was no way at all to put anything in it on the device.
    expect(screen.getByTestId<HTMLInputElement>('manage-label').value).toBe('')

    fireEvent.click(screen.getByTestId('manage-label'))
    tapOut('cold')
    expect(screen.getByTestId<HTMLInputElement>('manage-label').value).toBe('cold')

    fireEvent.click(screen.getByTestId('manage-rename-passphrase'))
    tapOut('abc')
    // The name kept what it had: the keys went to the other field.
    expect(screen.getByTestId<HTMLInputElement>('manage-label').value).toBe('cold')

    fireEvent.click(screen.getByTestId('manage-rename-submit'))
    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith('cold', 'teal', 'abc')
    })
  })

  /**
   * THE KEYBOARD STARTS ON THE PASSPHRASE, and which mistake it costs is the
   * reason. Defaulting to the name means somebody who taps straight into the
   * keys types their passphrase into a field that shows it in plain text on a
   * lit panel, and then seals it as the wallet's name. Defaulting this way, a
   * name typed into the wrong field appears as dots and is noticed at once.
   */
  it('types-into-the-passphrase-until-a-field-is-chosen', () => {
    setup()
    fireEvent.click(screen.getByTestId('manage-choose-rename'))
    tapOut('secret')
    expect(screen.getByTestId<HTMLInputElement>('manage-label').value).toBe('Family Vault')
    expect(screen.getByTestId('pk-hidden')).toBeTruthy()
    expect(screen.getByTestId('pk-length').textContent).toBe('6')
  })

  /**
   * maxLength is an attribute of an input element, and the keyboard is not one.
   *
   * The field advertised a limit that held for a browser and not for the
   * device: the keys called onChange with whatever had been tapped. A name past
   * the daemon's limit is refused by `normaliseLabel` AFTER the passphrase has
   * been derived twice, so the cost of not capping it here is several seconds
   * of a device that looks frozen followed by a refusal.
   */
  it('will-not-let-the-keyboard-type-past-the-name-limit', () => {
    setup()
    fireEvent.click(screen.getByTestId('manage-choose-rename'))
    fireEvent.click(screen.getByTestId('manage-label'))
    // Starts at 'Family Vault', twelve characters, and the limit is 32.
    tapOut('abcdefghijklmnopqrstuvwxyz')
    expect(screen.getByTestId<HTMLInputElement>('manage-label').value.length).toBe(32)
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
    tapOut('Family Vault')
    fireEvent.click(screen.getByTestId('manage-destroy-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('manage-error').textContent).toContain('No stored wallet is open')
    })
    expect(screen.queryByTestId('manage-destroy')).not.toBeNull()
  })
})
