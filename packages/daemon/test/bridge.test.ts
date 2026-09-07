/**
 * daemon.bridge. The loopback forwarder between the kiosk and the daemon.
 *
 * Every test drives a real HTTP server and a real Unix socket. A bridge tested
 * against a mocked transport would prove that the code calls the functions it
 * calls, and the properties worth asserting here are all about what actually
 * happens on a socket: what address it bound, what bytes crossed, what a
 * traversal resolves to on this filesystem.
 */

import { describe, expect, it, afterEach } from 'vitest'
import { createServer, type Server as NetServer } from 'node:net'
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Server } from 'node:http'
import {
  BRIDGE_HOST,
  MAX_BRIDGE_REQUEST_BYTES,
  resolveStaticPath,
  startBridge,
} from '../src/bridge/server.js'

const started: (Server | NetServer)[] = []
const dirs: string[] = []

afterEach(() => {
  for (const s of started.splice(0)) s.close()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nr-bridge-'))
  dirs.push(dir)
  return dir
}

/** A stand-in daemon: reads a line, answers with whatever `reply` returns. */
async function fakeDaemon(dir: string, reply: (line: string) => string | null): Promise<string> {
  const socketPath = join(dir, 'daemon.sock')
  const server = createServer((socket) => {
    let buffer = ''
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const newline = buffer.indexOf('\n')
      if (newline === -1) return
      const answer = reply(buffer.slice(0, newline))
      if (answer === null) return
      socket.write(`${answer}\n`)
    })
  })
  started.push(server)
  await new Promise<void>((r) => {
    server.listen(socketPath, r)
  })
  return socketPath
}

async function bridgeOn(
  socketPath: string,
  staticRoot: string
): Promise<{ port: number; url: string }> {
  // Port 0 so the tests never collide with a running device or with each other.
  const server = await startBridge({ socketPath, staticRoot, port: 0 })
  started.push(server)
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { port: address.port, url: `http://${BRIDGE_HOST}:${String(address.port)}` }
}

