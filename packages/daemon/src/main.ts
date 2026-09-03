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
import { IdleClock, IDLE_LOCK_SECONDS } from './idle.js'
import { Session } from './session.js'
import { WalletStore } from './store/store.js'
import { DeviceIdentityStore } from './store/identity.js'
import { WalletRegistry } from './store/registry.js'

const REPO_ROOT =
  process.env['NULLROUTE_ROOT'] ?? fileURLToPath(new URL('../../..', import.meta.url))
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
  // Both, deliberately. The registry owns the several-wallet directories; the
  // single store is still the legacy location the registry migrates out of, and
  // the old store.* methods keep working against it until nothing calls them.
  const registry = new WalletRegistry(STORE_DIR)
  // Beside the wallets, not inside one. Three devices in a quorum hold the same
  // wallet and therefore show the same name, so the device needs one of its own.
  const identity = new DeviceIdentityStore(STORE_DIR)
  // Closes the wallet when nobody is at the device. Only a touch resets it:
  // see packages/daemon/src/idle.ts for why every other request must not.
  const idle = new IdleClock()
  const session = new Session()
  const state = { attestation, session, store, registry, identity, idle }

  // A sweep as well as the check on each request, because a frontend that has
  // crashed sends no requests at all and the seed must not outlive it. Ten
  // seconds is far below the window, so the lock is never late by anything a
  // person would notice, and the work is one subtraction.
  const sweep = setInterval(() => {
    if (idle.expired() && session.hasWallet) {
      session.lock()
      console.log(
        `nullrouted: locked after ${String(IDLE_LOCK_SECONDS)}s with nobody at the device`
      )
    }
  }, 10_000)
  // Never a reason to hold the process open. A device with no wallet loaded has
  // nothing for this timer to do, and it must not be what keeps the daemon up.
  sweep.unref()

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
    clearInterval(sweep)
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
