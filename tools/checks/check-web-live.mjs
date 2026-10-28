#!/usr/bin/env node
/**
 * Load the DEPLOYED site in a real browser and assert nothing is broken.
 *
 * This exists because of a failure that every other check missed. The
 * Content-Security-Policy pins the sha256 of Next's inline bootstrap scripts.
 * When those hashes did not match the served bytes, the result was:
 *
 *   - HTTP 200 on every page
 *   - correct, complete HTML, indistinguishable to curl or a crawler
 *   - a page that looked perfect in a screenshot
 *   - hydration dead, with React error #412 in the console
 *
 * The build passed, the types passed, the tests passed, the static isolation
 * check passed, and the responsive check passed. Only opening the real
 * deployed URL in a real browser and reading the console found it.
 *
 * AND IT ALSO ASKS WHETHER THE DEPLOYED SITE IS THE SITE WE BUILT, which is a
 * different question and was the one nobody was asking. nullroute.diy served a
 * three week old page: the home page had been cut from 6,568 pixels to 3,605,
 * the dead links had been fixed, and none of it was live, because `make deploy`
 * had not been run and nothing anywhere compared the two. Every check in this
 * file passed against that stale page, because a stale page renders perfectly.
 *
 * The comparison is byte-for-byte and can be, because `vercel deploy
 * --prebuilt` ships exactly the bytes in apps/web/out. Anything less exact
 * would be a check that tolerates the drift it exists to find.
 *
 * Uses Chrome over the DevTools Protocol via Node's built-in WebSocket, so it
 * adds no dependency.
 *
 * Run: node tools/checks/check-web-live.mjs [origin]
 * Default origin: https://nullroute-space.vercel.app
 */

import { spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import {
  chromeBinary,
  chromeProfile,
  finish,
  reap,
  waitForDebugEndpoint,
  freePort,
} from '../lib/browser.mjs'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const ORIGIN = process.argv[2] ?? process.env['NULLROUTE_SITE'] ?? 'https://nullroute.diy'

/**
 * A doc page that renders its shell but not its body would still "load", so
 * the body is measured against its own source. A fixed floor of 5,000
 * characters stood here until SECURITY.md was published: it is 2,732 bytes
 * of markdown, so the check failed a page that rendered completely, and the
 * same floor would have passed a long document that rendered a fifth of
 * itself. Rendered text runs shorter than its markdown (link targets, table
 * rules and fences do not show), so half the source is the bar.
 */
const BODY_SHARE = 0.5

/**
 * Every docs section page, with the share of its own source it must render.
 *
 * Each registered file is a chapter and each of its second-level headings a
 * page (apps/web/lib/docbook.ts). A page is matched to its source by its
 * heading: the built page's h1 is the section's heading text, so the section
 * runs from that heading to the next one in the file.
 *
 * MEASURED AGAINST VISIBLE TEXT, NOT RAW MARKDOWN. A section that is mostly
 * links or a table carries link targets and table rules that never render,
 * and against raw bytes a fully rendered references section would fail. Those
 * are stripped before the share is taken.
 *
 * This list was four entries long while the site published six documents, so
 * the two most recent ones were live, unlinked and unchecked. Everything here
 * is read from the registry and the build, never listed by hand. Parsed with
 * regular expressions because this file is plain Node with no build step.
 */
function sectionsOf(markdown) {
  const sections = []
  let fenced = false
  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) fenced = !fenced
    const heading = fenced ? null : /^## (.+)$/.exec(line)
    if (heading !== null) {
      sections.push({ text: plain(heading[1]), body: '' })
      continue
    }
    const current = sections.at(-1)
    if (current !== undefined) current.body += `${line}\n`
  }
  return sections
}

