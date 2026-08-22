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
    expect(screen.getByTestId('verified').textContent).toContain('All 3 checks passed')
    // The spec and invariant counts moved to the attestation screen, which is
    // where somebody goes to ask a detailed question. Here they cost four
    // lines and pushed the sentence about what this screen does NOT prove off
    // the bottom of a 480px panel, which was the wrong sentence to lose.
    expect(screen.getByTestId('attestation-facts').textContent).not.toContain('38')
    // A user can still tell from this screen whether wallet code is present.
    //
    // In words rather than in the tier's own vocabulary. "signer only, no
    // wallet code" was accurate and was written for somebody who already knew
    // there was a wallet package to leave out; nobody reading a lock screen
    // does. See lib/tier.ts.
    expect(screen.getByTestId('tier').textContent).toContain('Signing only')
    expect(screen.getByTestId('tier').textContent).toContain('no transaction building')
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

    expect(screen.getByTestId('blocked').textContent).toContain('Do not enter your passphrase')
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
    expect(screen.getByTestId('lock-caveat').textContent).toContain(
      'Reported by the software you are looking at'
    )
  })
})

/**
 * Tests for the verdict, which is the only thing on this screen that decides
 * anything.
 *
 * The rule is fail closed: a check passes if it says so in a word this screen
 * knows, and anything else is a failure. It used to be the other way round,
 * `status === 'failed'` and everything else a pass, which meant a status the
 * daemon emitted and this file had not been told about produced "Verification
 * passed" in green with Unlock enabled.
 *
 * Nothing found that in review, and no test would have: every fixture in this
 * file used the two strings the screen already knew. It surfaced when a fixture
 * elsewhere was written with 'fail' instead of 'failed' by mistake, and the
 * screen cheerfully reported 5 of 5 checks passing with one of them failed.
 */
