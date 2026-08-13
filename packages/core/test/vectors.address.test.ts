/**
 * Official BIP-84 and BIP-86 address vectors.
 *
 * Both BIPs publish addresses for the same well-known "abandon ... about"
 * mnemonic, which makes them the cleanest end-to-end check available: mnemonic
 * to seed to account key to address, every layer in one assertion.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mnemonicToSeed } from '../src/bip39/mnemonic.js'
import { rootFromSeed } from '../src/derive/hd.js'
import { MAINNET } from '../src/network/networks.js'
import { accountPath, deriveAddresses } from '../src/address/address.js'

const REPO_ROOT = new URL('../../../', import.meta.url).pathname
const V = JSON.parse(
  readFileSync(join(REPO_ROOT, 'spec/vectors/bip84-86-addresses.json'), 'utf8')
) as {
  mnemonic: string
  bip84: {
    accountPath: string
    receive: { index: number; address: string }[]
    change: { index: number; address: string }[]
  }
  bip86: {
    accountPath: string
    receive: { index: number; address: string }[]
    change: { index: number; address: string }[]
  }
}

describe('core.address.derive official vectors', () => {
  // INV-ADDR-1: native segwit.
  it('bip84-native-segwit', () => {
    using seed = mnemonicToSeed(V.mnemonic, '')
    const root = rootFromSeed(seed, MAINNET)
    const account = root.derive(V.bip84.accountPath)

    const receive = deriveAddresses(account, {
      scriptType: 'p2wpkh',
      network: MAINNET,
      change: false,
      start: 0,
      count: V.bip84.receive.length,
    })
    for (const expected of V.bip84.receive) {
      expect(receive[expected.index]?.address, `receive ${String(expected.index)}`).toBe(
        expected.address
      )
    }

    const change = deriveAddresses(account, {
      scriptType: 'p2wpkh',
      network: MAINNET,
      change: true,
      start: 0,
      count: V.bip84.change.length,
    })
    for (const expected of V.bip84.change) {
      expect(change[expected.index]?.address, `change ${String(expected.index)}`).toBe(
        expected.address
      )
    }
    root.wipePrivateData()
  })

  // INV-ADDR-2: taproot. The x-only key conversion is the part that silently
  // goes wrong, so this vector is the one that proves it.
  it('bip86-taproot', () => {
    using seed = mnemonicToSeed(V.mnemonic, '')
    const root = rootFromSeed(seed, MAINNET)
    const account = root.derive(V.bip86.accountPath)

    const receive = deriveAddresses(account, {
      scriptType: 'p2tr',
      network: MAINNET,
      change: false,
      start: 0,
      count: V.bip86.receive.length,
    })
    for (const expected of V.bip86.receive) {
      expect(receive[expected.index]?.address, `receive ${String(expected.index)}`).toBe(
        expected.address
      )
    }

    const change = deriveAddresses(account, {
      scriptType: 'p2tr',
      network: MAINNET,
      change: true,
      start: 0,
      count: V.bip86.change.length,
    })
    for (const expected of V.bip86.change) {
      expect(change[expected.index]?.address, `change ${String(expected.index)}`).toBe(
        expected.address
      )
    }
    root.wipePrivateData()
  })

  // INV-ADDR-3: the account path each BIP specifies.
  it('standard-account-paths', () => {
    expect(accountPath('p2pkh', MAINNET)).toBe("m/44'/0'/0'")
    expect(accountPath('p2sh-p2wpkh', MAINNET)).toBe("m/49'/0'/0'")
    expect(accountPath('p2wpkh', MAINNET)).toBe("m/84'/0'/0'")
    expect(accountPath('p2tr', MAINNET)).toBe("m/86'/0'/0'")
  })

  // INV-ADDR-4: every script type produces its own distinct address from the
  // same key, and each has the prefix its format requires.
  it('script-types-are-distinct', () => {
    using seed = mnemonicToSeed(V.mnemonic, '')
    const root = rootFromSeed(seed, MAINNET)
    const account = root.derive("m/84'/0'/0'")

    const addresses = (['p2pkh', 'p2sh-p2wpkh', 'p2wpkh', 'p2tr'] as const).map(
      (scriptType) =>
        deriveAddresses(account, {
          scriptType,
          network: MAINNET,
          change: false,
          start: 0,
          count: 1,
        })[0]?.address
    )

    expect(new Set(addresses).size).toBe(4)
    expect(addresses[0]?.startsWith('1')).toBe(true)
    expect(addresses[1]?.startsWith('3')).toBe(true)
    expect(addresses[2]?.startsWith('bc1q')).toBe(true)
    expect(addresses[3]?.startsWith('bc1p')).toBe(true)
    root.wipePrivateData()
  })
})
