import { type ReactElement, type ReactNode, useState } from 'react'
import { Screen } from '../components/Screen.js'
import { Button } from '../components/Button.js'

/**
 * BIP-85: deriving a child seed from this wallet's.
 *
 * Spec: ui.screens.child-seed
 *
 * THIS SCREEN DELIBERATELY DISPLAYS KEY MATERIAL, which makes it the second
 * place on the device that does, after revealing the mnemonic itself. That is
 * the point rather than an oversight: a derived child is a wallet the user is
 * about to write down, and one they cannot see is one they cannot use.
 *
 * What it must not do is let anyone forget where the child came from. A BIP-85
 * child is NOT independent of its parent. Anyone with the master mnemonic can
 * derive every child it has ever produced, so a child handed to somebody else
 * is protected by the parent's secrecy and nothing of its own. Every screen
 * here says that, and the path is displayed with the words rather than on
 * request, because a child written down without its path is unrecoverable.
 *
 * NOTHING IS WRITTEN. Deriving a child does not create a wallet on this device.
 * A child the user wants to keep is imported as a wallet in its own right and
 * goes through the same confirmation as any other.
 */

export type ChildApplication = 'mnemonic' | 'hex' | 'password'

export interface ChildSeedView {
  readonly path: string
  readonly words?: string
  readonly wordCount?: number
  readonly hex?: string
  readonly password?: string
}

export interface ChildSeedScreenProps {
  /**
   * The navigation menu, when leaving this screen is free.
   *
   * The only signal this device gives for that. It replaced a Home button in
   * the same corner meaning the same thing, which is how that corner came to
   * have three states and no rule.
   */
  readonly nav?: ReactNode
  readonly onDerive: (
    application: ChildApplication,
    index: number,
    size: number
  ) => Promise<ChildSeedView>
  readonly onBack: () => void
  /** Who this device is and which wallet it has open. See `Identity`. */
  readonly identity?: ReactNode
  readonly banner?: ReactElement | null
}

/** The sizes each application allows, as BIP-85 defines them. */
const SIZES: Record<ChildApplication, readonly number[]> = {
  mnemonic: [12, 18, 24],
  hex: [16, 32, 64],
  password: [20, 24, 32],
}

const APPLICATIONS: {
  readonly id: ChildApplication
  readonly label: string
  readonly unit: string
}[] = [
  { id: 'mnemonic', label: 'A mnemonic', unit: 'words' },
  { id: 'hex', label: 'Hex bytes', unit: 'bytes' },
  { id: 'password', label: 'A password', unit: 'characters' },
]

