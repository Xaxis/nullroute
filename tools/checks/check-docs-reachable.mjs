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
 *
 * Deliberately NOT checked: whether a document is any good, or current. A tool
 * cannot see that. What it can see is the mechanical half, which is the half
 * that keeps failing.
 */

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
