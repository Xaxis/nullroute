/**
 * The lock screen.
 *
 * Spec: ui.screens.lock
 *
 * This is the first thing a user sees and the last thing standing between them
 * and a device that is not what it claims to be. It exists to show three
 * numbers before anyone enters a PIN, so that a swapped or modified device can
 * be noticed rather than merely feared.
 *
 * Design constraints, all of which come from the device rather than from taste:
 *
 *   - 800x480, touch, and a user who is in a hurry but is being asked to check
 *     something carefully. Large targets, high contrast, no small print where
 *     it matters.
 *   - Monospace with unambiguous glyphs for the hash, chunked, because the
 *     whole point is comparing it against a value on another screen.
 *   - No animation. Motion belongs to progress indicators, and a security
 *     screen that moves invites a glance rather than a read.
 *   - The unlock action is never the focused default. No accidental double tap
 *     past the one screen that asks you to look.
 *
 * The honest caveat is printed on the screen itself, not buried in the docs:
 * these values are reported by the software you are looking at. They catch an
 * accident, a bad write, and an unsophisticated substitution. Until the boot
 * chain is signed, they do not catch an attacker who replaced the code drawing
 * them.
 */

import { type ReactElement } from 'react'
import { type NetworkId } from '@nullroute/core'
import { Hash } from '../components/Hash.js'
import { NetworkBanner } from '../components/NetworkBanner.js'

export interface AttestationView {
  readonly rootHash: string
  readonly rootHashShort: string
  readonly specCount: number
  readonly invariantCount: number
  readonly tier: string
  readonly version: string
  readonly checks: readonly { name: string; status: string; detail: string }[]
}

export interface LockScreenProps {
  readonly attestation: AttestationView
  readonly network: { readonly id: NetworkId; readonly label: string; readonly isMainnet: boolean }
  /** Shown once a wallet exists, so a mistyped passphrase is visible. */
  readonly fingerprint?: string
  readonly onUnlock: () => void
  readonly expanded?: boolean
  readonly onToggleExpanded?: () => void
}

export function LockScreen(props: LockScreenProps): ReactElement {
  const { attestation, network, fingerprint, onUnlock, expanded = false, onToggleExpanded } = props

  const failing = attestation.checks.filter((c) => c.status === 'failed')
  const verified = failing.length === 0

  return (
    <main className="nr-lock" data-testid="lock-screen">
      {!network.isMainnet && <NetworkBanner network={network} />}

      <header className="nr-lock__head">
        <h1 className="nr-lock__title">nullroute</h1>
        <span className="nr-lock__version">v{attestation.version}</span>
      </header>

      <section className="nr-lock__attestation" aria-label="Device attestation">
        <div className="nr-lock__row">
          <span className="nr-lock__label">Manifest root</span>
          <Hash
            value={attestation.rootHash}
            expanded={expanded}
            onToggle={onToggleExpanded}
            testId="manifest-root-hash"
          />
        </div>

        <div className="nr-lock__row">
          <span className="nr-lock__label">Verification</span>
          <span
            className={verified ? 'nr-status nr-status--ok' : 'nr-status nr-status--fail'}
            data-testid="verification-status"
          >
            {verified
              ? `passed, ${String(attestation.specCount)} specs, ${String(attestation.invariantCount)} invariants`
              : `FAILED: ${failing.map((c) => c.name).join(', ')}`}
          </span>
        </div>

        <div className="nr-lock__row">
          <span className="nr-lock__label">Build</span>
          <span className="nr-lock__value" data-testid="tier">
            {attestation.tier === 'signer' ? 'signer only, no wallet code' : attestation.tier}
          </span>
        </div>

        {fingerprint !== undefined && (
          <div className="nr-lock__row">
            <span className="nr-lock__label">Wallet</span>
            {/* Shown before unlock on purpose. A wrong passphrase produces a
                valid, different, empty wallet with no error, and this is the
                only signal the user gets. */}
            <span className="nr-lock__value nr-mono" data-testid="fingerprint">
              {fingerprint}
            </span>
          </div>
        )}
      </section>

      <p className="nr-lock__caveat">
        Compare the root hash against the published release before you enter your PIN. These
        values are reported by the software you are looking at, so they catch an accident or an
        unsophisticated substitution, not an attacker who replaced the code that draws them.
      </p>

      <div className="nr-lock__actions">
        {/* Not autofocused. A security-relevant confirmation is never the
            default action, so a stray tap cannot carry you past this screen. */}
        <button
          type="button"
          className="nr-button nr-button--primary"
          onClick={onUnlock}
          disabled={!verified}
          data-testid="unlock"
        >
          Unlock
        </button>
        {!verified && (
          <p className="nr-lock__blocked" data-testid="blocked">
            Verification failed, so the wallet will not load. This device is not running the code
            it was built from. Do not enter your PIN.
          </p>
        )}
      </div>
    </main>
  )
}
