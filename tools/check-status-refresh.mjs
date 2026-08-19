#!/usr/bin/env node
/**
 * A call that changes the device's state has to refresh the copy of it.
 *
 * THE BUG THIS EXISTS FOR, which shipped and was found by reading rather than
 * by any test. `wallets.unlock` set the active wallet and never called
 * `refresh()`, so `status.hasWallet` stayed false for the whole session. Three
 * things read it, and all three were wrong in ways nobody would report:
 *
 *   The idle lock never armed. The feature that closes the wallet when nobody
 *   is at the device, with its own spec and its own invariants, did not run.
 *
 *   A journey begun after unlocking prepended "Open a wallet" to a flow whose
 *   wallet was already open.
 *
 *   The lock screen routed a device with a loaded wallet back to the picker.
 *
 * Every test passed. The daemon was right the whole time: `device.status`
 * reported `hasWallet: true` to anybody who asked, and the frontend never
 * asked again.
 *
 * WHAT IT CHECKS. Every IPC method named below changes what `device.status`
 * would return. The call site for each has to have `refresh()` within a short
 * window after it, in the same function. That is a crude proximity rule and it
 * is deliberately crude: a precise one would need to understand control flow,
 * and a rule nobody can read is a rule people delete.
 *
 * WHAT IT CANNOT CATCH. A refresh whose result is thrown away, a refresh
 * before the call rather than after, or a fourth thing that reads stale status
 * for a reason none of this models. It catches the shape of the bug that
 * happened, which is the shape most likely to happen again.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const APP = join(ROOT, 'packages/ui/src/App.tsx')

/**
 * Methods after which `device.status` is no longer what the frontend holds.
 *
 * Listed rather than inferred. Inferring it would mean deciding from a method
 * name whether it mutates, and the one that caused this bug is named "unlock",
 * which sounds like it changes nothing on a device that was already on.
 */
const CHANGES_STATUS = [
  ['wallets.unlock', 'a wallet is now loaded, so hasWallet, fingerprint and network all moved'],
  ['wallets.create', 'a new wallet is loaded and sealed'],
  ['session.lock', 'the seed is gone and the network is back to mainnet'],
  ['wallet.import', 'a seed is loaded from a mnemonic'],
]

/**
 * How many CODE lines after the call a refresh still counts as being for it.
 *
 * Comments and blank lines do not count, which is not a nicety. The first
 * version of this counted raw lines and reported the unlock path as unfixed
 * while looking straight at its refresh, because the comment explaining the
 * bug was longer than the window. A rule that fires on its own documentation
 * is a rule people work around by writing less of it.
 */
const WINDOW = 14

const source = readFileSync(APP, 'utf8')
const lines = source.split('\n')

const problems = []
let checked = 0

for (const [method, why] of CHANGES_STATUS) {
  // Every call site, by the quoted method name as it appears in a call().
  const sites = []
  lines.forEach((line, index) => {
    if (line.includes(`'${method}'`)) sites.push(index)
  })

  if (sites.length === 0) {
    problems.push(
      `${method} is listed here as changing device.status and App.tsx does not call it. ` +
        `Either it was renamed, or this list is stale, and a stale list is a check that ` +
        `passes because it looks at nothing.`
    )
    continue
  }

  for (const at of sites) {
    checked += 1
    const window = lines
      .slice(at)
      .filter((line) => {
        const text = line.trim()
        return text.length > 0 && !text.startsWith('//') && !text.startsWith('*')
      })
      .slice(0, WINDOW)
      .join('\n')
    // `refresh()` exactly. Not `refreshSomething()`.
    if (!/\brefresh\(\)/.test(window)) {
      problems.push(
        `${APP.replace(ROOT, '')}:${String(at + 1)}: ${method} has no refresh() within ` +
          `${String(WINDOW)} lines. ${why}, and the frontend would keep showing the old answer.`
      )
    }
  }
}

if (problems.length > 0) {
  console.error('check-status-refresh: a call changed the device and nothing re-read it.\n')
  for (const problem of problems) console.error(`  ${problem}`)
  console.error('')
  console.error('  This exact bug shipped once. wallets.unlock did not refresh, so')
  console.error('  status.hasWallet stayed false all session: the idle lock never armed,')
  console.error('  journeys prepended a step that was already done, and the lock screen')
  console.error('  routed a loaded device back to the picker. Every test passed.')
  process.exit(1)
}

console.log(
  `check-status-refresh: ${String(checked)} call site(s) for ` +
    `${String(CHANGES_STATUS.length)} state-changing methods, each followed by a refresh`
)
