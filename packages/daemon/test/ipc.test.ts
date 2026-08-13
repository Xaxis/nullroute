/**
 * Tests for daemon.ipc.socket and the method table.
 *
 * The most important test here is `never-returns-key-material`. INV-KEY-1 says
 * private key material never leaves this process, and the way that guarantee
 * actually breaks is not a method that returns a seed on purpose: it is a
 * method that returns a richer object than intended, or an error message that
 * interpolates something it should not.
 *
 * So rather than checking method by method, it drives every method and searches
 * the serialised responses for the seed, the entropy and the mnemonic.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connect, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'
import { bytesToHex } from '@noble/hashes/utils.js'
import { MAINNET, mnemonicToSeed, wordsToEntropy } from '@nullroute/core'
import { startIpcServer, assertNoNetworkListeners } from '../src/ipc/socket.js'
import { createHandler } from '../src/handler.js'
import type { BootAttestation } from '../src/boot/attestation.js'

const SOCKET = join(tmpdir(), `nullroute-test-${String(process.pid)}.sock`)
const MNEMONIC = 'legal winner thank year wave sausage worth useful legal winner thank yellow'
const PASSPHRASE = 'TREZOR'

const attestation: BootAttestation = {
  rootHash: 'f'.repeat(64),
  specCount: 1,
  invariantCount: 1,
  tier: 'signer',
  version: 'test',
  checks: [],
}

let server: Server

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
  server = await startIpcServer({
    socketPath: SOCKET,
    handler: createHandler({ attestation, network: MAINNET }),
  })
})

afterAll(() => {
  server.close()
  rmSync(SOCKET, { force: true })
})

describe('daemon.ipc.socket', () => {
  // INV-NET-1
  it('holds-no-network-listener', () => {
    // The server is bound at this point, so this is asserting about a process
    // that IS listening, not one that never started.
    expect(() => {
      assertNoNetworkListeners()
    }).not.toThrow()

    const address = server.address()
    // A Unix socket's address is the path string. A TCP listener's is an object
    // with a port.
    expect(typeof address).toBe('string')
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

    const responses = await Promise.all([
      call('attestation.get'),
      call('network.get'),
      call('mnemonic.validate', { mnemonic: MNEMONIC }),
      call('wallet.fingerprint', { mnemonic: MNEMONIC, passphrase: PASSPHRASE }),
      call('wallet.xpub', { mnemonic: MNEMONIC, passphrase: PASSPHRASE, path: "m/84'/0'/0'" }),
      call('entropy.account', { rolls: '142536'.repeat(17) }),
      // Error paths too: an exception message is a serialisation route people forget.
      call('wallet.xpub', { mnemonic: MNEMONIC }),
      call('nope'),
    ])

    const serialized = JSON.stringify(responses)
    expect(serialized).not.toContain(seedHex)
    expect(serialized).not.toContain(entropyHex)
    expect(serialized).not.toContain(MNEMONIC)
    expect(serialized).not.toContain(PASSPHRASE)
    // No extended PRIVATE key either.
    expect(serialized).not.toContain('xprv')
  })

  // The signal that a passphrase was mistyped. There is no other one.
  it('fingerprint-changes-with-passphrase', async () => {
    const a = await call('wallet.fingerprint', { mnemonic: MNEMONIC })
    const b = await call('wallet.fingerprint', { mnemonic: MNEMONIC, passphrase: 'x' })
    const fa = (a.result as { fingerprint: string }).fingerprint
    const fb = (b.result as { fingerprint: string }).fingerprint
    expect(fa).not.toBe(fb)
    // Both succeeded. Neither errored. That is the hazard.
    expect(fa).toMatch(/^[0-9a-f]{8}$/)
    expect(fb).toMatch(/^[0-9a-f]{8}$/)
  })

  it('normalizes-path-notation-across-ipc', async () => {
    const a = await call('wallet.xpub', { mnemonic: MNEMONIC, path: 'm/84h/0h/0h' })
    const b = await call('wallet.xpub', { mnemonic: MNEMONIC, path: "m/84'/0'/0'" })
    expect((a.result as { xpub: string }).xpub).toBe((b.result as { xpub: string }).xpub)
    expect((a.result as { path: string }).path).toBe("m/84'/0'/0'")
  })

  it('reports-errors-without-swallowing-them', async () => {
    for (const [method, params] of [
      ['nope', undefined],
      ['network.set', { id: 'nope' }],
      ['wallet.xpub', { mnemonic: 'invalid', path: 'm/0' }],
      ['wallet.xpub', { mnemonic: MNEMONIC }],
    ] as const) {
      const response = await call(method, params)
      expect(response.error, `${method} should report an error`).toBeDefined()
      expect(response.result).toBeUndefined()
    }
  })
})
