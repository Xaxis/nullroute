/**
 * Run the commands docs/VERIFICATION.md tells a reader to run, and check that
 * they print what the document says they print.
 *
 * WHY THIS EXISTS. The root hash is the one number this whole project asks a
 * stranger to compare before entering a PIN, and the document teaching them how
 * to recompute it had drifted from the tool in four separate ways at once:
 *
 *   - it said the manifest covered "packages/ and spec/" when the Makefile had
 *     been building it from packages, spec AND provisioning
 *   - it said "every tracked source file" when the recipe was an allowlist of
 *     four extensions, leaving eighteen tracked files outside the hash
 *   - the regeneration command it printed omitted provisioning/ entirely, so a
 *     reader who followed it got a different number and had no way to tell
 *     which side was wrong
 *   - the example hash was from some earlier commit
 *
 * None of that was catchable, because a document is not executable. So this
 * makes it executable. Every `$ ` line inside a console block in the manifest
 * section gets run, and its transcript is compared to what follows it. A reader
 * copying those lines gets what the page promised, or this fails.
 *
 * The transcripts are the specification here. Changing how the manifest is
 * built means changing the document, which is the correct order.
 *
 * Run: node tools/checks/check-manifest-recipe.mjs [--write]
 *   --write updates the example hashes in place, and is what `make manifest`
 *   calls so nobody has to hand-copy a hash into prose ever again.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const DOC = join(ROOT, 'docs/VERIFICATION.md')
const WRITE = process.argv.includes('--write')

/**
 * coreutils on Linux, shasum on macOS. The document says these are
 * interchangeable, in those words, so substituting one for the other here is
 * checking a claim the page makes rather than working around a platform.
 */
let HAVE_SHA256SUM = true
try {
  execFileSync('sha256sum', ['--version'], { stdio: 'ignore' })
} catch {
  HAVE_SHA256SUM = false
}
const portable = (cmd) => (HAVE_SHA256SUM ? cmd : cmd.replaceAll('sha256sum', 'shasum -a 256'))

const source = readFileSync(DOC, 'utf8')
const lines = source.split('\n')

/**
 * Pull out the `$ command` / transcript pairs from fenced console blocks.
 *
 * Only blocks that touch the manifest are run. The document has console blocks
 * for other things (flashing a card, reading a serial number) that need
 * hardware, and running those is not this check's job.
 */
const RELEVANT = /MANIFEST\.lock|git ls-files/
const cases = []
let inBlock = false
let current = null

for (const [index, line] of lines.entries()) {
  if (line.startsWith('```')) {
    if (inBlock && current) {
      cases.push(current)
      current = null
    }
    inBlock = line === '```console'
    continue
  }
  if (!inBlock) continue

  if (line.startsWith('$ ')) {
    if (current) cases.push(current)
    const command = line.slice(2)
    current = RELEVANT.test(command) ? { command, expected: [], line: index + 1 } : null
    continue
  }
  if (current) current.expected.push(line)
}
if (current) cases.push(current)

if (cases.length === 0) {
  console.error('check-manifest-recipe: found no manifest commands in docs/VERIFICATION.md.')
  console.error('  Either the document stopped teaching this, or the block markers changed.')
  process.exit(1)
}

let problems = 0
const fail = (where, message) => {
  problems += 1
  console.error(`\n${where}\n    ${message}`)
}

/** The value everything in the document is supposed to agree with. */
const actualRoot = execFileSync(portable('sha256sum MANIFEST.lock'), {
  cwd: ROOT,
  shell: true,
  encoding: 'utf8',
})
  .trim()
  .split(/\s+/)[0]

let patched = source

for (const test of cases) {
  const where = `docs/VERIFICATION.md:${test.line}  $ ${test.command}`
  let stdout
  try {
    stdout = execFileSync(portable(test.command), {
      cwd: ROOT,
      shell: true,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    })
  } catch (err) {
    fail(
      where,
      `exited non-zero. A reader following this page runs this and it fails.\n    ${
        String(err.stderr ?? err.message)
          .trim()
          .split('\n')[0]
      }`
    )
    continue
  }

  const expected = test.expected.join('\n').trim()
  const got = stdout.trim()

  // A transcript with an ellipsis is showing shape, not every line of output.
  // Those are checked by running clean, which is the claim being made.
  if (expected.includes('...')) continue

  if (got === expected) continue

  // The common drift is one stale hash in an otherwise correct transcript, and
  // that is mechanical to repair rather than something to make a person retype.
  const staleHash = /^[0-9a-f]{64}(\s)/
  if (WRITE && staleHash.test(expected) && staleHash.test(got)) {
    patched = patched.replace(expected, got)
    console.log(`check-manifest-recipe: updated the transcript for "${test.command}"`)
    continue
  }

  fail(
    where,
    `printed something the document does not claim.\n` +
      `    document: ${expected.split('\n')[0]}\n` +
      `    actual:   ${got.split('\n')[0]}\n` +
      `    The command and the prose have to agree. Run "make manifest" if the hash is merely stale.`
  )
}

/**
 * The prose names the directories covered. It said "packages/ and spec/" for as
 * long as the Makefile had been hashing three roots, which is the kind of claim
 * a reader uses to decide what an unchanged root hash proves about a change.
 */
const roots = execFileSync('make', ['-s', 'print-manifest-roots'], { cwd: ROOT, encoding: 'utf8' })
  .trim()
  .split(/\s+/)
for (const root of roots) {
  if (!source.includes(`\`${root}/\``)) {
    fail(
      'docs/VERIFICATION.md',
      `never mentions \`${root}/\`, which the manifest covers. A reader cannot tell what an ` +
        `unchanged root hash proves if the document does not list what went into it.`
    )
  }
}

if (WRITE && patched !== source) writeFileSync(DOC, patched)

if (problems > 0) {
  console.error(`\ncheck-manifest-recipe: ${problems} problem${problems === 1 ? '' : 's'}`)
  process.exit(1)
}

console.log(
  `check-manifest-recipe: ${cases.length} documented command(s) run and matched, ` +
    `covering ${roots.join(', ')}, root hash ${actualRoot.slice(0, 12)}...`
)
