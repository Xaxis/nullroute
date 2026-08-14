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
 * The layout puts the manifest root hash first and large, because it is the one
 * value a user is being asked to carry across to another screen and compare
 * character by character. Everything else on this screen is context for that
 * comparison.
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
 * A note for whoever changes this next. This screen previously used its own
 * `nr-lock__*` class names, and not one of them was ever defined in styles.css,
 * so it rendered as unstyled HTML with labels running into their values. It now
 * uses the shared `Screen` scaffold and the same design system as every other
 * screen. `make ui-classes` fails the build if a class here has no rule.
 *
 * The honest caveat is printed on the screen itself, not buried in the docs:
 * these values are reported by the software you are looking at. They catch an
 * accident, a bad write, and an unsophisticated substitution. Until the boot
 * chain is signed, they do not catch an attacker who replaced the code drawing
 * them.
 */

import { type ReactElement } from 'react'
import { type NetworkId } from '@nullroute/core'
import { Screen } from '../components/Screen.js'
import { Button } from '../components/Button.js'
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
    <Screen
      title="nullroute"
      subtitle={`v${attestation.version}`}
      banner={network.isMainnet ? null : <NetworkBanner network={network} />}
      testId="lock-screen"
      actions={
        <>
          {/* The verdict sits beside the button rather than above the fold,
              so the thing that decides whether to proceed and the control that
              proceeds are read in one glance. */}
          <span
            className={`nr-status ${verified ? 'nr-status--ok' : 'nr-status--fail'}`}
            data-testid="verification-status"
          >
            {/* The counts are already on screen as facts. Repeating them here
                would spend the one line beside the primary action on something
                the user has just read. */}
            {verified
              ? 'Verification passed'
              : `Verification FAILED: ${failing.map((c) => c.name).join(', ')}`}
          </span>
          <div className="nr-spacer" />
          {/* Not autofocused. A security-relevant confirmation is never the
              default action, so a stray tap cannot carry you past this screen. */}
          <Button variant="primary" onClick={onUnlock} disabled={!verified} testId="unlock">
            Unlock
          </Button>
        </>
      }
    >
      {/* The hero. This is the value being compared against another screen, so
          it gets the space and the type size, and nothing sits above it. */}
      <div className="nr-attest" data-testid="attestation">
        <div className="nr-attest__label">Manifest root</div>
        <Hash
          value={attestation.rootHash}
          expanded={expanded}
          onToggle={onToggleExpanded}
          testId="manifest-root-hash"
        />
        <div className="nr-attest__hint">
          {expanded ? 'Tap to shorten.' : 'Tap to show all 64 characters.'}
        </div>
      </div>

      <div className="nr-facts" data-testid="attestation-facts">
        <div className="nr-fact">
          <span className="nr-fact__key">Specs</span>
          <span className="nr-fact__val">{attestation.specCount}</span>
        </div>
        <div className="nr-fact">
          <span className="nr-fact__key">Invariants</span>
          <span className="nr-fact__val">{attestation.invariantCount}</span>
        </div>
        <div className="nr-fact">
          <span className="nr-fact__key">Checks</span>
          <span className="nr-fact__val" data-testid="checks">
            {attestation.checks.length - failing.length}/{attestation.checks.length}
          </span>
        </div>
        {/* On screen rather than in a subtitle, because whether this build
            contains wallet code at all is an assurance statement and not a
            version string. */}
        <div className="nr-fact nr-fact--wide">
          <span className="nr-fact__key">Build</span>
          <span className="nr-fact__val" data-testid="tier">
            {attestation.tier === 'signer' ? 'signer only, no wallet code' : attestation.tier}
          </span>
        </div>
        {fingerprint !== undefined && (
          <div className="nr-fact">
            <span className="nr-fact__key">Wallet</span>
            {/* Shown before unlock on purpose. A wrong passphrase produces a
                valid, different, empty wallet with no error, and this is the
                only signal the user gets. */}
            <span className="nr-fact__val nr-mono" data-testid="fingerprint">
              {fingerprint}
            </span>
          </div>
        )}
      </div>

      {!verified && (
        <div className="nr-banner nr-banner--danger" data-testid="blocked">
          <strong>Do not enter your PIN</strong>
          <span>
            Verification failed, so the wallet will not load. This device is not running the code
            it was built from.
          </span>
        </div>
      )}

      {/* Tightened to fit 480px without scrolling. The caveat is the most
          skippable thing on this screen and the least affordable to have
          scrolled off, so it earns its brevity rather than its length. */}
      <p className="nr-hint">
        Compare this hash against the published release before entering your PIN. These values are
        reported by the software you are looking at: they catch an accident or a crude
        substitution, not an attacker who replaced the code that draws them.
      </p>
    </Screen>
  )
}
