/**
 * Derive addresses for a registered quorum, whichever kind it is.
 *
 * Spec: core.descriptor.quorum-addresses
 *
 * WHY THIS EXISTS RATHER THAN A TERNARY AT EACH CALL SITE. Taproot quorums and
 * the older kinds derive through different functions, and the branch had been
 * written out four times: in the owned index, in the registration smoke test,
 * and, eventually, in the two IPC methods that show a user an address. The two
 * IPC methods were written without it.
 *
 * The result was a taproot quorum that could be registered, signed for and
 * recognised as change, and never once displayed: the receive screen's quorum
 * tab errored and so did the screen for comparing addresses between devices.
 * Nothing was wrong with the derivation. What was wrong was that a rule
 * everybody had to remember was remembered in three places out of five.
 *
 * So there is one place now. A call site that forgets to dispatch cannot,
 * because dispatching is the only thing on offer.
 *
 * WHAT IT DELIBERATELY DOES NOT DO is unify the two result types. A multisig
 * address carries the derived public keys in script order; a taproot one
 * carries whether the descriptor has a script path. Both are real and neither
 * belongs to the other, so this returns the common part, which is every field a
 * caller choosing between them could have used anyway.
 */

import { type Descriptor } from './parse.js'
import { type Network } from '../network/networks.js'
import { deriveMultisigAddresses } from './multisig.js'
import { deriveTaprootAddresses } from './taproot.js'

export interface QuorumAddress {
  readonly address: string
  /** The index within the branch, not a full path: cosigners differ in path. */
  readonly index: number
}

export interface DeriveQuorumOptions {
  readonly network: Network
  /** Which branch. Applied only when the descriptor is multipath or ranged. */
  readonly change?: boolean
  readonly start?: number
  readonly count?: number
}

/**
 * The addresses this quorum pays to, from any descriptor kind that is one.
 *
 * Refuses a descriptor that is not a quorum by delegating: both underlying
 * functions already say what they expected and what they got, and a message
 * written here would be a third, vaguer version of a good one.
 */
export function deriveQuorumAddresses(
  descriptor: Descriptor,
  options: DeriveQuorumOptions
): readonly QuorumAddress[] {
  return descriptor.script.kind === 'tr'
    ? deriveTaprootAddresses(descriptor, options)
    : deriveMultisigAddresses(descriptor, options)
}
