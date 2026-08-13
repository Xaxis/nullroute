/**
 * The browser's side of the IPC transport.
 *
 * A same-origin POST to /ipc, which a loopback proxy forwards to the daemon's
 * Unix socket. Same-origin because the CSP is connect-src 'self': the page has
 * exactly one place it can talk to, and that place is on this machine.
 *
 * In development the proxy is Vite's. On the device it is a small local
 * forwarder started alongside the kiosk. Neither is reachable from off the
 * machine.
 */

import { type IpcTransport } from './client.js'

export function httpTransport(endpoint = '/ipc'): IpcTransport {
  let sequence = 0
  return {
    async send(method: string, params?: unknown): Promise<unknown> {
      sequence += 1
      const response = await globalThis.fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: String(sequence), method, params }),
      })
      if (!response.ok) {
        throw new Error(`The daemon proxy returned ${String(response.status)}.`)
      }
      return response.json()
    },
  }
}
