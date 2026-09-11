import { type ReactElement, type ReactNode, useEffect, useState } from 'react'
import { Screen } from '../components/Screen.js'
import { Refusal } from '../components/Refusal.js'
import { Working } from '../components/Working.js'
import { Button } from '../components/Button.js'
import { Hash } from '../components/Hash.js'
import { QrDisplay } from '../components/QrDisplay.js'
import { Info } from '../components/Info.js'

/**
 * Registering a quorum.
 *
 * Spec: ui.screens.multisig
 *
 * Two jobs, in the order a user does them. Hand this device's key to the
 * coordinator, then agree to the quorum that comes back.
 *
 * The screen is built around the fact that AGREEING IS THE DANGEROUS PART. A
 * descriptor with the user's key quietly swapped out produces a wallet that
 * accepts deposits and can never be spent from, and every screen after that
 * point looks completely normal. The daemon refuses such a descriptor outright,
 * so this screen's job is to make the thing that was verified legible: which
 * position is ours, what the threshold actually is, and every cosigner laid out
 * so it can be read aloud against the rest of the group.
 *
 * Fingerprints are shown and labelled as unverified. They are four bytes chosen
 * by whoever wrote the descriptor, and displaying one next to a key without
 * saying so would invite exactly the trust the daemon refuses to place in it.
 */

export interface CosignerView {
  readonly position: number
  /** The name the user gave this key. Theirs, never verified. */
  readonly name?: string
  /** The full extended key, so a name can be attached to it. */
  readonly fullXpub?: string
  readonly fingerprint: string | undefined
  readonly origin: string | undefined
  readonly xpub: string
  readonly isThisDevice: boolean
}

export interface RegistrationView {
  readonly descriptor: string
  readonly threshold: number
  readonly total: number
  readonly sorted: boolean
  readonly kind: string
  readonly cosigners: readonly CosignerView[]
  readonly ourPosition: number
  readonly warnings: readonly { readonly kind: string; readonly message: string }[]
}

export interface OurKeyView {
  readonly xpub: string
  readonly path: string
  readonly masterFingerprint: string
  readonly keyExpression: string
}

/** What a coordinator file said about itself, and what it actually carried. */
export interface ImportedFileView {
  readonly format: string
  readonly name: string | null
  /**
   * Lines the file asserted that this device does not check.
   *
   * A coordinator states its policy and derivation in prose. Those lines are a
   * hint about what the writer intended and never evidence: the descriptor
   * alone determines addresses. Shown so a disagreement can be noticed, and
   * used to decide nothing.
   */
  readonly unverifiedClaims: readonly string[]
  readonly descriptors: readonly {
    readonly descriptor: string
    readonly change: boolean | null
  }[]
}

export interface MultisigScreenProps {
  /**
   * The navigation menu, when leaving this screen is free.
   *
   * The only signal this device gives for that. It replaced a Home button in
   * the same corner meaning the same thing, which is how that corner came to
   * have three states and no rule.
   */
  readonly nav?: ReactNode
  readonly onOurKey: () => Promise<OurKeyView>
  readonly onReview: (descriptor: string) => Promise<RegistrationView>
  readonly onRegister: (descriptor: string) => Promise<void>
  /**
   * Read a file a coordinator exported.
   *
   * Optional, so the screen still works where the only route in is a pasted
   * descriptor. Importing decides nothing: it produces descriptors, and each
   * one still goes through the same review as one typed by hand.
   */
  readonly onImportFile?: (contents: string) => Promise<ImportedFileView>
  /**
   * Write the bundle a coordinator needs to watch this wallet.
   *
   * The other half of registration, and the half that is easy to forget: a
   * quorum every device has agreed to is still invisible to the software that
   * builds the transactions.
   */
  readonly onExportBundle?: () => Promise<{ bundle: string }>
  /**
   * Give one of the other keys a name.
   *
   * Optional. Without it the table reads as a list of extended keys, which is
   * what it always was: on the second device of three you are looking at two
   * strings and trying to remember which physical object each one is.
   */
  readonly onNameCosigner?: ((xpub: string, name: string) => Promise<void>) | undefined
  /** How many quorums are registered, so the export is offered only when it carries something. */
  readonly registeredCount?: number
  /**
   * Leaves for building a quorum here rather than importing one.
   *
   * Optional, and offered beside the descriptor field rather than instead of
   * it: importing a descriptor a coordinator built is still the common case
   * when the other cosigners are other vendors' hardware.
   */
  readonly onAssemble?: (() => void) | undefined
  /**
   * Text the camera already read, if the user arrived that way.
   *
   * A descriptor is 200 characters and this device has no keyboard, so typing
   * one on a 7 inch panel is not a route anybody takes twice.
   */
  readonly initialText?: string
  /** Leaves for the camera. Absent where there is no camera to reach. */
  readonly onScan?: (() => void) | undefined
  readonly onBack: () => void
  /** Where this screen sits in a journey, when it is part of one. */
  readonly steps?: ReactElement | null
  /** Who this device is and which wallet it has open. See `Identity`. */
  readonly identity?: ReactNode
  readonly banner?: ReactElement | null
}

