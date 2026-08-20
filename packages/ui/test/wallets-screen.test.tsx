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
import { Identity } from '../src/components/Identity.js'

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
    // Both halves, because the note was shortened to one line: that the list is
    // unauthenticated, and that opening a wallet is what settles it.
    const note = screen.getByTestId('wallets-unverified').textContent
    expect(note).toContain('not confirmed until a wallet opens')
    expect(note).toContain('says so if a name differs')

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

  /**
   * INV-UI-30. A list that failed to load must never render as an empty one.
   *
   * "This device holds no wallets" is the most alarming sentence a signing
   * device can say, and saying it because a call failed is a lie told at the
   * worst possible moment: the user's next move is to set up a new wallet.
   */
  it('never-renders-a-failed-list-as-an-empty-device', () => {
    render(
      <WalletsScreen
        wallets={[]}
        max={8}
        failure="The daemon did not answer."
        onUnlock={vi.fn()}
        onCreate={vi.fn()}
      />
    )
    expect(screen.queryByTestId('wallets-empty')).toBeNull()
    const shown = screen.getByTestId('wallets-failure').textContent
    expect(shown).toContain('may be incomplete')
    expect(shown).toContain('The daemon did not answer.')
  })

  /**
   * A wallet erased by exhausted attempts leaves a row, and that row must not
   * count towards the limit. Eight of them would otherwise say the device is
   * full while it holds nothing.
   */
  it('does-not-count-erased-wallets-against-the-limit', () => {
    const tombstones = Array.from({ length: 8 }, (_, index) => ({
      ...(rows()[0] ?? { colour: 'teal', network: 'mainnet', attemptsRemaining: 0 }),
      id: String(index).repeat(16).slice(0, 16),
      label: `Gone ${String(index)}`,
      exists: false,
      destroyed: true,
    })) as WalletRow[]

    render(<WalletsScreen wallets={tombstones} max={8} onUnlock={vi.fn()} onCreate={vi.fn()} />)
    const add = screen.getByTestId<HTMLButtonElement>('wallets-add')
    expect(add.disabled).toBe(false)
    expect(screen.getByTestId('wallets-screen').textContent).toContain('0 of 8')
  })

  /**
   * INV-UI-44. A row left by a wallet that ran out of attempts can be cleared.
   *
   * That row is the only kind this device cannot reach any other way: it cannot
   * be opened, and the manage screen erases only the wallet that is open. Left
   * alone it is permanent, and eight of them is a device that still works and
   * looks broken.
   */
  it('lets-a-tombstone-row-be-cleared-and-says-what-clearing-does-not-do', async () => {
    const onForget = vi.fn(async () => Promise.resolve())
    const list = rows()
    const second = list[1]
    if (second === undefined) throw new Error('no fixture row')
    list[1] = { ...second, exists: false, destroyed: true }

    render(
      <WalletsScreen
        wallets={list}
        max={8}
        onUnlock={vi.fn()}
        onCreate={vi.fn()}
        onForget={onForget}
      />
    )

    const erased = screen.getByTestId<HTMLButtonElement>('wallet-row-bbbbbbbbbbbbbbbb')
    expect(erased.disabled).toBe(false)
    fireEvent.click(erased)

    // It says the seed is already gone, so nobody reads this as a second
    // erasure and hesitates over a row that costs nothing.
    const note = screen.getByTestId('wallets-forget-note').textContent
    expect(note).toContain('already gone')
    expect(note).toContain('mnemonic still recovers it')

    fireEvent.click(screen.getByTestId('wallets-forget-submit'))
    await waitFor(() => {
      expect(onForget).toHaveBeenCalledWith('bbbbbbbbbbbbbbbb')
    })
  })

  it('reports-a-failed-clear-rather-than-pretending-the-row-went', async () => {
    const onForget = vi.fn().mockRejectedValue(new Error('That directory is not writable.'))
    const list = rows()
    const second = list[1]
    if (second === undefined) throw new Error('no fixture row')
    list[1] = { ...second, exists: false, destroyed: true }

    render(
      <WalletsScreen
        wallets={list}
        max={8}
        onUnlock={vi.fn()}
        onCreate={vi.fn()}
        onForget={onForget}
      />
    )
    fireEvent.click(screen.getByTestId('wallet-row-bbbbbbbbbbbbbbbb'))
    fireEvent.click(screen.getByTestId('wallets-forget-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('wallets-forget-error').textContent).toContain('not writable')
    })
    expect(screen.queryByTestId('wallets-forget')).not.toBeNull()
  })

  /**
   * Without a handler the row stays inert rather than opening a screen whose
   * only button cannot work.
   */
  it('leaves-a-tombstone-alone-when-there-is-nothing-to-clear-it-with', () => {
    const list = rows()
    const second = list[1]
    if (second === undefined) throw new Error('no fixture row')
    list[1] = { ...second, exists: false, destroyed: true }
    render(<WalletsScreen wallets={list} max={8} onUnlock={vi.fn()} onCreate={vi.fn()} />)
    expect(screen.getByTestId<HTMLButtonElement>('wallet-row-bbbbbbbbbbbbbbbb').disabled).toBe(true)
  })
})

