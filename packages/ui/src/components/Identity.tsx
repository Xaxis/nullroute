import { type ReactElement } from 'react'

/**
 * What this thing in your hand is, and which wallet it has open.
 *
 * Spec: ui.components.identity
 *
 * WHAT THIS REPLACED. The header carried two separate identity chips competing
 * for the same corner. One named the physical device and did nothing: it was on
 * all thirty six screens, took a hundred and forty pixels of the best space on
 * the panel, and could not be tapped. The other named the open wallet, lived
 * inside the banner slot, and disappeared whenever the idle warning wanted the
 * room, which is to say it vanished exactly when somebody had been away from
 * the screen long enough to have forgotten what was on it.
 *
 * They answer one question between them and they are one control now.
 *
 * IT IS THE WAY BETWEEN WALLETS. Switching used to live four taps deep, inside
 * More, under a screen about something else. On a device that holds eight
 * wallets the thing naming the open one is the obvious place to change it, and
 * a name that cannot be tapped teaches people the device has no opinion about
 * which wallet they are in.
 *
 * NOTHING HERE IS AUTHENTICATED BY BEING SHOWN. The device name is read from a
 * file beside the wallets before any passphrase, and the wallet name comes from
 * the daemon's answer about the seed it actually loaded. The second is worth
 * trusting and the first is not, which is why the wallet line is the one in
 * full-strength text.
 */

export interface IdentityProps {
  /** What this physical device is called, when it has been named. */
  readonly device?: string | undefined
  /** The open wallet, from the daemon's answer rather than from the row tapped. */
  readonly wallet?: { readonly label: string; readonly colour: string } | undefined
  /**
   * The network, always named when a wallet is open.
   *
   * NetworkBanner renders nothing on mainnet, deliberately, because a warning
   * that is always present is a warning nobody reads. That holds for one wallet
   * and breaks for several: "the absence of a banner means mainnet" is a signal
   * that looks identical to a banner which failed to render.
   */
  readonly networkLabel?: string | undefined
  readonly isMainnet?: boolean
  /** Opens the wallet picker. Absent on the screens where leaving is not free. */
  readonly onSwitch?: (() => void) | undefined
}

export function Identity(props: IdentityProps): ReactElement | null {
  const { device, wallet, networkLabel, isMainnet = true, onSwitch } = props

  /*
   * Nothing to say AND nothing to do: an unnamed device with no wallet open,
   * on a screen that would not let you switch anyway. A chip reading "No
   * wallet open" that does nothing about it is noise.
   *
   * WITH A SWITCH IT ALWAYS RENDERS, even with nothing to name. That case is
   * not hypothetical and it is not cosmetic: a device fresh out of the box has
   * no name and no wallet, and the menu deliberately withholds every
   * wallet destination until one is open. Returning null there left the setup
   * and import screens with a menu that led nowhere and no other way back to
   * the picker, which is the dead end this whole header was meant to end.
   */
  if (device === undefined && wallet === undefined && onSwitch === undefined) return null

  /*
   * Said in words, because the only thing distinguishing two wallets at a
   * glance is a coloured dot, and a dot is nothing to a screen reader or to
   * anybody who cannot separate the five colours this device uses. The chip it
   * replaced carried one of these and the replacement dropped it, which the
   * verifier caught as an invariant with no test rather than as a nicety.
   */
  const described = [
    device === undefined ? null : `Device ${device}`,
    wallet === undefined ? 'no wallet open' : `wallet ${wallet.label}`,
    wallet !== undefined && networkLabel !== undefined ? `on ${networkLabel}` : null,
  ]
    .filter((part) => part !== null)
    .join(', ')

  const body = (
    <>
      <span
        className="nr-identity__dot"
        data-colour={wallet?.colour ?? 'slate'}
        aria-hidden="true"
      />
      <span className="nr-identity__lines">
        {/* The device first and quietest. It answers "which of my three
            Raspberry Pis is this", which matters when carrying one somewhere
            and never when reading the screen. */}
        {device !== undefined && <span className="nr-identity__device">{device}</span>}
        <span className="nr-identity__wallet">
          {wallet === undefined ? 'No wallet open' : wallet.label}
        </span>
      </span>
      {wallet !== undefined && networkLabel !== undefined && (
        <span
          className={`nr-identity__net${isMainnet ? '' : ' nr-identity__net--test'}`}
          data-testid="identity-network"
        >
          {networkLabel}
        </span>
      )}
    </>
  )

  if (onSwitch === undefined) {
    return (
      <div className="nr-identity" aria-label={described} data-testid="identity">
        {body}
      </div>
    )
  }

  return (
    <button
      type="button"
      className="nr-identity nr-identity--button"
      aria-label={`${described}. Switch wallet.`}
      onClick={onSwitch}
      data-testid="identity-switch"
    >
      {body}
      {/* A caret, because a chip that opens something has to say so. Text
          rather than a glyph: `make prose` bans the range the usual arrows
          live in, and the panel is wide enough for a character. */}
      <span className="nr-identity__caret" aria-hidden="true">
        v
      </span>
    </button>
  )
}
