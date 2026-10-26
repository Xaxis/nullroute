/**
 * Real exports from other wallets, read the way this device reads them.
 *
 * Spec: core.descriptor.coordinator
 *
 * descriptor.coordinator.test.ts builds every file it reads inline, which tests
 * this module against its own idea of each format. These are the files the
 * formats actually arrive in. Sparrow keeps exports from Coldcard, Specter,
 * Jade, Keystone, Caravan and Electrum, and the BIP-129 test vectors, as
 * fixtures for its own importers, and Bitcoin Core 31.1 wrote the rest. All of
 * them are kept verbatim under spec/interop/, with where each came from in
 * spec/interop/README.md.
 *
 * Every expected value comes from outside this repository's code: a value
 * Sparrow's own test asserts for the file, a first address BIP-129 publishes,
 * an address from spec/vectors/bip84-86-addresses.json, or what Core's
 * `deriveaddresses` returned when tools/gen-interop-core.sh asked it. Where
 * this device reads a file differently from Sparrow, the test says so and
 * asserts what this device does, because that difference is the finding.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as btc from '@scure/btc-signer'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { CoordinatorFormatError, importCoordinatorFile } from '../src/descriptor/coordinator.js'
import { type Descriptor, type KeyExpression } from '../src/descriptor/parse.js'
import { derivePubkeyAt } from '../src/descriptor/derive-key.js'
import { keyPayload, multisigShape } from '../src/descriptor/multisig.js'
import { deriveQuorumAddresses } from '../src/descriptor/quorum-addresses.js'
import { MAINNET, REGTEST, type Network } from '../src/network/networks.js'

const INTEROP = new URL('../../../spec/interop/', import.meta.url)
const VECTORS = new URL('../../../spec/vectors/', import.meta.url)

function read(path: string): string {
  return readFileSync(new URL(path, INTEROP), 'utf8')
}

function readJson(path: string): unknown {
  return JSON.parse(read(path))
}

/** What Core's `deriveaddresses` returned: one list, or one per multipath branch. */
interface CoreDerived {
  readonly descriptor: string
  readonly range: readonly number[] | null
  readonly result: readonly string[] | readonly (readonly string[])[]
}

interface SparrowDerived extends CoreDerived {
  readonly fixture: string
}

interface CoreListed {
  readonly wallet_name: string
  readonly descriptors: readonly { readonly desc: string; readonly internal: boolean }[]
}

interface CoreDescriptorInfo {
  readonly input: string
  readonly result: { readonly checksum: string; readonly isrange: boolean }
}

interface AddressVector {
  readonly index: number
  readonly address: string
}

const PUBLISHED = JSON.parse(
  readFileSync(new URL('bip84-86-addresses.json', VECTORS), 'utf8')
) as Record<
  'bip84' | 'bip86',
  { accountXpub: string; receive: AddressVector[]; change: AddressVector[] }
>

const CORE_DERIVED = readJson('bitcoin-core-31.1/deriveaddresses.json') as CoreDerived[]
const CORE_SPARROW = readJson('bitcoin-core-31.1/deriveaddresses-sparrow.json') as SparrowDerived[]

const body = (descriptor: string): string => descriptor.split('#')[0] ?? descriptor

/** Core's answer for one descriptor it was given, found by its text. */
function coreFor(descriptor: string): CoreDerived['result'] {
  const entry = CORE_DERIVED.find((candidate) => body(candidate.descriptor) === body(descriptor))
  if (entry === undefined) throw new Error(`Core was never asked about ${descriptor}`)
  return entry.result
}

/**
 * The addresses a descriptor pays to, by whichever derivation fits it.
 *
 * Quorums and taproot go through deriveQuorumAddresses, which is what the
 * device uses. Single-key segwit has no descriptor-level helper in this
 * package, so it is the shared key derivation plus the library's script
 * constructor, the same two steps every other script kind takes.
 */
