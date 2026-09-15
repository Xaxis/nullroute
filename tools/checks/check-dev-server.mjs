#!/usr/bin/env node
/**
 * The dev server renders a styled application.
 *
 * This exists because `make dev` served the entire device UI with no stylesheet
 * at all, for as long as the strict CSP had been in packages/ui/index.html.
 * Every screen was structurally correct and visually destroyed: black text on a
 * transparent background, no layout, no colour. `vite dev` injects CSS as inline
 * <style> elements, and `style-src 'self'` blocks them.
 *
 * NOTHING CAUGHT IT. check-device-csp reads the policy and judges it.
 * check-device-ui loads the app in a real browser and asserts it mounts, and it
 * passes because it loads the PRODUCTION build, where Vite emits an external
 * stylesheet the policy allows. Both were looking at the shipped artifact, and
 * the thing that was broken was the one nobody checks and everybody uses.
 *
 * WHAT IT ASSERTS. The dev server serves a document, React mounts a screen, at
 * least one stylesheet is actually applied, the computed body background is not
 * transparent, and the browser reports no CSP violation.
 *
 * The daemon is deliberately NOT started. Without it the app renders its "no
 * daemon" state, which is the correct thing to render and is enough to prove the
 * shell, the bundle and the styles are alive. Screens past that are the screen
 * gallery's job (make screen-fit).
 *
 * Run: node tools/checks/check-dev-server.mjs
 * Needs: Chrome, and an installed workspace.
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromeBinary, chromeProfile, finish, reap, waitForDebugEndpoint } from '../lib/browser.mjs'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

// Not 5180. A developer running `make dev` in another terminal is the normal
// case, and a check that refuses to run because of it would get switched off.
const UI_PORT = 5187
const DEBUG_PORT = 9414

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Runs in the page.
 *
 * `document.styleSheets.length` is the assertion that matters. A blocked inline
 * <style> leaves the element in the DOM and contributes no sheet, so counting
 * <style> tags would have reported everything as fine.
 */
const MEASURE = `(() => {
  const body = getComputedStyle(document.body)
  return JSON.stringify({
    sheets: document.styleSheets.length,
    rules: [...document.styleSheets].reduce((n, s) => {
      try {
        return n + s.cssRules.length
      } catch {
        return n
      }
    }, 0),
    background: body.backgroundColor,
    color: body.color,
    mounted: document.querySelector('.nr-screen') !== null,
    text: (document.body.textContent || '').trim().length,
  })
})()`

async function cdp(ws, method, params, state) {
  const id = (state.seq += 1)
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.id !== id) return
      ws.removeEventListener('message', onMessage)
      if (message.error) reject(new Error(`${method}: ${message.error.message}`))
      else resolve(message.result)
    }
    ws.addEventListener('message', onMessage)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

let vite
let chrome

/**
 * Kill vite and Chrome. See tools/lib/browser.mjs for why this is not a polite
 * SIGTERM: this file is where that hang was first diagnosed, and the other five
 * browser checks turned out to have the same shape.
 */
function stop() {
  reap(vite, chrome)
}

async function main() {
  vite = spawn('npx', ['vite', '--port', String(UI_PORT), '--strictPort'], {
    cwd: `${ROOT}packages/ui`,
    stdio: 'ignore',
    detached: true,
  })

  let up = false
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(250)
    try {
      const res = await fetch(`http://127.0.0.1:${String(UI_PORT)}/`)
      if (res.ok) {
        up = true
        break
      }
    } catch {
      /* still starting */
    }
  }
  if (!up) throw new Error(`the dev server never answered on port ${String(UI_PORT)}`)

  chrome = spawn(
    chromeBinary('check-dev-server'),
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${String(DEBUG_PORT)}`,
      chromeProfile('check-dev-server'),
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], detached: true }
  )

  const wsUrl = await waitForDebugEndpoint(chrome, DEBUG_PORT)

  const state = { seq: 0 }
  const browser = new WebSocket(wsUrl)
  await new Promise((resolve) => browser.addEventListener('open', resolve, { once: true }))

  const { targetId } = await cdp(browser, 'Target.createTarget', { url: 'about:blank' }, state)
  const targets = await (await fetch(`http://127.0.0.1:${String(DEBUG_PORT)}/json/list`)).json()
  const page = new WebSocket(targets.find((t) => t.id === targetId).webSocketDebuggerUrl)
  await new Promise((resolve) => page.addEventListener('open', resolve, { once: true }))

  const violations = []
  page.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.method !== 'Log.entryAdded') return
    const entry = message.params.entry
    if (entry.source === 'security' || /Content Security Policy/i.test(entry.text)) {
      violations.push(entry.text.split('.')[0])
    }
  })

  await cdp(page, 'Log.enable', {}, state)
  await cdp(
    page,
    'Emulation.setDeviceMetricsOverride',
    { width: 800, height: 480, deviceScaleFactor: 1, mobile: false },
    state
  )
  await cdp(page, 'Page.navigate', { url: `http://127.0.0.1:${String(UI_PORT)}/` }, state)
  await sleep(3000)

  const { result } = await cdp(
    page,
    'Runtime.evaluate',
    { expression: MEASURE, returnByValue: true },
    state
  )
  const measured = JSON.parse(result.value)

  const failures = []
  if (!measured.mounted) failures.push('  React mounted no screen')
  if (measured.text < 100) {
    failures.push(`  the page holds ${String(measured.text)} characters of text`)
  }
  if (measured.sheets === 0) {
    failures.push('  no stylesheet is applied: document.styleSheets is empty')
  }
  if (measured.rules < 50) {
    failures.push(`  only ${String(measured.rules)} CSS rules are live`)
  }
  // The one that names the symptom a person would report.
  if (/^rgba\(0, 0, 0, 0\)$/.test(measured.background)) {
    failures.push(`  the body has no background: ${measured.background}`)
  }
  for (const violation of [...new Set(violations)]) {
    failures.push(`  CSP: ${violation}`)
  }

  page.close()
  browser.close()
  stop()

  if (failures.length > 0) {
    console.error('check-dev-server: the dev server does not render a styled application.\n')
    for (const failure of failures) console.error(failure)
    console.error(
      '\n  `vite dev` injects CSS as inline <style> elements and opens a WebSocket\n' +
        '  for hot reload, and the device policy in packages/ui/index.html blocks\n' +
        '  both. The devCsp plugin in packages/ui/vite.config.ts relaxes exactly\n' +
        '  those two directives for the dev server. If it stopped matching, fix it\n' +
        '  there rather than weakening the policy the device ships with.\n'
    )
    process.exit(1)
  }

  console.log(
    `check-dev-server: the dev server renders a styled application ` +
      `(${String(measured.rules)} CSS rules, background ${measured.background}, no CSP violation)`
  )

  // The verdict is printed and nothing is left to wait for. See tools/lib/browser.mjs.
  finish(0)
}

main().catch((err) => {
  stop()
  console.error(`check-dev-server: ${err.message}`)
  process.exit(1)
})
