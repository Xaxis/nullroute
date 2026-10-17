#!/usr/bin/env node
/**
 * nullroute.diy loads nothing from anywhere but itself, except one visit counter.
 *
 * The site documents a device whose entire premise is that it has no network
 * capability. A documentation site that pulled a font from a CDN would be
 * undercutting its own argument on the page where it makes it, and every
 * off-origin script is a party that could change what the threat model appears
 * to say.
 *
 * ONE EXCEPTION, decided by the owner: Overlook, the owner's own cookieless
 * visit counter (VISIT_COUNTER in apps/web/lib/site.ts), with the cost above
 * accepted. It is held to exactly one script URL and exactly the settings that
 * keep it a visit count, so it cannot quietly grow into link tracking or a
 * second script. The footer says what it collects. The device frontend is a
 * different build under INV-NET-3 and allows nothing like it.
 *
 * This asserts the property against the built output rather than trusting that
 * nobody added a `<script src>`. Outbound `<a href>` links are fine: those are
 * navigation the reader chooses, not resources the page fetches.
 *
 * It also checks for inline styles and scripts, because those are what force
 * `unsafe-inline` into the Content-Security-Policy. A strict CSP is only
 * possible while this stays clean.
 *
 * Run: node tools/checks/check-web-isolation.mjs
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
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

/**
 * The visit counter, written out here rather than imported, so this check is a
 * second statement of what the site may load and not a copy of the first.
 *
 * Every attribute is required with exactly this value. `data-outbound="false"`
 * stops link and download reporting, and `data-vitals="0"` stops it loading a
 * second script for Web Vitals, which the policy does not allow either.
 */
const COUNTER_SRC = 'https://overlook.technology/s.js'
const COUNTER_ATTRS = {
  defer: '',
  src: COUNTER_SRC,
  'data-site': 'ws_5bd4fpcbpb',
  'data-outbound': 'false',
  'data-vitals': '0',
}

function attributes(source) {
  const found = {}
  const re = /([a-z][a-z0-9-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/gi
  for (const m of source.matchAll(re)) {
    found[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? ''
  }
  return found
}

/**
 * Every `<script src>` pointing off-origin is a violation unless it is the
 * counter with exactly its settings, once per page.
 */
function offOriginScripts(html) {
  const problems = []
  let counters = 0
  for (const match of html.matchAll(/<script\b([^>]*)>/gi)) {
    const attrs = attributes(match[1] ?? '')
    if (attrs.src === undefined || !/^(https?:)?\/\//i.test(attrs.src)) continue
    if (attrs.src !== COUNTER_SRC) {
      problems.push(`${match[0].slice(0, 120)}: not the visit counter`)
      continue
    }
    counters += 1
    const wrong = Object.entries(COUNTER_ATTRS).filter(([name, value]) => attrs[name] !== value)
    const extra = Object.keys(attrs).filter((name) => !(name in COUNTER_ATTRS))
    if (wrong.length > 0 || extra.length > 0) {
      problems.push(
        `${match[0].slice(0, 160)}: the visit counter must carry exactly ` +
          Object.entries(COUNTER_ATTRS)
            .map(([name, value]) => (value === '' ? name : `${name}="${value}"`))
            .join(' ')
      )
    }
  }
  if (counters > 1) problems.push(`the visit counter is loaded ${String(counters)} times`)
  return problems
}

/** Resource-loading attributes. `href` on <a> is navigation and is exempt. */
const RESOURCE_PATTERNS = [
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

  const scripts = offOriginScripts(html)
  if (scripts.length > 0) {
    violations += scripts.length
    console.error(`${rel}: external-script (${scripts.length})`)
    for (const problem of scripts.slice(0, 3)) console.error(`  ${problem}`)
    console.error('  A remote script can change what this page says, and can see every reader.\n')
  }

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

console.log(
  `web-isolation: ${files.length} pages load nothing off-origin but the visit counter, ` +
    'with its settings, and no inline styles'
)
