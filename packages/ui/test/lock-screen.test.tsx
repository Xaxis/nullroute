/**
 * Tests for ui.screens.lock.
 *
 * The lock screen's job is to put three numbers in front of a user before they
 * enter a PIN. These tests assert the numbers are there, that a failed
 * verification blocks the wallet rather than warning about it, and that the
 * non-mainnet banner cannot be missed.
 */

import { describe, expect, it, afterEach, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LockScreen, type AttestationView } from '../src/screens/LockScreen.js'
import { chunk, abbreviate } from '../src/components/Hash.js'

afterEach(cleanup)

const ROOT_HASH = '9c46304078497172c607c3e56da0ea708a79825ffdb49fe2f684cc8a007b04de'

const passing: AttestationView = {
  rootHash: ROOT_HASH,
  rootHashShort: '9c463040...007b04de',
  specCount: 7,
  invariantCount: 38,
  tier: 'signer',
  version: '0.1.0',
  checks: [
    { name: 'coverage', status: 'passed', detail: '' },
    { name: 'invariants', status: 'passed', detail: '' },
    { name: 'differential', status: 'not-applicable', detail: '' },
  ],
}

const mainnet = { id: 'mainnet' as const, label: 'Mainnet', isMainnet: true }
const signet = { id: 'signet' as const, label: 'Signet', isMainnet: false }

describe('ui.screens.lock', () => {
  // INV-UI-1: the whole reason this screen exists.
  it('shows-the-manifest-root-hash', () => {
    render(<LockScreen attestation={passing} network={mainnet} onUnlock={() => undefined} />)
    const el = screen.getByTestId('manifest-root-hash')
    // Chunked, so a person can compare it. The first and last eight characters
    // are what actually gets checked.
    expect(el.textContent.replace(/\s/g, '')).toContain('9c463040')
    expect(el.textContent.replace(/\s/g, '')).toContain('007b04de')
  })

  it('expands-to-the-full-hash', () => {
    const onToggle = vi.fn()
    render(
      <LockScreen
        attestation={passing}
        network={mainnet}
        onUnlock={() => undefined}
        expanded={true}
        onToggleExpanded={onToggle}
      />
    )
    const el = screen.getByTestId('manifest-root-hash')
    expect(el.textContent.replace(/\s/g, '')).toBe(ROOT_HASH)
    fireEvent.click(el)
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('shows-verification-status-and-tier', () => {
    render(<LockScreen attestation={passing} network={mainnet} onUnlock={() => undefined} />)
    expect(screen.getByTestId('verification-status').textContent).toContain('passed')
    // The counts are shown as facts beside the hash rather than repeated in the
    // status line, which spends its one line on the verdict.
    expect(screen.getByTestId('attestation-facts').textContent).toContain('38')
    // A user can tell from this screen whether wallet code is present.
    expect(screen.getByTestId('tier').textContent).toContain('signer only')
  })

  // INV-UI-2: a failed verification blocks the wallet. It does not warn.
  it('blocks-unlock-when-verification-failed', () => {
    const onUnlock = vi.fn()
    const failed: AttestationView = {
      ...passing,
      checks: [{ name: 'integrity', status: 'failed', detail: 'hash mismatch' }],
    }
    render(<LockScreen attestation={failed} network={mainnet} onUnlock={onUnlock} />)

    const button = screen.getByTestId<HTMLButtonElement>('unlock')
    // Asserted on the DOM property rather than through a matcher library. One
    // fewer dependency, and this is what the browser actually checks.
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(onUnlock).not.toHaveBeenCalled()

    expect(screen.getByTestId('blocked').textContent).toContain('Do not enter your PIN')
    expect(screen.getByTestId('verification-status').textContent).toContain('integrity')
  })

  it('unlocks-when-verification-passed', () => {
    const onUnlock = vi.fn()
    render(<LockScreen attestation={passing} network={mainnet} onUnlock={onUnlock} />)
    fireEvent.click(screen.getByTestId('unlock'))
    expect(onUnlock).toHaveBeenCalledOnce()
  })

  // INV-UI-3: a test wallet can never be mistaken for a real one.
  it('shows-a-persistent-banner-off-mainnet', () => {
    render(<LockScreen attestation={passing} network={signet} onUnlock={() => undefined} />)
    const banner = screen.getByTestId('network-banner')

    // The invariant is that the banner NAMES the network. That is the whole
    // job: signet, testnet3 and testnet4 produce identical addresses, so
    // nothing about an address, an xpub or a path can recover which was meant,
    // and this label is the only carrier of that fact.
    expect(banner.textContent).toContain('Signet')

    // And names this one specifically. A banner that listed every test network
    // would satisfy a substring check while telling the user nothing.
    expect(banner.textContent).not.toContain('Testnet3')
    expect(banner.textContent).not.toContain('Testnet4')

    // It also has to say the coins are not real, or naming the network is
    // trivia rather than a warning.
    expect(banner.textContent.toLowerCase()).toContain('worth nothing')
  })

  it('shows-no-banner-on-mainnet', () => {
    render(<LockScreen attestation={passing} network={mainnet} onUnlock={() => undefined} />)
    expect(screen.queryByTestId('network-banner')).toBeNull()
  })

  // INV-UI-4: the only signal a user gets that a passphrase was mistyped.
  it('shows-the-wallet-fingerprint-before-unlock', () => {
    render(
      <LockScreen
        attestation={passing}
        network={mainnet}
        fingerprint="b8688df1"
        onUnlock={() => undefined}
      />
    )
    expect(screen.getByTestId('fingerprint').textContent).toBe('b8688df1')
  })

  it('states-the-limit-of-what-these-numbers-prove', () => {
    render(<LockScreen attestation={passing} network={mainnet} onUnlock={() => undefined} />)
    // The caveat is on the screen, not only in the docs. Overclaiming here
    // would be the most consequential place in the product to do it.
    expect(document.body.textContent).toContain('reported by the software you are looking at')
  })
})

describe('ui.components.hash', () => {
  it('chunks-in-groups-of-four', () => {
    expect(chunk('9c46304078497172')).toBe('9c46 3040 7849 7172')
    expect(chunk('abc')).toBe('abc')
  })

  it('abbreviates-to-first-and-last-eight', () => {
    expect(abbreviate(ROOT_HASH)).toBe('9c463040...007b04de')
    expect(abbreviate('short')).toBe('short')
  })
})
