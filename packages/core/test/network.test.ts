/**
 * Tests for core.network.networks.
 */

import { describe, expect, it } from 'vitest'
import { hexToBytes } from '@noble/hashes/utils.js'
import {
  MAINNET,
  REGTEST,
  SIGNET,
  TESTNET3,
  TESTNET4,
  NETWORKS,
  UnknownNetworkError,
  isAddressIdentical,
  networkById,
} from '../src/network/networks.js'
import { Secret } from '../src/util/secret.js'
import { rootFromSeed } from '../src/derive/hd.js'

const SEED_HEX = '000102030405060708090a0b0c0d0e0f'

describe('core.network.networks', () => {
  // INV-NET-4: version bytes are correct per network.
  it('version-bytes', () => {
    expect(MAINNET.bip32.public.toString(16)).toBe('488b21e')
    expect(MAINNET.bip32.private.toString(16)).toBe('488ade4')
    expect(MAINNET.pubKeyHash).toBe(0x00)
    expect(MAINNET.scriptHash).toBe(0x05)
    expect(MAINNET.wif).toBe(0x80)
    expect(MAINNET.bech32).toBe('bc')

    for (const net of [TESTNET3, TESTNET4, SIGNET, REGTEST]) {
      expect(net.bip32.public.toString(16), net.id).toBe('43587cf')
      expect(net.bip32.private.toString(16), net.id).toBe('4358394')
      expect(net.pubKeyHash, net.id).toBe(0x6f)
      expect(net.scriptHash, net.id).toBe(0xc4)
      expect(net.wif, net.id).toBe(0xef)
      expect(net.coinType, net.id).toBe(1)
    }
    expect(REGTEST.bech32).toBe('bcrt')
  })

  // INV-NET-5: an extended key serialises with its network's bytes, so a
  // mainnet xpub is visibly a mainnet xpub.
  it('extended-keys-carry-the-network', () => {
    using seed = Secret.fromBytes(hexToBytes(SEED_HEX), 'seed')

    const main = rootFromSeed(seed, MAINNET)
    expect(main.publicExtendedKey.startsWith('xpub')).toBe(true)
    main.wipePrivateData()

    for (const net of [TESTNET3, TESTNET4, SIGNET, REGTEST]) {
      const root = rootFromSeed(seed, net)
      expect(root.publicExtendedKey.startsWith('tpub'), net.id).toBe(true)
      root.wipePrivateData()
    }
  })

  // INV-NET-6: the property that makes the explicit network tag necessary.
  // testnet3, testnet4 and signet are address-identical, so nothing can
  // recover the intended network from an address or an xpub.
  it('test-networks-are-address-identical', () => {
    expect(isAddressIdentical(TESTNET3, TESTNET4)).toBe(true)
    expect(isAddressIdentical(TESTNET3, SIGNET)).toBe(true)
    expect(isAddressIdentical(TESTNET4, SIGNET)).toBe(true)

    // Regtest differs only by its bech32 prefix.
    expect(isAddressIdentical(TESTNET3, REGTEST)).toBe(false)
    // Mainnet differs from everything.
    expect(isAddressIdentical(MAINNET, TESTNET3)).toBe(false)

    // And the consequence, demonstrated rather than asserted: the same seed on
    // signet and testnet4 produces the identical extended key.
    using seed = Secret.fromBytes(hexToBytes(SEED_HEX), 'seed')
    const a = rootFromSeed(seed, SIGNET)
    const b = rootFromSeed(seed, TESTNET4)
    expect(a.publicExtendedKey).toBe(b.publicExtendedKey)
    a.wipePrivateData()
    b.wipePrivateData()
  })

  it('mainnet-is-the-only-mainnet', () => {
    expect(MAINNET.isMainnet).toBe(true)
    for (const net of [TESTNET3, TESTNET4, SIGNET, REGTEST]) {
      expect(net.isMainnet, net.id).toBe(false)
    }
  })

  it('lookup-by-id', () => {
    for (const id of Object.keys(NETWORKS)) {
      expect(networkById(id).id).toBe(id)
    }
    expect(() => networkById('mainnnet')).toThrow(UnknownNetworkError)
  })
})
