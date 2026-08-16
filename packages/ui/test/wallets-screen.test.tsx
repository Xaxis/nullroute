/**
 * Tests for the wallet picker and the active-wallet chip.
 *
 * A device with several wallets has one failure worth most of the design: the
 * user signs with a wallet they did not mean to use. These tests are about the
 * two halves of preventing it. The picker must not present unverified names as
 * facts, and the chip must never let the answer to "which wallet is this" leave
 * the screen.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WalletsScreen, type WalletRow } from '../src/screens/WalletsScreen.js'
import { WalletChip } from '../src/components/WalletChip.js'

afterEach(cleanup)

function rows(): WalletRow[] {
  return [
    {
      id: 'aaaaaaaaaaaaaaaa',
      label: 'Cold storage',
      colour: 'teal',
      network: 'mainnet',
      exists: true,
      attemptsRemaining: 10,
      destroyed: false,
    },
    {
      id: 'bbbbbbbbbbbbbbbb',
      label: 'Signet test',
      colour: 'amber',
      network: 'signet',
      exists: true,
      attemptsRemaining: 7,
      destroyed: false,
    },
  ]
}

function mount(overrides: Partial<React.ComponentProps<typeof WalletsScreen>> = {}) {
  const onUnlock = vi.fn(async () => Promise.resolve())
  render(
    <WalletsScreen
      wallets={rows()}
      max={8}
      onUnlock={onUnlock}
      onCreate={vi.fn()}
      {...overrides}
    />
  )
  return onUnlock
}

describe('WalletsScreen', () => {
  /**
   * INV-UI-30. Nothing on the picker is presented as verified.
   *
   * Every row is read from a file beside a sealed blob, editable by whoever
   * held the card. The screen says so, and the note is not behind a disclosure.
   */
  it('says-plainly-that-nothing-here-is-confirmed-yet', () => {
    mount()
    const note = screen.getByTestId('wallets-unverified').textContent
    expect(note).toContain('not confirmed until you open a wallet')

    // And no fingerprint anywhere, which is the value a user would treat as
    // proof if it were shown.
    expect(screen.getByTestId('wallets-screen').textContent).not.toMatch(/[0-9a-f]{8}/)
  })

  it('always-names-the-network-including-mainnet', () => {
    mount()
    const list = screen.getByTestId('wallet-rows').textContent
    // Mainnet named explicitly. With several wallets, the absence of a warning
    // is indistinguishable from a warning that failed to render.
    expect(list).toContain('mainnet')
    expect(list).toContain('signet')
  })

  it('shows-the-label-beside-every-colour', () => {
    mount()
    for (const row of rows()) {
      const element = screen.getByTestId(`wallet-row-${row.id}`)
      expect(element.textContent).toContain(row.label)
      expect(element.querySelector('[data-colour]')).toBeTruthy()
    }
  })

  it('takes-a-passphrase-for-the-wallet-that-was-tapped', async () => {
    const onUnlock = mount()
    fireEvent.click(screen.getByTestId('wallet-row-bbbbbbbbbbbbbbbb'))

    // The name is repeated with the same caveat, because this is the screen
    // where a passphrase is about to be typed.
    expect(screen.getByTestId('wallet-unlock-screen').textContent).toContain('Signet test')
    expect(screen.getByTestId('wallet-unlock-screen').textContent).toContain('not confirmed')
    // And the attempt counter is here, where the destructive path actually is.
    expect(screen.getByTestId('wallet-unlock-attempts').textContent).toBe('7 attempts left')

    fireEvent.click(screen.getByTestId('pk-key-a'))
    fireEvent.click(screen.getByTestId('wallet-unlock-submit'))

    await waitFor(() => {
      expect(onUnlock).toHaveBeenCalledWith('bbbbbbbbbbbbbbbb', 'a')
    })
  })

  it('clears-the-passphrase-after-a-failure', async () => {
    const onUnlock = vi.fn(async () => Promise.reject(new Error('Wrong passphrase.')))
    render(
      <WalletsScreen wallets={rows()} max={8} onUnlock={onUnlock} onCreate={vi.fn()} />
    )
    fireEvent.click(screen.getByTestId('wallet-row-aaaaaaaaaaaaaaaa'))
    fireEvent.click(screen.getByTestId('pk-key-a'))
    fireEvent.click(screen.getByTestId('wallet-unlock-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('wallet-unlock-error').textContent).toContain('Wrong passphrase')
    })
    // Left holding nothing, so a retry is a fresh attempt rather than the same
    // wrong passphrase submitted again.
    expect(screen.getByTestId('pk-length').textContent).toBe('0')
  })

  it('states-what-the-attempt-counter-does-and-does-not-do', () => {
    mount()
    fireEvent.click(screen.getByTestId('wallet-row-aaaaaaaaaaaaaaaa'))
    const text = screen.getByTestId('wallet-unlock-screen').textContent
    expect(text).toContain('erase this wallet')
    // The honest half: it is not a defence against someone holding the card.
    expect(text).toContain('does not stop anyone who copied the card')
  })

  it('refuses-to-add-a-wallet-past-the-limit', () => {
    const [first] = rows()
    if (first === undefined) throw new Error('no fixture row')
    const many = Array.from({ length: 8 }, (_, index) => ({
      ...first,
      id: String(index).repeat(16).slice(0, 16),
      label: `Wallet ${String(index)}`,
    }))
    render(<WalletsScreen wallets={many} max={8} onUnlock={vi.fn()} onCreate={vi.fn()} />)
    const add = screen.getByTestId<HTMLButtonElement>('wallets-add')
    expect(add.disabled).toBe(true)
    expect(add.textContent).toContain('full')
  })

  it('marks-the-open-wallet-and-disables-an-erased-one', () => {
    const list = rows()
    const second = list[1]
    if (second === undefined) throw new Error('no fixture row')
    list[1] = { ...second, exists: false, destroyed: true }
    render(
      <WalletsScreen
        wallets={list}
        max={8}
        active={{ id: 'aaaaaaaaaaaaaaaa', label: 'Cold storage' }}
        onUnlock={vi.fn()}
        onCreate={vi.fn()}
      />
    )
    expect(screen.getByTestId('wallet-row-aaaaaaaaaaaaaaaa').textContent).toContain('open')
    const erased = screen.getByTestId<HTMLButtonElement>('wallet-row-bbbbbbbbbbbbbbbb')
    expect(erased.disabled).toBe(true)
    expect(erased.textContent).toContain('erased')
  })

  it('shows-an-empty-device-honestly', () => {
    render(<WalletsScreen wallets={[]} max={8} onUnlock={vi.fn()} onCreate={vi.fn()} />)
    expect(screen.getByTestId('wallets-empty')).toBeTruthy()
  })
})

