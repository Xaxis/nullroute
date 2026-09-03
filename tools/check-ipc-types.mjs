#!/usr/bin/env node
/**
 * A `call<T>()` whose type is narrower than what the screen actually reads.
 *
 * THIS HAS HAPPENED THREE TIMES, and it is invisible by construction. The
 * frontend's `call<T>()` CASTS parsed JSON: it checks nothing, so an extra key
 * the daemon returned survives into the object a screen renders. Everything
 * works. What breaks is the reader.
 *
 *   `wallet.addresses` was typed as `{ address, path, index }` while the daemon
 *   had started returning a BIP-329 label per address and the wallet screen was
 *   rendering it. Anybody reading the call site would have concluded labels do
 *   not reach the screen.
 *
 *   `psbt.sign` was typed as `{ psbt, inputsSigned, signedWith }` while the
 *   daemon returned four more fields and the signing screen rendered all of
 *   them, including which cosigner still has to sign.
 *
 * The compiler cannot catch it. A narrow object type is assignable to a wider
 * optional one, and a cast is a cast.
 *
 * WHAT IT CHECKS, AND WHAT IT DELIBERATELY DOES NOT. It checks the direction
 * with no false positives: a call type that declares a field the daemon never
 * returns. That is always wrong. A screen reading it gets `undefined` with the
 * compiler insisting it cannot be, which is the same lie pointing the other
 * way and is the one that actually breaks something.
 *
 * IT DOES NOT CHECK THE OMISSION, which is the bug described above, and the
 * reason is worth recording rather than leaving as a gap somebody re-opens. A
 * handler echoes back the script type, the change flag and the network it was
 * given, and a caller that already passed those in has no reason to declare
 * them. Flagging omissions produced nine findings of which two were real, and
 * filtering by "does a screen read a field of this name" barely moved it,
 * because screens have props called `address` and `network` too. Telling the
 * two apart needs data-flow analysis, and this is a regex over two files.
 *
 * A check that cries wolf is a check somebody turns off, and the next real
 * finding goes with it. So the omission direction is handled structurally
 * instead: the two call sites that drifted now use named types shared with the
 * screens that consume them, and `call<PsbtSignedView>` cannot disagree with
 * the screen because it IS the screen's type.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const APP = join(ROOT, 'packages/ui/src/App.tsx')
const METHODS = join(ROOT, 'packages/daemon/src/ipc/methods')

const app = readFileSync(APP, 'utf8')
/* The thirteen method tables, concatenated. This read one 2084-line handler.ts
   and matched `case '<method>':`; the switch is gone and the tables replaced
   it. Concatenated rather than searched per file because the question asked
   here is per method, and a method lives in exactly one of them. */
const handler = readdirSync(METHODS)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => readFileSync(join(METHODS, name), 'utf8'))
  .join('\n')

/**
 * Fields a `case '<method>':` block returns, read from its `return { ... }`.
 *
 * Braces are counted rather than matched with a regex, because the returned
 * object contains nested ones and a lazy match stops at the first inner close.
 */
