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
 *   5. Every control is big enough to hit with a finger, and far enough from
 *      its neighbours. This is a touchscreen with no cursor, no hover and no
 *      keyboard, so a 20px target is not merely awkward, it is a mis-tap next
 *      to a button that erases a wallet.
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

/**
 * The smallest a control may be, in CSS pixels.
 *
 * 44 is WCAG 2.2's target size (2.5.8 at AA is 24, 2.5.5 at AAA is 44). The
 * higher number is the right one here and not because of the certificate: this
 * is a 7 inch panel operated by a finger, with no cursor, no hover and no
 * keyboard, and the mis-tap lands on whatever is beside it. On several of these
 * screens what is beside it erases a wallet.
 *
 * Measured on the border box, so padding counts and a small label inside a
 * large button passes.
 */
const MIN_TARGET = 44

/**
 * The gap two adjacent controls need, in CSS pixels.
 *
 * Targets that meet the size rule and touch each other still produce mis-taps,
 * because a fingertip is wider than the point the browser reports. Only
 * neighbours are checked: a control far from anything else can be any distance
 * from the rest of the screen.
 */
const MIN_GAP = 6

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
  const MIN_TARGET = ${MIN_TARGET}
  const MIN_GAP = ${MIN_GAP}
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

  /**
   * Whether an element is inside the visible box of every scroll container
   * above it.
   *
   * checkVisibility does not know about clipping. A keyboard key scrolled up
   * under the fixed header still reports a rect, and that rect overlaps the
   * header's own controls, so the adjacency rule fired on two things that are
   * nowhere near each other on screen: one of them was not on screen at all.
   *
   * Half or more of the element has to survive the clip. A row peeking out from
   * under a header is genuinely on screen and genuinely close to whatever is
   * above it.
   */
  const onScreen = (el, r) => {
    let clip = { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth }
    for (let node = el.parentElement; node !== null; node = node.parentElement) {
      const style = getComputedStyle(node)
      const scrolls = /auto|scroll|hidden/.test(style.overflowY + style.overflowX)
      if (!scrolls) continue
      const box = node.getBoundingClientRect()
      clip = {
        top: Math.max(clip.top, box.top),
        bottom: Math.min(clip.bottom, box.bottom),
        left: Math.max(clip.left, box.left),
        right: Math.min(clip.right, box.right),
      }
    }
    const height = Math.min(r.bottom, clip.bottom) - Math.max(r.top, clip.top)
    const width = Math.min(r.right, clip.right) - Math.max(r.left, clip.left)
    return height >= r.height / 2 && width >= r.width / 2
  }

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

  // --- 5. Big enough to hit, and far enough apart ---------------------------
  /**
   * The box a finger has to land in, which is not always the element's own.
   *
   * A checkbox inside a <label> is activated by tapping anywhere in the label,
   * so the 24px box is not the target and measuring it reports a screen as
   * unhittable when it is fine. The seed screen does exactly this on purpose:
   * an 18px checkbox gating an irreversible action would be a control that
   * gets missed, so the whole sentence is the target.
   */
  const hitBox = (el) => {
    if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) {
      const wrapper = el.closest('label')
      if (wrapper !== null) return wrapper.getBoundingClientRect()
    }
    return el.getBoundingClientRect()
  }

  const targets = []
  for (const el of document.querySelectorAll('button, a[href], input, textarea, summary, [role="button"]')) {
    if (!visible(el)) continue
    const r = hitBox(el)
    if (r.width === 0 && r.height === 0) continue
    if (!onScreen(el, r)) continue
    // A field the user types into is sized by its content and is not a target
    // in the same sense: nothing sits beside it to mis-hit.
    const typed = el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type !== 'checkbox')
    targets.push({ el, r, typed, name: label(el) })
  }

  for (const t of targets) {
    if (t.r.height + 0.5 < MIN_TARGET || t.r.width + 0.5 < MIN_TARGET) {
      problems.push({
        kind: 'target-too-small',
        detail: '<' + t.el.tagName.toLowerCase() + '> "' + t.name + '" is ' +
          Math.round(t.r.width) + 'x' + Math.round(t.r.height) +
          ', and a finger needs ' + MIN_TARGET + 'x' + MIN_TARGET,
      })
    }
  }

  // Neighbours only, and each pair once.
  for (let i = 0; i < targets.length; i += 1) {
    for (let j = i + 1; j < targets.length; j += 1) {
      const a = targets[i]
      const b = targets[j]
      if (a.typed && b.typed) continue
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue
      // A checkbox and its own label are one target measured twice.
      if (a.r.width === b.r.width && a.r.height === b.r.height && a.r.left === b.r.left &&
          a.r.top === b.r.top) continue

      // Gap along each axis. A negative value on both means they overlap.
      const dx = Math.max(a.r.left - b.r.right, b.r.left - a.r.right)
      const dy = Math.max(a.r.top - b.r.bottom, b.r.top - a.r.bottom)
      const gap = Math.max(dx, dy)
      if (gap >= MIN_GAP) continue
      // Only when they actually sit beside each other: two controls in
      // different columns and different rows are not confusable.
      const overlapsX = a.r.left < b.r.right && b.r.left < a.r.right
      const overlapsY = a.r.top < b.r.bottom && b.r.top < a.r.bottom
      if (!overlapsX && !overlapsY) continue

      problems.push({
        kind: 'targets-too-close',
        detail: '"' + a.name + '" and "' + b.name + '" are ' + Math.round(Math.max(gap, 0)) +
          'px apart, and adjacent targets need ' + MIN_GAP + 'px',
      })
    }
  }

  return JSON.stringify({ problems: problems.slice(0, 10) })
})()`

/**
 * Scroll everything scrollable to its end, so the last control is measured
 * where it actually lands.
 *
 * Every container, not just the screen body: a list with its own overflow is
 * still a way to reach a control, and only scrolling the body would report the
 * contents of a nested scroller as unreachable when they are one swipe away.
 *
 * Twice, because scrolling one container can change what fits in another.
 *
 * After this, an element still below the action bar is below it permanently:
 * anything reachable by scrolling has been scrolled to.
 */
const SCROLL_TO_END = `(() => {
  for (let pass = 0; pass < 2; pass += 1) {
    for (const el of document.querySelectorAll('*')) {
      if (el.scrollHeight > el.clientHeight) el.scrollTop = el.scrollHeight
    }
  }
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
        `  A target too small or too close: this is a 7 inch panel operated by a\n` +
        `  finger, with no cursor, no hover and no keyboard. The mis-tap lands on\n` +
        `  whatever is beside it, and on several of these screens what is beside\n` +
        `  it erases a wallet. Give it ${String(MIN_TARGET)}px of box and ${String(MIN_GAP)}px of air.\n\n` +
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
