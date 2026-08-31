import { type ReactElement, type ReactNode } from 'react'
import { Screen } from '../components/Screen.js'
import { Choice } from '../components/Choice.js'
import { Button } from '../components/Button.js'

/**
 * Everything that is not the wallet, the signing screen or an address.
 *
 * Spec: ui.screens.more
 *
 * WHY THIS IS A SCREEN AND NOT A TAB. It used to be the fourth tab of the
 * wallet screen, which made it a view OF the wallet. It is not: switching
 * wallets, checking the device, naming the device and deriving a child seed are
 * not things about the open wallet, and half of them lead away from it
 * entirely. Once the navigation rail existed, "More" appeared in two places
 * meaning the same thing, and the tab was the wrong one to keep.
 *
 * NOTHING HERE IS NEW. Every entry is the same Choice, with the same words and
 * the same testid, as the tab carried. What changed is that it is reachable
 * from every screen rather than from one, and that it no longer competes with
 * the address list for the same viewport.
 *
 * ORDER IS BY DISTANCE FROM THE OPEN WALLET. Things you do to this wallet
 * first, then things you do to the device, then the one that shows key
 * material. It is not alphabetical, and it is not by how often somebody taps
 * them: a list ordered by frequency puts erasing a wallet next to looking at
 * an address.
 */

export interface MoreScreenProps {
  readonly onMultisig: () => void
  readonly onProveControl?: (() => void) | undefined
  readonly onCheckProof?: (() => void) | undefined
  readonly onBackup?: (() => void) | undefined
  readonly onLabels?: (() => void) | undefined
  readonly onManage?: (() => void) | undefined
  readonly onSwitchWallet?: (() => void) | undefined
  readonly onCheckDevice?: (() => void) | undefined
  readonly onNameDevice?: (() => void) | undefined
  readonly onChildSeed?: (() => void) | undefined
  readonly onBack: () => void
  /** Which theme the panel is rendering in. */
  readonly theme?: 'dark' | 'light'
  /**
   * Change it.
   *
   * Absent on a device with no name yet, because the theme lives in the same
   * file the name does and there is nothing to write it into. That is worth an
   * explanation on screen rather than a control that fails.
   */
  readonly onSetTheme?: ((theme: 'dark' | 'light') => Promise<void>) | undefined
  readonly nav?: ReactElement | null
  /** Who this device is and which wallet it has open. See `Identity`. */
  readonly identity?: ReactNode
  readonly banner?: ReactElement | null
}

