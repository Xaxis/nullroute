/**
 * @nullroute/ui: the device frontend.
 *
 * Receives xpubs, addresses, descriptors and PSBTs. Never receives a seed, a
 * mnemonic or a private key (INV-KEY-1). Never generates entropy: the lint rule
 * bans crypto.getRandomValues here, because entropy collection happens in the
 * daemon or it does not happen. See docs/ENTROPY.md.
 */

export { LockScreen } from './screens/LockScreen.js'
export type { LockScreenProps, AttestationView } from './screens/LockScreen.js'

export { Hash, chunk, abbreviate } from './components/Hash.js'
export type { HashProps } from './components/Hash.js'

export { NetworkBanner } from './components/NetworkBanner.js'
export type { NetworkBannerProps } from './components/NetworkBanner.js'

export { call, IpcCallError } from './lib/client.js'
export type { IpcTransport, IpcFailure } from './lib/client.js'
