#!/usr/bin/env node
/**
 * A field somebody has to fill needs something on the panel to fill it with.
 *
 * THE BUG THIS EXISTS FOR, which shipped on four screens. docs/USING.md opens
 * by saying this is a fixed 800x480 touchscreen with no cursor and no keyboard.
 * No virtual keyboard is installed in the image and cage provides none, so an
 * <input> with no on-screen TextKeyboard bound to it cannot be filled on the
 * hardware at all.
 *
 * It can be filled perfectly under `make dev`, in a browser, on a workstation
 * with a real keyboard, which is the only place any of them had ever been used.
 * That is the whole shape of it: every test passed, jsdom types into anything,
 * and the screens looked complete.
 *
 * The worst was WalletScreen's verify tab. Checking whether an address belongs
 * to this wallet is how somebody catches a receive address swapped between the
 * device and the machine they pasted it into, and the question could not be
 * asked. Naming the device and forgetting a quorum were the other two.
 *
 * HOW A FIELD COUNTS AS FILLABLE. A keyboard in the same screen whose bound
 * expression MENTIONS the field's state variable. Mentions, not equals, because
 * one keyboard serving several fields binds a conditional:
 *
 *   value={field === 'confirm' ? confirm : value}
 *
 * and both of those fields are reachable through it. That is a deliberately
 * loose rule. It cannot tell which PANEL a field is on, so a keyboard on one
 * panel makes a same-named field on another look reachable, and
 * manage-passphrase-old is exactly that case: it shares the name `passphrase`
 * with the rename panel's keyboard and is listed as unreachable below anyway,
 * because a human looked.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const SCREENS = join(ROOT, 'packages/ui/src/screens')

/**
 * Fields filled by pointing the camera at a code, not by typing.
 *
 * Each is a long machine-generated string, which is the reason the camera
 * exists: a 200 character descriptor tapped out by hand is not a feature.
 */
const BY_CAMERA = new Map([
  ['backup-input', 'a backup file, scanned or shown as a code'],
  ['labels-input', 'a BIP-329 label file, scanned'],
  ['multisig-input', 'a descriptor or coordinator file, scanned or imported'],
  ['psbt-input', 'a transaction to review, scanned'],
])

/** Fields with their own kind of keyboard rather than the text one. */
const BY_WORDS = new Map([
  ['import-mnemonic', 'the word keyboard fills the mnemonic; this box is the paste route'],
])

/**
 * FIELDS WITH NO KEYBOARD YET, WITH THE MEASUREMENT THAT SAYS WHY NOT.
 *
 * Empty, and it was not. Five fields sat here: the three that change a
 * passphrase, the one that renames a wallet, and the one that confirms an
 * erase. Every one of them was a defect listed rather than hidden, and the
 * first attempt at fixing them was refused by check-screen-fit with numbers.
 *
 * THE NUMBER THAT MADE IT POSSIBLE. The body of a screen on this panel is
 * 287px. The keyboard is 188 of it and the gap above it another 14, so
 * everything else on a screen that can be typed on adds up to 70px: one row of
 * labelled fields, and no second row at any height. Three stacked fields are
 * 204 and there was no arrangement of them that left room for the keys.
 *
 * So the rows went sideways, the explanations went below the keys, and on the
 * erase panel the keyboard's own readout became the field, because a labelled
 * input showing the same string twice costs 82px of the 70 there are.
 *
 * The list stays because the rule is that it cannot GROW without this failing.
 * An entry here needs the measurement that says why not yet, and a layout whose
 * bottom rows of keys sit under the action bar is not one.
 */
const UNREACHABLE = new Map()

let problems = 0
const fail = (message) => {
  problems += 1
  console.error(`    ${message}`)
}

const found = new Set()
/** Fields a keyboard on their own screen is bound to. */
const byKeyboard = new Set()
let fields = 0

