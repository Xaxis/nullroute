#!/usr/bin/env node
/**
 * Every IPC method the daemon implements has to be reachable from the UI.
 *
 * THIS HAS HAPPENED TWICE. The multi-wallet picker shipped with nothing
 * navigating to it, so wallets.list, wallets.unlock and the legacy-store
 * migration never ran on a real device. Then message signing, BIP-85 and label
 * import shipped the same way: implemented, specced, tested through the daemon,
 * and unreachable by anybody holding the hardware.
 *
 * Both times every test passed, because every test called the daemon directly.
 * A feature nobody can reach is not a shipped feature, and the only way that
 * gets caught reliably is by checking it.
 *
 * A method may be deliberately unreachable. It just has to say so here, with a
 * reason, so the decision is visible in a diff rather than inferred from an
 * absence.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const METHODS = join(ROOT, 'packages/daemon/src/ipc/methods')
const UI_SRC = join(ROOT, 'packages/ui/src')

/**
 * Methods with no UI caller, and why.
 *
 * Each entry is a decision somebody made on purpose. "Not built yet" is not a
 * valid reason to be in here: an unimplemented method should not exist.
 */
const DELIBERATELY_UNREACHABLE = new Map([
  [
    'network.get',
    'device.status carries the network on every poll, so a separate call would be a second ' +
      'source for one fact.',
  ],
  ['wallet.fingerprint', 'Same: device.status and wallets.unlock both carry it.'],
  [
    'store.create',
    'The single-wallet path, refused outright once the device holds named wallets.',
  ],
  ['store.unlock', 'Same: superseded by wallets.unlock, and refused when a registry exists.'],
  ['store.destroy', 'Same: superseded by wallets.destroy.'],
  [
    'mnemonic.validate',
    'Validation happens inside wallet.import, which refuses an invalid mnemonic itself. The ' +
      'standalone method exists for a coordinator or a test, not for a screen.',
  ],
  [
    'descriptor.parse',
    'A building block for multisig.review, which is what a screen calls. Exposed so a third ' +
      'party can check a descriptor against this device without registering it.',
  ],
])

/**
 * Implemented, specced, tested, and with no screen yet.
 *
 * NOT the same as the list above, and the difference is the point. Those are
 * decisions. These are debt: whole features a user cannot reach, recorded here
 * because the alternative was calling them deliberate, which would be the exact
 * dishonesty this project keeps having to fix.
 *
 * The count is capped below and the cap only moves down. A new unreachable
 * method fails this check outright; clearing one of these means deleting the
 * line, which makes the cap fall with it.
 */
const NOT_YET_ON_A_SCREEN = new Map([
])

/**
 * The debt ceiling. Only ever lower this.
 *
 * A number in a file is a weak commitment, which is why it is asserted rather
 * than written in a comment: adding a fourteenth unreachable feature fails the
 * build, and clearing one without lowering the cap fails it too.
 */
const MAX_NOT_YET_ON_A_SCREEN = 0

/*
 * Read from the thirteen method tables rather than from one switch.
 *
 * This used to match `case '<method>':` in handler.ts, which was the whole IPC
 * surface in a single 62-label switch. The tables replaced it. Note the guard
 * below: a parse that suddenly matches nothing has to be a failure here, since
 * "no methods found" and "every method is reachable" are the same green line.
 */
const handler = readdirSync(METHODS)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => readFileSync(join(METHODS, name), 'utf8'))
  .join('\n')

// Namespaced names only. A table also switches on plain strings inside a
// method (the BIP-85 application, for one), and those are not IPC methods.
const methods = [...handler.matchAll(/^\s*'([a-z][\w]*\.[\w.]+)':\s*(?:async\s*)?\(/gm)]
  .map((match) => match[1])
  .filter((name) => name !== undefined)

if (methods.length === 0) {
  console.error('check-ipc-reachable: found no IPC methods, so this check is blind.')
  process.exit(1)
}

/** Every UI source file, so a method referenced anywhere counts as reachable. */
function sources(directory, found = []) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) sources(path, found)
    else if (/\.tsx?$/.test(entry)) found.push(readFileSync(path, 'utf8'))
  }
  return found
}

const ui = sources(UI_SRC).join('\n')

const unreachable = []
for (const method of new Set(methods)) {
  if (ui.includes(`'${method}'`) || ui.includes(`"${method}"`)) continue
  if (DELIBERATELY_UNREACHABLE.has(method)) continue
  if (NOT_YET_ON_A_SCREEN.has(method)) continue
  unreachable.push(method)
}

// An allowlist entry for a method that no longer exists is a stale excuse, and
// a stale excuse is how the next unreachable method gets waved through.
const stale = [...DELIBERATELY_UNREACHABLE.keys(), ...NOT_YET_ON_A_SCREEN.keys()].filter(
  (method) => !methods.includes(method)
)

// An entry that has since been wired up has to be removed, or the cap stops
// meaning anything.
const wiredUp = [...NOT_YET_ON_A_SCREEN.keys()].filter(
  (method) => ui.includes(`'${method}'`) || ui.includes(`"${method}"`)
)

if (NOT_YET_ON_A_SCREEN.size > MAX_NOT_YET_ON_A_SCREEN) {
  console.error(
    `check-ipc-reachable: ${String(NOT_YET_ON_A_SCREEN.size)} methods have no screen and the ` +
      `cap is ${String(MAX_NOT_YET_ON_A_SCREEN)}. That number only goes down.`
  )
  process.exit(1)
}

if (unreachable.length > 0 || stale.length > 0 || wiredUp.length > 0) {
  console.error('check-ipc-reachable: the daemon implements things nobody can reach.\n')
  for (const method of unreachable) {
    console.error(`  ${method} has no caller anywhere in packages/ui/src`)
  }
  for (const method of stale) {
    console.error(`  ${method} is listed as unreachable but no longer exists`)
  }
  for (const method of wiredUp) {
    console.error(
      `  ${method} now has a caller. Remove it from NOT_YET_ON_A_SCREEN and lower the cap.`
    )
  }
  console.error(
    '\n  A feature nobody can reach is not a shipped feature. Wire it to a screen, or\n' +
      '  add it to DELIBERATELY_UNREACHABLE with the reason.'
  )
  process.exit(1)
}

console.log(
  `check-ipc-reachable: ${String(new Set(methods).size)} IPC methods, ` +
    `${String(DELIBERATELY_UNREACHABLE.size)} deliberately not on a screen, ` +
    `${String(NOT_YET_ON_A_SCREEN.size)} with no screen yet (cap ${String(MAX_NOT_YET_ON_A_SCREEN)}), ` +
    `rest reachable`
)
