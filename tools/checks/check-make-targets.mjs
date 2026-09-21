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
/**
 * Every .mjs under tools/, not just tools/checks.
 *
 * THE TWO RULES BELOW SCANNED ONE DIRECTORY and there are eleven scripts in
 * this repository that spawn a browser. Ten are in tools/checks and obey both.
 * The eleventh is tools/gen-device-shots.mjs, which `make check` runs through
 * device-shots-check, and it broke both: its own four-entry candidate list
 * starting with the macOS path, and its own poll loop with stdio 'ignore' that
 * can only ever report that the port never opened.
 *
 * Those are the exact two failures the rules were written after, and the
 * commits that fixed them for the other eight could not see this one because
 * of where it lives. A rule that inspects a directory rather than a property
 * is a rule with a doorway next to it.
 */
function toolScripts() {
  const found = []
  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix === '' ? name.name : `${prefix}/${name.name}`
      if (name.isDirectory()) {
        walk(join(dir, name.name), rel)
        continue
      }
      if (name.name.endsWith('.mjs'))
        found.push({ rel: `tools/${rel}`, path: join(dir, name.name) })
    }
  }
  walk(join(ROOT, 'tools'), '')
  return found
}

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
  for (const { rel, path } of toolScripts()) {
    // The file that DEFINES the resolver is not a harness that should call it.
    if (rel === 'tools/lib/browser.mjs') continue
    const source = readFileSync(path, 'utf8')
    if (!source.includes('spawn(')) continue
    if (!/Google Chrome|chromium|chrome/i.test(source)) continue
    if (source.includes('chromeBinary(')) continue
    offenders.push(rel)
  }
  if (offenders.length > 0) {
    console.error('\ncheck-make-targets: a harness picks its own browser\n')
    for (const rel of offenders) console.error(`    ${rel}`)
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
  for (const { rel, path } of toolScripts()) {
    if (rel === 'tools/lib/browser.mjs') continue
    const source = readFileSync(path, 'utf8')
    /*
     * KEYED ON SPAWNING A BROWSER, not on already calling chromeBinary.
     *
     * This used to skip anything without chromeBinary(), so a harness that
     * broke the rule above was exempt from this one as well: get the browser
     * wrong and you were excused from getting the wait wrong too. The two
     * failures travel together, and gen-device-shots.mjs had both.
     */
    if (!source.includes('spawn(')) continue
    if (!/Google Chrome|chromium|chrome/i.test(source)) continue
    if (source.includes('waitForDebugEndpoint(')) continue
    offenders.push(rel)
  }
  if (offenders.length > 0) {
    console.error('\ncheck-make-targets: a harness waits for its browser its own way\n')
    for (const rel of offenders) console.error(`    ${rel}`)
    console.error(
      '\n  Use waitForDebugEndpoint() from tools/lib/browser.mjs, and spawn with\n' +
        "  stdio: ['ignore', 'pipe', 'pipe'] so it has something to quote. A hand\n" +
        '  written poll reports that the port never opened, which is the symptom,\n' +
        '  and throws away the reason the browser is going to give you.\n'
    )
    process.exit(1)
  }
}

/*
 * AND THEY ALL WALK THE GALLERY THE SAME WAY.
 *
 * The third in the same sequence, and the one with the largest spread. Four
 * scripts walk a gallery reach list, and all four wrote their own loop around
 * reachStep: check-screen-fit waited for the target to exist and evaluated
 * once, check-ui-roles and check-contrast polled the whole condition for 3.2
 * seconds, and gen-device-shots polled and then carried on regardless and took
 * the picture.
 *
 * Two costs, both paid. The tightest budget was on the check that walks the
 * most states, so it was the one that failed on a busy workstation, and the
 * screenshot generator had no budget at all in the sense that mattered.
 *
 * And reachStep returns a status precisely so the caller can say what went
 * wrong: `missing`, `disabled`, `no-key-C`, `typed-16-of-27`. Two of the four
 * kept a boolean and printed a sentence naming two causes instead, neither of
 * which was the cause. Twenty minutes went into looking for a regression in a
 * gallery no commit had touched.
 *
 * So reachStep is not for calling. walkReach is, and it holds the budget, the
 * refusal and the wording in one place.
 */
{
  const direct = []
  let users = 0
  for (const { rel, path } of toolScripts()) {
    if (rel === 'tools/lib/browser.mjs') continue
    // Against the source with its comments blanked. Three of these four files
    // now carry a paragraph explaining what reachStep is and why they stopped
    // calling it, and a rule that reads those would fail on the explanation.
    const source = stripComments(readFileSync(path, 'utf8'))
    /*
     * GATED ON IMPORTING THE MODULE, which the two rules above cannot use and
     * this one must.
     *
     * Those two ask whether a browser-spawning script CALLS the shared helper,
     * so they have to consider a script that imports nothing, which is exactly
     * the offender they exist to find. This one asks whether a script calls
     * something it should not, and the difference matters: the first version
     * was gated their way and failed on this file, because the sentences this
     * file prints quote every identifier involved. `spawn(`, `Google Chrome`
     * and `reachStep(` all appear here as words about code rather than as code.
     *
     * The same accident runs the other way in those two rules and is invisible
     * because it is benign: this file contains the literals `chromeBinary()`
     * and `waitForDebugEndpoint()` in its own advice, so `includes` counts it
     * as obeying rules it is not a subject of.
     *
     * A file that does not import tools/lib/browser.mjs cannot call reachStep,
     * so importing it is the honest predicate for "is one of the things this
     * rule is about", and it is a property rather than a list of four names.
     *
     * Anchored on `from`, because this file names that path in the skip line
     * of the two rules above and matched on it. Reading a file that is itself
     * about reading files means every loose substring is a word this file uses
     * to describe the rule as well as a word the rule is looking for.
     */
    if (!/from '[^']*lib\/browser\.mjs'/.test(source)) continue
    if (source.includes('walkReach(')) users += 1
    if (source.includes('reachStep(')) direct.push(rel)
  }
  if (direct.length > 0) {
    console.error('\ncheck-make-targets: a harness walks the gallery its own way\n')
    for (const rel of direct) console.error(`    ${rel}`)
    console.error(
      '\n  Use walkReach() from tools/lib/browser.mjs. Calling reachStep() directly\n' +
        '  means writing the budget, the give-up and the wording again, and those\n' +
        '  were written four times and disagreed four ways.\n'
    )
    process.exit(1)
  }
  /*
   * A rule about who calls reachStep passes for free the day nothing does.
   * The mechanism has to be in use for its absence to mean anything, which is
   * the same argument as the zero-invocations guard at the top of this file.
   */
  if (users < 4) {
    console.error(
      `\ncheck-make-targets: only ${String(users)} script(s) call walkReach(), and four walk\n` +
        '  the gallery. Either one went back to its own loop under another name, or\n' +
        '  this rule is now asserting something about nothing.\n'
    )
    process.exit(1)
  }
}

/** Source with // and /* comments blanked, so a rule reads code and not prose. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

console.log(`check-make-targets: ${String(checked)} script invocations, all present`)
