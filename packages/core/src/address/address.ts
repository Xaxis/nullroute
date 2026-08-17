/**
 * Address derivation for the four standard script types.
 *
 * Spec: core.address.derive
 *
 * BIP-44 (legacy), BIP-49 (nested segwit), BIP-84 (native segwit) and BIP-86
 * (taproot). Defaults are BIP-84 and BIP-86; the older two exist so a wallet
 * created elsewhere can be recovered here.
 *
 * Two things this layer adds over the audited library, both of which the
 * research found are easy to get wrong and silent when wrong:
 *
 *   1. Key format separation is strict. p2tr wants a 32-byte x-only key and
 *      throws on a 33-byte compressed one; p2wpkh wants the compressed form and
 *      throws on x-only. There is no coercion in either direction, so the
 *      conversion happens here, once, where it can be reasoned about.
 *   2. The network's `wif` field is always set. Omitting it is a type error but
 *      NOT a runtime one: it silently emits a corrupt WIF with an undefined
 *      version byte. nullroute's Network type makes it mandatory.
 *
 * p2sh-p2wpkh is composition rather than a flag: p2sh(p2wpkh(key)). There is no
 * single function for it, and reaching for one is how people end up emitting a
 * bare p2sh address.
 */

import * as btc from '@scure/btc-signer'
// BTC_NETWORK is NOT on the package index, only on the utils subpath, and the
// subpath needs its .js suffix. Both are easy to get wrong and both fail at
// build time rather than silently, which is the good case.
import { type BTC_NETWORK } from '@scure/btc-signer/utils.js'
import { type HDKey } from '@scure/bip32'
import { type Network } from '../network/networks.js'
import { DerivationError } from '../derive/hd.js'

/** The script types nullroute derives addresses for. */
export type ScriptType = 'p2pkh' | 'p2sh-p2wpkh' | 'p2wpkh' | 'p2tr'

export interface AddressInfo {
  readonly address: string
  readonly scriptType: ScriptType
  readonly path: string
  readonly network: Network
}

/** Purpose field of the BIP-44 style path each script type uses. */
export const PURPOSE: Readonly<Record<ScriptType, number>> = {
  p2pkh: 44,
  'p2sh-p2wpkh': 49,
  p2wpkh: 84,
  p2tr: 86,
}

/**
 * The network shape `@scure/btc-signer` expects.
 *
 * Built from nullroute's own Network so the two cannot drift, and so `wif` is
 * always present: a network literal without it typechecks as an error but does
 * not throw at runtime, it emits a corrupt WIF.
 */
export function toBtcNetwork(network: Network): BTC_NETWORK {
  return {
    bech32: network.bech32,
    pubKeyHash: network.pubKeyHash,
    scriptHash: network.scriptHash,
    wif: network.wif,
  }
}

/**
 * The standard account path for a script type, per BIP-44/49/84/86.
 *
 * m / purpose' / coin_type' / account'
 */
export function accountPath(scriptType: ScriptType, network: Network, account = 0): string {
  return `m/${String(PURPOSE[scriptType])}'/${String(network.coinType)}'/${String(account)}'`
}

/** The receive or change branch below an account, at a given index. */
export function branchPath(change: boolean, index: number): string {
  return `${change ? '1' : '0'}/${String(index)}`
}

/**
 * Derive an address from a public key.
 *
 * `key` must carry a public key. Passing a private key is fine; only the public
 * half is used.
 */
export function addressFromKey(
  key: HDKey,
  scriptType: ScriptType,
  network: Network,
  path: string
): AddressInfo {
  const pubkey = key.publicKey
  if (pubkey === null) {
    throw new DerivationError('Cannot derive an address: the key has no public part.')
  }

  const net = toBtcNetwork(network)
  let address: string

  switch (scriptType) {
    case 'p2pkh':
      address = btc.p2pkh(pubkey, net).address
      break

    case 'p2wpkh':
      address = btc.p2wpkh(pubkey, net).address
      break

    case 'p2sh-p2wpkh':
      // Composition, not a flag. There is no p2sh_p2wpkh export, and the
      // wrapped form is what BIP-49 specifies.
      address = btc.p2sh(btc.p2wpkh(pubkey, net), net).address
      break

    case 'p2tr': {
      // Taproot wants the x-only key: 32 bytes, the compressed key minus its
      // parity prefix. Passing the 33-byte form throws "non-schnorr pubkey",
      // and there is no automatic coercion in the library by design.
      const xOnly = pubkey.slice(1)
      // `undefined` for the script tree: this is a key-path-only address. The
      // tree is the SECOND argument, so passing the network there instead is a
      // silent misbehaviour rather than an error.
      address = btc.p2tr(xOnly, undefined, net).address
      break
    }
  }

  // The library types this as non-optional, so an undefined check would be dead
  // code. An EMPTY string is not ruled out by the types and is the worst
  // possible thing to return from a function that decides where money goes, so
  // that is what is checked.
  if (address.length === 0) {
    throw new DerivationError(
      `Deriving a ${scriptType} address produced an empty string. This should be unreachable.`
    )
  }

  return { address, scriptType, path, network }
}

export interface DeriveAddressesOptions {
  readonly scriptType: ScriptType
  readonly network: Network
  readonly change: boolean
  readonly start: number
  readonly count: number
}

/**
 * Derive a run of addresses from an account-level extended key.
 *
 * Used by the address explorer and by change verification. The account key is
 * public, so this needs no seed and no private material.
 */
export function deriveAddresses(
  accountKey: HDKey,
  options: DeriveAddressesOptions
): AddressInfo[] {
  const { scriptType, network, change, start, count } = options
  if (count < 0 || start < 0) {
    throw new DerivationError('Address range must be non-negative.')
  }

  const out: AddressInfo[] = []
  for (let i = 0; i < count; i += 1) {
    const index = start + i
    const relative = branchPath(change, index)
    const child = accountKey.derive(`m/${relative}`)
    out.push(addressFromKey(child, scriptType, network, relative))
  }
  return out
}
