#!/usr/bin/env node
/**
 * The header offers one exit, or none, and never one and a half.
 *
 * WHAT WENT WRONG WITHOUT THIS. A contact sheet of every screen showed the top
 * right holding nothing, or a Home button, or a Menu, with no rule anybody
 * could learn: "Sign a transaction" appeared four times with three different
 * answers. Collapsing that to one control fixed the look and opened a hole,
 * because the identity chip beside it is ALSO an exit. It opens the wallet
 * picker. A screen that withholds the menu and then offers a tappable wallet
 * name two inches to the left has withheld nothing, and the screens that
 * withhold it are the seed words and the transaction review.
 *
 * So: a screen rendered without `nav` must take the identity that cannot be
 * tapped. This is a text check on App.tsx rather than a type, because both
 * props are ReactNode and a type cannot tell one node from another.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const APP = join(ROOT, 'packages/ui/src/App.tsx')
const source = readFileSync(APP, 'utf8')

/**
 * Each screen element, from its opening tag to the `/>` that closes it.
 *
 * Depth-counted on braces so a nested element inside a prop cannot end the
 * block early and hide the props that follow it.
 */
function elements(src) {
  const found = []
  const open = /<([A-Z]\w*Screen)\b/g
  let m
  while ((m = open.exec(src)) !== null) {
    let i = open.lastIndex
    let depth = 0
    while (i < src.length) {
      const c = src[i]
      if (c === '{') depth += 1
      else if (c === '}') depth -= 1
      else if (c === '/' && src[i + 1] === '>' && depth === 0) break
      else if (c === '>' && depth === 0) break
      i += 1
    }
    found.push({ name: m.group ?? m[1], body: src.slice(m.index, i), at: m.index })
  }
  return found
}

const lineOf = (index) => source.slice(0, index).split('\n').length

const problems = []
let checked = 0
let gates = 0

for (const el of elements(source)) {
  checked += 1
  const hasNav = /\bnav=\{/.test(el.body)
  const identity = /\bidentity=\{(\w+)\}/.exec(el.body)

  if (hasNav) continue
  gates += 1

  if (identity === null) continue
  if (identity[1] === 'identityFixed') continue

  problems.push(
    `${el.name} at App.tsx:${String(lineOf(el.at))} has no menu, so leaving it is ` +
      `not free, and it passes \`${identity[1]}\`, which opens the wallet picker.`
  )
}

if (checked === 0) {
  console.error('check-header-rule: no screens found in App.tsx, so this check is blind.')
  process.exit(1)
}

if (problems.length > 0) {
  console.error('check-header-rule: a screen refuses an exit and offers the same exit beside it.\n')
  for (const p of problems) console.error(`  ${p}`)
  console.error(
    '\n  The menu and the wallet name are one decision. A screen that withholds\n' +
      '  the menu is a screen where leaving destroys something that cannot be\n' +
      '  made again, and tapping the wallet name leaves it just as completely.\n' +
      '  Pass `identityFixed`, or give the screen a menu and mean it.\n'
  )
  process.exit(1)
}

console.log(
  `check-header-rule: ${String(checked)} screens, ${String(gates)} without a menu, ` +
    'none of them switchable'
)
