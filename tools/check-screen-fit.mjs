#!/usr/bin/env node
/**
 * Every device screen fits the panel it ships on.
 *
 * The device has one screen size, 800x480, and it is not negotiable: there is
 * no scrollbar to reach for, no window to resize, and no second monitor. A
 * control that does not fit is a control that does not exist, and this device's
 * entire trust model is that the user reads what is on the display and acts on
 * it.
 *
 * NOTHING ELSE IN THE SUITE CAN SEE THIS. The component tests run in jsdom,
 * which computes no cascade and no box model, so every one of them passes on a
 * screen whose action bar has been pushed off the bottom. check-device-ui.mjs
 * drives a real browser and can only reach the lock screen, because there is no
 * daemon behind it.
 *
 * WHAT IT ASSERTS, per screen:
 *   1. The document does not scroll sideways. There is no way to scroll it.
 *   2. The action bar is fully on screen, vertically. It holds the primary
 *      action and the way out of the screen, and it is fixed to the bottom, so
 *      one too many buttons pushes it off rather than wrapping it.
 *   3. Every button and every link is inside the viewport. A button half off
 *      the right edge is a button nobody presses.
 *   4. With the body scrolled to its end, no control is left under the action
 *      bar. The bar is opaque and fixed, so a button still beneath it there is
 *      not one the user has to scroll to reach, it is one they cannot reach.
 *
 * It renders from tools/screens, a gallery outside packages/ so no fixture is
 * shipped to the device or covered by MANIFEST.lock.
 *
 * Run: node tools/check-screen-fit.mjs
 * Needs: Chrome, and the gallery built (make screens).
 */

import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIST = join(ROOT, 'tools/screens/dist')
// 8931 rather than something in the 9400s. Chrome refuses to connect to a list
// of ports it considers unsafe, and does it by failing the navigation while
// Page.navigate still returns a loaderId and no errorText, so the page comes
// back blank and every diagnostic says the load succeeded.
const PORT = 8931
const DEBUG_PORT = 9413

/** The panel. Not a breakpoint, a fixed piece of hardware. */
const WIDTH = 800
const HEIGHT = 480

const CHROME_CANDIDATES = [
  process.env['CHROME_PATH'],
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean)

