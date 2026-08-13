/**
 * Bitcoin network definitions.
 *
 * Spec: core.network.networks
 *
 * The single most important property here is stated up front, because getting
 * it wrong loses money in a way that looks fine on screen:
 *
 *   **testnet3, testnet4 and signet are address-identical.**
 *
 * They share every version byte and the same `tb` bech32 prefix, so an address
 * produced for one is byte-for-byte an address for the others. Nothing can
 * recover the intended network from an address string, and any code that tries
 * is guessing. The network is therefore an explicit tag carried in nullroute's
 * own data model, chosen at wallet creation and locked to that wallet, and it
 * is never inferred.
 *
 * The practical consequence: a wallet created on signet and a wallet created on
 * testnet4 from the same seed produce the same addresses, and only the tag
 * distinguishes them. The UI shows a persistent banner on every non-mainnet
 * screen for this reason.
 */

/** Networks nullroute supports. Chosen at wallet creation, then immutable. */
export type NetworkId = 'mainnet' | 'testnet3' | 'testnet4' | 'signet' | 'regtest'

export interface Network {
  readonly id: NetworkId
  /** Human-readable, for the UI banner. */
  readonly label: string
  /** True only for mainnet. Drives the warning banner and any spend guard. */
  readonly isMainnet: boolean

  /** bech32 human-readable part for segwit addresses. */
  readonly bech32: string
  /** Version byte for P2PKH addresses. */
  readonly pubKeyHash: number
  /** Version byte for P2SH addresses. */
  readonly scriptHash: number
  /** Version byte for WIF-encoded private keys. */
  readonly wif: number

  /** BIP-32 extended key version bytes. */
  readonly bip32: {
    readonly public: number
    readonly private: number
  }

  /**
   * BIP-44 coin type. Note that every test network uses 1, which is another
   * reason the network tag cannot be recovered from a derivation path either.
   */
  readonly coinType: number
}

/** BIP-32 version bytes for mainnet, from BIP-32 itself. */
const MAINNET_BIP32 = { public: 0x0488b21e, private: 0x0488ade4 } as const

/**
 * BIP-32 version bytes shared by every test network (tpub/tprv).
 *
 * Shared, not merely equal: BIP-32 defines one set of testnet version bytes and
 * signet, testnet3, testnet4 and regtest all use it.
 */
const TESTNET_BIP32 = { public: 0x043587cf, private: 0x04358394 } as const

export const MAINNET: Network = {
  id: 'mainnet',
  label: 'Mainnet',
  isMainnet: true,
  bech32: 'bc',
  pubKeyHash: 0x00,
  scriptHash: 0x05,
  wif: 0x80,
  bip32: MAINNET_BIP32,
  coinType: 0,
}

export const TESTNET3: Network = {
  id: 'testnet3',
  label: 'Testnet3',
  isMainnet: false,
  bech32: 'tb',
  pubKeyHash: 0x6f,
  scriptHash: 0xc4,
  wif: 0xef,
  bip32: TESTNET_BIP32,
  coinType: 1,
}

/** Address-identical to testnet3. Only the tag distinguishes them. */
export const TESTNET4: Network = {
  ...TESTNET3,
  id: 'testnet4',
  label: 'Testnet4',
}

/** Address-identical to testnet3. Only the tag distinguishes them. */
export const SIGNET: Network = {
  ...TESTNET3,
  id: 'signet',
  label: 'Signet',
}

/** The one test network that IS distinguishable, by its `bcrt` bech32 prefix. */
export const REGTEST: Network = {
  ...TESTNET3,
  id: 'regtest',
  label: 'Regtest',
  bech32: 'bcrt',
}

export const NETWORKS: Readonly<Record<NetworkId, Network>> = {
  mainnet: MAINNET,
  testnet3: TESTNET3,
  testnet4: TESTNET4,
  signet: SIGNET,
  regtest: REGTEST,
}

export class UnknownNetworkError extends Error {
  constructor(id: string) {
    super(`Unknown network "${id}". Expected one of: ${Object.keys(NETWORKS).join(', ')}.`)
    this.name = 'UnknownNetworkError'
  }
}

export function networkById(id: string): Network {
  const network = (NETWORKS as Record<string, Network | undefined>)[id]
  if (network === undefined) throw new UnknownNetworkError(id)
  return network
}

/**
 * Whether two networks produce identical addresses.
 *
 * Exposed rather than hidden because the UI has to say so. A user moving a
 * descriptor between signet and testnet4 gets the same addresses and no error,
 * and the honest response is to tell them that rather than to pretend the
 * device detected something.
 */
export function isAddressIdentical(a: Network, b: Network): boolean {
  return (
    a.bech32 === b.bech32 &&
    a.pubKeyHash === b.pubKeyHash &&
    a.scriptHash === b.scriptHash &&
    a.bip32.public === b.bip32.public
  )
}
