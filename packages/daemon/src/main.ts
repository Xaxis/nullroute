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
 * NOT run under `node --jitless`, and that is a measured decision rather than
 * an oversight. MemoryDenyWriteExecute would require it, and that directive is
 * absent because it crashes V8's baseline compiler. Meanwhile the wallet store
 * stretches a passphrase with Argon2id in pure JavaScript, which an interpreter
 * with no JIT runs about fifty times slower: 643 ms against 34.4 seconds at the
 * shipped parameters, on hardware faster than a Pi. Turning the JIT off would
 * make unlocking take minutes. See docs/PROVISIONING.md.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { requirePassingVerification, abbreviateHash } from './boot/attestation.js'
import { startIpcServer } from './ipc/socket.js'
import { createHandler } from './handler.js'
import { Session } from './session.js'
import { WalletStore } from './store/store.js'

const REPO_ROOT = process.env['NULLROUTE_ROOT'] ?? fileURLToPath(new URL('../../..', import.meta.url))
const SOCKET_PATH = process.env['NULLROUTE_SOCKET'] ?? '/run/nullroute/nullrouted.sock'

/**
 * Where the sealed wallet lives.
 *
 * On the device this is the LUKS2 partition, which is a separate volume from
 * the read-only system partition on purpose: the system partition is what
 * dm-verity covers and what the manifest hashes, and a wallet written into it
 * would change that hash on every use. Locally it defaults under the repo so a
 * developer can see, delete and inspect the file.
 *
 * This is one of the few environment variables the daemon reads, and it names a
 * location rather than changing any behaviour. Nothing security relevant is
 * configurable here: the parameters that matter are written into each sealed
 * file, not taken from the environment.
 */
const STORE_DIR = process.env['NULLROUTE_STORE'] ?? join(REPO_ROOT, '.nullroute-store')

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

  const store = new WalletStore(STORE_DIR)
  const state = { attestation, session: new Session(), store }
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
