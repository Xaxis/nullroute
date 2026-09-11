/**
 * Tests for the passphrase change screen.
 *
 * THE ONE THAT MATTERS MOST is not about the change succeeding. It is that a
 * user cannot leave this screen believing they changed the passphrase that
 * derives their keys. They did not, that one cannot be changed, and somebody
 * who thought otherwise would go looking for their money at addresses that do
 * not exist and conclude the device lost it.
 *
 * The rest is about the ways a typo becomes permanent. There is no recovery
 * from a mistyped new passphrase that is not "restore from your mnemonic and
 * lose every registration", so it is typed twice and the mismatch is shown
 * while it is still fixable.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ManageWalletScreen } from '../src/screens/ManageWalletScreen.js'

afterEach(() => {
  cleanup()
})

const WALLET = { label: 'Cold storage', colour: 'teal' }

function open(onChange = vi.fn().mockResolvedValue(undefined)) {
  const rendered = render(
    <ManageWalletScreen
      wallet={WALLET}
      onRename={async () => Promise.resolve()}
      onChangePassphrase={onChange}
      onDestroy={async () => Promise.resolve()}
      onBack={() => undefined}
    />
  )
  fireEvent.click(screen.getByTestId('manage-choose-passphrase'))
  return { ...rendered, onChange }
}

function type(testId: string, value: string): void {
  fireEvent.change(screen.getByTestId(testId), { target: { value } })
}

/**
 * Tap a field to select it, then type on the device's own keyboard.
 *
 * ONE KEYBOARD FOR THREE FIELDS, because the panel holds one: the body is 287px
 * and the keyboard is 188 of it, so everything above the keys is 70px, which is
 * one row. Stacked, these three fields were 204px, which is why this screen
 * shipped with three inputs and no way to fill any of them on the hardware.
 */