export function ChildSeedScreen(props: ChildSeedScreenProps): ReactElement {
  const { onDerive, onBack, identity, banner, nav } = props

  const [application, setApplication] = useState<ChildApplication>('mnemonic')
  const [size, setSize] = useState(12)
  const [index, setIndex] = useState(0)
  const [child, setChild] = useState<ChildSeedView | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const unit = APPLICATIONS.find((a) => a.id === application)?.unit ?? ''

  // --- What was derived ------------------------------------------------------
  if (child !== null) {
    return (
      <Screen
        title="Child seed"
        subtitle="Write down the path with it. Without the path this is unrecoverable."
        banner={banner}
        nav={nav}
        identity={identity}
        testId="child-result"
        actions={
          <Button
            onClick={() => {
              setChild(null)
            }}
            testId="child-done"
          >
            Done
          </Button>
        }
      >
        <div className="nr-card nr-card--tight">
          <div className="nr-row">
            <span className="nr-label">Path</span>
            <span className="nr-value nr-mono" data-testid="child-path">
              {child.path}
            </span>
          </div>
        </div>

        {child.words !== undefined && (
          <div className="nr-card">
            <span className="nr-card__label">{child.wordCount} words</span>
            <div className="nr-mono nr-break" data-testid="child-words">
              {child.words}
            </div>
          </div>
        )}
        {child.hex !== undefined && (
          <div className="nr-card">
            <span className="nr-card__label">Hex</span>
            <div className="nr-mono nr-break" data-testid="child-hex">
              {child.hex}
            </div>
          </div>
        )}
        {child.password !== undefined && (
          <div className="nr-card">
            <span className="nr-card__label">Password</span>
            <div className="nr-mono nr-break" data-testid="child-password">
              {child.password}
            </div>
          </div>
        )}

        {/* The whole reason this screen is written carefully. */}
        <div className="nr-banner nr-banner--danger" data-testid="child-parent-warning">
          <strong>This is not independent of the wallet that made it</strong>
          <span>
            Anyone holding this device&apos;s mnemonic can derive this child and every other one it
            has ever produced. Giving this to somebody else does not give them something separate:
            it gives them something your seed still controls. If you need a wallet that is genuinely
            separate, roll dice for it.
          </span>
        </div>

        <p className="nr-note" data-testid="child-not-saved">
          Nothing was written to this device. To keep this as a wallet here, import it like any
          other mnemonic, which goes through the same confirmation.
        </p>
      </Screen>
    )
  }

  // --- Choosing what to derive ----------------------------------------------
  return (
    <Screen
      title="Derive a child seed"
      subtitle="BIP-85. One master, many wallets, all recoverable from it."
      banner={banner}
      nav={nav}
      identity={identity}
      testId="child-screen"
      actions={
        <>
          <Button onClick={onBack} testId="child-back">
            Back
          </Button>
          <div className="nr-spacer" />
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              void (async () => {
                setBusy(true)
                setError(null)
                try {
                  setChild(await onDerive(application, index, size))
                } catch (err) {
                  setError((err as Error).message)
                } finally {
                  setBusy(false)
                }
              })()
            }}
            testId="child-derive"
          >
            {busy ? 'Deriving' : 'Derive'}
          </Button>
        </>
      }
    >
      <div className="nr-tabs">
        {APPLICATIONS.map((app) => (
          <button
            key={app.id}
            type="button"
            className="nr-tab"
            aria-pressed={application === app.id}
            onClick={() => {
              setApplication(app.id)
              // Each application allows different sizes, and carrying one over
              // would send the daemon a value it refuses by name.
              setSize(SIZES[app.id][0] ?? 12)
            }}
            data-testid={`child-app-${app.id}`}
          >
            {app.label}
          </button>
        ))}
      </div>

      <div className="nr-tabs" data-testid="child-sizes">
        {SIZES[application].map((option) => (
          <button
            key={option}
            type="button"
            className="nr-tab"
            aria-pressed={size === option}
            onClick={() => {
              setSize(option)
            }}
            data-testid={`child-size-${String(option)}`}
          >
            {option} {unit}
          </button>
        ))}
      </div>

      <div className="nr-card nr-card--tight">
        <div className="nr-row">
          <span className="nr-label">Index</span>
          <span className="nr-value nr-mono" data-testid="child-index">
            {index}
          </span>
          <div className="nr-spacer" />
          <Button
            disabled={index === 0}
            onClick={() => {
              setIndex(Math.max(0, index - 1))
            }}
            testId="child-index-down"
          >
            Down
          </Button>
          <Button
            onClick={() => {
              setIndex(index + 1)
            }}
            testId="child-index-up"
          >
            Up
          </Button>
        </div>
        <p className="nr-hint">
          The index is what makes each child different. The same index always gives the same child,
          so this is a way to recreate a wallet rather than a way to make a new random one.
        </p>
      </div>

      <p className="nr-note" data-testid="child-warning">
        Every child derived here is recoverable from this wallet&apos;s mnemonic and from nothing
        else. That is the feature: one set of words backs up all of them. It is also the limit,
        because a child given to somebody else is still controlled by the seed that made it.
      </p>

      {error !== null && (
        <div className="nr-banner nr-banner--danger" data-testid="child-error">
          <strong>Not derived</strong>
          <span>{error}</span>
        </div>
      )}
    </Screen>
  )
}
