#!/usr/bin/env node
/**
 * No page may scroll sideways on a phone.
 *
 * This exists because the failure is invisible to every other check. A flex item
 * does not shrink below its content by default, so one nowrap element or one wide
 * table can push the whole document wider than the viewport while the build stays
 * green, the types check, and the page looks perfect on a laptop. The reader on a
 * phone gets a page with the right-hand third cut off.
 *
 * It drives a real browser and measures the real layout, because the only way to
 * know a box fits is to lay it out. It talks to Chrome over the DevTools Protocol
 * using Node's built-in WebSocket, so it adds no dependency to a project that
 * counts them.
 *
 * Run: node tools/check-responsive.mjs
 * Needs: a built site (make web-build) and Chrome. Set CHROME_PATH to override.
 */

import { spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT = join(ROOT, 'apps/web/out')

// 320px is the narrowest phone still in real use; 390px is a current iPhone.
const WIDTHS = [320, 390]
const PORT = 8911

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean)

const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p))
if (chromePath === undefined) {
  console.error('check-responsive: no Chrome found. Set CHROME_PATH.')
  process.exit(1)
}
if (!existsSync(OUT)) {
  console.error('check-responsive: no build output at apps/web/out. Run "make web-build" first.')
  process.exit(1)
}

// --- a tiny static server over the exported site ---------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
}

const server = createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0]
  let file = join(OUT, url === '/' ? 'index.html' : decodeURIComponent(url))
  if (!file.startsWith(OUT)) {
    res.writeHead(403).end()
    return
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
  if (!existsSync(file) && existsSync(`${file}.html`)) file = `${file}.html`
  readFile(file).then(
    (body) => {
      const ext = file.slice(file.lastIndexOf('.'))
      res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' }).end(body)
    },
    () => {
      res.writeHead(404).end('not found')
    }
  )
})

function htmlPages(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) htmlPages(full, found)
    else if (name.endsWith('.html')) found.push(`/${relative(OUT, full)}`)
  }
  return found
}

/**
 * Runs in the page. Returns two different failures.
 *
 * ONE: the document itself scrolls sideways. A flex item does not shrink below
 * its content by default, so one nowrap element pushes the whole page wider
 * than the phone and the right-hand third is cut off.
 *
 * TWO: a link sits outside the viewport. This is the failure the first measure
 * cannot see, and it shipped: the header nav was a horizontal scroller, so the
 * DOCUMENT fitted perfectly while two of the six links were off the right edge
 * of a 320px screen with nothing on screen suggesting a sideways swipe. Wide
 * code blocks and wide tables are read by scrolling and are fine. A link is
 * not read, it is found, and one nobody can see is one nobody follows.
 */
const MEASURE = `(() => {
  const vw = document.documentElement.clientWidth
  const offenders = []
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    if (r.right <= vw + 1 && r.left >= -1) continue
    // Report only the outermost offender in a chain: a wide parent makes every
    // child look wide, and the parent is the one worth fixing.
    if (offenders.some((o) => o.el.contains(el))) continue
    offenders.push({
      el,
      tag: el.tagName.toLowerCase(),
      cls: (el.getAttribute('class') || '').slice(0, 90),
      left: Math.round(r.left),
      right: Math.round(r.right),
      text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 50),
    })
  }

  const hidden = []
  for (const el of document.querySelectorAll('a[href], button')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    // Fully inside, with a pixel of slack for subpixel layout.
    if (r.left >= -1 && r.right <= vw + 1) continue
    hidden.push({
      tag: el.tagName.toLowerCase(),
      href: el.getAttribute('href') || '',
      left: Math.round(r.left),
      right: Math.round(r.right),
      text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40),
    })
  }

  return JSON.stringify({
    viewport: vw,
    scrollWidth: document.documentElement.scrollWidth,
    offenders: offenders.map(({ el, ...rest }) => rest).slice(0, 8),
    hidden: hidden.slice(0, 8),
  })
})()`