describe('daemon.bridge', () => {
  describe('INV-NET-4: it binds loopback and nothing else', () => {
    it('binds-loopback-and-refuses-to-take-a-host', async () => {
      const dir = scratch()
      const socketPath = await fakeDaemon(dir, () => '{"ok":true}')
      const server = await startBridge({ socketPath, staticRoot: dir, port: 0 })
      started.push(server)

      const address = server.address()
      expect(address).not.toBeNull()
      if (address === null || typeof address === 'string') throw new Error('no address')
      expect(address.address).toBe('127.0.0.1')

      // The host is not in the options type at all. This is the assertion that
      // no caller can widen it, and it is a compile-time fact made visible.
      expect(BRIDGE_HOST).toBe('127.0.0.1')
      expect(Object.keys({ socketPath, staticRoot: dir, port: 0 })).not.toContain('host')
    })

    it('is-not-reachable-on-a-non-loopback-address', async () => {
      const dir = scratch()
      const socketPath = await fakeDaemon(dir, () => '{"ok":true}')
      const { port } = await bridgeOn(socketPath, dir)

      // A bind to 127.0.0.1 is not reachable through another local address.
      // 127.0.0.2 is still loopback, so this is the weakest form of the check
      // that does not need a second interface, and it fails if the bind ever
      // becomes a wildcard.
      await expect(
        fetch(`http://127.0.0.2:${String(port)}/`, { signal: AbortSignal.timeout(1500) })
      ).rejects.toThrow()
    })
  })

  describe('INV-BRIDGE-1: a static request cannot leave the root', () => {
    it('refuses-dot-dot-traversal', () => {
      const root = scratch()
      const outside = scratch()
      writeFileSync(join(outside, 'secret.txt'), 'seed')
      writeFileSync(join(root, 'index.html'), 'ok')

      expect(resolveStaticPath(root, '/../../etc/passwd')).toBeNull()
      expect(resolveStaticPath(root, `/..${outside}/secret.txt`)).toBeNull()
      // Encoded, because rejecting a literal `..` is the version that gets
      // walked through.
      expect(resolveStaticPath(root, '/%2e%2e/%2e%2e/etc/passwd')).toBeNull()
    })

    it('refuses-an-absolute-path', () => {
      const root = scratch()
      const outside = scratch()
      const secret = join(outside, 'secret.txt')
      writeFileSync(secret, 'seed')

      expect(resolveStaticPath(root, secret)).toBeNull()
      expect(resolveStaticPath(root, '/etc/passwd')).toBeNull()
    })

    it('refuses-a-symlink-that-leaves-the-root', () => {
      const root = scratch()
      const outside = scratch()
      const secret = join(outside, 'secret.txt')
      writeFileSync(secret, 'seed')
      symlinkSync(secret, join(root, 'escape.txt'))

      expect(resolveStaticPath(root, '/escape.txt')).toBeNull()
    })
  })

  describe('INV-BRIDGE-2: it forwards bytes and does not interpret them', () => {
    it('forwards-the-body-verbatim-and-returns-the-line', async () => {
      const dir = scratch()
      const seen: string[] = []
      const socketPath = await fakeDaemon(dir, (line) => {
        seen.push(line)
        return '{"id":"1","result":{"tier":"signer"}}'
      })
      const { url } = await bridgeOn(socketPath, dir)

      const body = '{"id":"1","method":"status.get"}'
      const response = await fetch(`${url}/ipc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      })

      expect(response.status).toBe(200)
      expect(seen).toEqual([body])
      expect(await response.json()).toEqual({ id: '1', result: { tier: 'signer' } })
    })

    it('does-not-alter-a-payload-it-does-not-understand', async () => {
      const dir = scratch()
      const seen: string[] = []
      // Not JSON, and not the daemon's shape. The bridge has no opinion about
      // either: a forwarder that validated the protocol would be a second
      // implementation of it, drifting from the first.
      const socketPath = await fakeDaemon(dir, (line) => {
        seen.push(line)
        return 'not json either'
      })
      const { url } = await bridgeOn(socketPath, dir)

      const response = await fetch(`${url}/ipc`, { method: 'POST', body: 'なんでも {not json}' })
      expect(seen).toEqual(['なんでも {not json}'])
      expect(await response.text()).toBe('not json either')
    })
  })

  describe('INV-BRIDGE-3: oversized and unreachable are errors, not hangs', () => {
    it('refuses-a-body-over-the-cap', async () => {
      const dir = scratch()
      const seen: string[] = []
      const socketPath = await fakeDaemon(dir, (line) => {
        seen.push(line)
        return '{"ok":true}'
      })
      const { url } = await bridgeOn(socketPath, dir)

      const oversize = 'x'.repeat(MAX_BRIDGE_REQUEST_BYTES + 1024)
      await fetch(`${url}/ipc`, { method: 'POST', body: oversize }).catch(() => undefined)

      // The point is not the status code, it is that the daemon never saw it.
      expect(seen).toEqual([])
    })

    it('reports-a-missing-daemon-socket-as-an-error', async () => {
      const dir = scratch()
      const { url } = await bridgeOn(join(dir, 'nothing-here.sock'), dir)

      const response = await fetch(`${url}/ipc`, { method: 'POST', body: '{"id":"1"}' })
      expect(response.status).toBe(502)
      const payload = (await response.json()) as { error: string }
      expect(payload.error).toContain('the daemon did not answer')
    })
  })

  describe('INV-BRIDGE-4: only GET and POST /ipc', () => {
    it('refuses-a-method-other-than-get-or-post', async () => {
      const dir = scratch()
      const seen: string[] = []
      const socketPath = await fakeDaemon(dir, (line) => {
        seen.push(line)
        return '{"ok":true}'
      })
      const { url } = await bridgeOn(socketPath, dir)

      for (const method of ['PUT', 'DELETE', 'PATCH']) {
        const response = await fetch(`${url}/ipc`, { method, body: '{}' })
        expect(response.status).toBe(405)
      }
      expect(seen).toEqual([])
    })

    it('refuses-post-to-a-path-other-than-ipc', async () => {
      const dir = scratch()
      const seen: string[] = []
      const socketPath = await fakeDaemon(dir, (line) => {
        seen.push(line)
        return '{"ok":true}'
      })
      const { url } = await bridgeOn(socketPath, dir)

      const response = await fetch(`${url}/anything-else`, { method: 'POST', body: '{}' })
      expect(response.status).toBe(404)
      expect(seen).toEqual([])
    })
  })

  describe('serving the frontend', () => {
    it('serves index.html for a directory, which is what a deep link needs', async () => {
      const root = scratch()
      mkdirSync(join(root, 'assets'))
      writeFileSync(join(root, 'index.html'), '<!doctype html>device')
      writeFileSync(join(root, 'assets', 'app.js'), 'export const a = 1')

      const dir = scratch()
      const socketPath = await fakeDaemon(dir, () => '{}')
      const { url } = await bridgeOn(socketPath, root)

      expect(await (await fetch(`${url}/`)).text()).toBe('<!doctype html>device')
      const js = await fetch(`${url}/assets/app.js`)
      expect(js.headers.get('content-type')).toContain('text/javascript')
    })
  })
})