describe('ui.screens.lock verdict', () => {
  const withStatus = (status: string): AttestationView => ({
    ...passing,
    checks: [
      { name: 'coverage', status: 'passed', detail: '' },
      { name: 'integrity', status, detail: 'one file does not match MANIFEST.lock' },
    ],
  })

  /**
   * INV-UI-53. Any status this screen does not recognise is a failure.
   *
   * The value crosses a JSON boundary, so its TypeScript type guarantees
   * nothing about what actually arrives.
   */
  it('treats-an-unrecognised-status-as-a-failure', () => {
    for (const status of ['fail', 'error', 'FAILED', 'skipped', 'pending', '', 'ok']) {
      cleanup()
      render(
        <LockScreen attestation={withStatus(status)} network={mainnet} onUnlock={() => undefined} />
      )
      expect(screen.getByTestId<HTMLButtonElement>('unlock').disabled, status).toBe(true)
      expect(screen.getByTestId('verification-status').textContent, status).toContain('FAILED')
      // Counted as failing, not quietly counted as passing.
      expect(screen.getByTestId('checks').textContent, status).toBe('1/2')
      // And the wallet is blocked, not merely warned about.
      expect(screen.queryByTestId('blocked'), status).not.toBeNull()
    }
  })

  /**
   * A status nobody here knows and a check that plainly failed are different
   * problems, and the first is worse: it means the screen and the daemon
   * disagree about what verification even reports.
   */
  it('names-an-unrecognised-status-rather-than-just-the-check', () => {
    render(
      <LockScreen attestation={withStatus('fail')} network={mainnet} onUnlock={() => undefined} />
    )
    expect(screen.getByTestId('verification-status').textContent).toContain(
      'integrity (status: fail)'
    )

    cleanup()
    render(
      <LockScreen attestation={withStatus('failed')} network={mainnet} onUnlock={() => undefined} />
    )
    const said = screen.getByTestId('verification-status').textContent
    expect(said).toContain('integrity')
    expect(said).not.toContain('status:')
  })

  /**
   * `not-applicable` has to keep passing. A spec that declares no vectors has
   * nothing to verify, and calling that a failure would mean no device boots.
   */
  it('still-passes-a-check-that-had-nothing-to-do', () => {
    render(
      <LockScreen
        attestation={withStatus('not-applicable')}
        network={mainnet}
        onUnlock={() => undefined}
      />
    )
    expect(screen.getByTestId<HTMLButtonElement>('unlock').disabled).toBe(false)
    // No count on a passing device: the verdict banner already says all of
    // them passed, and the same number twice reads as two measurements.
    expect(screen.queryByTestId('checks')).toBeNull()
    expect(screen.getByTestId('verified').textContent).toContain('All 2 checks passed')
  })

  /**
   * Every status the verifier can actually produce, read off packages/verify.
   * A rename there without a change here is the failure this pins down.
   */
  it('agrees-with-the-verifier-about-what-a-status-can-be', () => {
    for (const status of ['passed', 'not-applicable'] as const) {
      cleanup()
      render(
        <LockScreen attestation={withStatus(status)} network={mainnet} onUnlock={() => undefined} />
      )
      expect(screen.getByTestId<HTMLButtonElement>('unlock').disabled, status).toBe(false)
    }
    cleanup()
    render(
      <LockScreen attestation={withStatus('failed')} network={mainnet} onUnlock={() => undefined} />
    )
    expect(screen.getByTestId<HTMLButtonElement>('unlock').disabled).toBe(true)
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

/**
 * Where the refusal appears, which turned out to matter as much as whether it
 * appears at all.
 *
 * The panel is 480px. The hash card and the counts fill it, so the banner
 * saying not to proceed used to sit below both and off the bottom of the
 * screen: a user reading top to bottom saw a manifest root, some numbers, and
 * had to scroll to be told the device had failed verification.
 */
describe('ui.screens.lock refusal placement', () => {
  const failed: AttestationView = {
    ...passing,
    checks: [
      { name: 'coverage', status: 'passed', detail: '' },
      {
        name: 'integrity',
        status: 'failed',
        detail: 'packages/core/src/derive/hd.ts does not match MANIFEST.lock.',
      },
    ],
  }

  /**
   * INV-UI-54. On a failing device the refusal is the first thing in the body,
   * above the hash it would otherwise ask you to compare.
   */
  it('puts-the-refusal-above-everything-else', () => {
    render(<LockScreen attestation={failed} network={mainnet} onUnlock={() => undefined} />)

    const body = document.querySelector('.nr-screen__body')
    const blocked = screen.getByTestId('blocked')
    const hash = screen.getByTestId('attestation')

    // First in the body. The verdict banner is not rendered on a failing
    // device, so nothing sits between the refusal and the top of the screen.
    expect(body?.firstElementChild).toBe(blocked)
    // Ahead of the hero in document order, so it is read first.
    expect(blocked.compareDocumentPosition(hash) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  /**
   * INV-UI-54. It says which check failed and why, not only that something did.
   * "Verification failed" tells a user to stop; the detail is what tells them
   * whether they are looking at a corrupt card or at something worse.
   */
  it('says-what-actually-failed', () => {
    render(<LockScreen attestation={failed} network={mainnet} onUnlock={() => undefined} />)
    const said = screen.getByTestId('blocked').textContent
    expect(said).toContain('Do not enter your passphrase')
    expect(said).toContain('hd.ts does not match MANIFEST.lock')
  })

  it('is-absent-when-there-is-nothing-to-refuse', () => {
    render(<LockScreen attestation={passing} network={mainnet} onUnlock={() => undefined} />)
    expect(screen.queryByTestId('blocked')).toBeNull()

    // The VERDICT is first on a passing device, and the hash is directly
    // under it. The hash used to be first, which was defensible while the
    // verdict was a small line in the action bar and is not now: this screen
    // exists to deliver a verdict, and most boots are somebody who wants to
    // know the device is alright rather than somebody comparing 64 characters.
    const body = document.querySelector('.nr-screen__body')
    expect(body?.firstElementChild).toBe(screen.getByTestId('verified'))
    expect(body?.children[1]).toBe(screen.getByTestId('attestation'))
  })
})