function returnedFields(method) {
  /* `async` is optional: all fifty nine of these turned out to be synchronous
     once they left the one async switch they lived in, and lint removed the
     keyword. Matching on it made this tool find nothing and then report
     success, which is the failure mode it exists to prevent. */
  const found = new RegExp(`'${method.replace('.', '\\.')}': (?:async )?\\(`).exec(handler)
  if (found === null) return null
  const start = found.index

  // The end of this method, which is the next entry in the same table.
  const nextCase = handler.slice(start + 1).search(/\n {4}'[a-z][\w]*\.[\w.]+': /)
  const block = nextCase === -1 ? handler.slice(start) : handler.slice(start, start + 1 + nextCase)

  const fields = new Set()
  let at = 0
  for (;;) {
    const returnAt = block.indexOf('return {', at)
    if (returnAt === -1) break
    at = returnAt + 8

    let depth = 1
    let index = at
    while (index < block.length && depth > 0) {
      const char = block[index]
      if (char === '{') depth += 1
      if (char === '}') depth -= 1
      index += 1
    }
    const body = block.slice(at, index - 1)

    // Split at depth-zero commas, then take the key from each entry. Reading
    // line by line was the first attempt and it missed a single-line
    // `return { found: false, address: target, searchedTo: gapLimit }`
    // entirely, because the keys after the first are not at the start of a
    // line. The guard reported that as the daemon not returning a field it
    // plainly does return, which is the false positive this whole file argues
    // against, occurring in the file that argues it.
    let depthAt = 0
    let entry = ''
    const entries = []
    for (const char of body) {
      if ('{[('.includes(char)) depthAt += 1
      if ('}])'.includes(char)) depthAt -= 1
      if (char === ',' && depthAt === 0) {
        entries.push(entry)
        entry = ''
        continue
      }
      entry += char
    }
    entries.push(entry)

    for (const text of entries) {
      const trimmed = text
        .trim()
        .replace(/^\/\/.*$/gm, '')
        .trim()
      if (trimmed.length === 0) continue

      // `name: value`
      const key = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(trimmed)
      if (key !== null) {
        fields.add(key[1])
        continue
      }
      // Shorthand: `signatures`
      const shorthand = /^([A-Za-z_][A-Za-z0-9_]*)$/.exec(trimmed)
      if (shorthand !== null) {
        fields.add(shorthand[1])
        continue
      }
      // A conditional spread of one named field: `...(x ? { name: y } : {})`
      const spread = /^\.\.\..*?\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(trimmed)
      if (spread !== null) fields.add(spread[1])
    }
  }

  return fields.size === 0 ? null : fields
}

/** Every inline `call<{...}>(transport, 'method'` in App.tsx. */
function inlineCalls() {
  const found = []
  const pattern = /call<(\{[^}]*\})>\(\s*(?:transport,\s*)?'([a-z][a-zA-Z.]*)'/g
  for (const match of app.matchAll(pattern)) {
    const line = app.slice(0, match.index).split('\n').length
    const fields = new Set(
      [...match[1].matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*[?]?\s*:/g)].map((m) => m[1])
    )
    found.push({ line, method: match[2], fields })
  }
  return found
}

const problems = []
let checked = 0
let skipped = 0

for (const { line, method, fields } of inlineCalls()) {
  const returned = returnedFields(method)
  if (returned === null) {
    // Reported, not passed. A method whose handler this cannot read is a method
    // nobody is checking, and silence there is how a check becomes decorative.
    skipped += 1
    /* Loud, because this is where the tool went blind. It matched on a shape
       the daemon stopped having, found nothing for all eighteen methods, and
       printed a success line reading "0 checked, 18 not checked". A guard that
       cannot find the thing it guards has failed, not passed. */
    console.error(
      `check-ipc-types: cannot find what the daemon returns for "${method}".\n` +
        `  Either the method is gone, or the shape this tool reads has changed.\n` +
        `  It looks for "'${method}': (" in packages/daemon/src/ipc/methods.`
    )
    process.exit(1)
    continue
  }
  checked += 1

  // The direction with no false positives: promised and never sent.
  const invented = [...fields].filter((field) => !returned.has(field))
  if (invented.length > 0) {
    problems.push(
      `packages/ui/src/App.tsx:${String(line)}: call<{...}>('${method}') declares ` +
        `${invented.join(', ')}, which the daemon does not return. A screen reading that gets ` +
        `undefined while the compiler insists it cannot be.`
    )
  }
}

if (problems.length > 0) {
  console.error('check-ipc-types: a call type promises a field the daemon never sends.\n')
  for (const problem of problems) console.error(`  ${problem}`)
  console.error('')
  console.error('  call() casts parsed JSON and checks nothing, so the compiler will not')
  console.error('  catch this. The value is undefined at runtime and typed as present.')
  process.exit(1)
}

console.log(
  `check-ipc-types: ${String(checked)} inline call type(s) promise nothing the daemon does ` +
    `not send` +
    (skipped > 0 ? `, ${String(skipped)} not checked` : '') +
    '. Omissions are not checked here: see the header for why.'
)
