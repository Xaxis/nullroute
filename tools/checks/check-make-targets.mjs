#!/usr/bin/env node
/**
 * Every script the Makefile invokes has to exist.
 *
 * `make image` called `tools/build-image/build.sh`, which was never written.
 * Running it produced a bash "no such file or directory", which reads as a
 * broken installation rather than as a feature that does not exist yet. The
 * documentation was honest about the image build being in design; the tooling
 * was not, and the tooling is what somebody actually runs.
 *
 * This is the same rule as `check-invariant-claims`, applied to commands rather
 * than to invariants: a target that cannot do what its name says has to say so
 * itself, in a sentence, rather than failing in a way that looks like the user's
 * fault.
 *
 * A target may deliberately reference something unbuilt. It just has to fail on
 * purpose, which is what the allowlist below records, and each entry names the
 * target that guards it so the two cannot drift apart.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const MAKEFILE = join(ROOT, 'Makefile')
const CHECKS = join(ROOT, 'tools/checks')

const text = readFileSync(MAKEFILE, 'utf8')
const lines = text.split('\n')

const problems = []
let checked = 0

lines.forEach((line, index) => {
  // Recipe lines only. A path inside a comment is prose, not an invocation.
  if (!line.startsWith('\t')) return
  const command = line.replace(/^\t@?-?/, '')
  if (command.startsWith('#')) return

  for (const match of command.matchAll(/(?:^|\s)((?:tools|provisioning)\/[\w./-]+)/g)) {
    const path = match[1]
    if (path === undefined) continue
    checked += 1
    if (!existsSync(join(ROOT, path))) {
      problems.push(`Makefile:${String(index + 1)} runs ${path}, which does not exist`)
    }
  }
})

if (checked === 0) {
  console.error('check-make-targets: found no script invocations, so this check is blind.')
  console.error('  Either the Makefile changed shape or the pattern stopped matching.')
  process.exit(1)
}

if (problems.length > 0) {
  console.error('check-make-targets: the Makefile invokes things that are not there.\n')
  for (const problem of problems) console.error(`  ${problem}`)
  console.error(
    '\n  A target that cannot do what its name says has to say so in a sentence,\n' +
      '  not fail in a way that looks like a broken checkout.'
  )
  process.exit(1)
}

/**
 * A harness that drives a browser asks the shared resolver for one.
 *
 * TWO OF TEN HAD THE MACOS PATH WRITTEN INTO THE SPAWN CALL. They cannot run
 * anywhere else, and the only machine that ever runs this project anywhere else
 * is CI, which had not started a job in three days. The first run that got far
 * enough to reach them died on `spawn /Applications/Google Chrome.app/... ENOENT`.
 *
 * The other eight each walked their own candidate list beginning with
 * CHROME_PATH, which is the right answer written out eight times, and that is
 * how two of them came to be different.
 */
{
  const offenders = []
  for (const name of readdirSync(CHECKS).filter((f) => f.endsWith('.mjs'))) {
    const source = readFileSync(join(CHECKS, name), 'utf8')
    if (!source.includes('spawn(')) continue
    if (!/Google Chrome|chromium|chrome/i.test(source)) continue
    if (source.includes('chromeBinary(')) continue
    offenders.push(name)
  }
  if (offenders.length > 0) {
    console.error('\ncheck-make-targets: a harness picks its own browser\n')
    for (const name of offenders) console.error(`    tools/checks/${name}`)
    console.error(
      '\n  Use chromeBinary() from tools/lib/browser.mjs. A path written into a\n' +
        '  spawn call is a path that is right on one machine, and the machine it is\n' +
        '  wrong on is the one that runs this on Linux.\n'
    )
    process.exit(1)
  }
}

/*
 * AND THEY ALL WAIT FOR IT THE SAME WAY.
 *
 * The same argument as the paragraph above, one step later in the same
 * sequence. Eight harnesses spawned a browser and eight wrote their own loop
 * polling the debugging port, all with stdio: 'ignore', so every one of them
 * could report only that the port never opened. That sentence does not
 * separate a browser still starting from one that exited on the spot, and
 * those want opposite responses: wait longer, or read what it printed.
 *
 * CI spent a run on it, and the answer was in Chrome's stderr, which nothing
 * was reading. One of the eight had no guard at all and went on to
 * `new WebSocket(undefined)`.
 *
 * chromeBinary stopped a path from being right in eight files and wrong in
 * two. This stops the wait from being.
 */
{
  const offenders = []
  for (const name of readdirSync(CHECKS).filter((f) => f.endsWith('.mjs'))) {
    const source = readFileSync(join(CHECKS, name), 'utf8')
    if (!source.includes('chromeBinary(')) continue
    if (source.includes('waitForDebugEndpoint(')) continue
    offenders.push(name)
  }
  if (offenders.length > 0) {
    console.error('\ncheck-make-targets: a harness waits for its browser its own way\n')
    for (const name of offenders) console.error(`    tools/checks/${name}`)
    console.error(
      '\n  Use waitForDebugEndpoint() from tools/lib/browser.mjs, and spawn with\n' +
        "  stdio: ['ignore', 'pipe', 'pipe'] so it has something to quote. A hand\n" +
        '  written poll reports that the port never opened, which is the symptom,\n' +
        '  and throws away the reason the browser is going to give you.\n'
    )
    process.exit(1)
  }
}

console.log(`check-make-targets: ${String(checked)} script invocations, all present`)
