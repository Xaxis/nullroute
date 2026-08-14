/**
 * The non-mainnet banner.
 *
 * Spec: ui.components.network-banner
 *
 * Persistent on every screen of a non-mainnet wallet, not just at creation.
 * The failure it prevents is a user treating a test wallet as real, or the
 * reverse, and that mistake is made mid-session rather than at setup.
 *
 * It also names the network explicitly, which matters more than it looks:
 * testnet3, testnet4 and signet produce identical addresses, so the tag on this
 * banner is the ONLY thing distinguishing them. Nothing about an address, an
 * xpub or a derivation path can recover which one was intended.
 *
 * It is a compact chip rather than a paragraph, and that is a device constraint
 * rather than a style preference. The panel is 480px tall and this sits on every
 * screen; as a three-line block it consumed about a fifth of the display
 * permanently, which on the wallet screen left room for two addresses. The name
 * is the part that has to persist, because the name is the part that cannot be
 * recovered from anything else. The full explanation is on the setup screen,
 * next to the choice it is explaining.
 */

import { type ReactElement } from 'react'
import { type NetworkId } from '@nullroute/core'

export interface NetworkBannerProps {
  readonly network: {
    readonly id: NetworkId
    readonly label: string
    readonly isMainnet: boolean
  }
}

export function NetworkBanner({ network }: NetworkBannerProps): ReactElement | null {
  if (network.isMainnet) return null

  return (
    <div className="nr-netchip" role="status" data-testid="network-banner">
      <strong className="nr-netchip__name">{network.label}</strong>
      <span className="nr-netchip__note">test coins, worth nothing</span>
    </div>
  )
}
