#!/usr/bin/env node
/**
 * The dice demo on the website computes what the documentation says it does.
 *
 * This is the only falsifiable object on nullroute.diy. Everything else there
 * is a claim; the demo invites a reader to roll, hands them a `printf ... |
 * sha256sum` command, and tells them their terminal will print the same string.
 * If it ever does not, the site is a live demonstration that this project's
 * central promise is false, on the page where it makes it.
 *
 * It has been wrong before. The command used to elide the roll string after 24
 * characters with a literal "...", so the command hashed different bytes than
 * the digest above it. That shipped, and nothing here noticed, because nothing
 * here looked.
 *
 * WHAT IT BINDS TOGETHER. The worked example is read out of docs/ENTROPY.md
 * rather than written here, so three things have to agree: the procedure a
 * reader follows by hand, the digits and digest published in the document, and
 * what the browser actually computes when somebody presses the buttons. Any one
 * of them drifting fails this. A hardcoded expectation in this file would let
 * the document and the site drift together away from the procedure, which is
 * the failure worth ruling out.
 *
 * Run: node tools/checks/check-dice-demo.mjs
 * Needs: a built site (make web-build) and Chrome. Set CHROME_PATH to override.
 */

import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromeBinary, chromeProfile, finish, reap, waitForDebugEndpoint } from '../lib/browser.mjs'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const OUT = join(ROOT, 'apps/web/out')
const ENTROPY = join(ROOT, 'docs/ENTROPY.md')
const PORT = 8913
const DEBUG = 9226

if (!existsSync(OUT)) {
  console.error('check-dice-demo: no build output at apps/web/out. Run "make web-build" first.')
  process.exit(1)
}

/**
 * The worked example, lifted from the document that publishes it.
 *
 * The transcript in ENTROPY.md is the thing a reader is told to reproduce, so
 * it is the thing this replays. Failing loudly when it cannot be found matters
 * more than usual: a regex that silently stops matching would leave this check
 * passing with nothing to compare, which is the shape of every bug in this
 * repository's own tooling so far.
 */
const doc = readFileSync(ENTROPY, 'utf8')
const example = /printf '%s' '(\d+)' \| sha256sum\n([0-9a-f]{64})/.exec(doc)
if (example === null) {
  console.error('check-dice-demo: could not find the worked example in docs/ENTROPY.md.')
  console.error("  Looked for a `printf '%s' '<digits>' | sha256sum` line followed by a digest.")
  console.error('  If the transcript moved, this check is blind rather than passing.')
  process.exit(1)
}
const [, ROLLS, EXPECTED] = example
if (ROLLS.length !== 100) {
  console.error(
    `check-dice-demo: the example in ENTROPY.md is ${String(ROLLS.length)} rolls, not 100.`
  )
  console.error('  100 rolls is the published minimum. 99 is 255.911 bits, which is short of 256.')
  process.exit(1)
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
}
const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0]
  let file = join(OUT, path === '/' ? 'index.html' : decodeURIComponent(path))
  if (!file.startsWith(OUT)) return void res.writeHead(403).end()
  if (existsSync(`${file}.html`)) file = `${file}.html`
  else if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
  if (!existsSync(file)) return void res.writeHead(404).end('not found')
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function cdp(ws, id, method, params = {}) {
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

async function main() {
  await new Promise((resolve) => server.listen(PORT, resolve))

  const chrome = spawn(
    chromeBinary('check-dice-demo'),
    [
      '--headless',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${DEBUG}`,
      chromeProfile('check-dice-demo'),
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )

  const wsUrl = await waitForDebugEndpoint(chrome, DEBUG)

  const browserWs = new WebSocket(wsUrl)
  await new Promise((resolve) => browserWs.addEventListener('open', resolve, { once: true }))
  let seq = 0
  const { targetId } = await cdp(browserWs, ++seq, 'Target.createTarget', { url: 'about:blank' })
  const targets = await (await fetch(`http://127.0.0.1:${DEBUG}/json/list`)).json()
  const page = new WebSocket(targets.find((t) => t.id === targetId).webSocketDebuggerUrl)
  await new Promise((resolve) => page.addEventListener('open', resolve, { once: true }))

  await cdp(page, ++seq, 'Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await cdp(page, ++seq, 'Page.navigate', { url: `http://127.0.0.1:${PORT}/` })
  await sleep(1200)

  /*
   * Pressed, not typed into state. The buttons are what a reader uses, and a
   * check that set the value directly would pass over a broken click handler.
   */
  for (const face of ROLLS) {
    const { result } = await cdp(page, ++seq, 'Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const b = document.querySelector('button[aria-label="Roll ${face}"]')
        if (b === null) return 'missing'
        b.click()
        return 'ok'
      })()`,
    })
    if (result.value !== 'ok') {
      throw new Error(`no button for face ${face}. The demo's controls have changed.`)
    }
  }
  // The digest is computed in an effect off an async subtle.digest call.
  await sleep(600)

  const { result } = await cdp(page, ++seq, 'Runtime.evaluate', {
    returnByValue: true,
    expression: `JSON.stringify({
      digest: (document.querySelector('[aria-label="SHA-256 of those digits"]')?.textContent ?? '').replace(/\\s+/g, ''),
      rolls: (document.querySelector('[aria-label="Your rolls"]')?.textContent ?? '').trim(),
      command: (document.querySelector('code[role="region"]')?.textContent ?? '').trim(),
    })`,
  })
  const shown = JSON.parse(result.value)

  page.close()
  browserWs.close()
  reap(chrome)
  server.close()

  const problems = []

  if (shown.rolls !== ROLLS) {
    problems.push(
      `the demo recorded ${String(shown.rolls.length)} rolls, not the ${String(ROLLS.length)} pressed`
    )
  }

  if (shown.digest !== EXPECTED) {
    problems.push(
      `the demo hashed those rolls to\n      ${shown.digest || '(nothing)'}\n` +
        `    and docs/ENTROPY.md publishes\n      ${EXPECTED}`
    )
  }

  /*
   * The command has to carry every digit. This is the bug that shipped: an
   * elided roll string means the reader's terminal hashes different bytes and
   * disagrees with the page, which reads as the project being wrong rather than
   * the page being wrong.
   */
  if (!shown.command.includes(ROLLS)) {
    problems.push(
      `the printed command does not contain the whole roll string, so running it\n` +
        `    hashes different bytes than the digest shown above it:\n      ${shown.command.slice(0, 90)}`
    )
  }
  if (/\\n|echo /.test(shown.command)) {
    problems.push(
      `the printed command uses echo or embeds a newline. The published rule is\n` +
        `    the ASCII digits with NO trailing newline, which is why it is printf.`
    )
  }

  if (problems.length > 0) {
    console.error('check-dice-demo: the website disagrees with docs/ENTROPY.md\n')
    for (const p of problems) console.error(`  - ${p}\n`)
    console.error(
      '  This demo is the only falsifiable object on the site. A reader who runs\n' +
        '  the command and gets a different answer has been shown, on the page that\n' +
        '  makes the claim, that the claim is false.\n'
    )
    process.exit(1)
  }

  console.log(
    `check-dice-demo: ${String(ROLLS.length)} rolls pressed in the browser hash to the digest ` +
      `docs/ENTROPY.md publishes (${EXPECTED.slice(0, 16)}...)`
  )
  finish(0)
}

main().catch((err) => {
  console.error(`check-dice-demo: ${err.message}`)
  process.exit(1)
})
