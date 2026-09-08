#!/usr/bin/env node
/**
 * An operation that takes seconds has to say so on the screen.
 *
 * THE BUG THIS EXISTS FOR, which shipped on four screens and was found by
 * reading rather than by any test. Every passphrase on this device goes through
 * Argon2id at 64 MiB and three passes. The excluded-controls note in
 * provisioning/profiles/os-signer.yaml measures that at 643ms on a machine
 * considerably faster than a Raspberry Pi, so the device spends several seconds
 * on it, and `reseal` spends twice that because it opens and then seals.
 *
 * All four screens showed a disabled button whose label changed to one word,
 * on panels with no other feedback. Several seconds of that is where somebody
 * decides the device has frozen and pulls the power, and two of the four are
 * mid-write when they do: writing a backup, and restoring one.
 *
 * Every test passed. There is nothing incorrect about the code, which is why
 * neither the unit tests nor the layout harness had anything to say: the
 * gallery's default handler REJECTS, so the busy state was never rendered at
 * all, and jsdom computes no box, so no assertion could see where the message
 * would have been. It is a defect of the screen rather than of the function.
 *
 * WHAT IT CHECKS, IN BOTH DIRECTIONS.
 *
 *   Every IPC method that reaches the envelope KDF is declared below, and the
 *   screen that calls it renders <Working>.
 *
 *   And nothing reaches the KDF that is NOT declared below. That half is the
 *   one that matters in a year: the list is maintained by hand, and a
 *   hand-maintained list of dangerous things is exactly the shape that goes
 *   quietly out of date. So the daemon is read for the answer rather than
 *   trusted to match. It is the same completeness rule as unit-executables,
 *   for the same reason: an omission looks exactly like a thing that is fine.
 *
 * WHAT IT CANNOT CATCH. Whether the message is VISIBLE. That is a layout
 * question, it is why the gallery has a `pending` helper and states using it,
 * and it took two wrong placements on PassphraseScreen to get right: under a
 * full keyboard it is below the fold, and above one on a body already scrolled
 * to the input it is off the top. This checks that the screen says something,
 * not that anybody can read it. check-screen-fit answers the second.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const STORE = join(ROOT, 'packages/daemon/src/store')
const METHODS = join(ROOT, 'packages/daemon/src/ipc/methods')
const SCREENS = join(ROOT, 'packages/ui/src/screens')

/**
 * The IPC methods that derive a key, and the screen a user waits on while they
 * do. Declared, and then checked against the daemon below.
 *
 * Two methods land on PassphraseScreen because unlocking an existing wallet and
 * sealing a new one are the same panel in two modes.
 */
const SLOW = [
  ['wallets.unlock', 'PassphraseScreen.tsx', 'opens the envelope'],
  ['wallets.create', 'PassphraseScreen.tsx', 'seals a new one'],
  // The single-wallet path this device shipped with, kept for a card made
  // before the registry existed. It lands on the same panel in the same mode.
  ['store.unlock', 'PassphraseScreen.tsx', 'opens the envelope on a pre-registry card'],
  ['backup.create', 'BackupScreen.tsx', 'seals the backup file'],
  ['backup.restore', 'BackupScreen.tsx', 'opens it'],
  ['multisig.register', 'MultisigScreen.tsx', 'reseals the store, so twice'],
  // FOUND BY THIS CHECK RATHER THAN BY READING, which is the point of it. The
  // hand audit that started this work found five methods and stopped, because
  // five was how many were obvious. `rename` and `changePassphrase` verify the
  // passphrase by OPENING the envelope and then seal a new one, so each of
  // these costs two derivations, the same as a reseal, on operations whose
  // names all promise something instant.
  ['multisig.labelCosigner', 'MultisigScreen.tsx', 'reseals to carry the name'],
  ['multisig.forget', 'FleetScreen.tsx', 'reseals without the quorum'],
  ['wallets.rename', 'ManageWalletScreen.tsx', 'reseals, so a colour costs two derivations'],
  ['wallets.passphrase', 'ManageWalletScreen.tsx', 'opens with the old and seals with the new'],
  // NO SCREEN, and that is the whole entry rather than an omission. Superseded
  // by wallets.create and refused outright once the device holds named wallets,
  // which is why check-ipc-reachable lists it as deliberately unreachable too.
  // Declared here so it is accounted for rather than silently missing.
  ['store.create', null, 'superseded by wallets.create and refused when a registry exists'],
]

let problems = 0
const fail = (message) => {
  problems += 1
  console.error(`    ${message}`)
}

/**
 * Store functions whose body reaches `seal` or `open` from envelope.ts.
 *
 * Derived by finding each call and walking back to the nearest definition above
 * it, which works because this codebase formats one method per block at a
 * consistent indent. A crude rule, deliberately: a precise one needs a parser,
 * and a rule nobody can read is a rule people delete.
 */