/** Heading text as it renders: links to their text, emphasis and code marks gone. */
function plain(text) {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*`_]/g, '')
    .trim()
}

function visibleLength(markdown) {
  return markdown
    .replace(/\]\([^)]*\)/g, ']')
    .replace(/^\|?[\s:|-]+\|[\s:|-]*$/gm, '')
    .replace(/\s+/g, ' ').length
}

function decode(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .trim()
}

function docPages() {
  const source = readFileSync(join(ROOT, 'apps/web/lib/docs.ts'), 'utf8')
  const chapters = [...source.matchAll(/slug:\s*'([a-z0-9-]+)',\s*file:\s*'([^']+)'/g)]
  if (chapters.length === 0) {
    console.error(
      'check-web-live: no documents parsed from apps/web/lib/docs.ts, so this is blind.'
    )
    process.exit(1)
  }
  const pages = []
  for (const [, slug, file] of chapters) {
    const sections = sectionsOf(readFileSync(join(ROOT, file), 'utf8'))
    const dir = join(OUT, 'docs', slug)
    const built = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.html')) : []
    if (built.length !== sections.length) {
      console.error(
        `check-web-live: ${file} has ${String(sections.length)} sections and the build has ` +
          `${String(built.length)} pages for it. Run "make web-build".`
      )
      process.exit(1)
    }
    for (const name of built) {
      const html = readFileSync(join(dir, name), 'utf8')
      const heading = decode(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? '')
      const section = sections.find((s) => s.text === heading)
      if (section === undefined) {
        console.error(`check-web-live: no section of ${file} is headed "${heading}"`)
        process.exit(1)
      }
      const title = /<title>([^<]*)<\/title>/.exec(html)
      pages.push({
        path: `/docs/${slug}/${name.slice(0, -'.html'.length)}`,
        expect: title ? decode(title[1]) : '(no title in the build)',
        minBody: Math.floor(visibleLength(section.body) * BODY_SHARE),
      })
    }
  }
  return pages
}

const OUT = join(ROOT, 'apps/web/out')

/**
 * Every other page the build wrote, read out of apps/web/out.
 *
 * The same lesson as the document list one level up: the site grew from seven
 * pages to nineteen and this check still opened the home page and the
 * documents, so /check, /profile and the rest went live unchecked. Each page
 * is expected to carry the title its own build gave it; the byte comparison
 * below is what proves it is that build.
 */
function builtPages() {
  if (!existsSync(OUT)) {
    console.error('check-web-live: no apps/web/out. Run "make web-build" first.')
    process.exit(1)
  }
  return (
    readdirSync(OUT, { recursive: true })
      .filter((f) => f.endsWith('.html') && !['404.html', '_not-found.html'].includes(f))
      .map((f) => (f === 'index.html' ? '/' : `/${f.slice(0, -'.html'.length)}`))
      // Section pages are docPages' to check, with a body to measure.
      .filter((path) => !/^\/docs\/[^/]+\/[^/]+$/.test(path))
      .sort()
      .map((path) => {
        const title = /<title>([^<]*)<\/title>/.exec(readFileSync(builtFile(path), 'utf8'))
        return {
          path,
          expect: title ? decode(title[1]) : '(no title in the build)',
        }
      })
  )
}

const PAGES = [...builtPages(), ...docPages()]

/** Where `next build` put the page this path serves. */
function builtFile(path) {
  return path === '/' ? join(OUT, 'index.html') : join(OUT, `${path.slice(1)}.html`)
}

const sha256 = (text) => createHash('sha256').update(text).digest('hex')

const PORT = await freePort()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/*
 * EVERY WAIT HAS AN END. A command whose reply never came waited forever, and
 * one deploy sat in this check for forty minutes with Chrome open and nothing
 * printed. A check that can hang is a check nobody can tell apart from one
 * still working, so each command gets thirty seconds and names itself when it
 * runs out, and the whole run gets a ceiling below.
 */
const COMMAND_MS = 30_000
const RUN_MS = 5 * 60_000

function send(ws, state, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++state.seq
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMessage)
      reject(new Error(`${method} had no reply in ${String(COMMAND_MS / 1000)}s`))
    }, COMMAND_MS)
    const onMessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id !== id) return
      clearTimeout(timer)
      ws.removeEventListener('message', onMessage)
      if (msg.error) reject(new Error(`${method}: ${msg.error.message}`))
      else resolve(msg.result)
    }
    ws.addEventListener('message', onMessage)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

/** The browser, where the watchdog and the failure path can reach it. */
let chrome

async function main() {
  const watchdog = setTimeout(() => {
    console.error(
      `check-web-live: no result after ${String(RUN_MS / 60_000)} minutes, stopping. The ` +
        'deploy itself finished; this is the check that reads it back.'
    )
    reap(chrome)
    process.exit(1)
  }, RUN_MS)
  chrome = spawn(
    chromeBinary('check-web-live'),
    [
      '--headless',
      '--disable-gpu',
      '--no-first-run',
      // See check-responsive.mjs: CI runners lack the namespaces Chrome's
      // sandbox needs, and it exits before opening the debugging port.
      '--no-sandbox',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${PORT}`,
      chromeProfile('check-web-live'),
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )

  const browserWsUrl = await waitForDebugEndpoint(chrome, PORT)

  const state = { seq: 0 }
  const browser = new WebSocket(browserWsUrl)
  await new Promise((r) => browser.addEventListener('open', r, { once: true }))

  const { targetId } = await send(browser, state, 'Target.createTarget', { url: 'about:blank' })
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  const page = new WebSocket(list.find((t) => t.id === targetId).webSocketDebuggerUrl)
  await new Promise((r) => page.addEventListener('open', r, { once: true }))

  let problems = []
  page.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.method === 'Log.entryAdded') {
      const entry = msg.params.entry
      if (entry.level === 'error' || /Content Security Policy|Refused to/i.test(entry.text)) {
        problems.push(`[${entry.source}] ${entry.text}`)
      }
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails
      problems.push(`[exception] ${d.exception?.description ?? d.text}`)
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      problems.push(
        `[console] ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`
      )
    }
  })

  await send(page, state, 'Log.enable')
  await send(page, state, 'Runtime.enable')
  await send(page, state, 'Page.enable')

  let failures = 0

  for (const { path, expect, minBody } of PAGES) {
    problems = []
    await send(page, state, 'Page.navigate', { url: `${ORIGIN}${path}` })
    await sleep(2500)

    const { result } = await send(page, state, 'Runtime.evaluate', {
      expression: `JSON.stringify({
        title: document.title,
        h1: (document.querySelector('h1') || {}).textContent || '',
        chars: document.body.innerText.length,
        body: (document.querySelector('.prose-doc') || { innerText: '' }).innerText.length
      })`,
      returnByValue: true,
    })
    const info = JSON.parse(result.value)

    const issues = []

    /*
     * IS THIS THE PAGE WE BUILT. Fetched raw rather than read out of the
     * browser, because innerHTML is the DOM after parsing and hydration and
     * this has to compare the bytes that were served.
     */
    const local = builtFile(path)
    if (!existsSync(local)) {
      issues.push(`no local build at ${local.replace(ROOT, '')}. Run "make web-build" first.`)
    } else {
      let served
      try {
        served = await (await fetch(`${ORIGIN}${path}`)).text()
      } catch (err) {
        served = null
        issues.push(`could not fetch it: ${err instanceof Error ? err.message : String(err)}`)
      }
      if (served !== null) {
        const expected = readFileSync(local, 'utf8')
        if (sha256(served) !== sha256(expected)) {
          issues.push(
            `the deployed page is not the built page: served ${String(served.length)} bytes ` +
              `hashing ${sha256(served).slice(0, 12)}, built ${String(expected.length)} bytes ` +
              `hashing ${sha256(expected).slice(0, 12)}. Run "make deploy".`
          )
        }
      }
    }

    if (!info.h1.includes(expect) && !info.title.includes(expect)) {
      issues.push(`expected "${expect}" in the heading or title, got h1="${info.h1}"`)
    }
    if (minBody !== undefined && info.body < minBody) {
      issues.push(
        `the document body is ${String(info.body)} characters against a source that needs ` +
          `${String(minBody)}: it did not render`
      )
    }
    issues.push(...problems)

    if (issues.length > 0) {
      failures += 1
      console.error(`${ORIGIN}${path}`)
      for (const issue of issues) console.error(`    ${issue.slice(0, 200)}`)
      console.error('')
    } else {
      const body =
        minBody === undefined ? '' : `, body ${String(info.body)} of ${String(minBody)} needed`
      console.log(`  ok  ${path}  (${info.chars} chars${body}, no console errors)`)
    }
  }

  clearTimeout(watchdog)
  page.close()
  browser.close()
  reap(chrome)

  if (failures > 0) {
    console.error(`check-web-live: ${failures} of ${PAGES.length} pages are broken at ${ORIGIN}`)
    process.exit(1)
  }
  console.log(
    `check-web-live: ${PAGES.length} pages render clean at ${ORIGIN}, ` +
      `and every one is byte-identical to the local build`
  )
  // The verdict is printed and nothing is left to wait for. See tools/lib/reap.mjs.
  finish(0)
}

main().catch((err) => {
  console.error(`check-web-live: ${err.message}`)
  // Chrome goes with the failure, or it outlives the check holding its port.
  if (chrome !== undefined) reap(chrome)
  process.exit(1)
})
