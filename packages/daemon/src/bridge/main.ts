/**
 * The bridge, as a process.
 *
 * Separate from the daemon's own entry point on purpose, and run as a separate
 * user. Everything the browser may see passes through here and no key material
 * does, so this is exactly as trusted as the frontend: a process that parses
 * HTTP on a browser's behalf must not share a uid with the one holding a seed.
 *
 * Configuration comes from the environment because the unit is what decides
 * where things live on a device, and there is nothing here worth a config file.
 */

import { startBridge, BRIDGE_HOST, BRIDGE_PORT } from './server.js'

const socketPath = process.env['NULLROUTE_SOCKET'] ?? '/run/nullroute/nullrouted.sock'
const staticRoot = process.env['NULLROUTE_UI'] ?? '/usr/lib/nullroute/ui'
const port = Number(process.env['NULLROUTE_UI_PORT'] ?? String(BRIDGE_PORT))

startBridge({
  socketPath,
  staticRoot,
  port,
  // Reported, never swallowed. A bridge that hid a socket error would leave the
  // frontend rendering a lock screen with no attestation behind it, which is
  // the one thing a user came to the device to check.
  onError: (error) => {
    process.stderr.write(`nullroute-bridge: ${error.message}\n`)
  },
}).then(
  () => {
    process.stdout.write(
      `nullroute-bridge\n` +
        `  serving        ${staticRoot}\n` +
        `  listening      http://${BRIDGE_HOST}:${String(port)}\n` +
        `  forwarding to  ${socketPath}\n`
    )
  },
  (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`nullroute-bridge: could not start: ${message}\n`)
    process.exit(1)
  }
)