describe('WalletChip', () => {
  /**
   * INV-UI-31. The chip always names the network, mainnet included.
   *
   * NetworkBanner renders nothing on mainnet on purpose, so that a warning
   * stays a warning. That reasoning holds for one wallet and breaks for
   * several: "no banner" and "the banner did not render" look identical, and
   * the user is choosing between chains rather than being warned about one.
   */
  it('names-the-network-on-mainnet-too', () => {
    render(
      <WalletChip label="Cold storage" colour="teal" networkLabel="Mainnet" isMainnet />
    )
    const chip = screen.getByTestId('wallet-chip')
    expect(chip.textContent).toContain('Cold storage')
    expect(chip.textContent).toContain('Mainnet')
  })

  it('marks-a-test-network-differently', () => {
    render(
      <WalletChip label="Signet test" colour="amber" networkLabel="Signet" isMainnet={false} />
    )
    expect(screen.getByTestId('wallet-chip').querySelector('.nr-wchip__net--test')).toBeTruthy()
  })

  it('describes-itself-for-a-reader-that-cannot-see-colour', () => {
    render(<WalletChip label="Cold storage" colour="teal" networkLabel="Mainnet" isMainnet />)
    expect(screen.getByTestId('wallet-chip').getAttribute('aria-label')).toBe(
      'Active wallet Cold storage on Mainnet'
    )
  })
})
