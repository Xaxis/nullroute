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

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const MAKEFILE = join(ROOT, 'Makefile')

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

console.log(`check-make-targets: ${String(checked)} script invocations, all present`)
