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
 * Run: node tools/check-ui-classes.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
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
const unused = [...defined]
  .filter((cls) => cls.startsWith('nr-') && !used.has(cls))
  .sort()

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
