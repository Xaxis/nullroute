import { type ReactElement, useEffect, useState } from 'react'
import { Screen } from '../components/Screen.js'
import { Button } from '../components/Button.js'
import { Hash } from '../components/Hash.js'

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

export interface MultisigScreenProps {
  readonly onOurKey: () => Promise<OurKeyView>
  readonly onReview: (descriptor: string) => Promise<RegistrationView>
  readonly onRegister: (descriptor: string) => Promise<void>
  readonly onBack: () => void
  readonly banner?: ReactElement | null
}

export function MultisigScreen(props: MultisigScreenProps): ReactElement {
  const { onOurKey, onReview, onRegister, onBack, banner } = props

  const [ourKey, setOurKey] = useState<OurKeyView | null>(null)
  const [descriptor, setDescriptor] = useState('')
  const [review, setReview] = useState<RegistrationView | null>(null)
  const [registered, setRegistered] = useState(false)
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

  if (registered && review !== null) {
    return (
      <Screen
        title="Quorum registered"
        subtitle={`${String(review.threshold)} of ${String(review.total)}, and this device is one of them.`}
        banner={banner}
        testId="multisig-registered"
        actions={
          <>
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

  return (
    <Screen
      title="Multisig"
      subtitle="Share this device's key, then register the quorum."
      banner={banner}
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
              onClick={() => void run(async () => { setReview(await onReview(descriptor)) })}
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

      {review === null && (
        <div className="nr-field">
          <span className="nr-field__label">Quorum descriptor</span>
          <textarea
            className="nr-input nr-input--area nr-break"
            rows={5}
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
          <p className="nr-hint">
            The checksum is required. It is the only thing standing between a mistyped character
            and a valid descriptor for a completely different wallet.
          </p>
        </div>
      )}

      {error !== null && (
        <div className="nr-banner nr-banner--danger" data-testid="multisig-error">
          <strong>Not registered</strong>
          <span>{error}</span>
        </div>
      )}

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
                      <div className="nr-mono nr-break">{cosigner.xpub}</div>
                      <div className="nr-hint">
                        {cosigner.isThisDevice ? (
                          <span className="nr-ok">this device, verified</span>
                        ) : (
                          <>
                            {cosigner.fingerprint ?? 'no fingerprint'}
                            {cosigner.origin === undefined ? '' : ` at ${cosigner.origin}`}
                            , unverified
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="nr-hint">
              Read these against what the other cosigners see. Only the entry marked as this
              device has been verified: a fingerprint is four bytes chosen by whoever wrote the
              descriptor, so it is shown and not believed.
            </p>
          </div>

          {review.warnings.map((warning) => (
            <div key={warning.kind + warning.message} className="nr-banner nr-banner--testnet">
              <strong>Check this</strong>
              <span>{warning.message}</span>
            </div>
          ))}
        </>
      )}
    </Screen>
  )
}
