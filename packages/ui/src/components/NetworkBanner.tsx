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
    <div className="nr-banner nr-banner--testnet" role="status" data-testid="network-banner">
      <strong>{network.label}</strong>
      <span>
        Not mainnet. Coins here are worthless. Signet, testnet3 and testnet4 share every address
        format, so this label is the only thing telling them apart.
      </span>
    </div>
  )
}