describe('Identity', () => {
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
      <Identity
        wallet={{ label: 'Cold storage', colour: 'teal' }}
        networkLabel="Mainnet"
        isMainnet
      />
    )
    const chip = screen.getByTestId('identity')
    expect(chip.textContent).toContain('Cold storage')
    expect(chip.textContent).toContain('Mainnet')
  })

  it('marks-a-test-network-differently', () => {
    render(
      <Identity
        wallet={{ label: 'Signet test', colour: 'amber' }}
        networkLabel="Signet"
        isMainnet={false}
      />
    )
    expect(screen.getByTestId('identity').querySelector('.nr-identity__net--test')).toBeTruthy()
  })

  /**
   * INV-UI-31. Said in words, not only in a coloured dot.
   *
   * The only thing separating two wallets at a glance is that dot, which is
   * nothing at all to a screen reader or to somebody who cannot tell five
   * colours apart.
   */
  it('describes-itself-for-a-reader-that-cannot-see-colour', () => {
    render(
      <Identity
        device="The one in the attic"
        wallet={{ label: 'Cold storage', colour: 'teal' }}
        networkLabel="Mainnet"
        isMainnet
      />
    )
    expect(screen.getByTestId('identity').getAttribute('aria-label')).toBe(
      'Device The one in the attic, wallet Cold storage, on Mainnet'
    )
  })

  /** INV-UI-31. And it says so when the chip is also a way to change it. */
  it('says-that-tapping-it-switches-wallet', () => {
    render(<Identity wallet={{ label: 'Cold storage', colour: 'teal' }} onSwitch={vi.fn()} />)
    expect(screen.getByTestId('identity-switch').getAttribute('aria-label')).toContain(
      'Switch wallet'
    )
  })

  /**
   * INV-UI-95. It names the device as well as the wallet.
   *
   * These were two chips competing for one corner. Three identical Raspberry
   * Pis holding one 2-of-3 show the same wallet name, so the wallet alone
   * cannot say which object is in your hand.
   */
  it('names-the-device-and-the-wallet-together', () => {
    render(
      <Identity
        device="The one in the attic"
        wallet={{ label: 'Cold storage', colour: 'teal' }}
      />
    )
    const chip = screen.getByTestId('identity').textContent
    expect(chip).toContain('The one in the attic')
    expect(chip).toContain('Cold storage')
  })

  /**
   * INV-UI-95. With nothing open it says so, rather than showing a device name
   * beside a blank where a wallet would be.
   */
  it('says-when-no-wallet-is-open', () => {
    render(<Identity device="The one in the attic" />)
    expect(screen.getByTestId('identity').textContent).toContain('No wallet open')
  })

  /**
   * INV-UI-95. Switching is offered through it, which is the point: it used to
   * live four taps deep inside More, under a screen about something else.
   */
  it('opens-the-picker-when-switching-is-allowed', () => {
    const onSwitch = vi.fn()
    render(<Identity device="attic" wallet={{ label: 'Cold', colour: 'teal' }} onSwitch={onSwitch} />)
    fireEvent.click(screen.getByTestId('identity-switch'))
    expect(onSwitch).toHaveBeenCalledOnce()
  })

  /**
   * INV-UI-95. And not offered at all where it is not allowed, rather than
   * offered and refused.
   *
   * On a screen with no menu this chip would be the same exit wearing
   * different clothes: tapping it on the seed screen throws away the words
   * before anybody has written them down.
   */
  it('is-not-a-control-at-all-where-leaving-is-not-free', () => {
    render(<Identity device="attic" wallet={{ label: 'Cold', colour: 'teal' }} />)
    expect(screen.queryByTestId('identity-switch')).toBeNull()
    expect(screen.getByTestId('identity').tagName).not.toBe('BUTTON')
  })
})
