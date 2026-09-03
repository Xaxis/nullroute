#!/usr/bin/env node
/**
 * Constants the frontend restates, checked against the daemon that enforces them.
 *
 * The UI cannot import from packages/daemon, and that boundary is deliberate:
 * see INV-KEY-1. The cost of it is that a handful of values exist twice, and a
 * value that exists twice drifts.
 *
 * The wallet colours are the live case. The picker renders a swatch per colour
 * and the daemon refuses any name not in its own list, so a colour added on one
 * side and not the other is a swatch that produces "Unknown colour" when tapped.
 * Nothing else catches it: the types are strings across the IPC boundary, the
 * component tests pass their own fixtures, and the daemon tests never see a
 * screen.
 *
 * This is a string comparison on purpose. Parsing TypeScript to compare two
 * arrays would be a more impressive check and a less reliable one.
 */

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** Pull a `const NAME = [ ... ] as const` array of string literals. */
function literals(path, name) {
  const source = readFileSync(join(ROOT, path), 'utf8')
  const match = new RegExp(`${name}\\s*=\\s*\\[([^\\]]*)\\]`).exec(source)
  if (match === null) {
    console.error(`check-ui-constants: ${name} not found in ${path}, so this check is blind.`)
    process.exit(1)
  }
  const found = [...(match[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1])
  if (found.length === 0) {
    console.error(`check-ui-constants: ${name} in ${path} parsed as empty.`)
    process.exit(1)
  }
  return found
}

const failures = []

const pairs = [
  {
    what: 'wallet colours',
    a: { path: 'packages/daemon/src/store/registry.ts', name: 'WALLET_COLOURS' },
    b: { path: 'packages/ui/src/screens/ManageWalletScreen.tsx', name: 'WALLET_COLOUR_NAMES' },
    // Order matters here as well as membership: the swatch row and any future
    // default are both positional, so a reordered list is a silently different
    // default colour.
    ordered: true,
  },
]

for (const pair of pairs) {
  const a = literals(pair.a.path, pair.a.name)
  const b = literals(pair.b.path, pair.b.name)
  const same = pair.ordered
    ? a.join(',') === b.join(',')
    : [...a].sort().join(',') === [...b].sort().join(',')
  if (!same) {
    failures.push(
      `  ${pair.what}: ${pair.a.name} is [${a.join(', ')}] and ${pair.b.name} is [${b.join(', ')}]`
    )
  }
}

// Every colour the daemon accepts needs a swatch rule, or the swatch renders as
// nothing and the user taps an invisible button.
const css = readFileSync(join(ROOT, 'packages/ui/src/styles.css'), 'utf8')
for (const colour of literals('packages/daemon/src/store/registry.ts', 'WALLET_COLOURS')) {
  if (!css.includes(`[data-colour='${colour}']`)) {
    failures.push(`  ${colour} is an accepted wallet colour with no rule in styles.css`)
  }
}

/**
 * Every custom property the stylesheet reads is one the stylesheet defines.
 *
 * An undefined custom property is not a CSS error. It is an empty value, so
 * `color: var(--color-text)` renders as whatever was inherited, and on a dark
 * panel that is dark text on a dark background. Fifty such uses shipped before
 * anything caught them, because jsdom computes no cascade and the browser check
 * only asserts that React mounted.
 *
 * The built stylesheet is checked too when one exists. Tailwind emits @theme
 * variables into :root, and a variable that never reaches the output is
 * undefined at runtime however well defined it looks in the source.
 */
function customProperties(css) {
  // A declaration, wherever it sits: at the start of a line, or inside a
  // single-line rule such as [data-colour='slate'] { --wallet-colour: #fff; }
  const defined = new Set([...css.matchAll(/(?:^|[{;\s])(--[\w-]+)\s*:/gm)].map((m) => m[1]))
  const used = new Set([...css.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]))
  return { defined, used }
}

{
  const source = readFileSync(join(ROOT, 'packages/ui/src/styles.css'), 'utf8')
  const { defined, used } = customProperties(source)
  for (const name of [...used].sort()) {
    // A fallback is a deliberate default rather than an omission.
    if (!defined.has(name) && !source.includes(`var(${name},`)) {
      failures.push(`  ${name} is read by styles.css and defined nowhere in it`)
    }
  }

  const builtPath = join(ROOT, 'packages/ui/dist-app/assets/index.css')
  if (existsSync(builtPath)) {
    const built = readFileSync(builtPath, 'utf8')
    const emitted = customProperties(built).defined
    for (const name of [...defined].sort()) {
      if (used.has(name) && !emitted.has(name)) {
        failures.push(`  ${name} is defined in styles.css and absent from the built stylesheet`)
      }
    }
  }
}

/**
 * Every stage a journey routes to is a stage the shell actually handles.
 *
 * A journey is data the shell trusts: it reads a step's stage and calls
 * setStage with it. A stage name that App.tsx does not handle sends the user to
 * a blank screen, and nothing else would notice, because journeys.ts has no
 * imports on purpose and TypeScript cannot relate a string union in one file to
 * a set of comparisons in another.
 *
 * Read out of the source rather than executed, for the same reason
 * check-ipc-reachable is: this runs as plain Node with no build step.
 */
{
  const journeys = readFileSync(join(ROOT, 'packages/ui/src/journeys.ts'), 'utf8')
  const app = readFileSync(join(ROOT, 'packages/ui/src/App.tsx'), 'utf8')

  const routed = new Set(
    [...journeys.matchAll(/\{\s*stage:\s*'([a-z-]+)'/g)].map((match) => match[1])
  )
  if (routed.size === 0) {
    console.error('check-ui-constants: no journey steps parsed, so this check is blind.')
    process.exit(1)
  }

  const handled = new Set([...app.matchAll(/stage\.at === '([a-z-]+)'/g)].map((match) => match[1]))
  if (handled.size === 0) {
    console.error('check-ui-constants: no stages parsed from App.tsx, so this check is blind.')
    process.exit(1)
  }

  for (const stage of [...routed].sort()) {
    if (!handled.has(stage)) {
      failures.push(`  a journey routes to the stage '${stage}', which App.tsx does not handle`)
    }
  }

  // A stage declared in the JourneyStage union and never used is not an error,
  // but one that names a stage nothing handles is a trap for the next author.
  const declared = new Set(
    [
      ...(/export type JourneyStage =([\s\S]*?)\n\n/.exec(journeys)?.[1] ?? '').matchAll(
        /'([a-z-]+)'/g
      ),
    ].map((match) => match[1])
  )
  for (const stage of [...declared].sort()) {
    if (!handled.has(stage)) {
      failures.push(`  JourneyStage offers '${stage}', which App.tsx does not handle`)
    }
  }
}

if (failures.length > 0) {
  console.error('check-ui-constants: the frontend disagrees with itself or with the daemon.\n')
  for (const failure of failures) console.error(failure)
  console.error(
    '\n  A list exists twice because the UI may not import from the daemon: change\n' +
      '  both, or the screen offers something the daemon refuses.\n\n' +
      '  An undefined custom property renders as an empty value rather than an\n' +
      '  error, so the screen draws wrong and nothing anywhere reports it.\n\n' +
      '  A journey routing to a stage nothing handles sends the user to a blank\n' +
      '  screen. journeys.ts has no imports on purpose, so TypeScript cannot\n' +
      '  relate its stage names to the comparisons in App.tsx.'
  )
  process.exit(1)
}

console.log(
  `check-ui-constants: ${String(pairs.length)} constant(s) restated in the frontend agree with ` +
    `the daemon, every custom property the stylesheet reads is defined and emitted, ` +
    `every journey routes to a stage that exists`
)
