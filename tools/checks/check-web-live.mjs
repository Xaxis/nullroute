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
import { existsSync, readFileSync } from 'node:fs'
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
 * Every document, read out of the registry rather than listed here.
 *
 * This list was four entries long while the site published six documents, so
 * the two most recent ones were live, unlinked and unchecked, and the check
 * reported all pages clean. A hardcoded list of what to check is a list that
 * silently stops covering what exists.
 *
 * Parsed with a regular expression because this file is plain Node with no
 * build step, and the shape it reads is a literal array of string fields.
 */
function docPages() {
  const source = readFileSync(join(ROOT, 'apps/web/lib/docs.ts'), 'utf8')
  const found = [...source.matchAll(/slug:\s*'([a-z0-9-]+)'[\s\S]{0,400}?title:\s*'([^']+)'/g)]
  if (found.length === 0) {
    console.error(
      'check-web-live: no documents parsed from apps/web/lib/docs.ts, so this is blind.'
    )
    process.exit(1)
  }
  return found.map((m) => ({ path: `/docs/${m[1]}`, expect: m[2] }))
}

const PAGES = [{ path: '/', expect: 'Built to be checked' }, ...docPages()]

const OUT = join(ROOT, 'apps/web/out')

/** Where `next build` put the page this path serves. */
function builtFile(path) {
  return path === '/' ? join(OUT, 'index.html') : join(OUT, `${path.slice(1)}.html`)
}

const sha256 = (text) => createHash('sha256').update(text).digest('hex')

/** A doc page that renders its shell but not its body would still "load". */
const MIN_CHARS = 5000

const PORT = await freePort()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function send(ws, state, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++state.seq
    const onMessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id !== id) return
      ws.removeEventListener('message', onMessage)
      if (msg.error) reject(new Error(`${method}: ${msg.error.message}`))
      else resolve(msg.result)
    }
    ws.addEventListener('message', onMessage)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function main() {
  const chrome = spawn(
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

  for (const { path, expect } of PAGES) {
    problems = []
    await send(page, state, 'Page.navigate', { url: `${ORIGIN}${path}` })
    await sleep(2500)

    const { result } = await send(page, state, 'Runtime.evaluate', {
      expression: `JSON.stringify({
        title: document.title,
        h1: (document.querySelector('h1') || {}).textContent || '',
        chars: document.body.innerText.length
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
    if (path.startsWith('/docs') && info.chars < MIN_CHARS) {
      issues.push(`only ${info.chars} characters of text: the document body did not render`)
    }
    issues.push(...problems)

    if (issues.length > 0) {
      failures += 1
      console.error(`${ORIGIN}${path}`)
      for (const issue of issues) console.error(`    ${issue.slice(0, 200)}`)
      console.error('')
    } else {
      console.log(`  ok  ${path}  (${info.chars} chars, no console errors)`)
    }
  }

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
  process.exit(1)
})
