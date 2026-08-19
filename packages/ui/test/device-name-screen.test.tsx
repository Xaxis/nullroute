/**
 * Tests for naming this physical device.
 *
 * Three nullroute devices holding one 2-of-3 hold the same wallet, so they show
 * the same wallet name, the same colour and the same fingerprint. This name is
 * the only thing that tells the objects apart before one of them is unlocked.
 *
 * It is also deliberately powerless, and the screen has to say so: it lives in
 * a plain file beside the wallets, so it can be read before any passphrase,
 * which means anyone holding the card can edit it.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DeviceNameScreen } from '../src/screens/DeviceNameScreen.js'
import { WALLET_COLOUR_NAMES } from '../src/screens/ManageWalletScreen.js'

afterEach(cleanup)

function setup(overrides: Partial<React.ComponentProps<typeof DeviceNameScreen>> = {}) {
  const onSave = vi.fn().mockResolvedValue(undefined)
  const onBack = vi.fn()
  render(<DeviceNameScreen onSave={onSave} onBack={onBack} {...overrides} />)
  return { onSave, onBack }
}

describe('DeviceNameScreen', () => {
  // INV-UI-78. The name and the colour reach the daemon.
  it('names-the-device-and-offers-every-colour', async () => {
    const { onSave } = setup()

    expect(screen.getByTestId<HTMLButtonElement>('device-name-save').disabled).toBe(true)

    fireEvent.change(screen.getByTestId('device-name-input'), {
      target: { value: 'The one in the attic' },
    })
    for (const colour of WALLET_COLOUR_NAMES) {
      expect(screen.queryByTestId(`device-colour-${colour}`), colour).not.toBeNull()
    }
    fireEvent.click(screen.getByTestId('device-colour-teal'))
    fireEvent.click(screen.getByTestId('device-name-save'))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith('The one in the attic', 'teal')
    })
  })

  /**
   * INV-UI-78. The screen states what the name is worth. It appears in the
   * header of every screen including the one where a transaction is authorised,
   * and somebody reading it there should know it is not evidence of anything.
   */
  it('says-the-name-is-unverified-and-decides-nothing', () => {
    setup()
    const said = screen.getByTestId('device-name-unverified').textContent
    expect(said).toContain('not verified')
    expect(said).toContain('anyone holding the card can change it')
    expect(said).toContain('decides anything from it')
  })

  it('starts-from-the-current-name-when-there-is-one', () => {
    setup({ current: { name: 'Attic', colour: 'rose' } })
    expect(screen.getByTestId<HTMLInputElement>('device-name-input').value).toBe('Attic')
    expect(screen.getByTestId('device-colour-rose').getAttribute('aria-pressed')).toBe('true')
  })

  it('reports-a-refused-name', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('A device name is at most 48 characters.'))
    setup({ onSave })

    fireEvent.change(screen.getByTestId('device-name-input'), { target: { value: 'x'.repeat(60) } })
    fireEvent.click(screen.getByTestId('device-name-save'))

    await waitFor(() => {
      expect(screen.getByTestId('device-name-error').textContent).toContain('at most 48')
    })
  })
})
