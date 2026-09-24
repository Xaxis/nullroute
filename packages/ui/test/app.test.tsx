/**
 * Tests for the shell, driven through a fake daemon.
 *
 * Spec: ui.app
 *
 * THIS IS THE LAYER THAT KEEPS BREAKING IN PRODUCTION while everything else
 * passes. The screens are tested against their props, the daemon is tested
 * against its handler, and the shell in between, which decides which screen
 * comes next and what to call with what arguments, had no test at all. That is
 * where saving a newly created wallet called `store.create` for a while after
 * the daemon started refusing it: every screen test passed, every daemon test
 * passed, and the device could not save a wallet.
 *
 * The seam is `globalThis.fetch`, so these run the real transport, the real
 * client and the real App against a scripted daemon. What is asserted is the
 * boundary: which method was called, with which parameters, and which screen
 * came out. Not the screens themselves, which have their own tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from '../src/App.js'

interface Call {
  readonly method: string
  readonly params: Record<string, unknown>
}

let calls: Call[]
let replies: Map<string, unknown>

/** What the daemon answers when nothing more specific is scripted. */
function defaults(): Map<string, unknown> {
  return new Map<string, unknown>([
    [
      'attestation.get',
      {
        rootHash: 'a'.repeat(64),
        rootHashShort: 'aaaaaaaa...aaaaaaaa',
        specCount: 31,
        invariantCount: 221,
        tier: 'signer',
        version: '0.1.0',
        checks: [{ name: 'integrity', status: 'passed', detail: '' }],
      },
    ],
    [
      'device.status',
      {
        hasWallet: false,
        network: { id: 'mainnet', label: 'Mainnet', isMainnet: true },
      },
    ],
    ['store.status', { stored: false, attemptsRemaining: 10 }],
    [
      'wallets.list',
      {
        migrated: null,
        migrationError: null,
        max: 8,
        active: null,
        wallets: [],
        verified: false,
        note: 'Not verified until you open one.',
      },
    ],
    ['multisig.registrations', { descriptors: [], quorums: [] }],
    // Screens fetch on mount, including ones this test navigates straight past.
    // Scripted here so an unhandled rejection in the output is always a real
    // one rather than a screen that was on its way out.
    ['wallet.addresses', { addresses: [] }],
    ['wallet.descriptor', { descriptor: 'wpkh(xpub)#aaaaaaaa', checksum: 'aaaaaaaa' }],
    [
      'entropy.account',
      {
        accounting: { rolls: 0, bits: 0, needed: 100, enough: false },
        warnings: [],
      },
    ],
    ['session.lock', { locked: true }],
    ['network.set', { id: 'signet' }],
  ])
}

function lastCall(method: string): Call | undefined {
  return [...calls].reverse().find((c) => c.method === method)
}

beforeEach(() => {
  calls = []
  replies = defaults()

  vi.stubGlobal(
    'fetch',
    // Not async: nothing here awaits, and fetch's contract is a promise for a
    // Response rather than an async function, so returning the object directly
    // is both correct and what the linter asks for.
    vi.fn((_url: string, init: { body: string }) => {
      const request = JSON.parse(init.body) as {
        method: string
        params?: Record<string, unknown>
      }
      calls.push({ method: request.method, params: request.params ?? {} })

      if (!replies.has(request.method)) {
        // Loud, not empty. A method the fake does not know about is a method
        // this test file has not been taught, and returning a blank result
        // would have the shell render a screen full of nothing and pass.
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              error: { code: 'unscripted', message: `No fake reply for ${request.method}.` },
            }),
        })
      }
      const reply = replies.get(request.method)
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve(
            reply instanceof Error
              ? { error: { code: 'refused', message: reply.message } }
              : { result: reply }
          ),
      })
    })
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** Boot to the lock screen, which is where every session starts. */
async function boot(): Promise<void> {
  render(<App />)
  await waitFor(() => {
    expect(screen.getByTestId('lock-screen')).toBeTruthy()
  })
}

describe('ui.app boot', () => {
  /**
   * INV-UI-64. The shell asks for the attestation before anything else and
   * renders the lock screen from it, rather than rendering a wallet and asking
   * afterwards.
   */
  it('reads-the-attestation-before-showing-anything', async () => {
    await boot()
    expect(calls[0]?.method).toBe('attestation.get')
    expect(calls.map((c) => c.method)).toContain('store.status')
  })

  /**
   * A daemon that does not answer is reported as unreachable, not as a device
   * with no wallet. Those look identical on a lock screen and only one of them
   * is a reason to set up a new wallet.
   */
  it('says-when-the-daemon-is-unreachable-rather-than-showing-an-empty-device', async () => {
    replies.delete('attestation.get')
    render(<App />)
    await waitFor(() => {
      expect(document.body.textContent).toContain('No fake reply for attestation.get')
    })
    expect(screen.queryByTestId('lock-screen')).toBeNull()
  })
})

