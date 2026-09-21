/**
 * Tests for daemon.ipc.socket, the session, and the method table.
 *
 * The most important test here is `never-returns-key-material`. INV-KEY-1 says
 * private key material never leaves this process, and the way that guarantee
 * actually breaks is not a method that returns a seed on purpose: it is a
 * method returning a richer object than intended, or an error message that
 * interpolates something it should not.
 *
 * So rather than checking method by method, it drives every method and searches
 * the serialised responses for the seed, the entropy and the mnemonic. The one
 * sanctioned exception, `seed.reveal`, is tested separately and is asserted to
 * close permanently once backup is confirmed.
 *
 * "Every method" is now true. It used to be a hand-written array of twelve
 * calls covering ten of the daemon's fifty nine methods, with `wallet.import`,
 * the one call handed the mnemonic, invoked on a line whose response was never
 * searched. The list is read from the method table instead, and a method with
 * no fixture in PARAMS fails this test by name.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { connect, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync, readdirSync, rmSync } from 'node:fs'
import { bytesToHex } from '@noble/hashes/utils.js'
import { mnemonicToSeed, wordsToEntropy } from '@nullroute/core'
import { startIpcServer, assertNoNetworkListeners } from '../src/ipc/socket.js'
import { createHandler } from '../src/handler.js'
import { Session } from '../src/session.js'
import type { BootAttestation } from '../src/boot/attestation.js'

const SOCKET = join(tmpdir(), `nullroute-test-${String(process.pid)}.sock`)
const MNEMONIC = 'legal winner thank year wave sausage worth useful legal winner thank yellow'
const PASSPHRASE = 'TREZOR'
const ROLLS = '142536'.repeat(17)
const DESCRIPTOR =
  "wsh(sortedmulti(2,[73c5da0a/48'/0'/0'/2']xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj/<0;1>/*,[aabbccdd/48'/0'/0'/2']xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/<0;1>/*))#l6cw2rmc"

/**
 * The daemon's method table, read from source at test time.
 *
 * The same enumeration tools/checks/check-ipc-reachable.mjs uses. Read rather
 * than listed, so a method added to the daemon cannot quietly escape the
 * INV-KEY-1 search below: it arrives here with no fixture and fails by name.
 */
function declaredMethods(): string[] {
  const dir = join(import.meta.dirname, '../src/ipc/methods')
  const names = new Set<string>()
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.ts')) continue
    const source = readFileSync(join(dir, file), 'utf8')
    for (const match of source.matchAll(/^\s*'([a-z][\w]*\.[\w.]+)':\s*(?:async\s*)?\(/gm)) {
      if (match[1] !== undefined) names.add(match[1])
    }
  }
  const found = [...names].sort()
  // A parse that matches nothing would turn this whole test into a no-op that
  // reports success, which is the failure this file exists to prevent.
  if (found.length < 40) {
    throw new Error(
      `Only ${String(found.length)} IPC methods were found in ${dir}. The shape this ` +
        `enumeration reads has changed, and INV-KEY-1 would be checked on almost nothing.`
    )
  }
  return found
}

/**
 * What to send each method, so every one of them is actually reached.
 *
 * Arguments are chosen to get PAST validation and into the body, since a method
 * that throws on a missing parameter never runs the code that could leak. Most
 * of these still fail here, because this daemon is started without a store or a
 * registry, and that is wanted: an error message is a serialisation route.
 */
