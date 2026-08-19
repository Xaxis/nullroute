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
    replies.set('seed.reveal', { words: Array.from({ length: 12 }, () => 'abandon'), fingerprint: '73c5da0a' })
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