export function MultisigScreen(props: MultisigScreenProps): ReactElement {
  const {
    onOurKey,
    onReview,
    onRegister,
    onImportFile,
    onExportBundle,
    onNameCosigner,
    registeredCount = 0,
    onAssemble,
    initialText,
    onScan,
    onBack,
    steps,

    identity,
    banner,
    nav,
  } = props

  const [ourKey, setOurKey] = useState<OurKeyView | null>(null)
  const [descriptor, setDescriptor] = useState(initialText ?? '')
  const [review, setReview] = useState<RegistrationView | null>(null)
  const [registered, setRegistered] = useState(false)
  const [imported, setImported] = useState<ImportedFileView | null>(null)
  const [bundle, setBundle] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const key = await onOurKey()
        if (!cancelled) setOurKey(key)
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [onOurKey])

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // --- The bundle a coordinator needs -------------------------------------
  if (bundle !== null) {
    return (
      <Screen
        title="For the coordinator"
        subtitle="Public keys and descriptors. Nothing here can spend."
        banner={banner}
        nav={nav}
        identity={identity}
        steps={steps}
        testId="multisig-bundle"
        actions={
          <Button
            onClick={() => {
              setBundle(null)
            }}
            testId="multisig-bundle-back"
          >
            Back
          </Button>
        }
      >
        <QrDisplay text={bundle} fileType="json" testId="multisig-bundle-qr" />

        <details className="nr-details">
          <summary className="nr-details__summary">Show it as text, to save on a card</summary>
          <div className="nr-field">
            <textarea
              className="nr-input nr-input--area nr-break"
              readOnly
              rows={8}
              value={bundle}
              data-testid="multisig-bundle-text"
            />
          </div>
        </details>

        <Info label="What has to match" testId="multisig-bundle-note">
          Every cosigner has to register the same descriptor, character for character, and the
          coordinator has to import it too. A quorum that every device agreed to is still invisible
          to the software that builds the transactions until this reaches it.
        </Info>
      </Screen>
    )
  }

  // --- What arrived in a coordinator file ----------------------------------
  // The file is read, and nothing in it is believed. Its name and its policy
  // lines are prose written by whoever exported it; the descriptor is the only
  // part that decides an address, and it still goes through the same review as
  // one typed in by hand.
  if (imported !== null) {
    return (
      <Screen
        title="What that file contains"
        subtitle={`Read as ${imported.format}. Nothing in it is verified yet.`}
        banner={banner}
        nav={nav}
        identity={identity}
        steps={steps}
        testId="multisig-imported"
        actions={
          <Button
            onClick={() => {
              setImported(null)
              setError(null)
            }}
            testId="multisig-imported-back"
          >
            Back
          </Button>
        }
      >
        {imported.name !== null && (
          <div className="nr-card nr-card--tight">
            <div className="nr-row">
              <span className="nr-label">Called</span>
              <span className="nr-value" data-testid="multisig-imported-name">
                {imported.name}
              </span>
            </div>
          </div>
        )}

        {imported.unverifiedClaims.length > 0 && (
          <div className="nr-banner nr-banner--caution" data-testid="multisig-imported-claims">
            <strong>The file also says this, and the device does not check it</strong>
            <span>
              {imported.unverifiedClaims.join('. ')}. Only the descriptor decides an address. If one
              of those lines disagrees with what you were told, stop and ask the coordinator before
              registering anything.
            </span>
          </div>
        )}

        <div className="nr-wlist" data-testid="multisig-imported-descriptors">
          {imported.descriptors.map((entry) => (
            <button
              key={entry.descriptor}
              type="button"
              className="nr-choice"
              onClick={() => {
                setDescriptor(entry.descriptor)
                setImported(null)
                void run(async () => {
                  setReview(await onReview(entry.descriptor))
                })
              }}
              data-testid={`multisig-imported-pick-${String(imported.descriptors.indexOf(entry))}`}
            >
              <span className="nr-choice__title">
                {entry.change === null
                  ? 'Descriptor'
                  : entry.change
                    ? 'Change branch'
                    : 'Receive branch'}
              </span>
              <span className="nr-choice__desc nr-mono nr-break">{entry.descriptor}</span>
            </button>
          ))}
        </div>

        <p className="nr-note">
          Choosing one checks it the same way a descriptor typed in by hand is checked. Reading a
          file registers nothing.
        </p>

        {error !== null && (
          <Refusal title="Not registered" testId="multisig-error">
            {error}
          </Refusal>
        )}
      </Screen>
    )
  }

  if (registered && review !== null) {
    return (
      <Screen
        title="Quorum registered"
        subtitle={`${String(review.threshold)} of ${String(review.total)}, and this device is one of them.`}
        banner={banner}
        nav={nav}
        identity={identity}
        steps={steps}
        testId="multisig-registered"
        actions={
          <>
            {onExportBundle !== undefined && (
              <Button
                onClick={() =>
                  void run(async () => {
                    setBundle((await onExportBundle()).bundle)
                  })
                }
                testId="multisig-export-after"
              >
                {busy ? 'Writing' : 'For the coordinator'}
              </Button>
            )}
            <div className="nr-spacer" />
            <Button variant="primary" onClick={onBack} testId="multisig-done">
              Done
            </Button>
          </>
        }
      >
        <div className="nr-card nr-card--tight">
          <p className="nr-hint">
            This device will now recognise the quorum&rsquo;s change as its own, and will sign for
            it. Every other cosigner has to register the same descriptor, character for character,
            or their addresses will not match yours.
          </p>
        </div>
        <div className="nr-field">
          <span className="nr-field__label">Registered descriptor</span>
          <textarea
            className="nr-input nr-input--area nr-break"
            readOnly
            rows={5}
            value={review.descriptor}
            data-testid="multisig-descriptor-out"
          />
        </div>
      </Screen>
    )
  }

  /*
   * "your key" rather than "this device's key", which is the same fact in nine
   * fewer characters. At fifty this subtitle needed 300px of a title column
   * that has 288 when the open wallet carries the longest name the daemon will
   * seal, so its last words were cut. The header names the device two inches
   * away, so whose key it is was never in doubt.
   */
  return (
    <Screen
      title="Multisig"
      subtitle="Share your key, then register the quorum."
      banner={banner}
      nav={nav}
      identity={identity}
      steps={steps}
      testId="multisig-screen"
      actions={
        <>
          <Button variant="ghost" onClick={onBack} testId="multisig-cancel">
            Cancel
          </Button>
          <div className="nr-spacer" />
          {review === null ? (
            <Button
              disabled={descriptor.trim().length === 0 || busy}
              onClick={() =>
                void run(async () => {
                  setReview(await onReview(descriptor))
                })
              }
              testId="multisig-review"
            >
              {busy ? 'Checking' : 'Check quorum'}
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await onRegister(review.descriptor)
                  setRegistered(true)
                })
              }
              testId="multisig-register"
            >
              {busy ? 'Registering' : 'Register'}
            </Button>
          )}
        </>
      }
    >
      {/* FIRST, because it is the answer to what just happened.

          This sat after the whole input block and landed 14px under the fold,
          which on a screen somebody has just tapped Review on means the screen
          appears not to have responded. Same shape as the signing screen had.
          data-must-see is what noticed, once the gallery had a state whose
          handlers reject. */}
      {error !== null && (
        <Refusal title="Not registered" testId="multisig-error">
          {error}
        </Refusal>
      )}

      {/* THE SLOWEST OF THE FOUR. Registering a quorum reseals the store, which
          OPENS the envelope and then SEALS it, so it is two Argon2id runs back
          to back rather than one. On a Pi that is long enough to read as a
          device that has stopped responding, and the only sign of it was a
          button reading "Registering". */}
      {busy && (
        <Working label="Rewriting the wallet" testId="multisig-working">
          The wallet file is being rewritten, so leave the device alone until it is finished.
        </Working>
      )}

      {/* THE KEY YOU HAND OVER AND THE ONE THAT COMES BACK, SIDE BY SIDE.

          Stacked, this screen was 548px of content in a 317px body, and what
          the panel showed was a card and an empty textarea: the three ways to
          get a descriptor in were all below the fold, on a device where typing
          one by hand is not among them. They are two halves of one exchange and
          they belong in one view. */}
      <div className={review === null ? 'nr-split nr-split--even' : ''}>
        {review === null && ourKey !== null && (
          <div className="nr-card nr-card--tight" data-testid="multisig-our-key">
            <div className="nr-row">
              <span className="nr-label">Our key</span>
              <span className="nr-value nr-mono">{ourKey.path}</span>
            </div>
            <div className="nr-row">
              <span className="nr-label">Fingerprint</span>
              <span className="nr-value nr-mono">{ourKey.masterFingerprint}</span>
            </div>
            <Hash value={ourKey.xpub} />
            <p className="nr-hint">
              Give this to the coordinator. It is a public key: it can derive addresses and cannot
              spend anything.
            </p>
          </div>
        )}

        {review === null && onExportBundle !== undefined && registeredCount > 0 && (
          <Button
            onClick={() =>
              void run(async () => {
                setBundle((await onExportBundle()).bundle)
              })
            }
            testId="multisig-export"
          >
            {busy ? 'Writing' : `For the coordinator (${String(registeredCount)} registered)`}
          </Button>
        )}

        {/* THE WAYS IN, BESIDE THE BOX RATHER THAN UNDER IT.

          Every one of them was below the fold. The screen showed a large empty
          textarea and nothing else, on a device with no keyboard, where typing
          a descriptor by hand is not a thing anybody does: you scan it, or you
          read a coordinator file, or you build it from keys you already hold.
          The box was the only visible affordance and it was the one that does
          not work here.

          Three rows rather than five for the same reason. It is a paste and
          scan target, not something typed into. */}
        {review === null && (
          <div className="nr-field">
            <span className="nr-field__label">Quorum descriptor</span>
            <div className="nr-split__col">
              <textarea
                className="nr-input nr-input--area nr-break"
                rows={3}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                placeholder="wsh(sortedmulti(2,[...]xpub.../<0;1>/*,...))#checksum"
                value={descriptor}
                onChange={(e) => {
                  setDescriptor(e.target.value)
                }}
                data-testid="multisig-input"
              />
              <div className="nr-split__col">
                {onScan !== undefined && (
                  <Button onClick={onScan} testId="multisig-scan">
                    Scan it with the camera
                  </Button>
                )}

                {/* The same field. A coordinator export is usually a wrapper around
              the descriptor above, and pasting either into one box is fewer
              decisions than choosing which box to paste into. */}
                {onAssemble !== undefined && (
                  <Button onClick={onAssemble} testId="multisig-assemble">
                    I have the other keys, build it here
                  </Button>
                )}
                {onImportFile !== undefined && (
                  <Button
                    disabled={descriptor.trim().length === 0 || busy}
                    onClick={() =>
                      void run(async () => {
                        setImported(await onImportFile(descriptor))
                      })
                    }
                    testId="multisig-import"
                  >
                    {busy ? 'Reading' : 'That is a coordinator file, read it'}
                  </Button>
                )}
              </div>
            </div>
            <p className="nr-hint">
              The checksum is required. It is the only thing standing between a mistyped character
              and a valid descriptor for a completely different wallet.
            </p>
          </div>
        )}
      </div>

      {review !== null && (
        <>
          <div className="nr-card nr-card--tight">
            <div className="nr-row">
              <span className="nr-label">Quorum</span>
              <span className="nr-value" data-testid="multisig-quorum">
                {review.threshold} of {review.total} must sign
              </span>
            </div>
            <div className="nr-row">
              <span className="nr-label">Script</span>
              <span className="nr-value nr-mono">
                {review.kind}, {review.sorted ? 'sortedmulti' : 'multi'}
              </span>
            </div>
            <div className="nr-row">
              <span className="nr-label">This device</span>
              <span className="nr-value nr-ok" data-testid="multisig-our-position">
                cosigner {review.ourPosition + 1} of {review.total}
              </span>
            </div>
            <p className="nr-hint">
              Verified by re-deriving this device&rsquo;s key and matching the key itself. A
              descriptor that did not contain it would have been refused.
            </p>
          </div>

          <div className="nr-card">
            <span className="nr-card__label">Cosigners</span>
            <table className="nr-table nr-table--dense" data-testid="multisig-cosigners">
              <thead>
                <tr>
                  <th className="nr-table__index">#</th>
                  <th>Key</th>
                </tr>
              </thead>
              <tbody>
                {review.cosigners.map((cosigner) => (
                  <tr key={cosigner.position}>
                    <td className="nr-mono nr-table__index">{cosigner.position + 1}</td>
                    <td>
                      {/* The user's own name for this key, above the key
                          itself, because on a device holding one of three it
                          is the only part anybody can act on. Marked as theirs
                          rather than presented as a fact: it says nothing
                          about who controls the key. */}
                      {cosigner.name !== undefined && (
                        <div data-testid={`cosigner-name-${String(cosigner.position)}`}>
                          {cosigner.name}
                          <span className="nr-hint"> your name for it</span>
                        </div>
                      )}
                      <div className="nr-mono nr-break">{cosigner.xpub}</div>
                      <div className="nr-hint">
                        {cosigner.isThisDevice ? (
                          <span className="nr-ok">this device, verified</span>
                        ) : (
                          <>
                            {cosigner.fingerprint ?? 'no fingerprint'}
                            {cosigner.origin === undefined ? '' : ` at ${cosigner.origin}`},
                            unverified
                          </>
                        )}
                      </div>
                      {onNameCosigner !== undefined &&
                        !cosigner.isThisDevice &&
                        cosigner.fullXpub !== undefined && (
                          <input
                            className="nr-input"
                            defaultValue={cosigner.name ?? ''}
                            maxLength={32}
                            placeholder="Name it, for you"
                            spellCheck={false}
                            // THROUGH run(), NOT `void`. Two things were wrong
                            // with firing this bare.
                            //
                            // Naming a cosigner RESEALS THE WALLET: it verifies
                            // the passphrase by opening the envelope and writes
                            // a new one, which is two Argon2id runs and several
                            // seconds on a Pi. Outside run() nothing set busy,
                            // so the device went away for seconds with no
                            // disabled control and no message, triggered by
                            // tapping away from a text field.
                            //
                            // And `void` DISCARDED THE REJECTION. A reseal that
                            // failed left the typed name sitting in the input
                            // looking saved. The name is not key material, but
                            // a silently dropped write is how somebody comes to
                            // trust a label that does not exist on the device.
                            onBlur={(e) => {
                              const full = cosigner.fullXpub
                              if (full === undefined) return
                              const name = e.target.value
                              void run(async () => {
                                await onNameCosigner(full, name)
                              })
                            }}
                            data-testid={`cosigner-rename-${String(cosigner.position)}`}
                          />
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="nr-hint">
              Read these against what the other cosigners see. Only the entry marked as this device
              has been verified: a fingerprint is four bytes chosen by whoever wrote the descriptor,
              so it is shown and not believed.
            </p>
          </div>

          {review.warnings.map((warning) => (
            <div key={warning.kind + warning.message} className="nr-banner nr-banner--caution">
              <strong>Check this</strong>
              <span>{warning.message}</span>
            </div>
          ))}
        </>
      )}
    </Screen>
  )
}
