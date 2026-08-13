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
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { connect, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
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

const attestation: BootAttestation = {
  rootHash: 'f'.repeat(64),
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
  })

  // INV-KEY-1: the boundary, checked by searching rather than by inspection.
  it('never-returns-key-material', async () => {
    using seed = mnemonicToSeed(MNEMONIC, PASSPHRASE)
    using entropy = wordsToEntropy(MNEMONIC)
    const seedHex = bytesToHex(seed.bytes)
    const entropyHex = bytesToHex(entropy.bytes)

    await call('wallet.import', { mnemonic: MNEMONIC, passphrase: PASSPHRASE })

    const responses = await Promise.all([
      call('attestation.get'),
      call('device.status'),
      call('network.get'),
      call('mnemonic.validate', { mnemonic: MNEMONIC }),
      call('wallet.fingerprint'),
      call('wallet.xpub', { scriptType: 'p2wpkh' }),
      call('wallet.descriptor', { scriptType: 'p2wpkh' }),
      call('wallet.addresses', { scriptType: 'p2wpkh', count: 3 }),
      call('entropy.account', { rolls: ROLLS }),
      // Error paths too: an exception message is a serialisation route people
      // forget about.
      call('wallet.xpub', {}),
      call('nope'),
      // An imported seed may never be revealed, at any point.
      call('seed.reveal'),
    ])

    const serialized = JSON.stringify(responses)
    expect(serialized).not.toContain(seedHex)
    expect(serialized).not.toContain(entropyHex)
    expect(serialized).not.toContain(MNEMONIC)
    expect(serialized).not.toContain(PASSPHRASE)
    expect(serialized).not.toContain('xprv')
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
    expect(descriptor.descriptor).toMatch(/^wpkh\(\[[0-9a-f]{8}\/84'\/0'\/0'\]xpub.*\/0\/\*\)#\w{8}$/)
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
    const other = (await call('wallet.verifyAddress', {
      address: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
    })).result as { found: boolean }
    expect(other.found).toBe(false)
  })
})