export function MoreScreen(props: MoreScreenProps): ReactElement {
  const {
    onMultisig,
    onProveControl,
    onCheckProof,
    onBackup,
    onLabels,
    onManage,
    onSwitchWallet,
    onCheckDevice,
    onNameDevice,
    onChildSeed,
    onBack,
    theme = 'dark',
    onSetTheme,
    nav,
    identity,
    banner,
  } = props

  return (
    <Screen
      title="More"
      subtitle="Grouped by what each one acts on."
      banner={banner}
      nav={nav}
      identity={identity}
      testId="more-screen"
      actions={
        <>
          {/* Only a way back. Every destination on this screen is in the body,
              where a list of choices belongs, rather than split between a body
              and a bar. */}
          <Button onClick={onBack} testId="more-back">
            Back
          </Button>
        </>
      }
    >
      <div className="nr-wlist" data-testid="wallet-more">
        <section className="nr-section" data-testid="more-group-wallet">
          <h2 className="nr-section__title">This wallet</h2>
          <div className="nr-section__items">
            {onBackup !== undefined && (
              <Choice
                title="Backup"
                description="Write an encrypted backup of this wallet, or restore one onto this device."
                selected={false}
                onSelect={onBackup}
                testId="wallet-backup"
              />
            )}
            {onLabels !== undefined && (
              <Choice
                title="Labels"
                description="Read and write BIP-329 label files. A label is a note and decides nothing."
                selected={false}
                onSelect={onLabels}
                testId="wallet-labels"
              />
            )}
            {onChildSeed !== undefined && (
              <Choice
                title="Derive a child seed"
                description="BIP-85. Makes another wallet from this one, recoverable from these words and nothing else."
                selected={false}
                onSelect={onChildSeed}
                tag={{ text: 'shows key material', tone: 'warn' }}
                testId="wallet-child"
              />
            )}
            {/* Last in its group on purpose: it is the only one here that can
                take a wallet off this device. */}
            {onManage !== undefined && (
              <Choice
                title="Erase or rename this wallet"
                description="Remove its seed from this device, or change what it is called and the colour beside it. Both need the passphrase."
                selected={false}
                onSelect={onManage}
                testId="wallet-manage"
              />
            )}
          </div>
        </section>

        <section className="nr-section" data-testid="more-group-proofs">
          <h2 className="nr-section__title">Signatures and other devices</h2>
          <div className="nr-section__items">
            {onProveControl !== undefined && (
              <Choice
                title="Prove an address"
                description="Sign a message with one of your addresses, to show somebody it is yours."
                selected={false}
                onSelect={onProveControl}
                testId="wallet-prove"
              />
            )}
            {onCheckProof !== undefined && (
              <Choice
                title="Check a proof"
                description="Somebody sent you an address and a signature. Find out whether it is really theirs."
                selected={false}
                onSelect={onCheckProof}
                testId="wallet-check-proof"
              />
            )}
            <Choice
              title="Multisig"
              description="Hand this device's key to a coordinator, and agree to the quorum that comes back."
              selected={false}
              onSelect={onMultisig}
              testId="wallet-multisig"
            />
          </div>
        </section>

        <section className="nr-section" data-testid="more-group-device">
          <h2 className="nr-section__title">This device</h2>
          <div className="nr-section__items">
            {onSwitchWallet !== undefined && (
              <Choice
                title="Switch wallet"
                description="Open a different wallet on this device. Locks this one first."
                selected={false}
                onSelect={onSwitchWallet}
                testId="wallet-switch"
              />
            )}
            {onCheckDevice !== undefined && (
              <Choice
                title="Check this device"
                description="The manifest root and the verification checks, the same ones the lock screen showed."
                selected={false}
                onSelect={onCheckDevice}
                testId="wallet-check-device"
              />
            )}
            {/* THE THEME LIVES HERE, NOT AT THE TOP.

                It used to have the first slot on the screen, ahead of every
                destination, on the reasoning that it is the only control here
                that changes the screen you are looking at. That is true and it
                is not worth the best position on a panel with no vertical room:
                it is a setting somebody touches once. It is a property of the
                device, so it sits with the rest of them. */}
            <div className="nr-choice nr-choice--static" data-testid="theme-picker">
              <span className="nr-choice__title">Theme</span>
              <div className="nr-picker">
                {(['dark', 'light'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    className="nr-picker__option"
                    aria-pressed={theme === option}
                    disabled={onSetTheme === undefined}
                    onClick={() => {
                      void onSetTheme?.(option)
                    }}
                    data-testid={`theme-${option}`}
                  >
                    {option === 'dark' ? 'Dark' : 'Light'}
                  </button>
                ))}
              </div>
              {onSetTheme === undefined && (
                <span className="nr-choice__desc" data-testid="theme-needs-a-name">
                  Kept in the same file as this device&rsquo;s name, so the lock screen can render
                  in it before you type a passphrase. Name this device to choose one.
                </span>
              )}
            </div>
            {onNameDevice !== undefined && (
              <Choice
                title="Name this device"
                description="So you can tell it from your other ones. Every device in a quorum shows the same wallet name."
                selected={false}
                onSelect={onNameDevice}
                testId="wallet-name-device"
              />
            )}
          </div>
        </section>
      </div>
    </Screen>
  )
}
