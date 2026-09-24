/**
 * Tests for checking the device after it is open.
 *
 * The lock screen shows the manifest root once, before a passphrase, and then
 * it is gone for the session. That is the wrong shape for the claim this whole
 * project rests on. Checking the device is not a thing you do at boot: it is
 * what you do before signing something large, or after the device has been out
 * of your sight, or when somebody asks you to prove the thing in your hand is
 * the thing you built.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AttestationScreen } from '../src/screens/AttestationScreen.js'
import { type AttestationView } from '../src/screens/LockScreen.js'

afterEach(cleanup)

const ROOT_HASH = '9c46304078497172c607c3e56da0ea708a79825ffdb49fe2f684cc8a007b04de'

function attestation(overrides: Partial<AttestationView> = {}): AttestationView {
  return {
    rootHash: ROOT_HASH,
    rootHashShort: '9c463040...007b04de',
    specCount: 31,
    invariantCount: 227,
    tier: 'signer',
    version: '0.1.0',
    checks: [
      { name: 'coverage', status: 'passed', detail: '212 of 212 runtime exports covered' },
      { name: 'differential', status: 'not-applicable', detail: '' },
    ],
    ...overrides,
  }
}

describe('AttestationScreen', () => {
  /**
   * INV-UI-69. The same values the lock screen showed, reachable, with every
   * check named. The lock screen spends its space on the hash; by the time
   * somebody is here they are asking a more detailed question.
   */
  it('shows-the-root-hash-and-every-check-by-name', () => {
    render(<AttestationScreen attestation={attestation()} onBack={vi.fn()} />)

    expect(screen.getByTestId('attestation-root').textContent).toContain('Manifest root')
    const checks = screen.getByTestId('attestation-checks').textContent
    expect(checks).toContain('coverage')
    expect(checks).toContain('212 of 212')
    expect(checks).toContain('differential')
    expect(screen.getByTestId('attestation-verdict').textContent).toContain('passed')
  })

  /**
   * INV-UI-70. The same count as the lock screen: a check with nothing to
   * check is named as not applicable, is not coloured as a pass, and a list
   * with nothing passed is a failure rather than "Verification passed".
   */
  it('names-a-check-that-had-nothing-to-do-rather-than-passing-it', () => {
    render(<AttestationScreen attestation={attestation()} onBack={vi.fn()} />)
    expect(screen.getByTestId('attestation-verdict').textContent).toContain(
      'not applicable: differential'
    )
    const rows = [...screen.getByTestId('attestation-checks').querySelectorAll('tbody tr')]
    const differential = rows.find((row) => row.textContent.includes('differential'))
    expect(differential?.querySelector('.nr-status--ok')).toBeNull()

    for (const checks of [[], [{ name: 'vectors', status: 'not-applicable', detail: '' }]]) {
      cleanup()
      render(<AttestationScreen attestation={attestation({ checks })} onBack={vi.fn()} />)
      expect(screen.getByTestId('attestation-verdict').textContent).toContain('FAILED')
    }
  })

  /**
   * INV-UI-69. The caveat is word for word the lock screen's. Two phrasings of
   * one limit would let a reader believe the weaker of them.
   */
  it('repeats-the-lock-screens-caveat-rather-than-rewording-it', () => {
    render(<AttestationScreen attestation={attestation()} onBack={vi.fn()} />)
    const said = screen.getByTestId('attestation-caveat').textContent
    expect(said).toContain('reported by the software you are looking at')
    expect(said).toContain('not an attacker who replaced the code that draws them')
    // And how to check it independently, which is the point of showing it.
    expect(document.body.textContent).toContain('sha256sum MANIFEST.lock')
  })

  /**
   * INV-UI-70. Fail closed, exactly as the lock screen does. A status this file
   * has not been told about must not read as a pass.
   */
  it('treats-an-unrecognised-status-as-a-failure', () => {
    for (const status of ['fail', 'ok', 'error', '']) {
      cleanup()
      render(
        <AttestationScreen
          attestation={attestation({
            checks: [{ name: 'integrity', status, detail: 'hd.ts does not match' }],
          })}
          onBack={vi.fn()}
        />
      )
      expect(screen.getByTestId('attestation-verdict').textContent, status).toContain('FAILED')
    }
  })

  /**
   * INV-UI-70. A device that is failing and open at the same time should be
   * impossible, because the lock screen refuses to unlock. If it is on screen,
   * something has gone badly wrong and saying so outranks everything else here.
   */
  it('says-plainly-when-a-failing-device-is-somehow-open', () => {
    render(
      <AttestationScreen
        attestation={attestation({
          checks: [
            { name: 'integrity', status: 'failed', detail: 'hd.ts does not match MANIFEST.lock.' },
          ],
        })}
        onBack={vi.fn()}
      />
    )
    const said = screen.getByTestId('attestation-failed').textContent
    expect(said).toContain('open and should not be')
    expect(said).toContain('do not sign anything')
    expect(said).toContain('hd.ts does not match')
  })

  it('does-not-warn-on-a-device-that-is-fine', () => {
    render(<AttestationScreen attestation={attestation()} onBack={vi.fn()} />)
    expect(screen.queryByTestId('attestation-failed')).toBeNull()
  })

  /**
   * The banner tells somebody to lock this device immediately. Offering Back
   * and a status label, with locking two taps away inside a popdown, is the
   * instruction and not the means.
   */
  it('offers-a-lock-when-it-is-telling-you-to-lock', () => {
    const onLock = vi.fn()
    render(
      <AttestationScreen
        attestation={attestation({
          checks: [{ name: 'integrity', status: 'failed', detail: 'a file does not match.' }],
        })}
        onBack={vi.fn()}
        onLock={onLock}
      />
    )
    fireEvent.click(screen.getByTestId('attestation-lock'))
    expect(onLock).toHaveBeenCalled()
  })

  /**
   * And not on a device that verified. A danger-styled control on a passing
   * screen is how somebody learns to stop reading the colour.
   */
  it('offers-no-lock-on-a-device-that-verified', () => {
    render(<AttestationScreen attestation={attestation()} onBack={vi.fn()} onLock={vi.fn()} />)
    expect(screen.queryByTestId('attestation-lock')).toBeNull()
  })

  it('expands-the-hash-on-request', () => {
    const onToggleExpanded = vi.fn()
    render(
      <AttestationScreen
        attestation={attestation()}
        expanded={false}
        onToggleExpanded={onToggleExpanded}
        onBack={vi.fn()}
      />
    )
    expect(screen.getByTestId('attestation-root').textContent).toContain('all 64 characters')
    fireEvent.click(screen.getByTestId('attestation-hash'))
    expect(onToggleExpanded).toHaveBeenCalled()
  })
})
