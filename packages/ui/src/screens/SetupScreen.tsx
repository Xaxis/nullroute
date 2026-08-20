import { type ReactElement, type ReactNode, useState } from 'react'
import { Screen } from '../components/Screen.js'
import { Button } from '../components/Button.js'
import { Choice } from '../components/Choice.js'

/**
 * First run: choose a network, then choose how the seed comes into being.
 *
 * Spec: ui.screens.setup
 *
 * The network is chosen HERE and locked to the wallet, because the same seed on
 * a different network is a different wallet and switching later would silently
 * show addresses nobody funded. The daemon enforces that; this screen is where
 * the decision is made visible.
 *
 * The entropy modes are presented with their honest trade-offs rather than as
 * equivalent options. Mode C is available and is described as what it is.
 */

export type EntropyMode = 'dice' | 'machine' | 'import'
export type NetworkChoice = 'mainnet' | 'testnet4' | 'signet' | 'regtest'

export interface SetupScreenProps {
  /**
   * The navigation menu, when leaving this screen is free.
   *
   * The only signal this device gives for that. It replaced a Home button in
   * the same corner meaning the same thing, which is how that corner came to
   * have three states and no rule.
   */
  readonly nav?: ReactNode
  readonly onStart: (mode: EntropyMode, network: NetworkChoice) => void
  /** Where this screen sits in a journey, when it is part of one. */
  readonly steps?: ReactElement | null
  /**
   * Back to the picker, from the action bar.
   *
   * Named for what it is now. It was `onHome`, which was the header button's
   * prop name back when Screen rendered one, and this screen borrowed it for a
   * Cancel in the body. When the header button went, a sweep took the prop with
   * it and this button silently stopped rendering: the screen that had no way
   * out went back to having no way out, and only a test noticed.
   */
  readonly onCancel?: (() => void) | undefined
  /** Who this device is and which wallet it has open. See `Identity`. */
  readonly identity?: ReactNode
  readonly banner?: ReactElement | null
}

const NETWORKS: { id: NetworkChoice; label: string; description: string }[] = [
  { id: 'mainnet', label: 'Mainnet', description: 'Real bitcoin.' },
  {
    id: 'signet',
    label: 'Signet',
    description: 'A test network. Address-identical to testnet3 and testnet4.',
  },
  {
    id: 'testnet4',
    label: 'Testnet4',
    description: 'A test network. Address-identical to signet and testnet3.',
  },
  { id: 'regtest', label: 'Regtest', description: 'A local test network.' },
]

export function SetupScreen(props: SetupScreenProps): ReactElement {
  const { onStart, steps, identity, banner, nav, onCancel } = props
  const [network, setNetwork] = useState<NetworkChoice>('mainnet')
  const [mode, setMode] = useState<EntropyMode>('dice')

  return (
    <Screen
      title="Set up this device"
      subtitle="No wallet exists yet."
      banner={banner}
      nav={nav}
      identity={identity}
      steps={steps}
      testId="setup-screen"
      actions={
        <>
          {/* This screen had no way out at all. Tapping "add a wallet" from the
              picker and changing your mind left you here, on a device with no
              browser back and no window to close. */}
          {onCancel !== undefined && (
            <Button onClick={onCancel} testId="setup-cancel">
              Cancel
            </Button>
          )}
          <div className="nr-spacer" />
          <Button
            variant="primary"
            onClick={() => {
              onStart(mode, network)
            }}
            testId="setup-start"
          >
            {mode === 'dice'
              ? 'Roll the dice'
              : mode === 'machine'
                ? 'Let the device choose'
                : 'Enter a mnemonic'}
          </Button>
        </>
      }
    >
      <div className="nr-field">
        <span className="nr-field__label">Network</span>
        <div className="nr-tabs">
          {NETWORKS.map((n) => (
            <button
              key={n.id}
              type="button"
              className="nr-tab"
              aria-pressed={network === n.id}
              onClick={() => {
                setNetwork(n.id)
              }}
              data-testid={`network-${n.id}`}
            >
              {n.label}
            </button>
          ))}
        </div>
        <p className="nr-hint">
          {NETWORKS.find((n) => n.id === network)?.description} Chosen once and locked to this
          wallet: the same seed on a different network derives different addresses.
        </p>
      </div>

      <Choice
        title="Roll dice"
        description="100 rolls of a d6. The device shows you the arithmetic, and you can reproduce the result on any machine with sha256sum. This is the only mode where the device can be caught lying to you."
        tag={{ text: 'recommended', tone: 'ok' }}
        selected={mode === 'dice'}
        onSelect={() => {
          setMode('dice')
        }}
        testId="mode-dice"
      />

      {/* Offered, and never level with the dice. The tag and the description
          say what is being given up rather than leaving the two looking like a
          preference. */}
      <Choice
        title="Let the device choose"
        description="A seed from this device's random number generator, with no dice. This is what every other hardware wallet does by default. Nothing about the result can be checked by hand: you are trusting the hardware, the kernel and this code."
        tag={{ text: 'cannot be verified', tone: 'warn' }}
        selected={mode === 'machine'}
        onSelect={() => {
          setMode('machine')
        }}
        testId="mode-machine"
      />

      <Choice
        title="Import an existing mnemonic"
        description="Recover a wallet, or bring in a seed generated elsewhere. The checksum is validated and the fingerprint is shown so you can confirm it is the wallet you meant."
        selected={mode === 'import'}
        onSelect={() => {
          setMode('import')
        }}
        testId="mode-import"
      />

      {mode === 'machine' && (
        <div className="nr-banner nr-banner--danger" data-testid="setup-machine-warning">
          <strong>You will not be able to check this seed</strong>
          <span>
            The dice path can be reproduced with a die and any machine that has sha256sum, which
            is the property that makes this device worth using over a black box. This path has
            none of it. The device will still check that its generator is present and not stuck,
            and that is a much weaker claim than being able to redo the arithmetic yourself.
          </span>
        </div>
      )}
    </Screen>
  )
}