function addressesOf(
  descriptor: Descriptor,
  network: Network,
  count: number,
  change = false
): string[] {
  const { script } = descriptor
  const single = (key: KeyExpression, pay: (pubkey: Uint8Array) => string): string[] =>
    Array.from({ length: count }, (_, index) => pay(derivePubkeyAt(key, index, change)))

  if (script.kind === 'wpkh') {
    return single(script.key, (pubkey) => btc.p2wpkh(pubkey, network).address)
  }
  if (script.kind === 'sh' && script.inner.kind === 'wpkh') {
    return single(
      script.inner.key,
      (pubkey) => btc.p2sh(btc.p2wpkh(pubkey, network), network).address
    )
  }
  return deriveQuorumAddresses(descriptor, { network, count, change }).map((entry) => entry.address)
}

/**
 * Every descriptor this device read from a Sparrow fixture derives, on regtest,
 * exactly the addresses Core derived from the same file.
 *
 * The generator read each file with its own small reader, in the order the
 * file gives its descriptors, and so does this module, so the two lists line
 * up by position. A descriptor without a wildcard has one address whatever the
 * index, and Core was asked for it without a range.
 */
function expectCoreAgrees(fixture: string, descriptors: readonly Descriptor[]): void {
  const core = CORE_SPARROW.filter((entry) => entry.fixture === `sparrow/${fixture}`)
  expect(core.length, fixture).toBe(descriptors.length)
  descriptors.forEach((descriptor, i) => {
    const entry = core[i]!
    if (descriptor.ranged) {
      if (body(entry.descriptor).includes('<0;1>')) {
        const [receive, change] = entry.result as readonly (readonly string[])[]
        expect(addressesOf(descriptor, REGTEST, 2, false), fixture).toEqual(receive)
        expect(addressesOf(descriptor, REGTEST, 2, true), fixture).toEqual(change)
      } else {
        expect(addressesOf(descriptor, REGTEST, 2), fixture).toEqual(entry.result)
      }
    } else {
      expect(entry.range, fixture).toBeNull()
      // The index does not apply to a fixed descriptor, so both are Core's one.
      expect(addressesOf(descriptor, REGTEST, 2), fixture).toEqual([
        entry.result[0],
        entry.result[0],
      ])
    }
  })
}

function keysOf(descriptor: Descriptor): readonly KeyExpression[] {
  const { script } = descriptor
  if (script.kind === 'wpkh' || script.kind === 'tr' || script.kind === 'pkh') return [script.key]
  if (script.kind === 'sh' && script.inner.kind === 'wpkh') return [script.inner.key]
  return multisigShape(descriptor).keys
}

/** Fingerprint, origin path and extended key, as this device extracted them. */
function origins(descriptor: Descriptor): { fingerprint: string; path: string; xpub: string }[] {
  return keysOf(descriptor).map((key) => {
    if (key.kind !== 'extended' || key.origin === undefined) {
      throw new Error('expected an extended key with an origin')
    }
    return { fingerprint: key.origin.fingerprint, path: key.origin.path, xpub: key.xpub }
  })
}

function sparrow(name: string) {
  return importCoordinatorFile(read(`sparrow/${name}`))
}

const parsedOf = (name: string): Descriptor[] =>
  sparrow(name).descriptors.map((entry) => entry.parsed)

