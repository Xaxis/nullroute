import { type ReactElement, type ReactNode } from 'react'
import { Screen } from '../components/Screen.js'
import { tierLabel, tierExplanation } from '../lib/tier.js'
import { Button } from '../components/Button.js'
import { Hash } from '../components/Hash.js'
import { type AttestationView } from './LockScreen.js'
import { Info } from '../components/Info.js'
import { useMoreBelow } from '../lib/scroll.js'
import { judge } from '../lib/verdict.js'

/**
 * Check the device, after it is open.
 *
 * Spec: ui.screens.attestation
 *
 * The lock screen shows the manifest root once, before a passphrase, and then
 * it is gone for the rest of the session. That is the wrong shape for the one
 * claim this project is built on. "You can check this device rather than trust
 * it" is not a thing you do once at boot: it is what you do before signing
 * something large, when a device has been out of your sight, or when somebody
 * asks you to prove the thing in your hand is the thing you built.
 *
 * The values are the same ones the lock screen displayed. What is different is
 * that they are reachable, and that the caveat can be read at leisure rather
 * than while a person is trying to get past a login.
 *
 * WHAT THIS DOES NOT PROVE, and the screen says it in the same words the lock
 * screen uses: these numbers are reported by the software you are looking at.
 * They catch an accident or a crude substitution. They do not catch an attacker
 * who replaced the code that draws them, which is the whole subject of the tier
 * model in docs/PROVISIONING.md.
 */

export interface AttestationScreenProps {
  /**
   * The navigation menu, when leaving this screen is free.
   *
   * The only signal this device gives for that. It replaced a Home button in
   * the same corner meaning the same thing, which is how that corner came to
   * have three states and no rule.
   */
  readonly nav?: ReactNode
  readonly attestation: AttestationView
  /** Whether the manifest root is shown in full. Lifted, like the lock screen. */
  readonly expanded?: boolean
  readonly onToggleExpanded?: () => void
  readonly onBack: () => void

  /**
   * Close the wallet and forget the seed.
   *
   * Optional, because this screen is also reachable on a device with nothing
   * open, where there is nothing to lock and a button offering to would be a
   * control that does nothing.
   */
  readonly onLock?: (() => void) | undefined
  /** Who this device is and which wallet it has open. See `Identity`. */
  readonly identity?: ReactNode
  readonly banner?: ReactElement | null
}

