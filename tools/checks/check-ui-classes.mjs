#!/usr/bin/env node
/**
 * Every `nr-` class the device UI uses must have a rule in styles.css.
 *
 * This exists because the lock screen shipped completely unstyled and no other
 * check noticed. It used its own `nr-lock__*` naming scheme, none of which was
 * ever written into the stylesheet. TypeScript is happy, because a className is
 * just a string. ESLint is happy. Every unit test passed, because they assert on
 * `data-testid` and text content, not on layout. The build was green and the
 * first screen a user sees rendered as raw HTML with the labels running into
 * their values.
 *
 * A class name is a reference to something, and nothing in the toolchain checked
 * that the something existed. This does.
 *
 * Run: node tools/checks/check-ui-classes.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const UI = join(ROOT, 'packages/ui/src')
const STYLES = join(UI, 'styles.css')

function sources(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) sources(full, found)
    else if (name.endsWith('.tsx') || name.endsWith('.ts')) found.push(full)
  }
  return found
}

/**
 * Marks where an interpolation was. Any string that cannot occur inside a CSS
 * class name works; this one is chosen to be obvious in a debug print.
 */
const SENTINEL = '<<EXPR>>'

const css = readFileSync(STYLES, 'utf8')

// Every class selector anywhere in the sheet, including compound selectors like
// `.nr-card .nr-hash` and `.nr-button--primary:disabled`.
const defined = new Set()
for (const match of css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) defined.add(match[1])

/**
 * Class names as they appear in JSX.
 *
 * Two forms are collected. A plain `className="a b c"` yields its literal
 * classes. A template literal yields the literal runs between interpolations,
 * so `` `nr-status ${ok ? 'nr-status--ok' : 'nr-status--fail'}` `` contributes
 * all three. Anything genuinely computed cannot be checked here and is skipped
 * rather than guessed at.
 */
const used = new Map() // class -> Set of files
const dynamic = new Map() // partially computed prefix -> Set of files

function record(cls, file) {
  if (!cls.startsWith('nr-')) return
  const set = used.get(cls) ?? new Set()
  set.add(relative(ROOT, file))
  used.set(cls, set)
}

for (const file of sources(UI)) {
  const text = readFileSync(file, 'utf8')

  // className="..." and className={'...'} and className={`...`}
  for (const m of text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{'([^']*)'\})/g)) {
    const body = m[1] ?? m[2] ?? m[3] ?? ''
    // Interpolations become a sentinel rather than whitespace, so that a token
    // built partly at runtime (`nr-tag--${tone}`) is recognised as incomplete
    // instead of being checked as the literal prefix `nr-tag--`.
    for (const token of body.replace(/\$\{[^}]*\}/g, SENTINEL).split(/\s+/)) {
      if (token.length === 0) continue
      if (token.includes(SENTINEL)) {
        if (!token.startsWith('nr-')) continue
        const prefix = token.slice(0, token.indexOf(SENTINEL))
        const set = dynamic.get(prefix) ?? new Set()
        set.add(relative(ROOT, file))
        dynamic.set(prefix, set)
        continue
      }
      record(token, file)
    }
  }

  // String literals inside a className expression, e.g. the two branches of a
  // ternary. Collected from any quoted string that looks like our classes.
  for (const m of text.matchAll(/'((?:nr-[\w-]+)(?:\s+nr-[\w-]+)*)'/g)) {
    for (const token of (m[1] ?? '').split(/\s+/)) record(token, file)
  }
}

const missing = [...used.entries()].filter(([cls]) => !defined.has(cls)).sort()

if (missing.length > 0) {
  console.error('check-ui-classes: classes used by the UI with no rule in styles.css\n')
  for (const [cls, files] of missing) {
    console.error(`  .${cls}`)
    for (const file of files) console.error(`      ${file}`)
  }
  console.error(
    '\n  A class name is a reference. TypeScript sees a string, so an undefined\n' +
      '  class renders as unstyled HTML with a green build. Add the rule, or fix\n' +
      '  the name.\n'
  )
  process.exit(1)
}

// The other direction is a warning, not a failure. A stylesheet may legitimately
// carry a rule for something rendered by markdown or by a future screen, and
// failing the build over dead CSS would be a worse trade than leaving it.
const unused = [...defined].filter((cls) => cls.startsWith('nr-') && !used.has(cls)).sort()

console.log(`check-ui-classes: ${String(used.size)} classes used, all defined`)

// A class assembled at runtime cannot be resolved statically. Rather than
// pretend it was checked, name the prefix and show which rules could satisfy
// it, so a reader can confirm the variants are all present.
if (dynamic.size > 0) {
  for (const [prefix, files] of [...dynamic.entries()].sort()) {
    const variants = [...defined].filter((c) => c.startsWith(prefix)).sort()
    console.log(
      `  dynamic ${prefix}* in ${[...files].join(', ')} -> ` +
        (variants.length > 0 ? variants.map((v) => `.${v}`).join(', ') : 'NO MATCHING RULES')
    )
    if (variants.length === 0) {
      console.error(`check-ui-classes: no rule matches the dynamic prefix ${prefix}`)
      process.exit(1)
    }
  }
}

if (unused.length > 0) {
  console.log(`  ${String(unused.length)} defined but unused: ${unused.join(', ')}`)
}

