/**
 * Official BIP-32 test vectors.
 *
 * Vectors 1 to 4 are parsed from bip-0032.mediawiki and vendored at
 * spec/vectors/bip32.json: every chain, both the extended public and private
 * key.
 *
 * Vector 4 exists because of a real historical bug: some implementations
 * mishandled a leading-zero private key, producing a different chain. It is
 * included for that reason rather than for completeness.
 *
 * Vector 5, the extended keys every wallet must refuse, is an extraction at
 * spec/vectors/bip32-invalid-keys.json, pinned by hash in derive.spec.yaml and
 * descriptor/parse.spec.yaml. Its source is "Test vector 5" of
 * bip-0032.mediawiki at bitcoin/bips c0644a054fd1568ecbfc9c2b656ad5200b16ff74,
 * and it was produced by:
 *
 *   node tools/extract-bip32-vectors.mjs bip-0032.mediawiki <commit>
 *
 * It found a bug. Six of its keys begin "xpub" and pass their checksum, and
 * the descriptor parser accepted all six, because it checked the checksum and
 * nothing the checksum covers. The library refused them later, at address
 * derivation. The parser refuses them now (INV-DPARSE-3).
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createBase58check } from '@scure/base'
import { sha256 } from '@noble/hashes/sha2.js'
import { hexToBytes } from '@noble/hashes/utils.js'
import { Secret } from '../src/util/secret.js'
import { DerivationError, parseExtendedKey, rootFromSeed } from '../src/derive/hd.js'
import { MAINNET } from '../src/network/networks.js'
import { normalizePath } from '../src/derive/path.js'
import {
  DescriptorParseError,
  canonicalKeyExpression,
  parseDescriptor,
  parseKeyExpression,
} from '../src/descriptor/parse.js'
import { withChecksum } from '../src/descriptor/checksum.js'
import { AssembleError, assembleQuorum } from '../src/descriptor/assemble.js'
import { importCoordinatorFile } from '../src/descriptor/coordinator.js'

const REPO_ROOT = new URL('../../../', import.meta.url).pathname
const VECTORS = JSON.parse(readFileSync(join(REPO_ROOT, 'spec/vectors/bip32.json'), 'utf8')) as {
  name: string
  seedHex: string
  chains: { path: string; extPub: string; extPrv: string }[]
}[]

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

interface InvalidKeys {
  readonly source: string
  readonly bipsCommit: string
  readonly invalid: readonly { readonly description: string; readonly key: string }[]
}

const INVALID_KEYS = JSON.parse(
  readFileSync(join(REPO_ROOT, 'spec/vectors/bip32-invalid-keys.json'), 'utf8')
) as InvalidKeys

const PRIVATE = /extended PRIVATE key/
const NOT_COMPRESSED = /does not hold a compressed public key/
const NOT_BIP32 = /is not a valid BIP-32 extended public key/
const UNKNOWN_PREFIX = /neither an extended public key nor hex/

/**
 * What refuses each key in the descriptor parser, in the BIP's order.
 *
 * The NOT_COMPRESSED and NOT_BIP32 rows are the six keys that parsed before
 * INV-DPARSE-3 checked what an extended key encodes rather than only its
 * checksum.
 */
const PARSER_REFUSES: readonly RegExp[] = [
  NOT_COMPRESSED, // pubkey version / prvkey mismatch
  PRIVATE, // prvkey version / pubkey mismatch
  NOT_COMPRESSED, // invalid pubkey prefix 04
  PRIVATE, // invalid prvkey prefix 04
  NOT_COMPRESSED, // invalid pubkey prefix 01
  PRIVATE, // invalid prvkey prefix 01
  PRIVATE, // zero depth with non-zero parent fingerprint
  NOT_BIP32, // zero depth with non-zero parent fingerprint
  PRIVATE, // zero depth with non-zero index
  NOT_BIP32, // zero depth with non-zero index
  UNKNOWN_PREFIX, // unknown extended key version
  UNKNOWN_PREFIX, // unknown extended key version
  PRIVATE, // private key 0 not in 1..n-1
  PRIVATE, // private key n not in 1..n-1
  NOT_BIP32, // invalid pubkey 02...07
  PRIVATE, // invalid checksum
]

/** The thrown error, which the caller asserts the type of. */
function thrown(run: () => unknown): Error | undefined {
  try {
    run()
    return undefined
  } catch (err) {
    return err as Error
  }
}