function tapOut(testId: string, text: string): void {
  fireEvent.click(screen.getByTestId(testId))
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

describe('ManageWalletScreen passphrase change', () => {
  /**
   * INV-UI-87. The single most dangerous belief a user can leave this screen
   * with. A BIP-39 passphrase feeds the seed derivation; this one encrypts the
   * file. Confusing them is unrecoverable in the direction that matters.
   */
  it('says-first-that-this-does-not-change-any-address', () => {
    open()
    const scope = screen.getByTestId('manage-passphrase-scope').textContent
    expect(scope).toContain('does not change your addresses')
    expect(scope).toContain('BIP-39 passphrase is a different thing')
  })

  /**
   * INV-UI-87. Typed twice, and the mismatch shown while it is still fixable.
   * The alternative to catching it here is discovering it at the next reboot.
   */
  it('will-not-change-anything-until-the-new-one-is-typed-twice-the-same', () => {
    open()
    type('manage-passphrase-old', 'the old one')
    type('manage-passphrase-new', 'a new one')
    type('manage-passphrase-confirm', 'a new onr')

    expect(screen.getByTestId('manage-passphrase-mismatch')).toBeTruthy()
    expect(screen.getByTestId<HTMLButtonElement>('manage-passphrase-submit').disabled).toBe(true)

    type('manage-passphrase-confirm', 'a new one')
    expect(screen.queryByTestId('manage-passphrase-mismatch')).toBeNull()
    expect(screen.getByTestId<HTMLButtonElement>('manage-passphrase-submit').disabled).toBe(false)
  })

  /** INV-UI-87. Setting it to what it already is is a mistake, not a no-op. */
  it('refuses-a-new-passphrase-identical-to-the-old-one', () => {
    open()
    type('manage-passphrase-old', 'same')
    type('manage-passphrase-new', 'same')
    type('manage-passphrase-confirm', 'same')

    expect(screen.getByTestId('manage-passphrase-same')).toBeTruthy()
    expect(screen.getByTestId<HTMLButtonElement>('manage-passphrase-submit').disabled).toBe(true)
  })

  /**
   * INV-UI-87. All three fields are fillable on the panel this ships on.
   *
   * THE DEFECT THIS EXISTS FOR. These three inputs had no keyboard bound to
   * them at all. They could be filled perfectly under `make dev` in a browser,
   * every test on this screen passed, and on the device there was no way to
   * change a passphrase: no virtual keyboard is installed in the image and cage
   * provides none. Typing through `fireEvent.change` is what hid it, so this
   * one taps the keys.
   */
  it('fills-each-of-the-three-fields-from-the-one-keyboard', async () => {
    const { onChange } = open()

    tapOut('manage-passphrase-old', 'old one')
    tapOut('manage-passphrase-new', 'new one')
    tapOut('manage-passphrase-confirm', 'new one')

    expect(screen.getByTestId<HTMLButtonElement>('manage-passphrase-submit').disabled).toBe(false)
    fireEvent.click(screen.getByTestId('manage-passphrase-submit'))
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('old one', 'new one')
    })
  })

  /**
   * The keys go to the field that was tapped, and to no other.
   *
   * The loose half of this is the dangerous one: a keyboard that kept filling
   * the first field while the user looked at the third would produce two
   * passphrases that do not match and no way to see why.
   */
  it('types-into-the-field-that-was-tapped', () => {
    open()
    tapOut('manage-passphrase-old', 'abc')
    tapOut('manage-passphrase-new', 'de')

    expect(screen.getByTestId<HTMLInputElement>('manage-passphrase-old').value).toBe('abc')
    expect(screen.getByTestId<HTMLInputElement>('manage-passphrase-new').value).toBe('de')
    expect(screen.getByTestId<HTMLInputElement>('manage-passphrase-confirm').value).toBe('')
    // The readout follows the selection rather than the last thing typed
    // anywhere, which is the only thing on the panel saying which field the
    // next key lands in.
    expect(screen.getByTestId('pk-length').textContent).toBe('2')
  })

  /**
   * INV-UI-87. What it costs, before the tap rather than after. A passphrase
   * nobody remembers makes a wallet exactly as unreachable as one nobody
   * stole, and the mnemonic does not bring back the registrations.
   */
  it('says-what-cannot-be-recovered-before-the-change-happens', () => {
    open()
    const cost = screen.getByTestId('manage-passphrase-cost').textContent
    expect(cost).toContain('Write the new one down before you tap')
    expect(cost).toContain('does not restore the quorums')
  })

  /**
   * INV-UI-87. A refusal is reported as a refusal. Reporting success for a
   * change the daemon rejected would leave somebody believing their old
   * passphrase no longer works.
   */
  it('reports-a-refusal-rather-than-claiming-it-changed', async () => {
    open(vi.fn().mockRejectedValue(new Error('That is not the passphrase.')))
    type('manage-passphrase-old', 'wrong')
    type('manage-passphrase-new', 'a new one')
    type('manage-passphrase-confirm', 'a new one')
    fireEvent.click(screen.getByTestId('manage-passphrase-submit'))

    await waitFor(() => screen.getByTestId('manage-passphrase-error'))
    expect(screen.getByTestId('manage-passphrase-error').textContent).toContain('Not changed')
    expect(screen.queryByTestId('manage-passphrase-done')).toBeNull()
  })

  /** INV-UI-87. And a success is stated, since nothing else on the device would. */
  it('confirms-the-change-rather-than-returning-silently', async () => {
    const { onChange } = open()
    type('manage-passphrase-old', 'the old one')
    type('manage-passphrase-new', 'a new one')
    type('manage-passphrase-confirm', 'a new one')
    fireEvent.click(screen.getByTestId('manage-passphrase-submit'))

    await waitFor(() => screen.getByTestId('manage-passphrase-done'))
    expect(onChange).toHaveBeenCalledWith('the old one', 'a new one')
    expect(screen.getByTestId('manage-passphrase-done').textContent).toContain(
      'The old one no longer works'
    )
  })
})
