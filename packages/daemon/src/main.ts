#!/usr/bin/env node
/**
 * The daemon entry point.
 *
 * Order matters and is not an implementation detail:
 *
 *   1. Verify the build (INV-BUILD-1). Nothing else happens first, because
 *      everything after this point is only meaningful if the code is the code
 *      that was verified.
 *   2. Bind the Unix socket and assert no network listener exists.
 *   3. Serve.
 *
 * Run under `node --jitless` in production. MemoryDenyWriteExecute in the
 * systemd unit crashes V8's baseline compiler otherwise. See
 * docs/PROVISIONING.md.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { MAINNET } from '@nullroute/core'
import { requirePassingVerification, abbreviateHash } from './boot/attestation.js'
import { startIpcServer } from './ipc/socket.js'
import { createHandler } from './handler.js'

const REPO_ROOT = process.env['NULLROUTE_ROOT'] ?? fileURLToPath(new URL('../../..', import.meta.url))
const SOCKET_PATH = process.env['NULLROUTE_SOCKET'] ?? '/run/nullroute/nullrouted.sock'

function version(): string {
  try {
    return readFileSync(join(REPO_ROOT, 'VERSION'), 'utf8').trim()
  } catch {
    return 'unknown'
  }
}

async function main(): Promise<void> {
  // INV-BUILD-1. Throws, and the throw is not caught: a daemon that starts
  // after failing verification is the failure this whole project exists to
  // rule out.
  const attestation = requirePassingVerification(REPO_ROOT, version())

  const state = { attestation, network: MAINNET }
  const server = await startIpcServer({
    socketPath: SOCKET_PATH,
    handler: createHandler(state),
    onError: (error) => {
      // Reported, never swallowed.
      console.error(`nullrouted: ${error.name}: ${error.message}`)
    },
  })

  console.log(
    `nullrouted ${attestation.version}\n` +
      `  manifest root  ${abbreviateHash(attestation.rootHash)}\n` +
      `  tier           ${attestation.tier}\n` +
      `  specs          ${String(attestation.specCount)}, ${String(attestation.invariantCount)} invariants\n` +
      `  listening      ${SOCKET_PATH}`
  )

  const shutdown = (): void => {
    server.close(() => {
      process.exit(0)
    })
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err: unknown) => {
  console.error(`nullrouted: refusing to start\n\n${(err as Error).message}`)
  process.exit(1)
})
