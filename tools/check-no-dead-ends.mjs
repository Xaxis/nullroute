#!/usr/bin/env node
/**
 * No screen is a dead end.
 *
 * The device has no browser back button, no window to close, no gesture and no
 * keyboard. If a screen renders no control that leaves it, the only way out is
 * a power cycle, and on a screen holding an unsaved seed that is not a
 * recoverable mistake.
 *
 * This has happened. `SetupScreen` shipped with one control, "Roll the dice".
 * Tapping "add a wallet" from the picker and changing your mind left you on it
 * permanently. Nothing caught it: the screen tests exercised the path forward,
 * the layout check confirmed the one button fitted, and the shell tests walked
 * through rather than turning around.
 *
 * WHAT COUNTS AS A WAY OUT. A prop whose name says it leaves: `onBack`,
 * `onCancel`, `onHome`, `onDone`, `onContinue`, `onSkip`, `onLock`. Matched by
 * name because that is the convention this codebase already follows, and a
 * convention a tool enforces is a convention.
 *
 * THE EXEMPTIONS ARE NAMED AND ARGUED. Two screens deliberately offer no ESCAPE,
 * only the action that says what it costs, and each is listed below with the
 * reason. The list cannot rot: an exemption for a screen that no longer exists
 * fails, and so does one for a screen that has since gained an exit. It caught
 * its own author on the second of those the first time it ran.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCREENS = join(ROOT, 'packages/ui/src/screens')

/**
 * Props whose name means "this leaves the screen".
 *
 * `nav` is here and is the strongest of them. The others go one place, usually
 * back; a navigation rail goes everywhere, is always visible, and holds still
 * while the body scrolls. A screen that has one cannot trap anybody.
 *
 * It is deliberately not a substitute in the list below: a screen in the middle
 * of a flow is passed no rail, on purpose, and still needs its own way out.
 */
const EXITS = ['onBack', 'onCancel', 'onHome', 'onDone', 'onContinue', 'onSkip', 'onLock', 'nav']

/**
 * Screens with no way out, and why that is right.
 *
 * Not a list of things to fix. Each of these is a gate whose only exit is the
 * action that states its consequence, because an escape hatch beside it would
 * be the easier tap.
 */
const NO_WAY_OUT = new Map([
  [
    'SeedScreen.tsx',
    'the words are shown once. Leaving loses them, so the only exit is confirming they are written down.',
  ],
])

const files = readdirSync(SCREENS).filter((name) => name.endsWith('.tsx'))
if (files.length === 0) {
  console.error('check-no-dead-ends: no screens found, so this check is blind.')
  process.exit(1)
}

const failures = []

for (const file of files) {
  const source = readFileSync(join(SCREENS, file), 'utf8')
  // The props interface, not the whole file: a screen that merely mentions
  // `onCancel` while passing it to a child is not itself escapable.
  const props = /export interface \w+Props \{([\s\S]*?)\n\}/.exec(source)?.[1] ?? ''
  const exits = EXITS.filter((name) => new RegExp(`readonly ${name}\\??:`).test(props))

  if (NO_WAY_OUT.has(file)) {
    if (exits.length > 0) {
      failures.push(
        `  ${file} is listed as having no way out and now offers ${exits.join(', ')}. ` +
          `Remove the exemption.`
      )
    }
    continue
  }

  if (exits.length === 0) {
    failures.push(`  ${file} renders no way out. On this device that means a power cycle.`)
  }
}

for (const file of NO_WAY_OUT.keys()) {
  if (!files.includes(file)) {
    failures.push(`  ${file} is exempted and no longer exists. Remove the exemption.`)
  }
}

if (failures.length > 0) {
  console.error('check-no-dead-ends: a screen with no way out is a power cycle.\n')
  for (const failure of failures) console.error(failure)
  console.error(
    '\n  The device has no back button, no window to close, no gesture and no\n' +
      '  keyboard. Give the screen one of: ' +
      `${EXITS.join(', ')}.\n` +
      '  If it genuinely should trap the user, add it to NO_WAY_OUT with the reason.\n'
  )
  process.exit(1)
}

console.log(
  `check-no-dead-ends: ${String(files.length)} screens, ` +
    `${String(files.length - NO_WAY_OUT.size)} with a way out and ` +
    `${String(NO_WAY_OUT.size)} deliberately without one`
)
