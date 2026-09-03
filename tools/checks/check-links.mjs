#!/usr/bin/env node
/**
 * Every internal link resolves, and every anchor exists on its target.
 *
 * Paths, not just files. A threat model that sends a reader to
 * `docs/VERIFICATION.md#reproducing-the-build` has to land on that section, or
 * the reader concludes the procedure does not exist. In a repository where the
 * documentation is a deliverable and a reader may be deciding whether to trust
 * the device with money, a dangling reference is a defect rather than a typo.
 *
 * Checks:
 *   - relative links between markdown files resolve to a real file
 *   - `#anchors` correspond to a heading actually present in the target
 *   - links to source paths (packages/..., tools/..., spec/...) point at
 *     something that exists, since specs and docs both cite code by path
 *
 * External links are NOT checked: that would need the network, and this must
 * run offline in the same places everything else does.
 *
 * Run: node tools/checks/check-links.mjs
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.next',
  '.next-dev',
  '.vercel',
  'out',
  '.git',
  'vectors',
  'interop',
])

function markdownFiles(dir, found = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) markdownFiles(full, found)
    else if (name.endsWith('.md')) found.push(full)
  }
  return found
}

/** GitHub's heading-to-anchor slug, which is what the site's rehype-slug matches. */
function slug(text) {
  return (
    text
      .trim()
      .toLowerCase()
      .replace(/[`*_~]/g, '')
      // Strip a markdown link wrapper, keeping the visible text.
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
  )
}

function headingsOf(file) {
  const found = new Set()
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
    if (match?.[2] !== undefined) found.add(slug(match[2]))
  }
  return found
}

const files = markdownFiles(ROOT)
const headingCache = new Map()

function headings(file) {
  let cached = headingCache.get(file)
  if (cached === undefined) {
    cached = headingsOf(file)
    headingCache.set(file, cached)
  }
  return cached
}

let problems = 0

for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const rel = relative(ROOT, file)
  const lines = text.split('\n')

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    // Skip fenced code, where a link-shaped string is usually an example.
    for (const match of line.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = match[1]
      if (target === undefined) continue
      if (/^(https?:|mailto:|tel:)/.test(target)) continue

      const [pathPart, anchor] = target.split('#')

      // A bare anchor refers to this file.
      if (pathPart === '' || pathPart === undefined) {
        if (anchor !== undefined && !headings(file).has(anchor)) {
          problems += 1
          console.error(`${rel}:${i + 1}  no heading "#${anchor}" in this file`)
        }
        continue
      }

      const resolved = resolve(dirname(file), pathPart)
      if (!existsSync(resolved)) {
        problems += 1
        console.error(`${rel}:${i + 1}  broken link: ${pathPart}`)
        console.error(`    resolved to ${relative(ROOT, resolved)}`)
        continue
      }

      if (anchor !== undefined && resolved.endsWith('.md')) {
        if (!headings(resolved).has(anchor)) {
          problems += 1
          console.error(`${rel}:${i + 1}  ${pathPart} exists but has no heading "#${anchor}"`)
        }
      }
    }
  }
}

if (problems > 0) {
  console.error(`\ncheck-links: ${problems} broken reference${problems === 1 ? '' : 's'}`)
  process.exit(1)
}

console.log(`check-links: every internal link and anchor in ${files.length} files resolves`)
