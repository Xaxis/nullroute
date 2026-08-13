/**
 * Official BIP-39 test vectors.
 *
 * From trezor/python-mnemonic, vendored at spec/vectors/bip39-english.json and
 * pinned by hash in the spec file. Vendored rather than fetched because the
 * device build has no network, and because a vector file that can change under
 * you is not a vector file.
 *
 * Each entry is [entropy hex, mnemonic, seed hex, xprv], with the passphrase
 * "TREZOR" throughout. All four directions are checked: entropy to words, words
 * back to entropy, words to seed, and seed to root key.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { Secret } from '../src/util/secret.js'
import { entropyToWords, mnemonicToSeed, wordsToEntropy } from '../src/bip39/mnemonic.js'
import { rootFromSeed } from '../src/derive/hd.js'
import { MAINNET } from '../src/network/networks.js'

const REPO_ROOT = new URL('../../../', import.meta.url).pathname
const VECTORS = JSON.parse(
  readFileSync(join(REPO_ROOT, 'spec/vectors/bip39-english.json'), 'utf8')
) as { english: [string, string, string, string][] }

const PASSPHRASE = 'TREZOR'

describe('core.bip39.mnemonic official vectors', () => {
  it('vector-file-is-present', () => {
    expect(VECTORS.english.length).toBeGreaterThanOrEqual(24)
  })

  // INV-BIP39-1
  it('entropy-to-mnemonic', () => {
    for (const [entropyHex, mnemonic] of VECTORS.english) {
      using entropy = Secret.fromBytes(hexToBytes(entropyHex), 'vector')
      expect(entropyToWords(entropy), `entropy ${entropyHex}`).toBe(mnemonic)
    }
  })

  // INV-BIP39-2
  it('mnemonic-to-entropy', () => {
    for (const [entropyHex, mnemonic] of VECTORS.english) {
      using entropy = wordsToEntropy(mnemonic)
      expect(bytesToHex(entropy.bytes), `mnemonic ${mnemonic.slice(0, 30)}`).toBe(entropyHex)
    }
  })

  // INV-BIP39-3: the derivation users actually depend on.
  it('mnemonic-to-seed', () => {
    for (const [, mnemonic, seedHex] of VECTORS.english) {
      using seed = mnemonicToSeed(mnemonic, PASSPHRASE)
      expect(bytesToHex(seed.bytes), `mnemonic ${mnemonic.slice(0, 30)}`).toBe(seedHex)
    }
  })

  // INV-BIP39-4: end to end, through BIP-32, against the vector's own xprv.
  it('seed-to-root-key', () => {
    for (const [, mnemonic, , xprv] of VECTORS.english) {
      using seed = mnemonicToSeed(mnemonic, PASSPHRASE)
      const root = rootFromSeed(seed, MAINNET)
      expect(root.privateExtendedKey, `mnemonic ${mnemonic.slice(0, 30)}`).toBe(xprv)
      root.wipePrivateData()
    }
  })

  // The passphrase is part of the key, not a credential guarding it. A wrong
  // one produces a valid, different, empty wallet rather than an error, which
  // is the single most common way people lose funds this way.
  it('passphrase-changes-the-seed-silently', () => {
    const [, mnemonic] = VECTORS.english[0] ?? []
    if (mnemonic === undefined) throw new Error('no vector')

    using withPassphrase = mnemonicToSeed(mnemonic, PASSPHRASE)
    using without = mnemonicToSeed(mnemonic, '')
    using nearMiss = mnemonicToSeed(mnemonic, 'TREZOr')

    // All three succeed. None of them errors. That is the whole problem.
    expect(bytesToHex(withPassphrase.bytes)).not.toBe(bytesToHex(without.bytes))
    expect(bytesToHex(withPassphrase.bytes)).not.toBe(bytesToHex(nearMiss.bytes))
  })
})
