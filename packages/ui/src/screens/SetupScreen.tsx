import { type ReactElement, useState } from 'react'
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

export type EntropyMode = 'dice' | 'import'
export type NetworkChoice = 'mainnet' | 'testnet4' | 'signet' | 'regtest'

export interface SetupScreenProps {
  readonly onStart: (mode: EntropyMode, network: NetworkChoice) => void
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
  const { onStart, banner } = props
  const [network, setNetwork] = useState<NetworkChoice>('mainnet')
  const [mode, setMode] = useState<EntropyMode>('dice')

  return (
    <Screen
      title="Set up this device"
      subtitle="No wallet exists yet."
      banner={banner}
      testId="setup-screen"
      actions={
        <>
          <div className="nr-spacer" />
          <Button
            variant="primary"
            onClick={() => {
              onStart(mode, network)
            }}
            testId="setup-start"
          >
            {mode === 'dice' ? 'Roll the dice' : 'Enter a mnemonic'}
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

      <Choice
        title="Import an existing mnemonic"
        description="Recover a wallet, or bring in a seed generated elsewhere. The checksum is validated and the fingerprint is shown so you can confirm it is the wallet you meant."
        selected={mode === 'import'}
        onSelect={() => {
          setMode('import')
        }}
        testId="mode-import"
      />

      <div className="nr-banner nr-banner--info">
        <strong>Note</strong>
        <span>
          A machine-only mode exists in the design and is deliberately not offered here yet. It is
          the mode every other device uses by default, and it is the one this project exists to
          avoid: not broken, but unverifiable. You cannot check a number a black box handed you.
        </span>
      </div>
    </Screen>
  )
}
