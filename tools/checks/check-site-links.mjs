#!/usr/bin/env node
/**
 * Every link on the BUILT site points at something that exists.
 *
 * WHY THIS IS NOT check-links. That one reads the markdown in the repository
 * and answers "does `../README.md#what-you-need` name a real file and a real
 * heading". It does, and it always did. The site then rewrites that link into
 * `/docs/readme`, which is not a page, and the reader gets a 404. The
 * repository link was valid, the published link was not, and each check was
 * right about the half it could see. Three links shipped that way: two to
 * `/docs/readme` on the install page and one to `/docs/security` on the
 * verification page.
 *
 * So this reads the output rather than the input. It is the only check that
 * sees what a visitor sees.
 *
 * TWO KINDS OF TARGET, and the second is the one that rots quietly:
 *
 *   1. A route. `/docs/using` must have been exported.
 *   2. A fragment. `#reproducing-the-build` must be an id on the page it lands
 *      on. Headings get their ids from rehype-slug, and the on-this-page
 *      contents build their hrefs from a slug function written by hand in
 *      markdown.ts. Two slug algorithms over the same headings agree until a
 *      heading contains something they disagree about, and then a contents
 *      entry silently goes nowhere.
 *
 * External links are not fetched. That needs the network, and nothing here may
 * depend on one.
 *
 * Run: node tools/checks/check-site-links.mjs
 * Needs: a built site (make web-build).
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const OUT = join(ROOT, 'apps/web/out')

if (!existsSync(OUT)) {
  console.error('check-site-links: no build output at apps/web/out. Run "make web-build" first.')
  process.exit(1)
}

function htmlPages(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) htmlPages(full, found)
    else if (name.endsWith('.html')) found.push(full)
  }
  return found
}

/** The route a built file answers to, so a link can be matched against it. */
function routeOf(file) {
  const rel = `/${relative(OUT, file)}`
  if (rel === '/index.html') return '/'
  if (rel.endsWith('/index.html')) return rel.slice(0, -'/index.html'.length)
  return rel.slice(0, -'.html'.length)
}

const pages = htmlPages(OUT)
const routes = new Map(pages.map((f) => [routeOf(f), f]))

/** Every id and name a page offers as a fragment target. */
function anchorsOf(file) {
  const html = readFileSync(file, 'utf8')
  const found = new Set()
  for (const m of html.matchAll(/\sid="([^"]+)"/g)) found.add(m[1])
  for (const m of html.matchAll(/<a[^>]*\sname="([^"]+)"/g)) found.add(m[1])
  return found
}

const anchors = new Map()
for (const file of pages) anchors.set(file, anchorsOf(file))

let problems = 0
let checked = 0

for (const file of pages) {
  const html = readFileSync(file, 'utf8')
  const from = routeOf(file)
  const seen = new Set()

  for (const m of html.matchAll(/href="([^"]+)"/g)) {
    const href = m[1]
    if (seen.has(href)) continue
    seen.add(href)

    // Off-site, or a scheme this check has no opinion about.
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue
    // Build output: hashed asset paths, verified by the build itself.
    if (href.startsWith('/_next/') || href.startsWith('/icon.svg')) continue

    checked += 1

    const hash = href.indexOf('#')
    const path = hash === -1 ? href : href.slice(0, hash)
    const fragment = hash === -1 ? '' : decodeURIComponent(href.slice(hash + 1))

    // A bare fragment addresses the page it is on.
    const target = path === '' ? from : path

    if (!target.startsWith('/')) {
      console.error(`${from}: relative link "${href}" survived into the build`)
      console.error(`    A link in a page is resolved against the URL, not the file. Make it`)
      console.error(`    absolute, or rewrite it where the markdown is rendered.\n`)
      problems += 1
      continue
    }

    let targetFile = routes.get(target) ?? routes.get(target.replace(/\/$/, ''))

    /*
     * A STATIC FILE IS A VALID TARGET TOO. This check knew about pages and
     * nothing else, which was fine while every internal link went to one. Next
     * emits `<link rel="preload" href="/device/lock.png">` for the screenshots
     * on the home page, and six real files that ship in the build were reported
     * as routes the site does not publish. A check that cries wolf about
     * correct output gets ignored the day it is right.
     */
    if (targetFile === undefined) {
      const asset = join(OUT, target.slice(1))
      if (existsSync(asset) && statSync(asset).isFile()) {
        // Assets have no anchors, so there is nothing further to check.
        continue
      }
    }

    if (targetFile === undefined) {
      console.error(`${from}: "${href}" goes to ${target}, which the site does not publish`)
      const near = [...routes.keys()].filter((r) => r.startsWith('/docs/')).join(', ')
      console.error(`    Published routes under /docs: ${near}\n`)
      problems += 1
      continue
    }

    if (fragment !== '' && !(anchors.get(targetFile) ?? new Set()).has(fragment)) {
      console.error(`${from}: "${href}" lands on ${target}, which has no #${fragment}`)
      console.error(
        `    Heading ids come from rehype-slug and contents links from the slug\n` +
          `    function in markdown.ts. When those two disagree the link is silently\n` +
          `    dead, which is what this line is telling you.\n`
      )
      problems += 1
    }
  }
}

if (problems > 0) {
  console.error(
    `check-site-links: ${String(problems)} broken link(s) across ${String(pages.length)} built pages`
  )
  process.exit(1)
}

console.log(
  `check-site-links: ${String(checked)} internal link(s) across ${String(pages.length)} built pages all resolve`
)