for (const file of readdirSync(SCREENS).filter((name) => name.endsWith('.tsx'))) {
  const text = readFileSync(join(SCREENS, file), 'utf8')
  const bindings = [
    ...text.matchAll(/<(?:Text|Word)Keyboard\b[\s\S]{0,400}?(?:value|words)=\{([\s\S]*?)\}\s*\n/g),
  ].map((match) => match[1])

  for (const match of text.matchAll(/<(input|textarea)\b([\s\S]{0,700}?)data-testid="([^"]+)"/g)) {
    const attrs = match[2]
    const id = match[3]
    // A readout is not a field somebody fills.
    if (/readOnly/.test(attrs)) continue
    const type = /type="(\w+)"/.exec(attrs)?.[1] ?? 'text'
    if (type === 'checkbox' || type === 'radio') continue
    const value = /value=\{(\w+)\}/.exec(attrs)?.[1]
    if (value === undefined) continue

    fields += 1
    found.add(id)

    if (UNREACHABLE.has(id)) continue
    if (BY_CAMERA.has(id) || BY_WORDS.has(id)) continue

    const bound = bindings.some((expression) => new RegExp(`\\b${value}\\b`).test(expression))
    if (bound) byKeyboard.add(id)
    if (!bound) {
      fail(
        `${file} has ${id}, which somebody has to fill, and no keyboard on the ` +
          `screen is bound to ${value}. On a panel with no cursor and no keyboard ` +
          'that field cannot be filled at all. Bind a TextKeyboard to it, give it a ' +
          'camera route, or add it to UNREACHABLE here with the measurement that ' +
          'says why not yet.'
      )
    }
  }
}

// The lists must not rot. A testid that has been renamed or a field that has
// since been given a keyboard leaves an entry here asserting something false,
// and a stale exemption is how a defect list becomes a place things go to be
// forgotten.
for (const [name, why] of [...UNREACHABLE, ...BY_CAMERA, ...BY_WORDS]) {
  if (!found.has(name)) {
    fail(`${name} is listed here (${why}) and no screen has a writable field with that testid.`)
  }
}

/**
 * A field the keyboard fills is REACHED through the keyboard.
 *
 * THE SECOND HALF OF THE SAME BUG. The screen gallery reaches a state by tapping
 * testids, and one of its steps is `type:<testid>:<text>`, which finds the input
 * and sets its value through the React setter. That is what a workstation with a
 * real keyboard does, and it is how five unfillable fields were measured,
 * screenshotted and contrast-checked for months while reading as reachable.
 *
 * Fixing the fields is not enough on its own: nothing stopped the next reach
 * list from going back to the easy route, and a harness that types the way the
 * hardware cannot is a harness that certifies screens nobody can use.
 *
 * So `type:` is now reserved for the fields that are genuinely filled some other
 * way: the camera ones, and the mnemonic box that exists to be pasted into. Use
 * `keys:<text>` for anything else, which taps the keys and fails when the string
 * cannot be produced on the keyboard this device actually has.
 */
const GALLERY = join(ROOT, 'tools/screens/gallery.tsx')
let reached = 0
for (const match of readFileSync(GALLERY, 'utf8').matchAll(/'type:([^:']+):/g)) {
  const id = match[1]
  reached += 1
  if (BY_CAMERA.has(id) || BY_WORDS.has(id)) continue
  if (!byKeyboard.has(id)) continue
  fail(
    `the gallery reaches ${id} with a "type:" step, and that field is filled by ` +
      'an on-screen keyboard on the device. Setting its value directly is a route ' +
      'the hardware does not have, so every guard that measures the state after it ' +
      'is measuring something nobody can reach. Use "keys:" instead, which taps the ' +
      'keys.'
  )
}

if (problems > 0) {
  console.error(`\ncheck-typeable: ${String(problems)} problem(s)`)
  process.exit(1)
}

console.log(
  `check-typeable: ${String(fields)} writable field(s), ` +
    `${String(BY_CAMERA.size)} filled by camera, ${String(BY_WORDS.size)} by the word keyboard, ` +
    `${String(UNREACHABLE.size)} still unreachable and listed, ${String(byKeyboard.size)} bound to ` +
    `a keyboard, and ${String(reached)} gallery "type:" step(s), none of them on a field a ` +
    `keyboard fills`
)