const chromePath = CHROME_CANDIDATES.find((path) => existsSync(path))
if (chromePath === undefined) {
  console.error('check-screen-fit: no Chrome found. Set CHROME_PATH.')
  process.exit(1)
}
if (!existsSync(join(DIST, 'index.html'))) {
  console.error('check-screen-fit: the screen gallery is not built. Run "make screens" first.')
  process.exit(1)
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${String(PORT)}`)
  const relative = normalize(url.pathname).replace(/^(\.\.[/\\])+/, '')
  let file = join(DIST, relative)
  if (!file.startsWith(DIST)) {
    response.writeHead(403).end()
    return
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html')
  response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
  response.end(readFileSync(file))
})

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Runs in the page, once the screen has rendered. */
const MEASURE = `(() => {
  const de = document.documentElement
  const vw = de.clientWidth
  const vh = de.clientHeight
  const problems = []

  if (de.scrollWidth > vw + 1) {
    problems.push({
      kind: 'sideways',
      detail: 'the document is ' + de.scrollWidth + 'px wide in a ' + vw + 'px panel',
    })
  }

  const bar = document.querySelector('.nr-screen__actions')
  if (bar === null) {
    problems.push({ kind: 'no-action-bar', detail: 'this screen has no action bar at all' })
  } else {
    const r = bar.getBoundingClientRect()
    if (r.bottom > vh + 1 || r.top < -1) {
      problems.push({
        kind: 'action-bar-off-screen',
        detail: 'the action bar spans ' + Math.round(r.top) + '..' + Math.round(r.bottom) +
          ' in a ' + vh + 'px panel',
      })
    }
    if (bar.scrollWidth > bar.clientWidth + 1) {
      problems.push({
        kind: 'action-bar-overflows',
        detail: 'the action bar needs ' + bar.scrollWidth + 'px and has ' + bar.clientWidth + 'px',
      })
    }
  }

  /**
   * Whether an element is actually on the screen, rather than merely laid out.
   *
   * A closed <details> keeps its contents in the layout tree with a stale box:
   * Chrome hides them with content-visibility rather than display:none, so
   * getBoundingClientRect returns coordinates for something nobody can see.
   * Measuring those reported the import screen's hidden textarea as buried
   * under the action bar, which it was not, because it was not anywhere.
   */
  const visible = (el) =>
    typeof el.checkVisibility === 'function'
      ? el.checkVisibility({
          contentVisibilityAuto: true,
          opacityProperty: true,
          visibilityProperty: true,
        })
      : true

  const label = (el) =>
    (el.textContent || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '')
      .trim()
      .slice(0, 40)

  for (const el of document.querySelectorAll('button, a[href], input, textarea')) {
    if (!visible(el)) continue
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    // Inside a scroll container is fine: a long address list is meant to
    // scroll. Outside the panel entirely is not.
    if (r.left >= -1 && r.right <= vw + 1) continue
    problems.push({
      kind: 'control-off-screen',
      detail: '<' + el.tagName.toLowerCase() + '> "' + label(el) +
        '" spans ' + Math.round(r.left) + '..' + Math.round(r.right),
    })
  }

  // The body is scrolled to its end before this runs, so anything still under
  // the action bar is under it permanently. The bar is opaque and fixed, so
  // that is not a control the user has to scroll to reach, it is one they
  // cannot reach at all.
  const body = document.querySelector('.nr-screen__body')
  if (bar !== null && body !== null) {
    const barTop = bar.getBoundingClientRect().top
    for (const el of body.querySelectorAll('button, a[href], input, textarea')) {
      if (!visible(el)) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) continue
      // Half or more of it hidden. A row whose last pixel row is covered is
      // legible; one cut through the middle is not, and one entirely beneath
      // the bar does not exist.
      if (r.top + r.height / 2 <= barTop) continue
      problems.push({
        kind: 'buried-under-action-bar',
        detail: '<' + el.tagName.toLowerCase() + '> "' + label(el) +
          '" sits at ' + Math.round(r.top) + '..' + Math.round(r.bottom) +
          ' with the bar starting at ' + Math.round(barTop) +
          ', and the body is already scrolled to the end',
      })
    }
  }

  return JSON.stringify({ problems: problems.slice(0, 10) })
})()`

/** Scroll the body to its end, so the last control is measured where it lands. */
const SCROLL_TO_END = `(() => {
  const body = document.querySelector('.nr-screen__body')
  if (body === null) return false
  body.scrollTop = body.scrollHeight
  return true
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

async function main() {
  await new Promise((resolve) => {
    server.listen(PORT, resolve)
  })

  const chrome = spawn(
    chromePath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${String(DEBUG_PORT)}`,
      'about:blank',
    ],
    { stdio: 'ignore' }
  )

  let wsUrl
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(150)
    try {
      const res = await fetch(`http://127.0.0.1:${String(DEBUG_PORT)}/json/version`)
      wsUrl = (await res.json()).webSocketDebuggerUrl
      if (wsUrl) break
    } catch {
      /* still starting */
    }
  }
  if (!wsUrl) throw new Error('Chrome did not expose a debugging endpoint')

  const state = { seq: 0 }
  const browser = new WebSocket(wsUrl)
  await new Promise((resolve) => browser.addEventListener('open', resolve, { once: true }))

  const { targetId } = await cdp(browser, 'Target.createTarget', { url: 'about:blank' }, state)
  const targets = await (await fetch(`http://127.0.0.1:${String(DEBUG_PORT)}/json/list`)).json()
  const page = new WebSocket(targets.find((t) => t.id === targetId).webSocketDebuggerUrl)
  await new Promise((resolve) => page.addEventListener('open', resolve, { once: true }))

  await cdp(
    page,
    'Emulation.setDeviceMetricsOverride',
    { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false },
    state
  )

  // The gallery publishes its own list, so this file cannot drift out of date
  // by holding a stale copy of the screen names.
  await cdp(page, 'Page.navigate', { url: `http://127.0.0.1:${String(PORT)}/` }, state)
  await sleep(1200)
  const listed = await cdp(
    page,
    'Runtime.evaluate',
    { expression: 'JSON.stringify(window.NULLROUTE_SCREENS ?? [])', returnByValue: true },
    state
  )
  const screens = JSON.parse(listed.result.value)
  if (screens.length === 0) {
    throw new Error('the gallery listed no screens, so this check is blind')
  }

  let failed = 0
  for (const { name, reach } of screens) {
    const label = reach.length === 0 ? name : `${name} after ${reach.join(' then ')}`

    await cdp(
      page,
      'Page.navigate',
      { url: `http://127.0.0.1:${String(PORT)}/?screen=${name}` },
      state
    )
    await sleep(700)

    // Tapped in order, and a testid that no longer exists fails rather than
    // being skipped: a reach list that quietly stopped reaching anywhere would
    // report every state as fitting while measuring only the first.
    let unreachable = null
    for (const testId of reach) {
      const clicked = await cdp(
        page,
        'Runtime.evaluate',
        {
          expression: `(() => {
            const el = document.querySelector('[data-testid="${testId}"]')
            if (el === null) return false
            el.click()
            return true
          })()`,
          returnByValue: true,
        },
        state
      )
      if (clicked.result.value !== true) {
        unreachable = testId
        break
      }
      await sleep(250)
    }

    if (unreachable !== null) {
      failed += 1
      console.error(`\n${label}:`)
      console.error(`    unreachable: no element with data-testid="${unreachable}"`)
      continue
    }

    await cdp(page, 'Runtime.evaluate', { expression: SCROLL_TO_END }, state)
    await sleep(150)

    const { result } = await cdp(
      page,
      'Runtime.evaluate',
      { expression: MEASURE, returnByValue: true },
      state
    )
    const { problems } = JSON.parse(result.value)

    if (problems.length > 0) {
      failed += 1
      console.error(`\n${label} does not fit ${String(WIDTH)}x${String(HEIGHT)}:`)
      for (const problem of problems) {
        console.error(`    ${problem.kind}: ${problem.detail}`)
      }
    }
  }

  page.close()
  browser.close()
  chrome.kill()
  server.close()

  if (failed > 0) {
    console.error(
      `\ncheck-screen-fit: ${String(failed)} of ${String(screens.length)} screen states failed.\n\n` +
        `  A state that does not fit: the device has one screen and no way to\n` +
        `  scroll the document or resize the window, so a control that does not\n` +
        `  fit is a control that does not exist, and a warning under a fixed\n` +
        `  action bar is a warning nobody reads. Move destinations into the body\n` +
        `  rather than adding a button.\n\n` +
        `  A state reported unreachable: the tap list in tools/screens/gallery.tsx\n` +
        `  names a testid that is gone. Point it at the new one, or drop it, but\n` +
        `  do not leave it: a reach list that reaches nowhere reports every state\n` +
        `  as fitting while measuring only the first.\n`
    )
    process.exit(1)
  }
  console.log(
    `check-screen-fit: ${String(screens.length)} screen states fit ` +
      `${String(WIDTH)}x${String(HEIGHT)}`
  )
}

main().catch((err) => {
  console.error(`check-screen-fit: ${err.message}`)
  process.exit(1)
})