describe('ui.app what the header says about the wallet', () => {
  /**
   * INV-UI-101. The header is the one control on every screen that answers
   * "which wallet is this", and it was answering "none" about an open one.
   *
   * THE BUG THIS EXISTS FOR. `DeviceStatus` here did not declare
   * `activeWallet`, which the daemon has always sent, so nothing read it from
   * status: the chip was set only by the two paths that open a wallet. Restart
   * the frontend while the daemon keeps running, which is what a kiosk crash
   * looks like, and the device drew a header reading "No wallet open" while the
   * daemon reported hasWallet, unlocked, and the wallet's name.
   *
   * A person reading "No wallet open" concludes the seed is not in memory. It
   * was. That is the one question this device exists to answer honestly.
   */
  it('names-the-open-wallet-after-the-frontend-restarts', async () => {
    replies.set('device.status', {
      hasWallet: true,
      unlocked: true,
      backupConfirmed: true,
      fingerprint: '73c5da0a',
      network: { id: 'mainnet', label: 'Mainnet', isMainnet: true },
      activeWallet: { id: 'w1', label: 'Cold storage', colour: 'teal' },
    })

    await boot()

    expect(screen.getByTestId('identity-switch').textContent).toContain('Cold storage')
    expect(screen.getByTestId('identity-switch').textContent).not.toContain('No wallet open')
  })

  /** INV-UI-101. And says so plainly when there genuinely is not one. */
  it('says-no-wallet-is-open-when-the-daemon-says-none-is', async () => {
    await boot()
    expect(screen.getByTestId('identity-switch').textContent).toContain('No wallet open')
  })
})

