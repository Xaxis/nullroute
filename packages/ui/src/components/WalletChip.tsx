import { type ReactElement } from 'react'

/**
 * Which wallet is active, in the header, on every screen.
 *
 * Spec: ui.screens.wallets
 *
 * A device holding one wallet needs no such thing. A device holding several has
 * exactly one dangerous failure, which is a user reviewing a transaction under
 * one wallet's name and signing with another's keys, and the defence against it
 * is that the answer is never off screen.
 *
 * THE NETWORK IS PART OF THE NAME HERE. NetworkBanner renders nothing on
 * mainnet, deliberately, because a warning that is always present is a warning
 * nobody reads. That reasoning holds for one wallet and breaks for several: a
 * user with a mainnet wallet and a signet wallet needs the distinction on both,
 * and "the absence of a banner means mainnet" is a signal that looks identical
 * to a banner that failed to render. So this chip always names the network.
 *
 * Everything shown here comes from the daemon's answer about the seed it has
 * loaded, never from the picker the user tapped. Those differ exactly when
 * something is wrong, which is when it matters.
 */

export interface WalletChipProps {
  readonly label: string
  readonly colour: string
  readonly networkLabel: string
  readonly isMainnet: boolean
  readonly testId?: string
}

export function WalletChip(props: WalletChipProps): ReactElement {
  const { label, colour, networkLabel, isMainnet, testId } = props

  return (
    <div
      className="nr-wchip"
      data-colour={colour}
      data-testid={testId ?? 'wallet-chip'}
      // A colour tag is a convenience and never the only difference between two
      // wallets: the label sits beside it, and a user who cannot distinguish
      // these colours loses nothing but speed.
      aria-label={`Active wallet ${label} on ${networkLabel}`}
    >
      <span className="nr-wchip__dot" data-colour={colour} />
      <span className="nr-wchip__label">{label}</span>
      <span className={`nr-wchip__net${isMainnet ? '' : ' nr-wchip__net--test'}`}>
        {networkLabel}
      </span>
    </div>
  )
}
