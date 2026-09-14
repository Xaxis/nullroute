#!/usr/bin/env node
/**
 * The manifest root the website publishes is the one this tree computes.
 *
 * The home page quotes the root hash out of verification-report.json rather
 * than describing it, which is the whole point of the page: a reader compares
 * the number on nullroute.diy with the number their own checkout produces and
 * with the number the device prints on its lock screen. A page that quotes a
 * stale root is not a cosmetic problem. It invites a reader to conclude their
 * checkout has been tampered with, or worse, to accept a device whose root
 * does not match because the site told them a different number was correct.
 *
 * THIS WAS REACHABLE. verification-report.json was declared in the Makefile
 * with no prerequisites, so make rebuilt it only when it did not exist. A
 * workstation that had run `make verify` once kept that report across every
 * later device commit, `make web-build` read it, and the site built quietly
 * around an old hash. The CSP hashes are then generated from that same stale
 * build, so they match it perfectly and `make web-csp` passes. Nothing failed.
 * CI never saw it either, because a fresh checkout has no report and always
 * generates a current one, so this could only ever have shipped from a local
 * `make deploy`, which is how the site is deployed.
 *
 * The report now depends on MANIFEST.lock, which fixes the cause. This checks
 * the property directly, because a dependency is a statement about timestamps
 * and this is a statement about the bytes that are about to be published.
 */

import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const INDEX = join(ROOT, 'apps/web/out/index.html')
const MANIFEST = join(ROOT, 'MANIFEST.lock')

if (!existsSync(INDEX)) {
  console.error('check-site-root: no build at apps/web/out. Run "make web-build" first.')
  process.exit(1)
}

const root = createHash('sha256').update(readFileSync(MANIFEST)).digest('hex')
const html = readFileSync(INDEX, 'utf8')

if (!html.includes(root)) {
  const quoted = [...new Set(html.match(/\b[0-9a-f]{64}\b/gu) ?? [])]
  console.error("check-site-root: the built home page does not quote this tree's manifest root.")
  console.error(`  this tree: ${root}`)
  console.error(
    quoted.length === 0
      ? '  the page quotes no 64-character hash at all.'
      : `  the page quotes: ${quoted.join(', ')}`
  )
  console.error('')
  console.error('  verification-report.json is stale, so the site would publish a number a')
  console.error('  reader cannot reproduce. Regenerate it and rebuild:')
  console.error('      make verify && make web-build && node tools/gen-csp.mjs')
  process.exit(1)
}

console.log(
  `check-site-root: the built site quotes ${root.slice(0, 12)}..., this tree's manifest root`
)