/**
 * A class that names a meaning draws that meaning's colour.
 *
 * WHAT THIS IS FOR. This device has four colour families and each one means
 * something: the accent is the brand and navigation, caution is "look at this",
 * danger is "the device refuses", verify is "this was checked and passed". The
 * whole interface rests on a person reading those at a glance, on a 7 inch
 * panel, in whatever light the room has.
 *
 * Three separate times a class named for one meaning was painted in another
 * family's colour, and every one of them was found by a person looking at a
 * screenshot:
 *
 *   - .nr-tag--note wore the verify green, so the colour of the lock screen
 *     saying every check passed was also the colour of "opens a wallet first".
 *     Fixed by hand; the comment explaining it is still in the sheet.
 *   - --color-caution-* held the danger values exactly, so a refusal and the
 *     permanent testnet strip were the same red.
 *   - .nr-tag--warn wore the brand accent, so "shows key material", "cannot be
 *     verified" and "not hand-checkable" were drawn in the colour of the
 *     wordmark and the primary button.
 *
 * None of it is visible to a contrast check, because every one of those colours
 * is perfectly legible. It is legible and it is the wrong colour.
 *
 * A neutral rule is fine and common: .nr-tag--note is deliberately grey now.
 * What fails is borrowing a DIFFERENT family's tokens, which is the specific
 * mistake all three were.
 */
const FAMILY_OF = {
  warn: 'caution',
  caution: 'caution',
  testnet: 'caution',
  test: 'caution',
  danger: 'danger',
  fail: 'danger',
  failed: 'danger',
  ok: 'verify',
  verified: 'verify',
}
const FAMILIES = ['accent', 'caution', 'danger', 'verify']

const wrongFamily = []
/* Comments stripped first. Without this the text before a rule is part of what
   the selector pattern matches, and .nr-idlechip was reported as naming caution
   because the comment above it says "Danger colours rather than caution". The
   comment was explaining the exact decision the check exists to enforce. */
const rules = css.replace(/\/\*[\s\S]*?\*\//g, ' ')
// One rule at a time: a selector list, then the declarations it applies.
for (const rule of rules.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const selector = rule[1].trim()
  const body = rule[2]
  // The meaning has to be a whole name segment, so `.nr-kb__key` is not "ok"
  // and `.nr-banner__dismiss` is not "miss".
  const named = new Set()
  for (const part of selector.matchAll(/[.#]?[\w-]+/g)) {
    for (const segment of part[0].split(/--|__|[.#]/)) {
      const family = FAMILY_OF[segment]
      if (family !== undefined) named.add(family)
    }
  }
  if (named.size !== 1) continue
  const want = [...named][0]
  const borrowed = FAMILIES.filter(
    (family) => family !== want && body.includes(`--color-${family}-`)
  )
  if (borrowed.length === 0) continue
  wrongFamily.push({ selector, want, borrowed })
}

if (wrongFamily.length > 0) {
  console.error('\ncheck-ui-classes: a class names one meaning and is painted in another\n')
  for (const { selector, want, borrowed } of wrongFamily) {
    console.error(`  ${selector}`)
    console.error(`      names ${want}, draws from ${borrowed.join(' and ')}`)
  }
  console.error(
    '\n  Each family means something and somebody has to read them apart at a\n' +
      '  glance. Borrowing another one spends its meaning: a warning in the brand\n' +
      '  colour teaches that the brand colour is a warning, and then the warning is\n' +
      '  not one. Use the matching --color-<family>-* tokens, or a neutral surface\n' +
      '  if the row is genuinely neither, as .nr-tag--note does.\n'
  )
  process.exit(1)
}

/**
 * Every :hover rule in the device stylesheet is guarded by a hover query.
 *
 * THIS DEVICE HAS NO POINTER. It is a 7 inch touchscreen and docs/USING.md
 * opens by saying there is no cursor, which is the same fact that gives every
 * target a 44px floor and every field an on-screen keyboard.
 *
 * A :hover rule here cannot fire the way it was written to, and on a touchscreen
 * it does something worse than nothing: the browser applies it on tap and leaves
 * it applied until something else is tapped, so the last control somebody
 * touched keeps a highlight it was never meant to hold. Five of these shipped.
 * The one on the dice pad painted `--color-accent`, which every other screen
 * uses to mean chosen, onto a die that has no chosen state.
 *
 * `@media (hover: hover)` is the whole fix: `hover: none` on the device, so they
 * never apply there, and they still work under `make dev` where a pointer
 * exists. This exists so the next one arrives guarded rather than in a year.
 */
{
  // Comments stripped first, and not only to stop this check reading its own
  // explanation as a rule. A brace inside a comment would throw off the depth
  // counter below and silently mark a guarded rule unguarded, or the reverse.
  const source = readFileSync(STYLES, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const unguarded = []
  // Depth of @media (hover: hover) nesting, tracked by counting braces, which
  // is enough for a stylesheet with no nested rules of its own.
  let guarded = 0
  let depth = 0
  for (const line of source.split('\n')) {
    const opensHover = /@media[^{]*\(\s*hover\s*:\s*hover\s*\)/.test(line)
    if (opensHover) guarded = depth + 1
    if (/:hover\b/.test(line) && !opensHover && guarded === 0) {
      unguarded.push(line.trim())
    }
    depth += (line.match(/{/g) ?? []).length
    depth -= (line.match(/}/g) ?? []).length
    if (guarded > 0 && depth < guarded) guarded = 0
  }

  if (unguarded.length > 0) {
    console.error('\ncheck-ui-classes: a hover rule on a device with no pointer\n')
    for (const selector of unguarded) console.error(`  ${selector}`)
    console.error(
      '\n  This panel is a touchscreen with no cursor, so a :hover rule cannot fire\n' +
        '  the way it was written to. What it does instead is stick: the browser\n' +
        '  applies it on tap and leaves it there until something else is tapped, so\n' +
        '  the last thing somebody touched keeps a highlight nobody designed.\n\n' +
        '  Wrap it in @media (hover: hover). It then does nothing on the device and\n' +
        '  still works under `make dev`, where there is a pointer.\n'
    )
    process.exit(1)
  }
}