async function cdp(ws, id, method, params = {}) {
  return new Promise((resolve, reject) => {
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  await new Promise((resolve) => server.listen(PORT, resolve))
  const pages = htmlPages(OUT).filter((p) => !p.includes('_not-found'))

  const chrome = spawn(
    chromePath,
    [
      '--headless',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      // CI runners execute as a user without the kernel namespaces Chrome's
      // sandbox needs, and Chrome exits before opening the debugging port. The
      // page being driven is a local static file from our own build, so the
      // sandbox is not protecting anything here.
      '--no-sandbox',
      // The default /dev/shm in a container is too small and Chrome crashes
      // partway through rendering rather than failing cleanly.
      '--disable-dev-shm-usage',
      '--remote-debugging-port=9223',
      'about:blank',
    ],
    { stdio: 'ignore' }
  )

  let wsUrl
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(150)
    try {
      const res = await fetch('http://127.0.0.1:9223/json/version')
      wsUrl = (await res.json()).webSocketDebuggerUrl
      if (wsUrl) break
    } catch {
      /* still starting */
    }
  }
  if (!wsUrl) throw new Error('check-responsive: Chrome did not expose a debugging endpoint')

  const browserWs = new WebSocket(wsUrl)
  await new Promise((resolve) => browserWs.addEventListener('open', resolve, { once: true }))

  let seq = 0
  const { targetId } = await cdp(browserWs, ++seq, 'Target.createTarget', { url: 'about:blank' })
  const targets = await (await fetch('http://127.0.0.1:9223/json/list')).json()
  const target = targets.find((t) => t.id === targetId)

  const page = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve) => page.addEventListener('open', resolve, { once: true }))

  let failures = 0
  let checked = 0

  for (const width of WIDTHS) {
    await cdp(page, ++seq, 'Emulation.setDeviceMetricsOverride', {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: true,
    })

    for (const path of pages) {
      await cdp(page, ++seq, 'Page.navigate', { url: `http://127.0.0.1:${PORT}${path}` })
      await sleep(350)

      const { result } = await cdp(page, ++seq, 'Runtime.evaluate', {
        expression: MEASURE,
        returnByValue: true,
      })
      const measured = JSON.parse(result.value)
      checked += 1

      if (measured.scrollWidth > measured.viewport + 1) {
        failures += 1
        console.error(
          `${path} at ${width}px: content is ${measured.scrollWidth}px wide, viewport is ${measured.viewport}px`
        )
        for (const o of measured.offenders) {
          console.error(`    <${o.tag} class="${o.cls}">`)
          console.error(`      spans ${o.left}..${o.right}   ${JSON.stringify(o.text)}`)
        }
        console.error(
          '    A flex or grid item will not shrink below its content unless it has min-width:0.\n'
        )
      }

      if (measured.hidden.length > 0) {
        failures += 1
        console.error(`${path} at ${width}px: ${measured.hidden.length} link(s) off screen`)
        for (const h of measured.hidden) {
          console.error(
            `    <${h.tag} href="${h.href}"> spans ${h.left}..${h.right}   ${JSON.stringify(h.text)}`
          )
        }
        console.error(
          '    The page fits, so nothing scrolls and nothing looks wrong. The link is\n' +
            '    simply not on the screen. Wrap the row rather than making it scroll: a\n' +
            '    sideways scroller with no visible edge is a link nobody finds.\n'
        )
      }
    }
  }

  page.close()
  browserWs.close()
  chrome.kill()
  server.close()

  if (failures > 0) {
    console.error(`check-responsive: ${failures} of ${checked} page renders scroll sideways`)
    process.exit(1)
  }
  console.log(`check-responsive: ${checked} page renders fit at ${WIDTHS.join('px and ')}px`)
}

main().catch((err) => {
  console.error(`check-responsive: ${err.message}`)
  process.exit(1)
})
