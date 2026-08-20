import { type ReactElement, type ReactNode, useCallback, useEffect, useState } from 'react'
import { Screen } from '../components/Screen.js'
import { Button } from '../components/Button.js'
import { Hash } from '../components/Hash.js'

/**
 * Building a quorum here, without a coordinator.
 *
 * Spec: ui.screens.assemble-quorum
 *
 * WHAT THIS REPLACES. Forming a multisig used to require software on a
 * networked machine: this device exported its own key, somebody assembled a
 * descriptor elsewhere, and the device imported the result. For a fleet of
 * air-gapped devices that made a fourth computer mandatory to create the wallet
 * the other three would then use without one. Three Pis in a room could not
 * agree on a wallet between themselves.
 *
 * Now they can. Collect each device's key by camera or by paste, choose the
 * threshold, and this builds the descriptor. Every device given the same keys
 * produces the same descriptor and the same checksum, whatever order they were
 * collected in, which is the whole point: the eight characters are what the
 * fleet compares.
 *
 * IT REGISTERS NOTHING. Assembling produces a descriptor. That descriptor still
 * goes through the same review as one from a coordinator, which is where the
 * device refuses a quorum it holds no key in and where the warnings about
 * degenerate thresholds live. Building and agreeing are separate acts on
 * purpose: the dangerous one is agreeing.
 */

export interface AssembledView {
  readonly descriptor: string
  readonly checksum: string
  readonly threshold: number
  readonly total: number
  readonly keys: readonly string[]
}

export interface AssembleQuorumScreenProps {
  /**
   * The navigation menu, when leaving this screen is free.
   *
   * The only signal this device gives for that. It replaced a Home button in
   * the same corner meaning the same thing, which is how that corner came to
   * have three states and no rule.
   */
  readonly nav?: ReactNode
  /** This device's own multisig key, fetched so slot one is filled in. */
  readonly onOurKey: () => Promise<{ keyExpression: string; masterFingerprint: string }>
  readonly onAssemble: (threshold: number, keys: readonly string[]) => Promise<AssembledView>
  /** Hands the finished descriptor to the review path. */
  readonly onReview: (descriptor: string) => void
  readonly onScan?: (() => void) | undefined
  /** Text the camera already read, dropped into the next empty slot. */
  readonly scanned?: string | undefined
  readonly onBack: () => void
  /** Who this device is and which wallet it has open. See `Identity`. */
  readonly identity?: ReactNode
  readonly banner?: ReactElement | null
}

