/**
 * Tests for the backup screen.
 *
 * One decision matters here: whether the seed goes in the file. A seedless
 * backup restores a device that can check what is yours and cannot spend. One
 * with a seed is a second copy of the money under a single passphrase, and a
 * file that quietly held a spendable key would be the worst kind of surprise,
 * because it looks like a settings export and it is a wallet.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BackupScreen } from '../src/screens/BackupScreen.js'

afterEach(cleanup)

function setup(overrides: Partial<React.ComponentProps<typeof BackupScreen>> = {}) {
  const onCreate = vi.fn().mockResolvedValue({ backup: '{"format":"x"}', includesSeed: false })
  const onDescribe = vi.fn().mockResolvedValue({
    label: 'Family Vault',
    network: 'signet',
    hasSeed: true,
    createdWith: 'v0.1.0',
  })
  const onRestore = vi.fn().mockResolvedValue({
    hasSeed: false,
    label: 'Family Vault',
    network: 'signet',
    registrations: 2,
    createdWith: 'v0.1.0',
  })
  const onBack = vi.fn()
  render(
    <BackupScreen
      onCreate={onCreate}
      onDescribe={onDescribe}
      onRestore={onRestore}
      onBack={onBack}
      {...overrides}
    />
  )
  return { onCreate, onDescribe, onRestore, onBack }
}

describe('BackupScreen', () => {
  /*
   * A scanned backup is a backup, not a passphrase.
   *
   * `initialText` seeded the passphrase and left the backup field empty, so
   * scanning a file dropped the user back on the two-choice screen with the
   * whole encrypted blob in the passphrase readout. Restore then showed an
   * empty textarea and a disabled button with no way forward, and the other
   * branch would have written a real backup under a passphrase nobody chose
   * and nobody could retype.
   */
  it('puts-a-scanned-backup-in-the-backup-field', () => {
    const blob = '{"v":1,"kdf":"argon2id","ct":"deadbeef"}'
    setup({ initialText: blob })

    // Straight to the restore branch: arriving with a file in hand means the
    // choice has already been made.
    const field = screen.getByTestId('backup-input')
    expect(field.value).toBe(blob)
    expect(screen.getByTestId('backup-describe').disabled).toBe(false)

    expect(screen.queryByTestId('backup-restore')).not.toBeNull()
  })

  /*
   * The half that could have cost something.
   *
   * With the blob seeding the passphrase, the write branch was enabled the
   * moment a file was scanned, and tapping it wrote a real backup encrypted
   * under a passphrase the user never chose and could not retype. Reached the
   * way a user would: back out of the restore branch and take the other one.
   */
  it('does-not-arm-the-write-branch-with-a-scanned-file', () => {
    setup({ initialText: '{"v":1,"kdf":"argon2id","ct":"deadbeef"}' })

    fireEvent.click(screen.getByTestId('backup-restore-back'))
    fireEvent.click(screen.getByTestId('backup-choose-create'))

    expect(screen.getByTestId('backup-create-submit').disabled).toBe(true)
    expect(screen.getByTestId('pk-length').textContent).toContain('0')
  })

  // Without one, nothing has been chosen yet and the screen still asks.
  it('still-asks-which-way-when-nothing-was-scanned', () => {
    setup()
    expect(screen.queryByTestId('backup-choose-create')).not.toBeNull()
    expect(screen.queryByTestId('backup-choose-restore')).not.toBeNull()
    expect(screen.queryByTestId('backup-input')).toBeNull()
  })

  /**
   * INV-UI-40. Seedless is the default and the difference is stated in the
   * words that matter, not in a toggle label alone.
   */
  it('does-not-include-the-seed-unless-asked', async () => {
    const { onCreate } = setup()
    fireEvent.click(screen.getByTestId('backup-choose-create'))

    expect(screen.getByTestId('backup-include-seed').textContent).toContain('Not including')
    expect(screen.getByTestId('backup-watching-note').textContent).toContain('no key')
    expect(screen.queryByTestId('backup-seed-warning')).toBeNull()

    fireEvent.click(screen.getByTestId('pk-key-a'))
    fireEvent.click(screen.getByTestId('backup-create-submit'))

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith('a', false, 'nullroute wallet')
    })
  })

  it('says-what-including-the-seed-means-before-doing-it', () => {
    setup()
    fireEvent.click(screen.getByTestId('backup-choose-create'))
    fireEvent.click(screen.getByTestId('backup-include-seed'))

    const warning = screen.getByTestId('backup-seed-warning').textContent
    expect(warning).toContain('second copy of your money')
    expect(warning).toContain('spend everything')
    // And the action itself changes, so the button is not the same tap.
    expect(screen.getByTestId('backup-create-submit').textContent).toContain('spendable')
  })

  it('warns-again-on-the-file-that-carries-a-seed', async () => {
    const onCreate = vi.fn().mockResolvedValue({ backup: '{"x":1}', includesSeed: true })
    setup({ onCreate })
    fireEvent.click(screen.getByTestId('backup-choose-create'))
    fireEvent.click(screen.getByTestId('pk-key-a'))
    fireEvent.click(screen.getByTestId('backup-create-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('backup-carries-seed')).toBeTruthy()
    })
    expect(screen.getByTestId('backup-carries-seed').textContent).toContain('copy of your wallet')
  })

  /**
   * INV-UI-41. What a backup says about itself is shown before a passphrase is
   * typed, and is stated as unverified. Those fields live outside the
   * encryption so anyone holding the file could have written them.
   */
  it('shows-what-the-file-claims-and-says-it-is-not-confirmed', async () => {
    setup()
    fireEvent.click(screen.getByTestId('backup-choose-restore'))
    fireEvent.change(screen.getByTestId('backup-input'), { target: { value: '{"format":"x"}' } })
    fireEvent.click(screen.getByTestId('backup-describe'))

    await waitFor(() => {
      expect(screen.getByTestId('backup-described')).toBeTruthy()
    })
    expect(screen.getByTestId('backup-described').textContent).toContain('Family Vault')
    const note = screen.getByTestId('backup-unverified').textContent
    expect(note).toContain('None of that is confirmed')
    expect(note).toContain('anyone holding it could have edited')
  })

  /**
   * INV-UI-41. A watch-only restore says so plainly. A user who believes they
   * restored a spending wallet and did not will discover it when they try to
   * sign, which is the worst moment.
   */
  it('says-when-a-restore-cannot-sign', async () => {
    setup()
    fireEvent.click(screen.getByTestId('backup-choose-restore'))
    fireEvent.change(screen.getByTestId('backup-input'), { target: { value: '{"format":"x"}' } })
    fireEvent.click(screen.getByTestId('backup-describe'))
    await waitFor(() => {
      expect(screen.getByTestId('backup-described')).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('pk-key-a'))
    fireEvent.click(screen.getByTestId('backup-restore-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('backup-restored-watching')).toBeTruthy()
    })
    const shown = screen.getByTestId('backup-restored-watching').textContent
    expect(shown).toContain('cannot sign anything')
    expect(shown).toContain('Import the mnemonic')
  })

  it('says-when-a-restore-can-sign-again', async () => {
    const onRestore = vi.fn().mockResolvedValue({
      hasSeed: true,
      label: 'Family Vault',
      network: 'signet',
      registrations: 1,
      createdWith: 'v0.1.0',
    })
    setup({ onRestore })
    fireEvent.click(screen.getByTestId('backup-choose-restore'))
    fireEvent.change(screen.getByTestId('backup-input'), { target: { value: '{"x":1}' } })
    fireEvent.click(screen.getByTestId('backup-describe'))
    await waitFor(() => {
      expect(screen.getByTestId('backup-described')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('pk-key-a'))
    fireEvent.click(screen.getByTestId('backup-restore-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('backup-restored-seed')).toBeTruthy()
    })
    expect(screen.queryByTestId('backup-restored-watching')).toBeNull()
  })

  it('reports-a-wrong-passphrase-and-leaves-nothing-restored', async () => {
    const onRestore = vi.fn().mockRejectedValue(new Error('That passphrase did not open it.'))
    setup({ onRestore })
    fireEvent.click(screen.getByTestId('backup-choose-restore'))
    fireEvent.change(screen.getByTestId('backup-input'), { target: { value: '{"x":1}' } })
    fireEvent.click(screen.getByTestId('backup-describe'))
    await waitFor(() => {
      expect(screen.getByTestId('backup-described')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('pk-key-a'))
    fireEvent.click(screen.getByTestId('backup-restore-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('backup-error').textContent).toContain('did not open it')
    })
    expect(screen.queryByTestId('backup-restored')).toBeNull()
  })
})
