#!/usr/bin/env node
/**
 * Load the device frontend in a real browser and assert it is not broken.
 *
 * INV-NET-3, from the other side.
 *
 * tools/check-device-csp.mjs reads the policy and judges it. That catches a
 * weakened policy and cannot catch a policy so strict the application will not
 * start, which is the failure that turns a signing device into a black screen.
 * Both failures are silent in every other check: the build succeeds, the tests
 * pass in jsdom, and the panel shows nothing.
 *
 * This is the check that would have caught adding WebAssembly to the frontend
 * without adding 'wasm-unsafe-eval'. A camera screen that never decodes is a
 * user who concludes the hardware is faulty.
 *
 * WHAT IT ASSERTS. The document parses under its own policy, React mounts and
 * renders something, the browser reports no CSP violation, and no request is
 * attempted to any origin other than the one serving the page.
 *
 * WHAT IT CANNOT ASSERT. There is no daemon here, so every IPC call fails and
 * the app renders its "no daemon" state. That is the correct thing to render and
 * is what the check looks for. Screens past the lock screen are covered by the
 * component tests, not by this.
 */

import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIST = join(ROOT, 'packages/ui/dist-app')
const PORT = 9327

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean)

const chromePath = CHROME_CANDIDATES.find((path) => existsSync(path))
if (chromePath === undefined) {
  console.error('check-device-ui: no Chrome found. Set CHROME_PATH.')
  process.exit(1)
}

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('check-device-ui: packages/ui/dist-app/index.html is missing.')
  console.error('  Build the device frontend first (npm run build --workspace @nullroute/ui).')
  process.exit(1)
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
}

/**
 * Serve the build the way the device does, from one origin, with no headers
 * beyond the content type.
 *
 * Deliberately NOT sending a CSP header: the policy under test is the meta tag
 * in the document, and a header here would test the server instead.
 */
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

async function main() {
  await new Promise((resolve) => {
    server.listen(PORT, resolve)
  })

  const chrome = spawn(
    chromePath,
    [
      // `--headless=new` rather than `--headless`. The old headless is a
      // separate implementation with its own renderer and does not composite
      // the way the device's kiosk Chromium does.
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--remote-debugging-port=9328',
      'about:blank',
    ],
    { stdio: 'ignore' }
  )

  let wsUrl
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(150)
    try {
      const res = await fetch('http://127.0.0.1:9328/json/version')
      wsUrl = (await res.json()).webSocketDebuggerUrl
      if (wsUrl) break
    } catch {
      /* still starting */
    }
  }
  if (!wsUrl) throw new Error('check-device-ui: Chrome did not expose a debugging endpoint')

  const browserWs = new WebSocket(wsUrl)
  await new Promise((resolve) => browserWs.addEventListener('open', resolve, { once: true }))

  let nextId = 1
  const pending = new Map()
  const violations = []
  const offOrigin = []
  const consoleErrors = []

  browserWs.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id !== undefined) {
      pending.get(message.id)?.(message)
      pending.delete(message.id)
      return
    }
    // Chrome reports a blocked load as a failed request with a CSP status.
    if (message.method === 'Network.loadingFailed') {
      const reason = message.params?.blockedReason
      if (reason !== undefined) violations.push(`${reason}`)
    }
    if (message.method === 'Network.requestWillBeSent') {
      const url = message.params?.request?.url ?? ''
      if (/^https?:\/\//i.test(url) && !url.startsWith(`http://127.0.0.1:${String(PORT)}`)) {
        offOrigin.push(url)
      }
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
      consoleErrors.push(
        (message.params.args ?? []).map((arg) => arg.value ?? arg.description ?? '').join(' ')
      )
    }
    // A CSP violation surfaces here too, as a page-level error message.
    if (message.method === 'Log.entryAdded') {
      const entry = message.params?.entry ?? {}
      if (entry.source === 'security' || /Content Security Policy/i.test(entry.text ?? '')) {
        violations.push(entry.text ?? 'unknown CSP violation')
      }
    }
  })

  const send = (method, params = {}, sessionId) =>
    new Promise((resolve) => {
      const id = nextId++
      pending.set(id, resolve)
      browserWs.send(JSON.stringify({ id, method, params, sessionId }))
    })

  const { result: target } = await send('Target.createTarget', { url: 'about:blank' })
  const { result: attached } = await send('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: true,
  })
  const session = attached.sessionId

  await send('Page.enable', {}, session)
  await send('Runtime.enable', {}, session)
  await send('Network.enable', {}, session)
  await send('Log.enable', {}, session)

  await send('Page.navigate', { url: `http://127.0.0.1:${String(PORT)}/` }, session)
  // The app renders, then fails its first IPC call and settles. Long enough for
  // both, short enough that a hang shows up as a failure rather than a wait.
  await sleep(3000)

  const { result: rendered } = await send(
    'Runtime.evaluate',
    {
      expression: `JSON.stringify({
        mounted: document.querySelector('#root')?.children.length ?? 0,
        text: (document.body.innerText || '').slice(0, 400),
        hasMeta: Boolean(document.querySelector('meta[http-equiv="Content-Security-Policy"]')),
      })`,
      returnByValue: true,
    },
    session
  )

  chrome.kill()
  server.close()

  const state = JSON.parse(rendered?.result?.value ?? '{}')
  const problems = []

  if (!state.hasMeta) problems.push('the served document carries no CSP meta tag')
  if (!state.mounted) {
    problems.push(`nothing rendered into #root. Body text was: ${JSON.stringify(state.text ?? '')}`)
  }
  for (const violation of violations) problems.push(`blocked by policy: ${violation}`)
  for (const url of offOrigin) problems.push(`requested an off-origin URL: ${url}`)
  // A failed IPC call is expected here and is not a policy problem.
  for (const error of consoleErrors) {
    if (/Content Security Policy|Refused to/i.test(error)) problems.push(`console: ${error}`)
  }

  if (problems.length > 0) {
    console.error('check-device-ui: the device frontend did not come up cleanly.\n')
    for (const problem of problems) console.error(`  ${problem}`)
    process.exit(1)
  }

  console.log(
    `check-device-ui: frontend mounted under its own CSP, ` +
      `no violations, no off-origin requests`
  )
}

main().catch((err) => {
  console.error(`check-device-ui: ${err.message}`)
  server.close()
  process.exit(1)
})