export function AssembleQuorumScreen(props: AssembleQuorumScreenProps): ReactElement {
  const { onOurKey, onAssemble, onReview, onScan, scanned, onBack, identity, banner, nav } = props

  /** Slot zero is this device. The rest are the other cosigners. */
  const [keys, setKeys] = useState<string[]>(['', ''])
  const [ours, setOurs] = useState<string | null>(null)
  const [threshold, setThreshold] = useState(2)
  const [built, setBuilt] = useState<AssembledView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // This device's own key, in slot one and not editable. Leaving somebody to
  // paste their own key into their own device would be an invitation to paste
  // the wrong one, and a quorum without this device in it is refused later
  // anyway, at a point where more work has been thrown away.
  const loadOurs = useCallback(async (): Promise<void> => {
    try {
      const key = await onOurKey()
      setOurs(key.keyExpression)
      setKeys((current) => [key.keyExpression, ...current.slice(1)])
    } catch (err) {
      setError((err as Error).message)
    }
  }, [onOurKey])

  useEffect(() => {
    void loadOurs()
  }, [loadOurs])

  // A scanned key goes into the first empty slot that is not ours.
  useEffect(() => {
    if (scanned === undefined || scanned.length === 0) return
    setKeys((current) => {
      const index = current.findIndex((key, position) => position > 0 && key.trim().length === 0)
      if (index === -1) return [...current, scanned]
      return current.map((key, position) => (position === index ? scanned : key))
    })
  }, [scanned])

  const filled = keys.filter((key) => key.trim().length > 0)

  /**
   * The threshold as it actually applies, never larger than the keys collected.
   *
   * The stored value can run ahead: somebody sets 3 of 4, removes a key, and
   * the raw number is now impossible. Before this the screen read "2 of 1" the
   * moment it opened, because the default threshold is 2 and only this device's
   * key is present, which is nonsense on the first screen somebody sees.
   *
   * Clamped rather than corrected, so raising the key count restores what they
   * asked for instead of making them set it again.
   */
  const effectiveThreshold = Math.min(threshold, Math.max(1, filled.length))

  // --- Built ----------------------------------------------------------------
  if (built !== null) {
    return (
      <Screen
        title="Quorum built"
        subtitle={`${String(built.threshold)} of ${String(built.total)}. Nothing is registered yet.`}
        banner={banner}
        nav={nav}
        identity={identity}
        testId="assemble-built"
        actions={
          <>
            <Button
              onClick={() => {
                setBuilt(null)
              }}
              testId="assemble-back-to-keys"
            >
              Change it
            </Button>
            <div className="nr-spacer" />
            <Button
              variant="primary"
              onClick={() => {
                onReview(built.descriptor)
              }}
              testId="assemble-review"
            >
              Check it
            </Button>
          </>
        }
      >
        {/* The checksum, given the space it deserves. This is the value every
            device in the quorum reads aloud to every other one, and it is the
            cheapest possible proof that they built the same wallet. */}
        <div className="nr-attest" data-testid="assemble-checksum">
          <div className="nr-attest__label">Checksum</div>
          <Hash value={built.checksum} expanded testId="assemble-checksum-value" />
          <div className="nr-attest__hint">
            Build the same quorum on every device and compare these eight characters.
          </div>
        </div>

        <p className="nr-note" data-testid="assemble-order-note">
          The order you collected the keys in does not matter. Every device given the same keys
          produces this same descriptor, character for character, so a checksum that differs means
          the keys differ rather than the sequence.
        </p>

        <details className="nr-details">
          <summary className="nr-details__summary">Show the descriptor</summary>
          <div className="nr-field">
            <textarea
              className="nr-input nr-input--area nr-break"
              readOnly
              rows={6}
              value={built.descriptor}
              data-testid="assemble-descriptor"
            />
          </div>
        </details>

        <div className="nr-banner nr-banner--testnet" data-testid="assemble-not-registered">
          <strong>Nothing is registered yet</strong>
          <span>
            This built a descriptor. Checking it is what verifies this device holds a key in it,
            and registering is what makes the device recognise the quorum's change as its own.
            Every other cosigner has to register the same descriptor too.
          </span>
        </div>
      </Screen>
    )
  }

  // --- Collecting keys ------------------------------------------------------
  return (
    <Screen
      title="Build a quorum"
      subtitle="Collect a key from every device, here, with no coordinator."
      banner={banner}
      nav={nav}
      identity={identity}
      testId="assemble-screen"
      actions={
        <>
          <Button onClick={onBack} testId="assemble-cancel">
            Back
          </Button>
          <div className="nr-spacer" />
          <span className="nr-hint" data-testid="assemble-count">
            {effectiveThreshold} of {filled.length}
          </span>
          <Button
            variant="primary"
            disabled={filled.length < 2 || busy}
            onClick={() => {
              void (async () => {
                setBusy(true)
                setError(null)
                try {
                  setBuilt(await onAssemble(effectiveThreshold, filled))
                } catch (err) {
                  setError((err as Error).message)
                } finally {
                  setBusy(false)
                }
              })()
            }}
            testId="assemble-build"
          >
            {busy ? 'Building' : 'Build it'}
          </Button>
        </>
      }
    >
      <div className="nr-card nr-card--tight">
        <span className="nr-card__label">How many signatures spend it</span>
        <div className="nr-row">
          <Button
            disabled={effectiveThreshold <= 1}
            onClick={() => {
              setThreshold(Math.max(1, effectiveThreshold - 1))
            }}
            testId="assemble-threshold-down"
          >
            Fewer
          </Button>
          <span className="nr-value nr-mono" data-testid="assemble-threshold">
            {effectiveThreshold} of {filled.length}
          </span>
          <Button
            disabled={effectiveThreshold >= filled.length}
            onClick={() => {
              setThreshold(effectiveThreshold + 1)
            }}
            testId="assemble-threshold-up"
          >
            More
          </Button>
        </div>
        <p className="nr-hint">
          2 of 3 is the usual choice: any one device can be lost or taken without losing the money,
          and no single one can spend it.
        </p>
      </div>

      <div className="nr-wlist" data-testid="assemble-keys">
        {keys.map((key, index) => (
          <div className="nr-field" key={index}>
            <span className="nr-field__label">
              {index === 0 ? 'This device' : `Cosigner ${String(index + 1)}`}
            </span>
            {index === 0 ? (
              <div className="nr-mono nr-break nr-address" data-testid="assemble-our-key">
                {ours ?? 'Reading this device&rsquo;s key.'}
              </div>
            ) : (
              <textarea
                className="nr-input nr-input--area nr-break"
                rows={2}
                spellCheck={false}
                placeholder="[fingerprint/48h/0h/0h/2h]xpub.../<0;1>/*"
                value={key}
                onChange={(e) => {
                  const next = e.target.value
                  setKeys((current) =>
                    current.map((existing, position) => (position === index ? next : existing))
                  )
                }}
                data-testid={`assemble-key-${String(index)}`}
              />
            )}
          </div>
        ))}
      </div>

      <div className="nr-row">
        {onScan !== undefined && (
          <Button onClick={onScan} testId="assemble-scan">
            Scan a key
          </Button>
        )}
        <Button
          disabled={keys.length >= 20}
          onClick={() => {
            setKeys((current) => [...current, ''])
          }}
          testId="assemble-add-slot"
        >
          Another cosigner
        </Button>
      </div>

      <p className="nr-note" data-testid="assemble-what-to-collect">
        Each device shows its own key under Multisig. Read it here by camera, or paste it. It is a
        public key: it derives addresses and cannot spend anything, so carrying it between devices
        risks nothing.
      </p>

      {error !== null && (
        <div className="nr-banner nr-banner--danger" data-testid="assemble-error">
          <strong>Not built</strong>
          <span>{error}</span>
        </div>
      )}
    </Screen>
  )
}