describe('core.derive.hd published BIP-32 test vector 5', () => {
  it('extraction-is-faithful', () => {
    expect(INVALID_KEYS.bipsCommit).toBe('c0644a054fd1568ecbfc9c2b656ad5200b16ff74')
    expect(INVALID_KEYS.source).toContain(INVALID_KEYS.bipsCommit)
    // The count at the pinned commit. A re-extraction that lost or gained a
    // key changes it.
    expect(INVALID_KEYS.invalid).toHaveLength(16)
    expect(PARSER_REFUSES).toHaveLength(INVALID_KEYS.invalid.length)
    // Every defect but one is inside the payload, so every key but the one
    // the BIP calls an invalid checksum passes its own base58check. A
    // character lost or changed in transcription would break that.
    const base58check = createBase58check(sha256)
    const failing = INVALID_KEYS.invalid.filter(({ key }) => {
      try {
        return base58check.decode(key).length !== 78
      } catch {
        return true
      }
    })
    expect(failing.map((c) => c.description)).toEqual(['invalid checksum'])
  })

  /** INV-BIP32-3. */
  it('refuses-every-published-invalid-extended-key', () => {
    for (const { description, key } of INVALID_KEYS.invalid) {
      const err = thrown(() => parseExtendedKey(key, MAINNET))
      expect(err, description).toBeInstanceOf(DerivationError)
    }
    // A real key still parses, so the refusals above are about the keys.
    const good = VECTORS[0]?.chains[0]
    if (good === undefined) throw new Error('vector 1 is missing')
    expect(parseExtendedKey(good.extPub, MAINNET).publicExtendedKey).toBe(good.extPub)
    expect(parseExtendedKey(good.extPrv, MAINNET).privateExtendedKey).toBe(good.extPrv)
  })

  /**
   * INV-DPARSE-3. Every path an extended key from outside takes into this
   * device: a key expression on its own, a descriptor, a coordinator file
   * (whose every format becomes a descriptor), an assembled quorum, and the
   * canonical rewrite. All of them reach parseKeyExpression, and each is run
   * anyway, so that a path added around it later is caught here.
   */
  it('every-import-path-refuses-every-published-invalid-extended-key', () => {
    const chains = VECTORS[0]?.chains
    const good = chains?.[0]?.extPub
    const other = chains?.[1]?.extPub
    if (good === undefined || other === undefined) throw new Error('vector 1 is missing')

    INVALID_KEYS.invalid.forEach(({ description, key }, i) => {
      const pattern = PARSER_REFUSES[i]
      if (pattern === undefined) throw new Error(`No outcome listed for ${description}`)

      const direct = thrown(() => parseKeyExpression(key))
      expect(direct, description).toBeInstanceOf(DescriptorParseError)
      expect(direct?.message, description).toMatch(pattern)

      const descriptor = thrown(() => parseDescriptor(withChecksum(`wpkh(${key})`)))
      expect(descriptor, description).toBeInstanceOf(DescriptorParseError)

      const canonical = thrown(() => canonicalKeyExpression(`[deadbeef/48h/0h/0h/2h]${key}`))
      expect(canonical, description).toBeInstanceOf(DescriptorParseError)

      const file = thrown(() => importCoordinatorFile(`wsh(sortedmulti(1,${key},${good}))`))
      expect(file?.message, description).toMatch(pattern)

      const quorum = thrown(() =>
        assembleQuorum({
          threshold: 1,
          keys: [`[deadbeef/48h/0h/0h/2h]${key}`, `[cafebabe/48h/0h/0h/2h]${good}`],
        })
      )
      expect(quorum, description).toBeInstanceOf(AssembleError)
      expect(quorum?.message, description).toMatch(/Key 1 could not be read/)
    })

    // Every path still takes a real key, so the refusals are about the keys.
    expect(parseKeyExpression(good).kind).toBe('extended')
    expect(() => parseDescriptor(withChecksum(`wpkh(${good})`))).not.toThrow()
    expect(importCoordinatorFile(`wsh(sortedmulti(1,${good},${other}))`).descriptors).toHaveLength(
      1
    )
    expect(
      assembleQuorum({
        threshold: 1,
        keys: [`[deadbeef/48h/0h/0h/2h]${good}`, `[cafebabe/48h/0h/0h/2h]${other}`],
      }).total
    ).toBe(2)
  })
})
