#!/usr/bin/env node
/**
 * Render real device screens into the website's public directory.
 *
 * WHY SCREENSHOTS AND NOT A DESCRIPTION. docs/USING.md tells a reader what each
 * screen is for, and it renders to 21,181 pixels: about twenty-three laptop
 * screens of continuous prose. Somebody deciding whether this project is worth
 * their evening should be able to see the thing in five seconds. Every one of
 * these images is the actual frontend, laid out by a real browser at the panel's
 * real 800x480, from the same gallery `make screen-fit` and `make contrast`
 * measure. Nothing here is a mockup.
 *
 * WHY THIS IS A GENERATOR AND NOT AN IMPORT. CLAUDE.md is explicit: apps/web
 * must never import from packages/, and device behaviour reaches the site as a
 * static artifact. A PNG is the most static artifact there is.
 *
 * The images are committed, because Vercel builds the site without a browser
 * and a build that silently shipped no screenshots would look fine.
 *
 * Run: node tools/gen-device-shots.mjs [--check]
 * Needs: a built gallery (make screens) and Chrome. Set CHROME_PATH to override.
 */

import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromeProfile, finish, reap, reachStep } from './lib/browser.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const GALLERY = join(ROOT, 'tools/screens/dist')
const OUT = join(ROOT, 'apps/web/public/device')
const PORT = 8917
const DEBUG = 9229
const check = process.argv.includes('--check')

/**
 * The screens the site shows, in the order the argument needs them.
 *
 * SIX, NOT A HUNDRED AND FOUR. The gallery holds every state the checks
 * measure, including a dozen refusals; a landing page that showed all of them
 * would be the wall of prose again in a different medium. These are the ones a
 * stranger needs to understand what the device is: the number it shows before
 * you trust it, where a seed comes from, what it makes you read before signing,
 * and what checking somebody else's proof looks like.
 */
const SCREENS = [
  { name: 'lock-passing', as: 'lock', caption: 'The hash before the PIN' },
  { name: 'dice', as: 'dice', caption: 'A hundred rolls' },
  { name: 'seed', as: 'seed', caption: 'The words, once' },
  { name: 'psbt-review', as: 'review', caption: 'Read before signing' },
  { name: 'receive', as: 'receive', caption: 'An address to check' },
  { name: 'verify-message', as: 'verify', caption: "Somebody else's proof" },
]

const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)
const chromePath = CHROME.find((p) => existsSync(p))
if (chromePath === undefined) {
  console.error('gen-device-shots: no Chrome found. Set CHROME_PATH.')
  process.exit(1)
}
if (!existsSync(GALLERY)) {
  console.error('gen-device-shots: no gallery at tools/screens/dist. Run "make screens" first.')
  process.exit(1)
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
}
const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0] ?? '/'
  let file = join(GALLERY, path)
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(GALLERY, 'index.html')
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const seq = { id: 0 }
function cdp(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = (seq.id += 1)
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
  await new Promise((r) => server.listen(PORT, r))
  mkdirSync(OUT, { recursive: true })

  const chrome = spawn(
    chromePath,
    [
      '--headless',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${String(DEBUG)}`,
      chromeProfile('gen-device-shots'),
      'about:blank',
    ],
    { stdio: 'ignore' }
  )

  let wsUrl
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(150)
    try {
      wsUrl = (await (await fetch(`http://127.0.0.1:${String(DEBUG)}/json/version`)).json())
        .webSocketDebuggerUrl
      if (wsUrl) break
    } catch {
      /* still starting */
    }
  }
  if (!wsUrl) throw new Error('Chrome did not expose a debugging endpoint')

  const browser = new WebSocket(wsUrl)
  await new Promise((r) => browser.addEventListener('open', r, { once: true }))
  const { targetId } = await cdp(browser, 'Target.createTarget', { url: 'about:blank' })
  const targets = await (await fetch(`http://127.0.0.1:${String(DEBUG)}/json/list`)).json()
  const page = new WebSocket(targets.find((t) => t.id === targetId).webSocketDebuggerUrl)
  await new Promise((r) => page.addEventListener('open', r, { once: true }))

  // The panel's real size, at 2x so the images hold up on a retina display.
  await cdp(page, 'Emulation.setDeviceMetricsOverride', {
    width: 800,
    height: 480,
    deviceScaleFactor: 2,
    mobile: false,
  })

  const stale = []
  for (const screen of SCREENS) {
    await cdp(page, 'Page.navigate', {
      url: `http://127.0.0.1:${String(PORT)}/?screen=${screen.name}`,
    })
    await sleep(1200)
    for (const step of screen.reach ?? []) {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const r = await cdp(page, 'Runtime.evaluate', {
          expression: reachStep(step),
          returnByValue: true,
        })
        if (r.result.value === 'clicked') break
        await sleep(80)
      }
      await sleep(300)
    }
    const shot = await cdp(page, 'Page.captureScreenshot', { format: 'png' })
    const bytes = Buffer.from(shot.data, 'base64')
    const file = join(OUT, `${screen.as}.png`)

    if (check) {
      // Compared by content, not by presence. A committed screenshot of a
      // screen that has since been redesigned is a picture of a device that no
      // longer exists, which is worse than no picture.
      const current = existsSync(file) ? readFileSync(file) : Buffer.alloc(0)
      const same =
        createHash('sha256').update(current).digest('hex') ===
        createHash('sha256').update(bytes).digest('hex')
      if (!same) stale.push(screen.as)
    } else {
      writeFileSync(file, bytes)
    }
  }

  page.close()
  browser.close()
  reap(chrome)
  server.close()

  if (check) {
    if (stale.length > 0) {
      console.error(
        `gen-device-shots: ${String(stale.length)} committed screenshot(s) no longer match the ` +
          `frontend: ${stale.join(', ')}\n`
      )
      console.error('  The site would be showing a device that has been redesigned since.')
      console.error('  Regenerate with "make device-shots" and look at what changed.\n')
      process.exit(1)
    }
    console.log(`gen-device-shots: ${String(SCREENS.length)} screenshots match the frontend`)
  } else {
    console.log(
      `gen-device-shots: ${String(SCREENS.length)} screens rendered at 800x480 into apps/web/public/device`
    )
  }
  finish(0)
}

main().catch((err) => {
  console.error(`gen-device-shots: ${err.message}`)
  process.exit(1)
})