describe('ui.app when something fails', () => {
  /**
   * INV-UI-99. A control that does nothing is worse than an error.
   *
   * THE BUG THIS EXISTS FOR. Every asynchronous action in the shell was
   * launched with `void go()`, in eight places, which drops a rejection on the
   * floor. Continue on the dice screen, after a hundred rolls, called
   * `seed.reveal`, was refused, and did nothing at all: the screen did not
   * change and the device said nothing. Somebody would tap it again, and again,
   * with no way to learn that the seed they had just generated was gone.
   *
   * Driven through `network.set`, which is the first action on the way into
   * setting a device up, because the point is the routing rather than the
   * method: they all go through one runner now.
   */
  it('says-so-when-an-action-fails', async () => {
    replies.set('network.set', new Error('The network is locked to this wallet.'))
    await boot()

    fireEvent.click(screen.getByTestId('unlock'))
    await waitFor(() => {
      expect(screen.getByTestId('wallets-add')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('wallets-add'))
    await waitFor(() => {
      expect(screen.getByTestId('setup-start')).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('setup-start'))

    const banner = await waitFor(() => screen.getByTestId('action-error'))
    expect(banner.textContent).toContain('The network is locked to this wallet.')

    // And it can be got rid of, because an error about something you have since
    // done differently is worse than no error.
    fireEvent.click(screen.getByTestId('action-error-dismiss'))
    await waitFor(() => {
      expect(screen.queryByTestId('action-error')).toBeNull()
    })
  })
})

describe('ui.app journeys', () => {
  /**
   * INV-UI-64. The goal hub is reachable from the lock screen, and starting a
   * journey routes to its first step with the step counter on it.
   */
  it('starts-a-journey-at-its-first-step-with-the-counter-showing', async () => {
    await boot()

    fireEvent.click(screen.getByTestId('lock-guide'))
    await waitFor(() => {
      expect(screen.getByTestId('start-screen')).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('start-goal-new-wallet'))
    fireEvent.click(screen.getByTestId('start-begin'))

    await waitFor(() => {
      expect(screen.getByTestId('setup-screen')).toBeTruthy()
    })
    const indicator = screen.getByTestId('journey-steps').textContent
    expect(indicator).toContain('Step 1 of 4')
    expect(indicator).toContain('Choose how to make the seed')
  })

  /**
   * INV-UI-65. The counter advances with the flow, and the network choice made
   * on the setup screen actually reaches the daemon before the next step.
   */
  it('advances-the-counter-and-sets-the-network-on-the-way', async () => {
    await boot()
    fireEvent.click(screen.getByTestId('lock-guide'))
    await waitFor(() => {
      expect(screen.getByTestId('start-screen')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('start-goal-new-wallet'))
    fireEvent.click(screen.getByTestId('start-begin'))
    await waitFor(() => {
      expect(screen.getByTestId('setup-screen')).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('network-signet'))
    fireEvent.click(screen.getByTestId('setup-start'))

    await waitFor(() => {
      expect(screen.getByTestId('dice-screen')).toBeTruthy()
    })
    expect(lastCall('network.set')?.params).toEqual({ id: 'signet' })

    const indicator = screen.getByTestId('journey-steps').textContent
    expect(indicator).toContain('Step 2 of 4')
    expect(indicator).toContain('Roll the dice')
  })

  /**
   * INV-UI-65. Walking off the journey's path stops the counter rather than
   * having it describe a position the user is not in.
   */
  it('stops-counting-when-the-user-leaves-the-path', async () => {
    await boot()
    fireEvent.click(screen.getByTestId('lock-guide'))
    await waitFor(() => {
      expect(screen.getByTestId('start-screen')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('start-goal-new-wallet'))
    fireEvent.click(screen.getByTestId('start-begin'))
    await waitFor(() => {
      expect(screen.getByTestId('journey-steps')).toBeTruthy()
    })

    // Straight to importing, which is step one of a DIFFERENT journey.
    fireEvent.click(screen.getByTestId('mode-import'))
    fireEvent.click(screen.getByTestId('setup-start'))
    await waitFor(() => {
      expect(screen.getByTestId('import-screen')).toBeTruthy()
    })
    expect(screen.queryByTestId('journey-steps')).toBeNull()
  })

  it('lets-the-hub-be-skipped-into-the-device', async () => {
    await boot()
    fireEvent.click(screen.getByTestId('lock-guide'))
    await waitFor(() => {
      expect(screen.getByTestId('start-screen')).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('start-skip'))
    // No wallet on this device, so the picker, which is what offers to make one.
    await waitFor(() => {
      expect(screen.getByTestId('wallets-screen')).toBeTruthy()
    })
    expect(screen.queryByTestId('journey-steps')).toBeNull()
  })
})

describe('ui.app the wallet store', () => {
  /**
   * INV-UI-66. Saving a newly created wallet calls `wallets.create`, never
   * `store.create`.
   *
   * The two address different files. `store.*` works on the blob at the root of
   * the store directory and is refused outright once the device can hold named
   * wallets, which it always can. This shell called the refused one for a
   * while: saving a wallet failed on a real device while every test in the
   * repository passed, because none of them was this one.
   */
  it('saves-a-new-wallet-through-the-multi-wallet-api', async () => {
    replies.set('entropy.fromDice', { ok: true })
    replies.set('seed.reveal', {
      words: Array.from({ length: 12 }, () => 'abandon'),
      fingerprint: '73c5da0a',
    })
    replies.set('seed.confirmBackup', { confirmed: true })
    replies.set('wallets.create', {
      id: 'a'.repeat(16),
      active: { id: 'a'.repeat(16), label: 'Wallet', colour: 'slate' },
    })

    await boot()
    fireEvent.click(screen.getByTestId('unlock'))
    await waitFor(() => {
      expect(screen.getByTestId('wallets-screen')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('wallets-add'))
    await waitFor(() => {
      expect(screen.getByTestId('setup-screen')).toBeTruthy()
    })

    // Import rather than dice: 100 rolls is not what this test is about.
    replies.set('wallet.import', { fingerprint: '73c5da0a' })
    fireEvent.click(screen.getByTestId('mode-import'))
    fireEvent.click(screen.getByTestId('setup-start'))
    await waitFor(() => {
      expect(screen.getByTestId('import-screen')).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('import-typed-toggle'))
    fireEvent.change(screen.getByTestId('import-mnemonic'), {
      target: { value: Array.from({ length: 12 }, () => 'abandon').join(' ') },
    })
    fireEvent.click(screen.getByTestId('import-submit'))

    await waitFor(() => {
      expect(screen.getByTestId('passphrase-screen')).toBeTruthy()
    })
    fireEvent.change(screen.getByTestId('passphrase-input'), { target: { value: 'correct horse' } })
    fireEvent.change(screen.getByTestId('passphrase-confirm'), {
      target: { value: 'correct horse' },
    })
    fireEvent.click(screen.getByTestId('passphrase-submit'))

    await waitFor(() => {
      expect(lastCall('wallets.create')).toBeDefined()
    })
    // The refused API is never touched.
    expect(calls.map((c) => c.method)).not.toContain('store.create')
    expect(lastCall('wallets.create')?.params).toMatchObject({ passphrase: 'correct horse' })
  })
})

/**
 * Getting out, from anywhere.
 *
 * The device has no browser back button, no window to close, no gesture and no
 * keyboard. A screen that renders no way out is a power cycle, and the setup
 * screen shipped exactly like that: tapping "add a wallet" from the picker and
 * changing your mind left you on it permanently.
 *
 * Nothing caught that. The screen tests exercised the path forward, the layout
 * check confirmed its one button fitted, and these shell tests walked through
 * rather than turning around.
 */
describe('ui.app getting home', () => {
  async function reach(testId: string): Promise<void> {
    await boot()
    fireEvent.click(screen.getByTestId('unlock'))
    await waitFor(() => {
      expect(screen.getByTestId('wallets-screen')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId(testId))
  }

  /**
   * INV-UI-67. The setup screen can be left. This is the regression that
   * prompted the whole check.
   */
  it('leaves-the-setup-screen-that-used-to-trap-people', async () => {
    await reach('wallets-add')
    await waitFor(() => {
      expect(screen.getByTestId('setup-screen')).toBeTruthy()
    })

    // Two ways out, and both work: the menu, and Cancel in the action bar.
    expect(screen.getByTestId('nav-menu-button')).toBeTruthy()
    fireEvent.click(screen.getByTestId('setup-cancel'))
    await waitFor(() => {
      expect(screen.getByTestId('wallets-screen')).toBeTruthy()
    })
  })

  /**
   * INV-UI-67. The picker is reachable from a screen deep in a flow.
   *
   * THROUGH THE WALLET NAME, which is the route that replaced a Home button.
   * With nothing open the menu offers the guide and the device's settings and
   * nothing about a wallet, deliberately, so the chip naming the open wallet
   * is what leads to the list of them.
   */
  it('goes-home-from-a-screen-deep-in-a-flow', async () => {
    await reach('wallets-add')
    await waitFor(() => {
      expect(screen.getByTestId('setup-screen')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('mode-import'))
    fireEvent.click(screen.getByTestId('setup-start'))
    await waitFor(() => {
      expect(screen.getByTestId('import-screen')).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('identity-switch'))
    await waitFor(() => {
      expect(screen.getByTestId('wallets-screen')).toBeTruthy()
    })
  })

  /**
   * INV-UI-68. Leaving ends the journey. A step counter that survived would
   * reappear on an unrelated screen claiming the user is three steps into
   * something they walked away from.
   */
  it('ends-the-journey-rather-than-leaving-the-counter-running', async () => {
    await boot()
    fireEvent.click(screen.getByTestId('lock-guide'))
    await waitFor(() => {
      expect(screen.getByTestId('start-screen')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('start-goal-new-wallet'))
    fireEvent.click(screen.getByTestId('start-begin'))
    await waitFor(() => {
      expect(screen.getByTestId('journey-steps')).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('identity-switch'))
    await waitFor(() => {
      expect(screen.getByTestId('wallets-screen')).toBeTruthy()
    })
    expect(screen.queryByTestId('journey-steps')).toBeNull()

    // And going back into a flow starts it from the beginning rather than
    // resuming a journey that was abandoned.
    fireEvent.click(screen.getByTestId('wallets-add'))
    await waitFor(() => {
      expect(screen.getByTestId('setup-screen')).toBeTruthy()
    })
    expect(screen.queryByTestId('journey-steps')).toBeNull()
  })

  /**
   * INV-UI-68. The seed screen deliberately has no way out. The words are shown
   * once and leaving loses them, so the only exit is confirming they are
   * written down: an escape hatch beside that would be the easier tap.
   *
   * The OTHER exit on that screen, the tappable wallet name, is checked in two
   * cheaper places rather than here: tools/checks/check-header-rule.mjs proves the
   * wiring in App.tsx, and the Identity tests prove the component renders no
   * control without an onSwitch. Reaching the real seed screen from here costs
   * a hundred dice rolls and a passphrase for one assertion.
   */
  it('offers-no-escape-from-the-screen-showing-the-words', async () => {
    replies.set('wallet.import', { fingerprint: '73c5da0a' })
    replies.set('seed.reveal', {
      words: Array.from({ length: 12 }, () => 'abandon'),
      fingerprint: '73c5da0a',
    })
    replies.set('entropy.fromDice', { ok: true })

    await boot()
    fireEvent.click(screen.getByTestId('unlock'))
    await waitFor(() => {
      expect(screen.getByTestId('wallets-screen')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('wallets-add'))
    await waitFor(() => {
      expect(screen.getByTestId('setup-screen')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('setup-start'))
    await waitFor(() => {
      expect(screen.getByTestId('dice-screen')).toBeTruthy()
    })
    // The dice screen can be left; that is the point of the contrast. Rolling
    // again is a tedious afternoon, not a loss.
    expect(screen.getByTestId('nav-menu-button')).toBeTruthy()
  })

  /**
   * INV-UI-95. A device fresh out of the box can still reach the picker.
   *
   * It has no name and no wallet open, and the menu withholds every wallet
   * destination until one is. The chip used to render nothing at all in that
   * case, which left setup and import with a menu that led nowhere and no
   * other way back: the exact dead end this header was built to end,
   * reintroduced by the thing that was supposed to end it.
   */
  it('reaches-the-picker-from-a-device-with-no-name-and-no-wallet', async () => {
    await reach('wallets-add')
    await waitFor(() => {
      expect(screen.getByTestId('setup-screen')).toBeTruthy()
    })

    const chip = screen.getByTestId('identity-switch')
    expect(chip.textContent).toContain('No wallet open')

    fireEvent.click(chip)
    await waitFor(() => {
      expect(screen.getByTestId('wallets-screen')).toBeTruthy()
    })
  })
})

/**
 * Moving between the wallets on one device, and checking the device itself.
 *
 * A device holds up to eight wallets and there was no route between them:
 * switching meant locking and starting again, which is a strange thing to have
 * to do to look at a different wallet you own. And the manifest root was shown
 * once, on the lock screen, before a passphrase, and then gone for the session.
 */
describe('ui.app switching and checking', () => {
  async function intoWallet(): Promise<void> {
    replies.set('device.status', {
      hasWallet: true,
      network: { id: 'mainnet', label: 'Mainnet', isMainnet: true },
    })
    await boot()
    fireEvent.click(screen.getByTestId('unlock'))
    await waitFor(() => {
      expect(screen.getByTestId('wallet-screen')).toBeTruthy()
    })
    // Through the MENU, which is how somebody reaches More now. It used to be
    // the fourth tab of the wallet screen, which put the same word in two
    // places once there was navigation.
    fireEvent.click(screen.getByTestId('nav-menu-button'))
    fireEvent.click(screen.getByTestId('nav-more'))
    await waitFor(() => {
      expect(screen.getByTestId('more-screen')).toBeTruthy()
    })
  }

  /**
   * INV-UI-71. Switching wallets locks the session first.
   *
   * Two seeds resident at once is the state from which a device signs with the
   * wrong one. `wallets.unlock` locks anyway, so doing it here also means the
   * picker is never showing a wallet as open that the next tap replaces.
   */
  it('locks-before-showing-the-picker', async () => {
    await intoWallet()

    fireEvent.click(screen.getByTestId('wallet-switch'))
    await waitFor(() => {
      expect(screen.getByTestId('wallets-screen')).toBeTruthy()
    })
    expect(lastCall('session.lock')).toBeDefined()
  })

  /**
   * INV-UI-71. A switch that fails leaves nothing open, and the screen says so.
   * The daemon locks before it tries the new wallet, so a wrong passphrase for
   * the second wallet has closed the first. The menu kept offering the first
   * one's actions and the wallet screen kept showing its fingerprint, on a
   * device holding no seed at all.
   */
  it('shows-nothing-open-after-a-switch-that-failed', async () => {
    const OTHER = {
      id: 'b'.repeat(16),
      label: 'Other',
      colour: 'slate',
      network: 'mainnet',
      exists: true,
      attemptsRemaining: 10,
      destroyed: false,
      bip39Passphrase: false,
    }
    replies.set('wallets.list', {
      migrated: null,
      migrationError: null,
      max: 8,
      active: null,
      wallets: [OTHER],
      verified: false,
      note: '',
    })
    await intoWallet()
    fireEvent.click(screen.getByTestId('nav-menu-button'))
    expect(screen.getByTestId('nav-wallet')).toBeTruthy()
    fireEvent.click(screen.getByTestId('nav-menu-button'))

    // Straight to the picker from the header, which is the route that does not
    // lock first. wallets.unlock locks, then refuses.
    fireEvent.click(screen.getByTestId('identity-switch'))
    await waitFor(() => {
      expect(screen.getByTestId(`wallet-row-${OTHER.id}`)).toBeTruthy()
    })
    replies.set('device.status', {
      hasWallet: false,
      unlocked: false,
      fingerprint: null,
      network: { id: 'mainnet', label: 'Mainnet', isMainnet: true },
      activeWallet: null,
    })
    replies.set('wallets.unlock', new Error('Wrong passphrase.'))
    fireEvent.click(screen.getByTestId(`wallet-row-${OTHER.id}`))
    fireEvent.click(screen.getByTestId('pk-key-a'))
    fireEvent.click(screen.getByTestId('wallet-unlock-submit'))
    await waitFor(() => {
      expect(document.body.textContent).toContain('Wrong passphrase')
    })

    fireEvent.click(screen.getByTestId('nav-menu-button'))
    await waitFor(() => {
      expect(screen.queryByTestId('nav-wallet')).toBeNull()
    })
    expect(screen.queryByTestId('nav-sign')).toBeNull()
  })

  /**
   * INV-UI-71. Leaving the picker goes back to the wallet when one is open.
   * It always went to the lock screen, which is the picker deciding to log
   * somebody out for having changed their mind.
   */
  it('returns-to-the-wallet-rather-than-logging-you-out', async () => {
    await intoWallet()
    fireEvent.click(screen.getByTestId('wallet-check-device'))
    await waitFor(() => {
      expect(screen.getByTestId('attestation-screen')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('attestation-back'))
    await waitFor(() => {
      expect(screen.getByTestId('wallet-screen')).toBeTruthy()
    })
  })

  /**
   * INV-UI-72. The attestation is reachable after unlocking, and shows the same
   * hash the lock screen did rather than fetching a second opinion.
   */
  it('shows-the-same-attestation-the-lock-screen-showed', async () => {
    await intoWallet()

    const before = calls.filter((c) => c.method === 'attestation.get').length
    fireEvent.click(screen.getByTestId('wallet-check-device'))
    await waitFor(() => {
      expect(screen.getByTestId('attestation-screen')).toBeTruthy()
    })

    expect(document.body.textContent).toContain('aaaa')
    // Not re-fetched. A second call could return something different from what
    // the user was shown at the lock screen, and then which one is the device?
    expect(calls.filter((c) => c.method === 'attestation.get').length).toBe(before)
  })
})

/**
 * The camera, on the screens that need it.
 *
 * `forStage` was `'psbt'` and nothing else, so on a device whose primary
 * transport is a QR code exactly one screen could use the camera. A descriptor,
 * a coordinator setup file, an encrypted backup and a label file all arrive the
 * same way and all took pasted text only, which on a machine with no keyboard
 * means tapping a 200 character descriptor into an on-screen keyboard.
 */
describe('ui.app scanning', () => {
  async function intoWallet(): Promise<void> {
    replies.set('device.status', {
      hasWallet: true,
      network: { id: 'mainnet', label: 'Mainnet', isMainnet: true },
    })
    replies.set('multisig.ourKey', {
      xpub: 'xpub6E64',
      path: "m/48'/0'/0'/2'",
      masterFingerprint: '73c5da0a',
      keyExpression: "[73c5da0a/48'/0'/0'/2']xpub6E64",
    })
    await boot()
    fireEvent.click(screen.getByTestId('unlock'))
    await waitFor(() => {
      expect(screen.getByTestId('wallet-screen')).toBeTruthy()
    })
    // Through the MENU, which is how somebody reaches More now. It used to be
    // the fourth tab of the wallet screen, which put the same word in two
    // places once there was navigation.
    fireEvent.click(screen.getByTestId('nav-menu-button'))
    fireEvent.click(screen.getByTestId('nav-more'))
    await waitFor(() => {
      expect(screen.getByTestId('more-screen')).toBeTruthy()
    })
  }

  /**
   * INV-UI-73. Every screen that takes a pasted file can reach the camera, and
   * the camera names what it is being pointed at.
   */
  it('reaches-the-camera-from-a-screen-that-takes-a-file', async () => {
    await intoWallet()
    fireEvent.click(screen.getByTestId('wallet-labels'))
    await waitFor(() => {
      expect(screen.getByTestId('labels-screen')).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('labels-scan'))
    await waitFor(() => {
      expect(screen.getByTestId('scan-screen')).toBeTruthy()
    })
    // Not "Scan a transaction", which is what it said whatever you scanned.
    expect(document.body.textContent).toContain('Scan a label file')
    expect(document.body.textContent).not.toContain('Scan a transaction')
  })

  /**
   * INV-UI-73. Cancelling the camera goes back to the screen that opened it,
   * not to a fixed destination.
   */
  it('returns-to-the-screen-that-opened-the-camera', async () => {
    await intoWallet()
    fireEvent.click(screen.getByTestId('wallet-backup'))
    await waitFor(() => {
      expect(screen.getByTestId('backup-screen')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('backup-choose-restore'))
    fireEvent.click(screen.getByTestId('backup-scan'))
    await waitFor(() => {
      expect(screen.getByTestId('scan-screen')).toBeTruthy()
    })
    expect(document.body.textContent).toContain('Scan a backup')

    fireEvent.click(screen.getByTestId('scan-cancel'))
    await waitFor(() => {
      expect(screen.getByTestId('backup-screen')).toBeTruthy()
    })
  })

  it('offers-the-camera-on-the-multisig-descriptor-field', async () => {
    await intoWallet()
    fireEvent.click(screen.getByTestId('wallet-multisig'))
    await waitFor(() => {
      expect(screen.getByTestId('multisig-screen')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('multisig-scan'))
    await waitFor(() => {
      expect(screen.getByTestId('scan-screen')).toBeTruthy()
    })
    expect(document.body.textContent).toContain('Scan a descriptor')
  })
})

/**
 * Registering a quorum, through the shell to the daemon.
 *
 * THE BUG THIS EXISTS FOR. `multisig.register` writes into the sealed wallet
 * only when it is handed the wallet's passphrase. The shell sent the descriptor
 * alone and dropped the `persisted` the daemon answered with, so every quorum
 * registered on the device was held for the session and gone at the next lock,
 * while the screen said the device would recognise it from now on.
 */
describe('ui.app registering a quorum', () => {
  const DESCRIPTOR = 'wsh(sortedmulti(2,a,b,c))#checksum'

  async function intoMultisig(activeWallet: Record<string, string> | null): Promise<void> {
    replies.set('device.status', {
      hasWallet: true,
      network: { id: 'mainnet', label: 'Mainnet', isMainnet: true },
      activeWallet,
    })
    replies.set('multisig.ourKey', {
      xpub: 'xpub6E64',
      path: "m/48'/0'/0'/2'",
      masterFingerprint: '73c5da0a',
      keyExpression: "[73c5da0a/48'/0'/0'/2']xpub6E64",
    })
    replies.set('multisig.review', {
      descriptor: DESCRIPTOR,
      threshold: 2,
      total: 3,
      sorted: true,
      kind: 'wsh',
      ourPosition: 1,
      cosigners: [],
      warnings: [],
    })
    await boot()
    fireEvent.click(screen.getByTestId('unlock'))
    await waitFor(() => {
      expect(screen.getByTestId('wallet-screen')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('nav-menu-button'))
    fireEvent.click(screen.getByTestId('nav-more'))
    await waitFor(() => {
      expect(screen.getByTestId('more-screen')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('wallet-multisig'))
    await waitFor(() => {
      expect(screen.getByTestId('multisig-screen')).toBeTruthy()
    })
    fireEvent.change(screen.getByTestId('multisig-input'), { target: { value: DESCRIPTOR } })
    fireEvent.click(screen.getByTestId('multisig-review'))
    await waitFor(() => {
      expect(screen.getByTestId('multisig-quorum')).toBeTruthy()
    })
  }

  /**
   * INV-UI-104. With a saved wallet open, the passphrase typed on the device
   * reaches `multisig.register`, and the finished panel says saved because the
   * daemon said `persisted: true`.
   */
  it('sends-the-passphrase-for-a-saved-wallet-and-reports-what-the-daemon-said', async () => {
    replies.set('multisig.register', { descriptor: DESCRIPTOR, persisted: true })
    await intoMultisig({ id: 'w1', label: 'Cold storage', colour: 'teal' })

    fireEvent.click(screen.getByTestId('multisig-agree'))
    for (const key of 'abc') fireEvent.click(screen.getByTestId(`pk-key-${key}`))
    fireEvent.click(screen.getByTestId('multisig-register'))

    await waitFor(() => {
      expect(screen.getByTestId('multisig-outcome-saved')).toBeTruthy()
    })
    expect(lastCall('multisig.register')?.params).toEqual({
      descriptor: DESCRIPTOR,
      passphrase: 'abc',
    })
  })

  /**
   * INV-UI-104. With no saved wallet open, no passphrase is sent, because the
   * daemon refuses one it has nowhere to use, and an answer with no
   * `persisted: true` in it reads as session only.
   */
  it('sends-no-passphrase-without-a-saved-wallet-and-says-session-only', async () => {
    replies.set('multisig.register', { descriptor: DESCRIPTOR })
    await intoMultisig(null)

    fireEvent.click(screen.getByTestId('multisig-register'))
    await waitFor(() => {
      expect(screen.getByTestId('multisig-outcome-session')).toBeTruthy()
    })
    expect(lastCall('multisig.register')?.params).toEqual({ descriptor: DESCRIPTOR })
  })
})

/**
 * A journey that operates on a wallet, started with none open.
 *
 * The hub used to disable the button and say "open a wallet first". That is a
 * refusal, and a guide that stops at its own first prerequisite has failed at
 * the one thing it exists to do. On a cold storage device, signing needing a
 * key in memory is the ordinary state of the machine, not an obstacle worth
 * reporting to somebody who just asked to sign something.
 */
describe('ui.app opening a wallet inside a journey', () => {
  const WALLET = {
    id: 'a'.repeat(16),
    label: 'Cold storage',
    colour: 'teal',
    network: 'mainnet',
    exists: true,
    attemptsRemaining: 10,
    destroyed: false,
    bip39Passphrase: false,
  }

  /**
   * INV-UI-77. The journey absorbs opening a wallet as its first step, counts
   * it, and carries on into the step that follows once it is open.
   */
  it('walks-through-opening-a-wallet-and-continues-the-flow', async () => {
    replies.set('wallets.list', {
      migrated: null,
      migrationError: null,
      max: 8,
      active: null,
      wallets: [WALLET],
      verified: false,
      note: 'Not verified until you open one.',
    })
    replies.set('wallets.unlock', {
      unlocked: true,
      active: { id: WALLET.id, label: WALLET.label, colour: 'teal' },
      fingerprint: '73c5da0a',
      registrations: 0,
      hintCorrected: false,
      labelVerified: true,
      bip39Passphrase: false,
      network: { id: 'mainnet', label: 'Mainnet', isMainnet: true },
    })

    await boot()
    fireEvent.click(screen.getByTestId('lock-guide'))
    await waitFor(() => {
      expect(screen.getByTestId('start-screen')).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('start-goal-sign'))
    // Not refused, and the extra step is visible before starting.
    expect(screen.getByTestId<HTMLButtonElement>('start-begin').disabled).toBe(false)
    expect(screen.getByTestId('start-steps').textContent).toContain('Open a wallet')
    fireEvent.click(screen.getByTestId('start-begin'))

    // Step one is the picker, and the counter says so.
    await waitFor(() => {
      expect(screen.getByTestId(`wallet-row-${WALLET.id}`)).toBeTruthy()
    })
    const first = screen.getByTestId('journey-steps').textContent
    expect(first).toContain('Step 1 of 4')
    expect(first).toContain('Open a wallet')

    fireEvent.click(screen.getByTestId(`wallet-row-${WALLET.id}`))
    fireEvent.change(screen.getByTestId('wallet-unlock-keyboard'), { target: {} })
    fireEvent.click(screen.getByTestId('pk-key-a'))
    fireEvent.click(screen.getByTestId('wallet-unlock-submit'))

    // The fingerprint gate is still shown. It is the only place a mistyped
    // BIP-39 passphrase surfaces, and that is true inside a journey too.
    await waitFor(() => {
      expect(screen.getByTestId('unlocked-screen')).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('unlocked-continue'))
    // Straight into signing, not onto the wallet screen. Landing there would be
    // the flow giving up one step in, which is what the refusal used to do.
    await waitFor(() => {
      expect(screen.getByTestId('psbt-screen')).toBeTruthy()
    })
    const next = screen.getByTestId('journey-steps').textContent
    expect(next).toContain('Step 2 of 4')
    expect(next).toContain('Load the transaction')
  })
})

/**
 * Which device is this.
 *
 * Three nullroute boxes holding one 2-of-3 hold the same wallet, so they show
 * the same wallet name, the same colour and the same fingerprint. Nothing on
 * any screen said which of the three objects was in your hand.
 */
describe('ui.app device identity', () => {
  /**
   * INV-UI-78. Read and shown BEFORE any passphrase, because the moment
   * somebody picks a device up is the moment they want to know which one it is.
   */
  it('shows-the-device-name-before-any-passphrase', async () => {
    replies.set('device.identity', {
      identity: { name: 'The one in the attic', colour: 'teal' },
      named: true,
      verified: false,
      note: 'Not verified.',
    })

    await boot()
    // On the lock screen, before anything is unlocked.
    expect(screen.getByTestId('identity-switch').textContent).toContain('The one in the attic')
  })

  /**
   * An unnamed device shows no chip rather than a placeholder. A device with
   * one wallet and no siblings has no use for a name, and "unnamed" in the
   * header of every screen would be noise claiming a problem.
   */
  it('shows-nothing-when-the-device-has-no-name', async () => {
    replies.set('device.identity', { identity: null, named: false, verified: false, note: '' })
    await boot()
    expect(screen.queryByTestId('screen-device')).toBeNull()
  })

  /**
   * A daemon too old to know the method, or one without storage, must not stop
   * the device booting. The name decides nothing, so failing to read it is not
   * a reason to refuse to start.
   */
  it('boots-when-the-daemon-cannot-answer-about-its-name', async () => {
    replies.delete('device.identity')
    await boot()
    expect(screen.getByTestId('lock-screen')).toBeTruthy()
    expect(screen.queryByTestId('screen-device')).toBeNull()
  })
})

/**
 * Which quorums the Receive screen is given, and for which wallet.
 *
 * TWO DEFECTS, ONE CAUSE. The list was read when the wallet screen was entered
 * and cleared by some of the paths that close a wallet. So a journey that went
 * from unlocking straight to Receive never read it, and a wallet closed by the
 * idle lock left its quorum behind for the next wallet's Receive screen to
 * offer as where money should go.
 */
describe('ui.app which quorums Receive offers', () => {
  const NET = { id: 'mainnet', label: 'Mainnet', isMainnet: true }
  const JOINT = {
    id: 'a'.repeat(16),
    label: 'Joint',
    colour: 'teal',
    network: 'mainnet',
    exists: true,
    attemptsRemaining: 10,
    destroyed: false,
    bip39Passphrase: false,
  }
  const SPENDING = { ...JOINT, id: 'b'.repeat(16), label: 'Spending', colour: 'slate' }
  const QUORUM = {
    descriptor: 'wsh(sortedmulti(2,A,B,C))#aaaaqqqq',
    checksum: 'aaaaqqqq',
    cosigners: [],
    threshold: 2,
    total: 3,
    ourPosition: 1,
    kind: 'wsh',
    sorted: true,
    unreadable: null,
  }

  /** Script the daemon's answers for this wallet being the one that opens. */
  function opens(wallet: typeof JOINT, fingerprint: string): void {
    replies.set('wallets.unlock', {
      unlocked: true,
      active: { id: wallet.id, label: wallet.label, colour: wallet.colour },
      fingerprint,
      registrations: 0,
      hintCorrected: false,
      labelVerified: true,
      bip39Passphrase: false,
    })
    replies.set('device.status', {
      hasWallet: true,
      unlocked: true,
      fingerprint,
      network: NET,
      activeWallet: { id: wallet.id, label: wallet.label, colour: wallet.colour },
    })
  }

  /** Guide me > Receive money, through the picker, from wherever the menu is. */
  async function receiveJourney(wallet: typeof JOINT): Promise<void> {
    fireEvent.click(screen.getByTestId('nav-menu-button'))
    fireEvent.click(screen.getByTestId('nav-guide'))
    await waitFor(() => {
      expect(screen.getByTestId('start-screen')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('start-goal-receive'))
    fireEvent.click(screen.getByTestId('start-begin'))
    await waitFor(() => {
      expect(screen.getByTestId(`wallet-row-${wallet.id}`)).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId(`wallet-row-${wallet.id}`))
    fireEvent.click(screen.getByTestId('pk-key-a'))
    fireEvent.click(screen.getByTestId('wallet-unlock-submit'))
    await waitFor(() => {
      expect(screen.getByTestId('unlocked-screen')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('unlocked-continue'))
  }

  beforeEach(() => {
    replies.set('wallets.list', {
      migrated: null,
      migrationError: null,
      max: 8,
      active: null,
      wallets: [JOINT, SPENDING],
      verified: false,
      note: '',
    })
    replies.set('multisig.addresses', {
      addresses: [{ address: 'bc1qquorumaddressforjoint', index: 0 }],
    })
    replies.set('wallet.addresses', {
      addresses: [{ address: 'bc1qsinglesigforspending', path: "m/84'/0'/0'/0/0", index: 0 }],
    })
  })

  /**
   * INV-UI-88. A wallet in a quorum reached through Guide me > Receive money,
   * which never passes the wallet screen, is still offered its quorum, and
   * Receive waits for the list rather than settling on this device's own key
   * while it is on its way.
   */
  it('reads-the-quorums-of-a-wallet-opened-on-the-way-to-receive', async () => {
    replies.set('multisig.registrations', { descriptors: [QUORUM.descriptor], quorums: [QUORUM] })
    // The list is held back until the test lets it go, so the screen is seen
    // in the moment between the wallet opening and the answer arriving.
    let release = (): void => undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const answer = globalThis.fetch
    vi.stubGlobal('fetch', async (url: string, init: RequestInit & { body: string }) => {
      const { method } = JSON.parse(init.body) as { method: string }
      if (method === 'multisig.registrations') await held
      return answer(url, init)
    })

    await boot()
    opens(JOINT, 'aaaaaaaa')
    await receiveJourney(JOINT)

    await waitFor(() => {
      expect(screen.getByTestId('receive-waiting')).toBeTruthy()
    })
    expect(calls.some((c) => c.method === 'wallet.addresses')).toBe(false)

    release()
    await waitFor(() => {
      expect(screen.getByTestId('receive-address').textContent).toContain('quor')
    })
    expect(screen.getByTestId('receive-source-aaaaqqqq')).toBeTruthy()
    expect(lastCall('multisig.addresses')?.params).toMatchObject({
      descriptor: QUORUM.descriptor,
    })
    expect(calls.some((c) => c.method === 'wallet.addresses')).toBe(false)
  })

  /**
   * INV-UI-88. A wallet closed by the idle lock takes its quorums with it. The
   * idle lock was one of the paths that did not clear them, and the next
   * wallet's Receive screen offered the old wallet's 2-of-3 as the default.
   */
  it('does-not-offer-one-wallets-quorum-on-the-next-wallets-receive-screen', async () => {
    opens(JOINT, 'aaaaaaaa')
    replies.set('multisig.registrations', { descriptors: [QUORUM.descriptor], quorums: [QUORUM] })
    // A one second idle window, so the lock fires on its own.
    replies.set('session.heartbeat', { idle: { seconds: 1, warnAt: 0 } })
    await boot()
    fireEvent.click(screen.getByTestId('unlock'))
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'multisig.registrations')).toBe(true)
    })

    replies.set('device.status', {
      hasWallet: false,
      unlocked: false,
      fingerprint: null,
      network: NET,
      activeWallet: null,
    })
    await waitFor(
      () => {
        expect(screen.getByTestId('wallets-screen')).toBeTruthy()
      },
      { timeout: 5000 }
    )

    replies.set('session.heartbeat', { idle: { seconds: 600, warnAt: 60 } })
    replies.set('multisig.registrations', { descriptors: [], quorums: [] })
    opens(SPENDING, 'bbbbbbbb')
    await receiveJourney(SPENDING)

    await waitFor(() => {
      expect(screen.getByTestId('receive-address').textContent).toContain('sing')
    })
    expect(screen.queryByTestId('receive-source-aaaaqqqq')).toBeNull()
    expect(screen.queryByTestId('receive-sources')).toBeNull()
    expect(calls.some((c) => c.method === 'multisig.addresses')).toBe(false)
  }, 15_000)
})
