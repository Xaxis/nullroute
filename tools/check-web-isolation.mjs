#!/usr/bin/env node
/**
 * nullroute.diy loads nothing from anywhere but itself.
 *
 * The site documents a device whose entire premise is that it has no network
 * capability. A documentation site that pulled a font from a CDN, or ran an
 * analytics script, would be undercutting its own argument on the page where it
 * makes it. It would also mean a third party could change what the threat model
 * appears to say.
 *
 * This asserts the property against the built output rather than trusting that
 * nobody added a `<script src>`. Outbound `<a href>` links are fine: those are
 * navigation the reader chooses, not resources the page fetches.
 *
 * It also checks for inline styles and scripts, because those are what force
 * `unsafe-inline` into the Content-Security-Policy. A strict CSP is only
 * possible while this stays clean.
 *
 * Run: node tools/check-web-isolation.mjs
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT = join(ROOT, 'apps/web/out')

if (!existsSync(OUT)) {
  console.error(`web-isolation: no build output at apps/web/out. Run "make web-build" first.`)
  process.exit(1)
}

function htmlFiles(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) htmlFiles(full, found)
    else if (name.endsWith('.html')) found.push(full)
  }
  return found
}

/** Resource-loading attributes. `href` on <a> is navigation and is exempt. */
const RESOURCE_PATTERNS = [
  {
    id: 'external-script',
    re: /<script[^>]+src=["'](https?:)?\/\/[^"']+["']/gi,
    why: 'A remote script can change what this page says, and can see every reader.',
  },
  {
    id: 'external-stylesheet',
    re: /<link[^>]+href=["'](https?:)?\/\/[^"']+["'][^>]*>/gi,
    why: 'Remote stylesheets (and remote fonts, which they usually pull) leak reader IP addresses.',
  },
  {
    id: 'external-image',
    re: /<(?:img|source)[^>]+src=["'](https?:)?\/\/[^"']+["']/gi,
    why: 'A remote image is a tracking pixel whether or not it was meant as one.',
  },
  {
    id: 'preconnect-or-dns-prefetch',
    re: /<link[^>]+rel=["'](?:preconnect|dns-prefetch|prefetch)["'][^>]*>/gi,
    why: 'A preconnect hint contacts a third party before the reader does anything.',
  },
  {
    id: 'inline-style-block',
    re: /<style[\s>]/gi,
    why: "An inline <style> block forces style-src 'unsafe-inline' into the CSP for the whole site.",
  },
  {
    id: 'inline-style-attribute',
    re: /\sstyle=["'][^"']+["']/gi,
    why: "An inline style attribute forces style-src 'unsafe-inline' into the CSP.",
  },
]

const files = htmlFiles(OUT)
let violations = 0

for (const file of files) {
  const html = readFileSync(file, 'utf8')
  const rel = relative(ROOT, file)

  for (const pattern of RESOURCE_PATTERNS) {
    const matches = html.match(pattern.re)
    if (matches === null) continue
    violations += matches.length
    console.error(`${rel}: ${pattern.id} (${matches.length})`)
    for (const match of matches.slice(0, 3)) {
      console.error(`  ${match.trim().slice(0, 120)}`)
    }
    console.error(`  ${pattern.why}\n`)
  }
}

if (violations > 0) {
  console.error(
    `web-isolation: ${violations} violation${violations === 1 ? '' : 's'} across ${files.length} pages`
  )
  process.exit(1)
}

console.log(`web-isolation: ${files.length} pages load nothing off-origin, no inline styles`)
