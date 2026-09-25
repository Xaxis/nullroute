#!/usr/bin/env node
/**
 * Every document is reachable from the README and from the website.
 *
 * A document nobody can find is not a published document. This has now happened
 * twice with the same two files: `docs/AIR-GAP.md` and `docs/FLEET.md` were
 * written, committed, and left out of the website's header for a week, and left
 * out of the README's documentation table for longer. Both times the files
 * built, both times the sitemap listed them, and both times the only route in
 * was to type the URL.
 *
 * The website half is now enforced structurally: the header nav is derived from
 * `apps/web/lib/docs.ts`, so registering a document puts it in the nav. Nothing
 * enforced the other two links, and nothing noticed that the registry and the
 * directory could disagree.
 *
 * WHAT IT CHECKS.
 *   1. Every file in docs/ is registered in apps/web/lib/docs.ts.
 *   2. Every registered document points at a file that exists.
 *   3. Every file in docs/ is linked from README.md.
 *   4. Every docs/NAME.md cited anywhere in the tracked tree exists.
 *
 * THE FOURTH IS THE OTHER DIRECTION, and it was missing for months. Seven
 * documents became four in one commit, and the three that went away,
 * docs/AIR-GAP.md, docs/FLEET.md and docs/PROVISIONING.md, stayed cited in
 * thirty places: spec references, security comments ("the real mitigations are
 * in docs/PROVISIONING.md"), test headers. A reader following a citation into
 * a file that does not exist is the first thing a hostile review finds, and
 * one of those citations was propping up a mitigation the device does not
 * have. research/ is excluded: it is a dated record of what was found,
 * including these files' absence.
 *
 * Deliberately NOT checked: whether a document is any good, or current. A tool
 * cannot see that. What it can see is the mechanical half, which is the half
 * that keeps failing.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const DOCS = join(ROOT, 'docs')
const REGISTRY = join(ROOT, 'apps/web/lib/docs.ts')
const README = join(ROOT, 'README.md')

const onDisk = readdirSync(DOCS)
  .filter((name) => name.endsWith('.md'))
  .map((name) => `docs/${name}`)
  .sort()

if (onDisk.length === 0) {
  console.error('check-docs-reachable: docs/ holds no markdown, so this check is blind.')
  process.exit(1)
}

const registrySource = readFileSync(REGISTRY, 'utf8')
// The `file:` field of each entry. Matched rather than imported because this
// runs as plain Node with no build step, the same as every other check here.
const registered = [...registrySource.matchAll(/file:\s*'([^']+)'/g)].map((match) => match[1])

if (registered.length === 0) {
  console.error(`check-docs-reachable: no documents parsed from ${REGISTRY}, so this is blind.`)
  process.exit(1)
}

const readme = readFileSync(README, 'utf8')

const failures = []

for (const doc of onDisk) {
  if (!registered.includes(doc)) {
    failures.push(
      `  ${doc} is not in apps/web/lib/docs.ts, so it is not on the site and not in the nav`
    )
  }
  // A markdown link to the path. The site is built from these files, so a
  // document the README does not mention is one a reader of the repository
  // reaches only by listing the directory.
  if (!readme.includes(`(${doc})`)) {
    failures.push(`  ${doc} is not linked from README.md`)
  }
}

for (const doc of registered) {
  if (!existsSync(join(ROOT, doc))) {
    failures.push(`  apps/web/lib/docs.ts registers ${doc}, which does not exist`)
  }
}

// Rule 4. Tracked files only, through git, so build output and worktrees are
// not read. Document names are upper case by this repository's convention, so
// that is what is matched; write a placeholder in lower case, as docs/<name>.md.
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0')
  .filter((file) => file !== '' && !file.startsWith('research/'))
  .filter((file) => file !== 'tools/checks/check-docs-reachable.mjs')
  .filter((file) => /\.(md|ts|tsx|mjs|js|yaml|yml|sh|json)$|^Makefile$/.test(file))
const cited = new Map()
for (const file of tracked) {
  let text
  try {
    text = readFileSync(join(ROOT, file), 'utf8')
  } catch {
    continue
  }
  for (const match of text.matchAll(/docs\/([A-Z][A-Z0-9-]+)\.md/g)) {
    const doc = `docs/${match[1] ?? ''}.md`
    if (existsSync(join(ROOT, doc))) continue
    cited.set(doc, [...(cited.get(doc) ?? []), file])
  }
}
for (const [doc, files] of cited) {
  const where = [...new Set(files)]
  failures.push(
    `  ${doc} does not exist and is cited by ${String(where.length)} file(s): ${where
      .slice(0, 4)
      .join(', ')}${where.length > 4 ? ', ...' : ''}`
  )
}

if (failures.length > 0) {
  console.error('check-docs-reachable: a document nobody can find is not a published document.\n')
  for (const failure of failures) console.error(failure)
  console.error(
    '\n  This has happened twice with the same two files. They built, the sitemap\n' +
      '  listed them, and the only route in was to type the URL. Register the\n' +
      '  document in apps/web/lib/docs.ts and link it from the README table.\n'
  )
  process.exit(1)
}

console.log(
  `check-docs-reachable: ${String(onDisk.length)} document(s), all registered on the site ` +
    `and linked from the README`
)
