/**
 * The lock screen.
 *
 * Spec: ui.screens.lock
 *
 * This is the first thing a user sees and the last thing standing between them
 * and a device that is not what it claims to be. It exists to show three
 * numbers before anyone enters a passphrase, so that a swapped or modified
 * device can
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

import { type ReactElement, type ReactNode } from 'react'
import { type NetworkId } from '@nullroute/core'
import { Screen } from '../components/Screen.js'
import { tierLabel } from '../lib/tier.js'
import { Button } from '../components/Button.js'
import { Hash } from '../components/Hash.js'
import { NetworkBanner } from '../components/NetworkBanner.js'

export interface AttestationView {
  readonly rootHash: string
  readonly rootHashShort: string
  /** Null where there is no dm-verity mapping, such as `make dev` on a laptop. */
  readonly verityRootHash?: string | null
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
  /**
   * Leaves for the goal hub instead of straight into the device.
   *
   * Optional, and never the primary action. Somebody who has used this before
   * wants the device, not a menu asking what they are trying to achieve.
   */
  readonly onGuide?: () => void
  /** Who this device is and which wallet it has open. See `Identity`. */
  readonly identity?: ReactNode
  /**
   * The navigation menu.
   *
   * On the gate screen too, and this is the reason the menu replaced a rail: a
   * rail of wallet destinations had nothing to show here, so the first screen
   * anybody meets had no visible navigation at all. What this menu offers with
   * nothing unlocked is the guide and the device's own settings, which is
   * exactly the set of things you can do before a passphrase.
   */
  readonly nav?: ReactNode
  readonly expanded?: boolean
  readonly onToggleExpanded?: () => void
}

/**
 * The statuses that count as a pass, and no others.
 *
 * `not-applicable` is a pass: a spec with no vectors declared has nothing to
 * verify, and calling that a failure would mean no device ever boots.
 */
const PASSING = new Set(['passed', 'not-applicable'])

