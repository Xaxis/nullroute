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
 * KNOWN UNREACHABLE, WITH THE MEASUREMENT THAT SAYS WHY NOT YET.
 *
 * These are defects, listed rather than hidden, and the list is not permission.
 * The fix was written and check-screen-fit refused it with numbers: the keyboard
 * is 144px tall and has to start by 263px for its bottom row to clear the action
 * bar, and these panels start it where each entry says. Every one needs content
 * cut above the keyboard, which is a redesign per panel rather than a nudge, and
 * a layout whose bottom rows of keys sit under the action bar is not better than
 * one that is honestly missing.
 *
 * The point of listing them is that the set cannot GROW without this failing.
 */
const UNREACHABLE = new Map([
  ['manage-passphrase-old', 'ManageWalletScreen passphrase panel, keyboard would start at 414'],
  ['manage-passphrase-new', 'ManageWalletScreen passphrase panel, keyboard would start at 414'],
  ['manage-passphrase-confirm', 'ManageWalletScreen passphrase panel, keyboard would start at 475'],
  ['manage-label', 'ManageWalletScreen rename panel, keyboard would start at 398'],
  ['manage-destroy-confirm', 'ManageWalletScreen destroy panel, keyboard would start at 407'],
])

let problems = 0
const fail = (message) => {
  problems += 1
  console.error(`    ${message}`)
}

const found = new Set()
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

if (problems > 0) {
  console.error(`\ncheck-typeable: ${String(problems)} problem(s)`)
  process.exit(1)
}

console.log(
  `check-typeable: ${String(fields)} writable field(s), ` +
    `${String(BY_CAMERA.size)} filled by camera, ${String(BY_WORDS.size)} by the word keyboard, ` +
    `${String(UNREACHABLE.size)} still unreachable and listed, the rest bound to a keyboard`
)
