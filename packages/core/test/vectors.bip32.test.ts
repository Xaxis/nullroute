/**
 * Official BIP-32 test vectors.
 *
 * Parsed from bip-0032.mediawiki and vendored at spec/vectors/bip32.json.
 * All four vectors, every chain, both the extended public and private key.
 *
 * Vector 4 exists because of a real historical bug: some implementations
 * mishandled a leading-zero private key, producing a different chain. It is
 * included for that reason rather than for completeness.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { hexToBytes } from '@noble/hashes/utils.js'
import { Secret } from '../src/util/secret.js'
import { rootFromSeed } from '../src/derive/hd.js'
import { MAINNET } from '../src/network/networks.js'
import { normalizePath } from '../src/derive/path.js'

const REPO_ROOT = new URL('../../../', import.meta.url).pathname
const VECTORS = JSON.parse(
  readFileSync(join(REPO_ROOT, 'spec/vectors/bip32.json'), 'utf8')
) as { name: string; seedHex: string; chains: { path: string; extPub: string; extPrv: string }[] }[]

describe('core.derive.hd official vectors', () => {
  it('vector-file-is-present', () => {
    expect(VECTORS.length).toBe(4)
    expect(VECTORS.reduce((n, v) => n + v.chains.length, 0)).toBeGreaterThanOrEqual(17)
  })

  // INV-BIP32-1
  it('derivation-matches-bip32', () => {
    for (const vector of VECTORS) {
      using seed = Secret.fromBytes(hexToBytes(vector.seedHex), 'vector-seed')
      for (const chain of vector.chains) {
        const root = rootFromSeed(seed, MAINNET)
        const path = normalizePath(chain.path)
        const key = path === 'm' ? root : root.derive(path)
        const where = `${vector.name} ${chain.path}`
        expect(key.publicExtendedKey, `${where} xpub`).toBe(chain.extPub)
        expect(key.privateExtendedKey, `${where} xprv`).toBe(chain.extPrv)
        root.wipePrivateData()
      }
    }
  })

  // INV-BIP32-2: both hardened notations reach the same key. Descriptors and
  // Bitcoin Core emit `h`; BIP-32 itself uses an apostrophe.
  it('both-hardened-notations-agree', () => {
    const vector = VECTORS[0]
    if (vector === undefined) throw new Error('no vector')
    using seed = Secret.fromBytes(hexToBytes(vector.seedHex), 'vector-seed')

    const rootA = rootFromSeed(seed, MAINNET)
    const rootB = rootFromSeed(seed, MAINNET)
    const viaApostrophe = rootA.derive(normalizePath("m/0'/1/2'"))
    const viaH = rootB.derive(normalizePath('m/0h/1/2h'))

    expect(viaApostrophe.publicExtendedKey).toBe(viaH.publicExtendedKey)
    rootA.wipePrivateData()
    rootB.wipePrivateData()
  })
})