export function AttestationScreen(props: AttestationScreenProps): ReactElement {
  const moreBelow = useMoreBelow()
  const {
    attestation,
    expanded = false,
    onToggleExpanded,
    onBack,
    onLock,
    identity,
    banner,
    nav,
  } = props

  // Fail closed, for the reason the lock screen does: a status this file has
  // not been told about must not read as a pass, and a check that had nothing
  // to check is named rather than counted as one. The same function decides
  // both screens, so they cannot disagree. See INV-UI-53 and INV-UI-70.
  const verdict = judge(attestation.checks)
  const { verified, failing } = verdict

  return (
    <Screen
      title="This device"
      subtitle={`v${attestation.version}`}
      banner={banner}
      nav={nav}
      identity={identity}
      testId="attestation-screen"
      actions={
        <>
          <Button onClick={onBack} testId="attestation-back">
            Back
          </Button>
          {/* THE BANNER SAYS "LOCK IT", SO LOCKING IS HERE.

              This screen tells somebody, in the strongest words the product
              uses, to lock the device and stop. It then offered Back and a
              status label. Locking lives in the navigation menu, so the
              instruction was followable, and following it meant opening a
              popdown and finding the right entry during the state the banner
              calls badly wrong.

              Only when it is failing. On a device that verified there is
              nothing urgent to do here, and a danger-styled button on a passing
              screen teaches somebody to ignore the colour. */}
          {!verified && onLock !== undefined && (
            <Button variant="danger" onClick={onLock} testId="attestation-lock">
              Lock now
            </Button>
          )}
          <div className="nr-spacer" />
          <span
            className={`nr-status ${verified ? 'nr-status--ok' : 'nr-status--fail'}`}
            data-testid="attestation-verdict"
          >
            {verified
              ? verdict.notApplicable.length === 0
                ? 'Verification passed'
                : `Verification passed, not applicable: ${verdict.notApplicable
                    .map((check) => check.name)
                    .join(', ')}`
              : `Verification FAILED: ${verdict.reasons.join(', ')}`}
          </span>
        </>
      }
    >
      {/* A device that failed and is nevertheless open. That combination should
          be impossible, because the lock screen refuses to unlock, so if it is
          on the screen something has gone badly wrong and saying so plainly
          matters more than anything else here. */}
      {!verified && (
        <div data-must-see className="nr-banner nr-banner--danger" data-testid="attestation-failed">
          <strong>This device is open and should not be</strong>
          <span>
            Verification is failing now and the wallet is loaded anyway. Lock it, take the card out,
            and do not sign anything. {failing.map((check) => check.detail).join(' ')}
          </span>
        </div>
      )}

      {/* THE HASH AND THE CHECKS SIDE BY SIDE.

          This screen stacked six blocks: 836px of content in a 333px window,
          on the screen whose whole job is answering "is this device running
          what it says it is". All five check rows were below the fold, so the
          answer was the one thing not on screen.

          The hash is what somebody compares and the table is what they read,
          and neither is an aside to the other, so they share the row. The table
          scrolls inside itself rather than taking the hash with it. */}
      <div
        className="nr-split nr-split--even nr-fill nr-scrolls"
        ref={moreBelow}
        data-testid="attestation-split"
      >
        {/* Scrolls too, because the standing caveats moved in here. They are
            about the hash directly above them and they were below the split,
            where they took 100px off a row that had 238 to give. */}
        <div className="nr-split__col nr-fill nr-scrolls" ref={moreBelow}>
          <div className="nr-attest" data-testid="attestation-root">
            <div className="nr-attest__label">Manifest root</div>
            <Hash
              value={attestation.rootHash}
              expanded={expanded}
              onToggle={onToggleExpanded}
              testId="attestation-hash"
            />
            <div className="nr-attest__hint">
              {expanded ? 'Tap to shorten.' : 'Tap to show all 64 characters.'}
            </div>
          </div>

          {/* What the one word in the Build row above actually means. This
              screen is where somebody has come to ask a more detailed question,
              and "signing only" is a claim about what code is on the device
              rather than a version string. The lock screen has room for the
              label and not for this. */}
          {tierExplanation(attestation.tier) !== null && (
            <p className="nr-hint" data-testid="attestation-tier-explained">
              {tierExplanation(attestation.tier)}
            </p>
          )}

          <div className="nr-card nr-card--tight">
            <div className="nr-row">
              <span className="nr-label">Specs</span>
              <span className="nr-value">{attestation.specCount}</span>
            </div>
            <div className="nr-row">
              <span className="nr-label">Invariants</span>
              <span className="nr-value">{attestation.invariantCount}</span>
            </div>
            <div className="nr-row">
              <span className="nr-label">Build</span>
              <span className="nr-value" data-testid="attestation-tier">
                {tierLabel(attestation.tier)}
              </span>
            </div>
          </div>

          {/* The same sentence the lock screen carries, deliberately word for word.
              Two different phrasings of one limit would let a reader believe the
              weaker one. */}
          <Info label="What this proves" testId="attestation-caveat">
            Compare this hash against the published release. These values are reported by the
            software you are looking at: they catch an accident or a crude substitution, not an
            attacker who replaced the code that draws them.
          </Info>

          <p className="nr-hint">
            Check it yourself with <span className="nr-mono">sha256sum MANIFEST.lock</span> on the
            source you built from. Three numbers should agree: that one, this one, and the release.
          </p>
        </div>

        {/* Every check by name, which the lock screen does not have room for. It
          spends its space on the hash, and by the time somebody is here they
          are asking a more detailed question. */}
        <div className="nr-split__col nr-fill nr-scrolls" ref={moreBelow}>
          <table className="nr-table nr-table--dense" data-testid="attestation-checks">
            <thead className="nr-table__stick">
              <tr>
                <th>Check</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {attestation.checks.map((check) => (
                <tr key={check.name}>
                  <td className="nr-mono">{check.name}</td>
                  <td>
                    <span
                      // Not green when not applicable. It did not pass, and
                      // the colour of a pass on it said it did.
                      className={
                        check.status === 'passed'
                          ? 'nr-status nr-status--ok'
                          : check.status === 'not-applicable'
                            ? 'nr-status'
                            : 'nr-status nr-status--fail'
                      }
                    >
                      {check.status}
                    </span>
                    {check.detail.length > 0 && <div className="nr-hint">{check.detail}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Screen>
  )
}