function kdfEntryPoints() {
  /** Every store function, with the text of its body. */
  const bodies = new Map()
  for (const file of readdirSync(STORE).filter((name) => name.endsWith('.ts'))) {
    const lines = readFileSync(join(STORE, file), 'utf8').split('\n')
    let current = null
    for (const line of lines) {
      const definition = /^export function (\w+)/.exec(line) ?? /^ {2}(?:#)?(\w+)\(/.exec(line)
      if (definition !== null) {
        current = definition[1]
        if (!bodies.has(current)) bodies.set(current, [])
        continue
      }
      if (current !== null && !/^\s*(\*|\/\/)/.test(line)) bodies.get(current).push(line)
    }
  }

  // Seed: the two envelope functions that actually derive a key. Their own
  // definitions are excluded, or each would match itself and report nothing.
  const found = new Set(['seal', 'open'])

  // TRANSITIVE, TO A FIXPOINT, and that is a correction. The first version
  // walked one hop and missed `reseal`, which is the SLOWEST path on the
  // device: it calls #writeSealed, which calls seal. One hop found
  // #writeSealed and stopped, so multisig.register looked like it derived no
  // key at all and the check reported the screen that needed the message most
  // as having nothing to declare.
  let grew = true
  while (grew) {
    grew = false
    for (const [name, body] of bodies) {
      if (found.has(name)) continue
      const calls = [...found].some((target) =>
        body.some((line) => new RegExp(`[^\\w]${target}\\(`).test(line))
      )
      if (calls) {
        found.add(name)
        grew = true
      }
    }
  }

  found.delete('seal')
  found.delete('open')
  return found
}

/** Which IPC method keys in a handler file mention any of those names. */
function methodsReaching(names) {
  const reaching = new Map()
  for (const file of readdirSync(METHODS).filter((name) => name.endsWith('.ts'))) {
    const text = readFileSync(join(METHODS, file), 'utf8')
    // Split on the method keys themselves, so each chunk is one handler.
    const parts = text.split(/^\s{4}'([\w.]+)':/m)
    for (let index = 1; index < parts.length; index += 2) {
      const method = parts[index]
      const body = parts[index + 1] ?? ''
      for (const name of names) {
        // `.name(` or `name(`, and never inside a comment line.
        const used = body
          .split('\n')
          .filter((line) => !/^\s*(\*|\/\/)/.test(line))
          .some((line) => new RegExp(`[^\\w]${name}\\(`).test(line))
        if (used) {
          if (!reaching.has(method)) reaching.set(method, new Set())
          reaching.get(method).add(name)
        }
      }
    }
  }
  return reaching
}

const entryPoints = kdfEntryPoints()
if (entryPoints.size === 0) {
  console.error('check-slow-feedback: found no store function reaching the KDF at all.')
  console.error('  That is not plausible, so this check has stopped recognising the')
  console.error('  code rather than found it clean. Fix the rule, do not delete it.')
  process.exit(1)
}

const reaching = methodsReaching(entryPoints)
const declared = new Set(SLOW.map(([method]) => method))

// DIRECTION ONE. Nothing derives a key without being declared here.
for (const [method, names] of reaching) {
  if (!declared.has(method)) {
    fail(
      `${method} reaches the key derivation (via ${[...names].join(', ')}) and is not ` +
        'declared in check-slow-feedback.mjs, so nothing checks that the screen ' +
        'calling it tells the user why the device has stopped responding.'
    )
  }
}

// DIRECTION TWO. Everything declared still does, so the list does not rot into
// a set of screens carrying an explanation for work they no longer do.
for (const [method] of SLOW) {
  if (!reaching.has(method)) {
    fail(
      `${method} is declared here as deriving a key and no longer appears to. ` +
        'Either the daemon changed or this rule stopped recognising it.'
    )
  }
}

// DIRECTION THREE. The screen actually says something. A null screen is a
// method nothing on the panel can reach, declared with its reason.
for (const [method, screen, why] of SLOW) {
  if (screen === null) continue
  const text = readFileSync(join(SCREENS, screen), 'utf8')
  if (!text.includes('<Working')) {
    fail(
      `${screen} calls ${method}, which ${why}, and renders no <Working>. ` +
        'A disabled button reading one word is not feedback on a panel that ' +
        'has no other.'
    )
  }
}

if (problems > 0) {
  console.error(`\ncheck-slow-feedback: ${String(problems)} problem(s)`)
  process.exit(1)
}

const screens = new Set(SLOW.map(([, screen]) => screen).filter((name) => name !== null))
console.log(
  `check-slow-feedback: ${String(entryPoints.size)} store function(s) reach the KDF, ` +
    `${String(reaching.size)} IPC method(s) call them, all declared, and each of the ` +
    `${String(screens.size)} screen(s) waiting on one explains the wait`
)