export function LockScreen(props: LockScreenProps): ReactElement {
  const {
    attestation,
    network,
    fingerprint,
    onUnlock,
    onGuide,
    identity,
    nav,
    expanded = false,
    onToggleExpanded,
  } = props

  // A check passes only if it says so, in a word this screen knows. Everything
  // else is a failure.
  //
  // This used to read `status === 'failed'`, which is fail-open on the one
  // screen where that is unaffordable: any status the daemon might emit that
  // this file had not been told about, a rename, a new outcome, a typo on
  // either side, produced "Verification passed" in green with Unlock enabled.
  // The value crosses a JSON boundary, so TypeScript guarantees nothing about
  // it, and the check names are drawn from the same payload.
  const failing = attestation.checks.filter((c) => !PASSING.has(c.status))
  const verified = failing.length === 0

  return (
    <Screen
      /* Not "nullroute". The brand says that, in the same header, four
         inches to the left, on this screen and on every other one. A title
         that repeats the brand is a title that says nothing about which
         screen you are on, which on the first screen anybody sees is the
         one thing a title is for. */
      title="This device"
      subtitle={`v${attestation.version}, ${attestation.tier}`}
      banner={network.isMainnet ? null : <NetworkBanner network={network} />}
      identity={identity}
      nav={nav}
      testId="lock-screen"
      actions={
        <>
          {/* ONLY ON FAILURE now. A pass is announced at the top of the body,
              at full width, so repeating it here put two verdicts on one
              screen and made the smaller one look like a second opinion.
              
              A failure keeps its line here because this is where the disabled
              button is: the reason you cannot proceed belongs beside the
              control that will not let you. */}
          {!verified && (
            <span className="nr-status nr-status--fail" data-testid="verification-status">
              {`Verification FAILED: ${failing
                .map((c) =>
                  // An unrecognised status is named, because "integrity
                  // failed" and "nobody here knows what integrity said" are
                  // different problems and the second one is worse.
                  c.status === 'failed' ? c.name : `${c.name} (status: ${c.status})`
                )
                .join(', ')}`}
            </span>
          )}
          <div className="nr-spacer" />
          {/* Behind Unlock, and only when verification passed. A device that
              just failed its own integrity check must not offer a friendly
              menu beside the reason not to proceed. */}
          {onGuide !== undefined && verified && (
            <Button onClick={onGuide} testId="lock-guide">
              Guide me
            </Button>
          )}
          {/* Not autofocused. A security-relevant confirmation is never the
              default action, so a stray tap cannot carry you past this screen. */}
          {/* NOT "Unlock". Nothing is unlocked here and nothing is
              decrypted: this screen is an attestation gate, the passphrase
              belongs to a wallet rather than to the device, and what this does
              is take you to the list of them. A label that promises an outcome
              one screen further on than it delivers is a small lie on the
              first screen anybody reads. */}
          <Button variant="primary" onClick={onUnlock} disabled={!verified} testId="unlock">
            Open a wallet
          </Button>
        </>
      }
    >
      {/* FIRST when it applies, above the hero, because 480px of panel holds
          the hash card and the facts and nothing else. This banner used to sit
          below both, which put the most important sentence a failing device
          ever says off the bottom of the screen: a user reading top to bottom
          saw a manifest root, some counts, and had to scroll to be told not to
          proceed. On a device that has just failed verification, nothing
          outranks this. */}
      {!verified && (
        <div data-must-see className="nr-banner nr-banner--danger" data-testid="blocked">
          <strong>Do not enter your passphrase</strong>
          <span>
            Verification failed, so the wallet will not load. This device is not running the code it
            was built from.{' '}
            {failing
              .map((c) => c.detail)
              .filter(Boolean)
              .join(' ')}
          </span>
        </div>
      )}

      {/* THE VERDICT, first, on the screen whose whole job is to deliver one.
          It used to appear only as a small line in the action bar, the same
          size as everything else, while the hash card was the hero. Somebody
          who is not comparing hashes today, which is most boots, had nothing
          telling them the device is in the state it should be in.
          
          The hash keeps the space below it. This screen exists so a device can
          be checked rather than trusted, and the hash is what gets checked; it
          just is not the answer to "is this thing alright". */}
      {verified && (
        <div className="nr-verdict" data-testid="verified">
          <div className="nr-verdict__line">
            <span className="nr-verdict__mark">Verified</span>
            <span className="nr-verdict__detail">
              All {attestation.checks.length} checks passed against this build.
            </span>
          </div>
          {/* THE LIMIT, WITH THE CLAIM. This was a paragraph two cards further
              down, which put it below the fold on a 480px panel: the screen
              made its strongest claim above the fold and qualified it out of
              sight. On a device whose whole argument is that it does not
              overclaim, that was the wrong sentence to lose. */}
          <p className="nr-verdict__limit" data-testid="lock-caveat">
            Reported by the software you are looking at, so it catches an accident or a crude
            substitution and not an attacker who replaced the code that draws it. Compare the hash
            against the published release.
          </p>
        </div>
      )}

      {/* The value being compared against another screen, so it gets the space
          and the type size. */}
      <div className="nr-attest" data-testid="attestation">
        <div className="nr-attest__label">Manifest root</div>
        <Hash
          value={attestation.rootHash}
          expanded={expanded}
          onToggle={onToggleExpanded}
          testId="manifest-root-hash"
        />

        {/* Directly under the hash it describes. At the bottom of the box it
            landed under the sentence saying there is no verity mapping, where
            it reads as an instruction to tap that sentence. */}
        <div className="nr-attest__hint">
          {expanded ? 'Tap a hash to shorten it.' : 'Tap a hash to show all 64 characters.'}
        </div>

        {/* IN THE SAME BOX, NOT A SECOND ONE.
            
            These are two numbers a user compares against a release, and they
            belong together. Given a box each they took 200 pixels of an
            480 pixel panel and pushed the system partition hash below the fold,
            on the one screen whose entire job is showing a number to compare.
            One box, one hint, two labelled rows.
            
            Rendered as an absence rather than a blank when there is no
            mapping: an empty value here reads as a number that has not loaded,
            and `make dev` on a laptop has no verity device. */}
        {attestation.verityRootHash !== undefined && (
          <div className="nr-attest__second" data-testid="verity-attestation">
            <div className="nr-attest__label">System partition</div>
            {attestation.verityRootHash === null ? (
              <div className="nr-attest__absent" data-testid="verity-root-absent">
                No dm-verity mapping. This system partition is not checked as it is read.
              </div>
            ) : (
              <Hash
                value={attestation.verityRootHash}
                expanded={expanded}
                onToggle={onToggleExpanded}
                testId="verity-root-hash"
              />
            )}
          </div>
        )}
      </div>

      {/* Two facts, not five. The spec and invariant counts are on the
          attestation screen, which is reachable once you are in and is where
          somebody goes to ask a detailed question; here they cost four lines
          that pushed the sentence about what this screen does NOT prove off
          the bottom of the panel. That sentence is the honest one, and it was
          the one being cut.
          
          These two stay because they decide something at boot. The build tier
          is an assurance statement rather than a version string, and the
          fingerprint is the only signal a user gets that a passphrase opened
          the wallet they meant. */}
      <div className="nr-facts" data-testid="attestation-facts">
        <div className="nr-fact">
          <span className="nr-fact__key">Build</span>
          <span className="nr-fact__val" data-testid="tier">
            {tierLabel(attestation.tier)}
          </span>
        </div>
        {/* Only when the verdict banner is NOT on screen. On a passing device
            that banner already says all five passed, and the same number twice
            reads as two different measurements. On a failing one the banner is
            the red refusal, which says what is wrong rather than how many, so
            the count earns its line. */}
        {!verified && (
          <div className="nr-fact">
            <span className="nr-fact__key">Checks</span>
            <span className="nr-fact__val" data-testid="checks">
              {attestation.checks.length - failing.length}/{attestation.checks.length}
            </span>
          </div>
        )}
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
    </Screen>
  )
}
