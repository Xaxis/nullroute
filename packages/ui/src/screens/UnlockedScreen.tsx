import { type ReactElement } from 'react'
import { Screen } from '../components/Screen.js'
import { Button } from '../components/Button.js'
import { Hash } from '../components/Hash.js'

/**
 * What just opened, shown once, before anything can be done with it.
 *
 * Spec: ui.screens.wallets
 *
 * THE FINGERPRINT IS THE ENTIRE POINT OF THIS SCREEN. A wrong BIP-39
 * passphrase does not fail. It derives a different, valid, empty wallet, and
 * every screen after this one will look completely normal while showing
 * addresses nobody has ever funded. There is no error to display, because
 * nothing went wrong as far as the arithmetic is concerned.
 *
 * The only signal a user will ever get is that these eight characters are not
 * the ones they wrote down. So they are the largest thing on the screen, they
 * appear before the wallet can be used, and the screen says in plain words what
 * a mismatch means. A user who did not record their fingerprint gets nothing
 * from this, and the copy says that too rather than implying otherwise.
 *
 * This is also where a picker that lied gets reported. If the name the wallet
 * sealed differs from the row that was tapped, the user hears it here rather
 * than finding a quietly corrected label later.
 */

export interface UnlockedScreenProps {
  readonly label: string
  readonly colour: string
  readonly fingerprint: string
  readonly networkLabel: string
  readonly isMainnet: boolean
  /** True when this wallet was created with a BIP-39 passphrase. */
  readonly usedPassphrase: boolean
  /** True when the name is not sealed, which is so for a migrated wallet. */
  readonly labelVerified: boolean
  /** True when the picker was showing something the ciphertext disagreed with. */
  readonly hintCorrected: boolean
  readonly onContinue: () => void
  readonly onLock: () => void
  /**
   * What this physical device is called. Rendered in the header by Screen.
   *
   * The lock screen is the single most important place for it: it is the first
   * thing shown when somebody picks a device up, and every device in a quorum
   * looks identical until one is unlocked.
   */
  readonly device?: { readonly name: string; readonly colour: string } | undefined
  readonly banner?: ReactElement | null
}

export function UnlockedScreen(props: UnlockedScreenProps): ReactElement {
  const {
    label,
    colour,
    fingerprint,
    networkLabel,
    isMainnet,
    usedPassphrase,
    labelVerified,
    hintCorrected,
    onContinue,
    onLock,
    device,
    banner,
  } = props

  return (
    <Screen
      title={label}
      subtitle={`${networkLabel}${isMainnet ? '' : ', a test network'}`}
      banner={banner}
      device={device}
      testId="unlocked-screen"
      actions={
        <>
          <Button onClick={onLock} testId="unlocked-lock">
            Not this one
          </Button>
          <div className="nr-spacer" />
          {/* Not the focused default. A stray tap must not carry someone past
              the one screen asking them to check something. */}
          <Button onClick={onContinue} testId="unlocked-continue">
            This is my wallet
          </Button>
        </>
      }
    >
      {/* The fingerprint, what to do with it, and what it cannot do, in one
          block. These were three siblings with the instruction below the value
          and the limit five elements further down, past the fold whenever any
          warning was showing. This screen exists so somebody notices the wrong
          wallet, and the sentence explaining when it cannot help them was the
          first thing to scroll away. */}
      <div className="nr-fp" data-testid="unlocked-fingerprint">
        <span className="nr-fp__label">Fingerprint</span>
        <span className="nr-fp__value">
          <Hash value={fingerprint} />
        </span>
        <span className="nr-wchip__dot" data-colour={colour} />
      </div>

      <p className="nr-note" data-testid="unlocked-compare">
        Compare this with what you wrote down when you made this wallet: it is computed from the
        keys that just loaded, so it cannot be faked by editing a file. If you never recorded one,
        this screen cannot help you.
      </p>

      {usedPassphrase && (
        <div className="nr-banner nr-banner--testnet" data-testid="unlocked-passphrase-warning">
          <strong>This wallet uses a passphrase</strong>
          <span>
            A wrong passphrase does not produce an error. It opens a different, valid, empty wallet,
            and every screen after this one will look normal. If the fingerprint above is not the
            one you recorded, lock now and try again. The mnemonic alone will not recover this
            wallet.
          </span>
        </div>
      )}

      {!labelVerified && (
        <div className="nr-banner nr-banner--testnet" data-testid="unlocked-unverified-name">
          <strong>This wallet has no confirmed name</strong>
          <span>
            It was made before this device could name wallets, so the only name it has is one stored
            beside it, which anyone holding the card could change. Rename it to give it a name that
            travels inside the encryption.
          </span>
        </div>
      )}

      {hintCorrected && (
        <div className="nr-banner nr-banner--testnet" data-testid="unlocked-hint-corrected">
          <strong>The picker was showing something else</strong>
          <span>
            The name or network on the list did not match what this wallet actually contains. The
            list has been corrected. If you did not rename this wallet recently, treat this device
            as having been handled by somebody else.
          </span>
        </div>
      )}

    </Screen>
  )
}