const PARAMS: Record<string, Record<string, unknown> | undefined> = {
  'attestation.get': undefined,
  'device.status': undefined,
  'device.identity': undefined,
  'device.setIdentity': { name: 'The attic Pi', colour: 'teal' },
  'device.setTheme': { theme: 'dark' },
  'network.get': undefined,
  'network.set': { id: 'signet' },
  'entropy.account': { rolls: ROLLS },
  'entropy.fromDice': { rolls: ROLLS },
  'entropy.fromMachine': { acknowledged: true },
  'entropy.health': undefined,
  'entropy.rollDice': { count: 10 },
  'mnemonic.validate': { mnemonic: MNEMONIC },
  'wallet.import': { mnemonic: MNEMONIC, passphrase: PASSPHRASE },
  'wallet.fingerprint': undefined,
  'wallet.xpub': { scriptType: 'p2wpkh' },
  'wallet.descriptor': { scriptType: 'p2wpkh' },
  'wallet.addresses': { scriptType: 'p2wpkh', count: 3 },
  'wallet.verifyAddress': { address: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu' },
  'descriptor.parse': { descriptor: DESCRIPTOR },
  'seed.reveal': undefined,
  'seed.confirmBackup': undefined,
  'seed.checkPositions': undefined,
  'seed.checkWord': { index: 0, word: 'legal' },
  'psbt.review': { psbt: 'cHNidP8BAHUCAAAAAQ==' },
  'psbt.sign': { psbt: 'cHNidP8BAHUCAAAAAQ==' },
  'multisig.ourKey': undefined,
  'multisig.review': { descriptor: DESCRIPTOR },
  'multisig.register': { descriptor: DESCRIPTOR },
  'multisig.registrations': undefined,
  'multisig.forget': { checksum: '8rf6pq2t' },
  'multisig.labelCosigner': { checksum: '8rf6pq2t', xpub: 'xpub', label: 'The attic Pi' },
  'multisig.assemble': { threshold: 2, keys: ['a', 'b'] },
  'multisig.importFile': { text: '{}' },
  'multisig.exportBundle': { descriptor: DESCRIPTOR },
  'multisig.addresses': { descriptor: DESCRIPTOR, change: false, start: 0, count: 2 },
  'multisig.verifyAddress': { descriptor: DESCRIPTOR, address: 'bc1q' },
  'message.review': { message: 'hello' },
  'message.sign': { message: 'hello', scriptType: 'p2wpkh', index: 0 },
  'message.verify': { address: 'bc1q', message: 'hello', signature: 'AA==' },
  'labels.import': { text: '{"type":"addr","ref":"bc1q","label":"Rent"}' },
  'labels.export': { labels: [] },
  'bip85.derive': { application: 'mnemonic', index: 0, size: 12 },
  'store.status': undefined,
  'store.create': { passphrase: PASSPHRASE },
  'store.unlock': { passphrase: PASSPHRASE },
  'store.destroy': undefined,
  'wallets.list': undefined,
  'wallets.create': { label: 'Cold', colour: 'teal', passphrase: PASSPHRASE },
  'wallets.unlock': { id: 'aaaaaaaaaaaaaaaa', passphrase: PASSPHRASE },
  'wallets.rename': {
    id: 'aaaaaaaaaaaaaaaa',
    label: 'Cold',
    colour: 'teal',
    passphrase: PASSPHRASE,
  },
  'wallets.passphrase': { id: 'aaaaaaaaaaaaaaaa', oldPassphrase: PASSPHRASE, newPassphrase: 'x' },
  'wallets.destroy': { id: 'aaaaaaaaaaaaaaaa' },
  'wallets.forget': { id: 'aaaaaaaaaaaaaaaa' },
  'backup.create': { passphrase: PASSPHRASE, includeSeed: true, label: 'Cold' },
  'backup.describe': { backup: '{}' },
  'backup.restore': { backup: '{}', passphrase: PASSPHRASE },
  'session.heartbeat': undefined,
  // Last on purpose: it closes the wallet the rest of these need.
  'session.lock': undefined,
}

const attestation: BootAttestation = {
  rootHash: 'f'.repeat(64),
  // No verity mapping, which is what a test host and a laptop both are.
  verityRootHash: null,
  specCount: 1,
  invariantCount: 1,
  tier: 'signer',
  version: 'test',
  checks: [],
}

let server: Server
let session: Session

function call(method: string, params?: unknown): Promise<{ result?: unknown; error?: unknown }> {
  return new Promise((resolve, reject) => {
    const socket = connect(SOCKET)
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      const newline = buffer.indexOf('\n')
      if (newline === -1) return
      socket.end()
      resolve(JSON.parse(buffer.slice(0, newline)) as { result?: unknown })
    })
    socket.on('error', reject)
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ id: '1', method, params })}\n`)
    })
  })
}

beforeAll(async () => {
  session = new Session()
  server = await startIpcServer({
    socketPath: SOCKET,
    handler: createHandler({ attestation, session }),
  })
})

beforeEach(() => {
  session.lock()
})

afterAll(() => {
  server.close()
  rmSync(SOCKET, { force: true })
})

describe('daemon.ipc.socket', () => {
  // INV-NET-1
  it('holds-no-network-listener', () => {
    expect(() => {
      assertNoNetworkListeners()
    }).not.toThrow()
    // A Unix socket's address is the path string; a TCP listener's is an object
    // carrying a port.
    expect(typeof server.address()).toBe('string')
  })

  it('serves-attestation', async () => {
    const { result } = await call('attestation.get')
    expect((result as { rootHash: string }).rootHash).toBe('f'.repeat(64))
    expect((result as { rootHashShort: string }).rootHashShort).toBe('ffffffff...ffffffff')

    // NULL, NOT ABSENT AND NOT EMPTY. The frontend renders a missing verity
    // hash as "no mapping" and a present one as a number to compare, and it can
    // only tell those apart if the daemon is explicit. An undefined here was
    // how this surfaced: abbreviateHash threw on it and the whole method
    // returned an error rather than an attestation.
    const payload = result as { verityRootHash: string | null; verityRootHashShort: string | null }
    expect(payload.verityRootHash).toBeNull()
    expect(payload.verityRootHashShort).toBeNull()
    expect('verityRootHash' in (result as object)).toBe(true)
  })

  /*
   * INV-KEY-1, over EVERY method rather than a list somebody typed once.
   *
   * The spec says no IPC response contains key material "on any method or any
   * error path". The header of this file says this test "drives every method
   * and searches the serialised responses". It did neither: it drove a
   * hand-written array covering ten of the daemon's fifty nine methods, and
   * `wallet.import`, the one call that is HANDED the mnemonic, was called on
   * its own line and its response never added to the array being searched.
   * Forty nine methods were never looked at, including backup.create,
   * backup.restore, bip85.derive, psbt.sign, message.sign, wallets.unlock and
   * store.unlock.
   *
   * Nothing kept the list and the method table in sync, and nothing could: a
   * list is not a check. So the table is read from source, every method must
   * have a fixture here, and a method with none fails this test by name. The
   * cost of adding a method to the daemon is now a line in PARAMS, which is the
   * point.
   */
  it('never-returns-key-material', async () => {
    using seed = mnemonicToSeed(MNEMONIC, PASSPHRASE)
    using entropy = wordsToEntropy(MNEMONIC)
    const seedHex = bytesToHex(seed.bytes)
    const entropyHex = bytesToHex(entropy.bytes)

    await call('wallet.import', { mnemonic: MNEMONIC, passphrase: PASSPHRASE })

    const declared = declaredMethods()
    const missing = declared.filter((method) => !(method in PARAMS))
    expect(
      missing,
      `these IPC methods have no fixture in PARAMS, so INV-KEY-1 is not checked on them`
    ).toEqual([])

    /*
     * Sequential, and failures kept. A method that throws is MORE interesting
     * than one that succeeds: an exception message that interpolates what it
     * was given is the serialisation route people forget about, and most of
     * these will throw here because no store is mounted.
     */
    const responses: unknown[] = []
    for (const method of declared) {
      /*
       * The KNOWN seed reloaded before every call, which is not a nicety.
       *
       * The loop runs in sorted order, so entropy.fromDice and
       * entropy.fromMachine come before labels, message, psbt, seed, store,
       * wallet and wallets, and each of them REPLACES the session seed with one
       * derived from the dice fixture. Everything after them was being searched
       * for a seed the daemon was no longer holding: a leak from psbt.sign
       * would have gone straight past. Verified, by making labels.export return
       * the live seed as hex and watching the test pass.
       */
      session.lock()
      await call('wallet.import', { mnemonic: MNEMONIC, passphrase: PASSPHRASE })
      responses.push(await call(method, PARAMS[method]))
    }
    // Plus the import itself, and a method that does not exist.
    responses.push(await call('wallet.import', { mnemonic: MNEMONIC, passphrase: PASSPHRASE }))
    responses.push(await call('nope'))
    responses.push(await call('wallet.xpub', {}))

    const serialized = JSON.stringify(responses)
    expect(serialized).not.toContain(seedHex)
    expect(serialized).not.toContain(entropyHex)
    expect(serialized).not.toContain(MNEMONIC)
    expect(serialized).not.toContain(PASSPHRASE)
    expect(serialized).not.toContain('xprv')
    // The words individually, not only the whole phrase: a response leaking
    // three of them in a list would pass a search for the joined string.
    for (const word of MNEMONIC.split(' ')) {
      expect(serialized, `the word "${word}" appears in a response`).not.toContain(`"${word}"`)
    }
  })

  // INV-KEY-6: the only signal a user gets that a passphrase was mistyped.
  it('fingerprint-changes-with-passphrase', async () => {
    await call('wallet.import', { mnemonic: MNEMONIC })
    const a = (await call('wallet.fingerprint')).result as { fingerprint: string }
    session.lock()
    await call('wallet.import', { mnemonic: MNEMONIC, passphrase: 'x' })
    const b = (await call('wallet.fingerprint')).result as { fingerprint: string }

    expect(a.fingerprint).not.toBe(b.fingerprint)
    // Both imports SUCCEEDED. Neither errored. That is the hazard.
    expect(a.fingerprint).toMatch(/^[0-9a-f]{8}$/)
    expect(b.fingerprint).toMatch(/^[0-9a-f]{8}$/)
  })

  // INV-IPC-2: the canonical path form is what comes back, whichever went in.
  it('normalizes-path-notation-across-ipc', async () => {
    await call('wallet.import', { mnemonic: MNEMONIC })
    const { result } = await call('wallet.xpub', { scriptType: 'p2wpkh' })
    expect((result as { path: string }).path).toBe("m/84'/0'/0'")
  })

  it('reports-errors-without-swallowing-them', async () => {
    for (const [method, params] of [
      ['nope', undefined],
      ['network.set', { id: 'nope' }],
      ['wallet.import', { mnemonic: 'invalid' }],
      ['wallet.xpub', { scriptType: 'nonsense' }],
      ['wallet.xpub', {}],
    ] as const) {
      const response = await call(method, params)
      expect(response.error, `${method} should report an error`).toBeDefined()
      expect(response.result).toBeUndefined()
    }
  })
})

describe('daemon.session', () => {
  // INV-SESS-1: the one sanctioned exception to INV-KEY-1, and its closure.
  it('reveals-a-generated-seed-once-then-never-again', async () => {
    await call('entropy.fromDice', { rolls: ROLLS })

    const revealed = (await call('seed.reveal')).result as { words: string[] }
    expect(revealed.words).toHaveLength(24)

    await call('seed.confirmBackup')

    // The window is closed, permanently, for this wallet.
    const after = await call('seed.reveal')
    expect(after.error).toBeDefined()
    expect(after.result).toBeUndefined()
    expect(JSON.stringify(after)).toContain('already confirmed')
  })

  // INV-SESS-2: an imported seed is never displayed. It already exists on paper.
  it('never-reveals-an-imported-seed', async () => {
    await call('wallet.import', { mnemonic: MNEMONIC })
    const response = await call('seed.reveal')
    expect(response.error).toBeDefined()
    expect(JSON.stringify(response)).not.toContain(MNEMONIC)
  })

  // INV-SESS-3: the network is fixed at creation. Changing it afterwards would
  // silently show addresses nobody funded.
  it('locks-the-network-once-a-wallet-exists', async () => {
    await call('network.set', { id: 'signet' })
    await call('wallet.import', { mnemonic: MNEMONIC })

    const response = await call('network.set', { id: 'mainnet' })
    expect(response.error).toBeDefined()
    expect(JSON.stringify(response)).toContain('fixed at wallet creation')
  })

  // INV-SESS-4: locking disposes the seed, and nothing works afterwards.
  it('locking-disposes-the-seed', async () => {
    await call('wallet.import', { mnemonic: MNEMONIC })
    expect(((await call('device.status')).result as { unlocked: boolean }).unlocked).toBe(true)

    await call('session.lock')
    const status = (await call('device.status')).result as { unlocked: boolean; hasWallet: boolean }
    expect(status.unlocked).toBe(false)
    expect(status.hasWallet).toBe(false)

    const after = await call('wallet.xpub', { scriptType: 'p2wpkh' })
    expect(after.error).toBeDefined()
  })

  // INV-SESS-5: word checking returns a verdict, never a word.
  it('checks-a-word-without-revealing-one', async () => {
    await call('entropy.fromDice', { rolls: ROLLS })
    const revealed = (await call('seed.reveal')).result as { words: string[] }
    const third = revealed.words[2]
    if (third === undefined) throw new Error('no word')

    const right = await call('seed.checkWord', { index: 2, word: third })
    expect((right.result as { correct: boolean }).correct).toBe(true)

    const wrong = await call('seed.checkWord', { index: 2, word: 'zebra' })
    expect((wrong.result as { correct: boolean }).correct).toBe(false)
    // The response carries a boolean and nothing else.
    expect(JSON.stringify(wrong)).not.toContain(third)
  })
})

describe('daemon wallet surface', () => {
  it('derives-addresses-and-a-checksummed-descriptor', async () => {
    await call('wallet.import', { mnemonic: MNEMONIC })

    const addresses = (await call('wallet.addresses', { scriptType: 'p2wpkh', count: 3 }))
      .result as { addresses: { address: string; path: string }[] }
    expect(addresses.addresses).toHaveLength(3)
    expect(addresses.addresses[0]?.address.startsWith('bc1q')).toBe(true)

    const descriptor = (await call('wallet.descriptor', { scriptType: 'p2wpkh' })).result as {
      descriptor: string
      checksum: string
    }
    expect(descriptor.descriptor).toMatch(
      /^wpkh\(\[[0-9a-f]{8}\/84'\/0'\/0'\]xpub.*\/0\/\*\)#\w{8}$/
    )
    expect(descriptor.checksum).toHaveLength(8)
  })

  // INV-ADDRV-1: verification re-derives rather than comparing a stored list.
  it('verifies-an-address-by-re-deriving-it', async () => {
    await call('wallet.import', { mnemonic: MNEMONIC })
    const addresses = (await call('wallet.addresses', { scriptType: 'p2wpkh', count: 3 }))
      .result as { addresses: { address: string; path: string }[] }
    const mine = addresses.addresses[1]?.address
    if (mine === undefined) throw new Error('no address')

    const found = (await call('wallet.verifyAddress', { address: mine })).result as {
      found: boolean
      path: string
    }
    expect(found.found).toBe(true)
    expect(found.path).toContain("84'/0'/0'")

    // Somebody else's address. The device says no rather than shrugging.
    const other = (
      await call('wallet.verifyAddress', {
        address: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
      })
    ).result as { found: boolean }
    expect(other.found).toBe(false)
  })
})