describe('core.descriptor.coordinator real exports', () => {
  /**
   * INV-COORD-6. The fixtures are the ones the README describes.
   *
   * spec/interop/SHA256SUMS is pinned in coordinator.spec.yaml, which `make
   * verify` checks, and this checks every file against it, the same chain
   * `sha256sum -c` would follow. A file nobody listed fails too, so a fixture
   * cannot be added without its provenance being recorded.
   */
  it('every-fixture-matches-its-pinned-hash', () => {
    const listed = new Map<string, string>()
    for (const line of read('SHA256SUMS').trim().split('\n')) {
      const match = /^([0-9a-f]{64}) {2}(\S+)$/.exec(line)
      if (match === null) throw new Error(`not sha256sum format: ${line}`)
      listed.set(match[2]!, match[1]!)
    }

    const found: string[] = []
    const walk = (directory: string): void => {
      for (const entry of readdirSync(new URL(directory, INTEROP))) {
        const path = `${directory}${entry}`
        if (statSync(new URL(path, INTEROP)).isDirectory()) walk(`${path}/`)
        else if (path !== 'SHA256SUMS' && path !== 'README.md') found.push(path)
      }
    }
    walk('')

    expect(found.sort()).toEqual([...listed.keys()].sort())
    // The README states each file's hash beside its provenance, and a README
    // that disagreed with the files would be provenance for something else.
    const readme = read('README.md').split('\n')
    for (const [path, hash] of listed) {
      expect(bytesToHex(sha256(new Uint8Array(readFileSync(new URL(path, INTEROP))))), path).toBe(
        hash
      )
      const row = readme.filter((line) => line.startsWith(`| \`${path}\` |`))
      expect(row, path).toHaveLength(1)
      expect(row[0], path).toContain(`\`${hash}\``)
    }
    // Both sources are present, so a test below cannot pass by reading nothing.
    expect(found.filter((path) => path.startsWith('sparrow/')).length).toBe(37)
    expect(found.filter((path) => path.startsWith('bitcoin-core-31.1/')).length).toBe(6)
  })

  /**
   * INV-COORD-6. Coldcard setup files, from Coldcard's own test files as Sparrow
   * keeps them. The structure is what Sparrow's ColdcardMultisigTest asserts;
   * the addresses are Core's.
   */
  it('reads-real-coldcard-exports-as-sparrow-asserts', () => {
    const p2wsh = sparrow('cc-multisig-export-1.txt')
    expect(p2wsh.format).toBe('coldcard')
    expect(p2wsh.name).toBe('CC-2-of-4')
    expect(p2wsh.descriptors.map((entry) => entry.change)).toEqual([false, true])
    const shape = multisigShape(p2wsh.descriptors[0]!.parsed)
    expect([shape.kind, shape.threshold, shape.total, shape.sorted]).toEqual(['wsh', 2, 4, true])
    expect(origins(p2wsh.descriptors[0]!.parsed).map((key) => key.fingerprint)).toEqual([
      '0f056943',
      '6ba6cfd0',
      '747b698e',
      '7bb026be',
    ])
    for (const key of origins(p2wsh.descriptors[0]!.parsed)) {
      expect(key.path).toBe("m/48'/0'/0'/2'")
    }
    expectCoreAgrees('cc-multisig-export-1.txt', parsedOf('cc-multisig-export-1.txt'))

    // "Format: P2WSH-P2SH", Coldcard's spelling of nested segwit, on testnet keys.
    const nested = sparrow('cc-multisig-export-2.txt')
    expect(nested.name).toBe('CC-2-of-4')
    const nestedShape = multisigShape(nested.descriptors[0]!.parsed)
    expect([nestedShape.kind, nestedShape.threshold, nestedShape.total]).toEqual(['sh-wsh', 2, 4])
    for (const key of origins(nested.descriptors[0]!.parsed)) {
      expect(key.path).toBe("m/48'/1'/0'/1'")
      expect(key.xpub.startsWith('tpub')).toBe(true)
    }
    expectCoreAgrees('cc-multisig-export-2.txt', parsedOf('cc-multisig-export-2.txt'))
  })

  /**
   * INV-COORD-5. Electrum's Coldcard-format export of a quorum whose third
   * cosigner sits on m/47'/0'/0'/1'. Sparrow's importWalletMultiDeriv asserts
   * each keystore's own origin. This device used to give all three keys the
   * last Derivation line in the file.
   */
  it('assembles-each-cosigner-under-its-own-derivation-line', () => {
    const imported = sparrow('cc-multisig-export-multideriv.txt')
    expect(imported.name).toBe('el-CC-3-of-3-sb-2')
    const shape = multisigShape(imported.descriptors[0]!.parsed)
    expect([shape.kind, shape.threshold, shape.total]).toEqual(['wsh', 3, 3])

    for (const entry of imported.descriptors) {
      const keys = origins(entry.parsed)
      expect(keys[0]).toEqual({
        fingerprint: '06b57041',
        path: "m/48'/0'/0'/2'",
        xpub: 'xpub6EfEGa5isJbQFSswM5Uptw5BSq2Td1ZDJr3QUNUcMySpC7itZ3ccypVHtLPnvMzKQ2qxrAgH49vhVxRcaQLFbixAVRR8RACrYTp88Uv9h8Z',
      })
      expect(keys[1]?.path).toBe("m/48'/0'/0'/2'")
      expect(keys[2]?.fingerprint).toBe('ca9a2b19')
      expect(keys[2]?.path).toBe("m/47'/0'/0'/1'")
    }
    // Both lines are reported, since the file asserted both.
    expect(imported.unverifiedClaims).toContain("Derivation line says m/48'/0'/0'/2'.")
    expect(imported.unverifiedClaims).toContain("Derivation line says m/47'/0'/0'/1'.")
    expectCoreAgrees(
      'cc-multisig-export-multideriv.txt',
      parsedOf('cc-multisig-export-multideriv.txt')
    )
  })

  /** INV-COORD-2. Sparrow refuses both of these too. */
  it('refuses-real-coldcard-exports-missing-policy-or-a-cosigner', () => {
    expect(() => sparrow('cc-multisig-export-nopolicy.txt')).toThrow(/missing Policy/)
    expect(() => sparrow('cc-multisig-export-missingkey.txt')).toThrow(
      /policy says 4 cosigners and the file lists 3/
    )
  })

  /**
   * INV-COORD-6. Specter Desktop's export, which Sparrow also writes.
   *
   * These two are from 2020, before Specter put `/0/*` on the descriptor it
   * exports, and this device reads them exactly as written: a descriptor with
   * no wildcard, deriving one address, and `multi()` in the order written.
   * Sparrow reads the same files as an account with receive and change
   * branches and reads `multi()` as `sortedmulti()`, so the two derive
   * different addresses from the multisig file. Core reads them as this device
   * does, which is what the addresses below compare against.
   */
  it('reads-real-specter-json-as-written', () => {
    const single = sparrow('specter-wallet.json')
    expect(single.format).toBe('json')
    expect(single.name).toBe('specter-wallet')
    const descriptor = single.descriptors[0]!.parsed
    expect(descriptor.script.kind).toBe('sh')
    expect(descriptor.ranged).toBe(false)
    expect(origins(descriptor)).toEqual([
      {
        fingerprint: '4df18faa',
        path: "m/49'/0'/0'",
        xpub: 'xpub6BgwyseZdeGJj2vB3FPHSGPxR1LLkr8AsAJqedrgjwBXKXXVWkH31fhwtQXgrM7uMrWjLwXhuDhhenNAh5eBdUSjrHkrKfaXutcJdAfgQ8D',
      },
    ])
    expectCoreAgrees('specter-wallet.json', [descriptor])

    const multi = sparrow('specter-multisig-wallet.json')
    expect(multi.name).toBe('specter-multisig')
    const shape = multisigShape(multi.descriptors[0]!.parsed)
    expect([shape.kind, shape.threshold, shape.total, shape.sorted]).toEqual(['wsh', 3, 4, false])
    expect(multi.descriptors[0]!.parsed.ranged).toBe(false)
    expect(origins(multi.descriptors[0]!.parsed)[0]).toEqual({
      fingerprint: 'ca9a2b19',
      path: "m/48'/0'/0'/2'",
      xpub: 'xpub6EhbRDNhmMX863W8RujJyAMw1vtM4MHXnsk14paK1ZBEH75k44gWqfaraXCrzg6w9pzC2yLc28vAdUfpB9ShuEB1HA9xMs6BjmRi4PKbt1K',
    })
    expectCoreAgrees('specter-multisig-wallet.json', parsedOf('specter-multisig-wallet.json'))
  })

  /**
   * INV-COORD-1. A receive and change pair on two lines, with and without a
   * blank line between. Both were refused as "altered since it was written",
   * because the whole file was read as one descriptor.
   */
  it('reads-descriptor-files-with-one-descriptor-per-line', () => {
    for (const name of ['descriptor-receive-change1.txt', 'descriptor-receive-change2.txt']) {
      const imported = sparrow(name)
      expect(imported.format).toBe('descriptor')
      // Each line came with a correct checksum, so what comes out is the file.
      expect(imported.descriptors.map((entry) => entry.descriptor)).toEqual(
        read(`sparrow/${name}`)
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
      )
      // The file does not say which branch is which, so neither does this.
      expect(imported.descriptors.map((entry) => entry.change)).toEqual([undefined, undefined])
    }
  })

  /**
   * INV-COORD-6. Descriptor files, and the descriptors Jade and Keystone export
   * for one key. Origins as Sparrow's DescriptorTest, JadeTest and
   * KeystoneSinglesigTest assert them; addresses from Core, and for Jade, whose
   * key is the BIP-84 test key, from BIP-84 itself.
   */
  it('reads-real-descriptor-exports-as-sparrow-asserts', () => {
    const a262 = {
      fingerprint: 'a262308d',
      path: "m/84'/0'/0'",
      xpub: 'xpub6DM7CYgaTMdMbhTcLTUWmNUE5WLXK5hx8ZMa4sRw8qYJPqtqKYiKnwsmT8A6AijDVAUZRivdBnXdR8QE7Y9vVnqvzPL3fXCmu1WtCRLdAoz',
    }
    for (const name of [
      'descriptor-receive.txt',
      'descriptor-receive-change1.txt',
      'descriptor-receive-change2.txt',
      'descriptor-multipath.txt',
    ]) {
      for (const descriptor of parsedOf(name)) {
        expect(descriptor.script.kind, name).toBe('wpkh')
        expect(origins(descriptor), name).toEqual([a262])
      }
      expectCoreAgrees(name, parsedOf(name))
    }
    // BIP-389 multipath, as Sparrow writes it now: one descriptor for both.
    const multipath = parsedOf('descriptor-multipath.txt')[0]!
    expect(keysOf(multipath)[0]).toMatchObject({ multipath: [0, 1], ranged: true })

    const jade = parsedOf('jade-keystore.txt')[0]!
    expect(origins(jade)[0]).toMatchObject({ fingerprint: '73c5da0a', path: "m/84'/0'/0'" })
    expect(keyPayload(origins(jade)[0]!.xpub)).toBe(keyPayload(PUBLISHED.bip84.accountXpub))
    expect(addressesOf(jade, MAINNET, 2)).toEqual(
      PUBLISHED.bip84.receive.slice(0, 2).map((entry) => entry.address)
    )
    expectCoreAgrees('jade-keystore.txt', [jade])

    // Keystone writes a zpub and an uppercase fingerprint. Both are accepted,
    // and the descriptor keeps them as written: what this module guarantees is
    // a recomputed checksum, not a rewritten key.
    const keystone = sparrow('keystone-singlesig-keystore-1.txt').descriptors[0]!
    expect(keystone.descriptor).toMatch(/^wpkh\(\[5271C071\/84'\/0'\/0'\]zpub6rcab/)
    expect(origins(keystone.parsed)[0]).toMatchObject({
      fingerprint: '5271c071',
      path: "m/84'/0'/0'",
    })
    expect(keyPayload(origins(keystone.parsed)[0]!.xpub)).toBe(
      keyPayload(
        'zpub6rcabYFcdr41zyUNRWRyHYs2Sm86E5XV8RjjRzTFYsiCngteeZnkwaF2xuhjmM6kpHjuNpFW42BMhzPmFwXt48e1FhddMB7xidZzN4SF24K'
      )
    )
    expectCoreAgrees('keystone-singlesig-keystore-1.txt', [keystone.parsed])
  })

  /**
   * INV-COORD-6. BIP-129 files. multisig-2 and multisig-3 are the test vectors
   * BIP-129 publishes, multisig-1 and multisig-4 are Sparrow's, and Sparrow's
   * Bip129Test asserts the first receive address of each it accepts. The first
   * address this device derives is the one each file states.
   *
   * multisig-3 is `multi()`, not `sortedmulti()`. Sparrow refuses it, because it
   * reads `multi()` as sorted and the sorted keys derive a different address.
   * This device reads it as written and derives the address BIP-129 publishes.
   */
  it('reads-real-bsms-files-to-the-addresses-bip-129-states', () => {
    const stated: Record<string, string> = {
      'bsms/multisig-1.bsms': 'bc1qfagqa83vrv9phj0886rlx6d68zzd7gejtr0ns8xxfeckve27397q6vq47w',
      'bsms/multisig-2.bsms': 'bc1qrgc6p3kylfztu06ysl752gwwuekhvtfh9vr7zg43jvu60mutamcsv948ej',
      'bsms/multisig-3.bsms': '3GzMtFXahiu4TpGNGFc4bHMvAcvz5vVQrT',
      'bsms/multisig-4.bsms': 'bc1qrgc6p3kylfztu06ysl752gwwuekhvtfh9vr7zg43jvu60mutamcsv948ej',
      // No restrictions and no wildcard: one address, still the one stated.
      'bsms/multisig-8.bsms': 'bc1qrgc6p3kylfztu06ysl752gwwuekhvtfh9vr7zg43jvu60mutamcsv948ej',
      'bsms/multisig-10.bsms': '3MmNkJ3e67jDGNwGL7yQ886T192Bbb81zP',
      // Fixed on the change chain at index 3, which Sparrow's test asserts.
      'bsms/multisig-12.bsms': 'bc1qr47z3tyaep62u4v3tjwj3gre5aqje242g0aarp0gurnltwpswa0svqrv9y',
    }
    for (const [name, address] of Object.entries(stated)) {
      const imported = importCoordinatorFile(read(`sparrow/${name}`))
      expect(imported.format, name).toBe('bsms')
      expect(addressesOf(imported.descriptors[0]!.parsed, MAINNET, 1)[0], name).toBe(address)
      // The file's own statement, surfaced and not consumed (INV-COORD-4).
      expect(imported.unverifiedClaims.join(' ').toLowerCase(), name).toContain(
        address.toLowerCase()
      )
    }

    // Templates expand into one descriptor per restriction, in the order given.
    const template = importCoordinatorFile(read('sparrow/bsms/multisig-2.bsms'))
    expect(template.descriptors.map((entry) => entry.change)).toEqual([false, true])
    expect(template.descriptors[1]!.descriptor).toContain('/1/*')
    expect(multisigShape(template.descriptors[0]!.parsed).sorted).toBe(true)
    expect(multisigShape(parsedOf('bsms/multisig-3.bsms')[0]!).sorted).toBe(false)

    // Every BSMS file this device reads, against Core.
    for (const n of ['1', '2', '3', '4', '5', '7', '8', '9', '10', '11', '12', '13', '14']) {
      expectCoreAgrees(`bsms/multisig-${n}.bsms`, parsedOf(`bsms/multisig-${n}.bsms`))
    }
    expectCoreAgrees(
      'bsms/multisig-address-mismatch.bsms',
      parsedOf('bsms/multisig-address-mismatch.bsms')
    )
  })

  /**
   * INV-COORD-3. BIP-129 requires a template to come with path restrictions.
   * multisig-6, -15 and -17 say "No path restrictions" beside one, and -16
   * leaves the line blank. Each is refused for that reason and not, as before,
   * with a claim that a good cosigner key was not valid base58.
   */
  it('refuses-real-bsms-files-bip-129-does-not-allow', () => {
    for (const n of ['6', '15', '16', '17']) {
      const attempt = (): unknown => importCoordinatorFile(read(`sparrow/bsms/multisig-${n}.bsms`))
      expect(attempt, n).toThrow(CoordinatorFormatError)
      expect(attempt, n).toThrow(/requires a template to come with path restrictions/)
      expect(attempt, n).not.toThrow(/base58/)
    }
    expect(() => importCoordinatorFile(read('sparrow/bsms/multisig-threshold-zero.bsms'))).toThrow(
      /threshold 0 is out of range/
    )
  })

  /**
   * INV-COORD-4. A first address that disagrees with the descriptor is shown and
   * not believed. This device derives its own first address from the
   * descriptor, which is not the one the file states, and nothing it returns
   * came from the statement. Sparrow refuses these files outright; here the
   * comparison is the user's, on the import screen.
   */
  it('surfaces-a-real-bsms-first-address-without-believing-it', () => {
    for (const name of ['multisig-address-mismatch.bsms', 'multisig-9.bsms']) {
      const imported = importCoordinatorFile(read(`sparrow/bsms/${name}`))
      const claimed = 'bc1qng45c3rez2265epnmvhajjj6hlpdv83zn8q8xy6h3mh2pnn8fglq0qgdzk'
      expect(imported.unverifiedClaims.join(' '), name).toContain(claimed)
      expect(imported.unverifiedClaims.join(' '), name).toContain('nothing here has checked it')
      const derived = addressesOf(imported.descriptors[0]!.parsed, MAINNET, 1)[0]
      expect(derived, name).not.toBe(claimed)
    }
    // BIP-129 says the fourth line must be there. This device does not need
    // it, since it would not believe it, and reads the file without one.
    const unstated = importCoordinatorFile(read('sparrow/bsms/multisig-14.bsms'))
    expect(unstated.descriptors).toHaveLength(2)
    expect(unstated.unverifiedClaims).toEqual(['Paths line says /0/*,/1/*.'])
  })

  /**
   * INV-COORD-6. Bitcoin Core's own export of a wallet holding the BIP-84 and
   * BIP-86 test key. This device reproduces Core's descriptors character for
   * character, checksum included, takes the branch from `internal`, extracts
   * the BIP's own account key, and derives Core's addresses on regtest and the
   * BIPs' published addresses on mainnet.
   */
  it('reads-bitcoin-core-31-listdescriptors', () => {
    const listed = readJson('bitcoin-core-31.1/listdescriptors-bip84-bip86.json') as CoreListed
    const imported = importCoordinatorFile(
      read('bitcoin-core-31.1/listdescriptors-bip84-bip86.json')
    )
    expect(imported.format).toBe('json')
    expect(imported.name).toBe('bip84-bip86')
    expect(imported.descriptors.map((entry) => entry.descriptor)).toEqual(
      listed.descriptors.map((entry) => entry.desc)
    )
    expect(imported.descriptors.map((entry) => entry.change)).toEqual(
      listed.descriptors.map((entry) => entry.internal)
    )
    expect(imported.descriptors).toHaveLength(4)

    for (const entry of imported.descriptors) {
      const bip = entry.parsed.script.kind === 'tr' ? PUBLISHED.bip86 : PUBLISHED.bip84
      const purpose = entry.parsed.script.kind === 'tr' ? '86' : '84'
      const [key] = origins(entry.parsed)
      expect(key).toMatchObject({ fingerprint: '73c5da0a', path: `m/${purpose}'/0'/0'` })
      expect(keyPayload(key!.xpub)).toBe(keyPayload(bip.accountXpub))

      expect(addressesOf(entry.parsed, REGTEST, 3)).toEqual(coreFor(entry.descriptor))
      const published = entry.change === true ? bip.change : bip.receive
      const mainnet = addressesOf(entry.parsed, MAINNET, 3)
      for (const vector of published) expect(mainnet[vector.index]).toBe(vector.address)
    }
  })

  /**
   * INV-COORD-6. A 2-of-3 quorum held by a Core cosigner. The `descriptors`
   * array of its `listdescriptors` is the shape `importdescriptors` takes, and
   * the generator proved it by having Core import it into a fresh wallet. This
   * is the one file this module names as Core's own format.
   */
  it('reads-a-bitcoin-core-importdescriptors-array-core-accepted', () => {
    const listed = readJson('bitcoin-core-31.1/listdescriptors-2of3.json') as CoreListed
    const array = importCoordinatorFile(read('bitcoin-core-31.1/importdescriptors-2of3.json'))
    expect(array.format).toBe('core-importdescriptors')
    expect(array.descriptors.map((entry) => entry.descriptor)).toEqual(
      listed.descriptors.map((entry) => entry.desc)
    )
    expect(array.descriptors.map((entry) => entry.change)).toEqual([false, true])

    // The same quorum wrapped in listdescriptors' object reads the same.
    const wrapped = importCoordinatorFile(read('bitcoin-core-31.1/listdescriptors-2of3.json'))
    expect(wrapped.format).toBe('json')
    expect(wrapped.name).toBe('2of3')
    expect(wrapped.descriptors).toEqual(array.descriptors)

    for (const entry of array.descriptors) {
      const shape = multisigShape(entry.parsed)
      expect([shape.kind, shape.threshold, shape.total, shape.sorted]).toEqual(['wsh', 2, 3, true])
      expect(origins(entry.parsed).map((key) => [key.fingerprint, key.path])).toEqual([
        ['73c5da0a', "m/48'/0'/0'/2'"],
        ['3442193e', "m/48'/0'/0'/2'"],
        ['bd16bee5', "m/48'/0'/0'/2'"],
      ])
      expect(addressesOf(entry.parsed, REGTEST, 3)).toEqual(coreFor(entry.descriptor))
    }
  })

  /**
   * INV-COORD-6. The BIP-389 multipath form of each Core wallet, which is how
   * this device registers a quorum. Core's checksum for it, and Core's
   * expansion into receive and change addresses, are this device's.
   */
  it('reads-multipath-descriptors-as-core-expands-them', () => {
    const infos = readJson('bitcoin-core-31.1/getdescriptorinfo.json') as CoreDescriptorInfo[]
    const multipaths = infos.filter((info) => info.input.includes('<0;1>'))
    expect(multipaths).toHaveLength(3)

    for (const info of multipaths) {
      const [entry] = importCoordinatorFile(info.input).descriptors
      expect(entry!.descriptor).toBe(`${info.input}#${info.result.checksum}`)
      const [receive, change] = coreFor(info.input) as readonly (readonly string[])[]
      expect(addressesOf(entry!.parsed, REGTEST, 3, false)).toEqual(receive)
      expect(addressesOf(entry!.parsed, REGTEST, 3, true)).toEqual(change)
    }
  })

  /**
   * INV-COORD-6. Formats this device does not read are refused whole, never
   * partly read: Caravan's and Electrum's wallet files carry keys but no
   * descriptor, Specter DIY's is a device command wrapped around one, and the
   * labelled descriptor puts a word in front of it.
   */
  it('refuses-real-exports-in-formats-it-does-not-read', () => {
    expect(() => sparrow('caravan-multisig-export-1.json')).toThrow(/holds no output descriptor/)
    expect(() => sparrow('electrum-multisig-wallet.json')).toThrow(/holds no output descriptor/)
    expect(() => sparrow('specter-diy-export.txt')).toThrow(/Unknown descriptor function/)
    expect(() => sparrow('descriptor-labelled.txt')).toThrow(/Unknown descriptor function/)
    for (const name of [
      'caravan-multisig-export-1.json',
      'electrum-multisig-wallet.json',
      'specter-diy-export.txt',
      'descriptor-labelled.txt',
    ]) {
      expect(() => sparrow(name), name).toThrow(CoordinatorFormatError)
    }
  })
})
