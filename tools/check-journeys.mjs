#!/usr/bin/env node
/**
 * Every guided journey completes, in the real application, against a real daemon.
 *
 * WHY THIS EXISTS. The device shipped unable to create a wallet. Rolling a
 * hundred dice and pressing Continue did nothing at all: the daemon's idle
 * clock had expired, the frontend only sent heartbeats while a wallet was open,
 * and setting one up happens with no wallet open by definition. `seed.reveal`
 * answered "No wallet is loaded" and `void go()` dropped the rejection on the
 * floor, so the screen did not change and the device said nothing.
 *
 * Nothing in the repository could see it. 920 unit tests pass in jsdom, which
 * computes no layout and has no daemon. tools/check-screen-fit.mjs measures a
 * gallery of hand-written fixtures, which cannot be in the state the real app
 * is in. tools/check-device-ui.mjs drives the real frontend and stops at the
 * lock screen, because there is nothing behind it.
 *
 * This is the missing half: the real App, the real daemon, and a finger.
 *
 * WHAT IT ASSERTS, per journey: that the last step lands on the screen the
 * journey says it lands on, that no unhandled rejection reached the console on
 * the way, and that no step found its control missing or disabled. A journey
 * that stops early fails here rather than being discovered by somebody with a
 * hundred dice in front of them.
 *
 * WHY IT DRIVES REAL INPUT. `el.click()` fires a click and no pointerdown, and
 * the frontend resets the idle clock on pointerdown. Driving with click alone
 * walks the application with the idle clock permanently expired, which
 * reproduces the bug above as a harness artifact and would have had this check
 * reporting a fault that was not there. Input.dispatchMouseEvent goes in at the
 * browser's input layer and produces what a finger produces.
 *
 * ISOLATED. Its own store directory and its own socket, both under a temporary
 * directory that is removed afterwards, so running this never touches wallets
 * on the machine it runs on.
 *
 * Run: node tools/check-journeys.mjs
 * Needs: Chrome, `make build` and `make build-app`.
 */

import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIST = join(ROOT, 'packages/ui/dist-app')
const DAEMON = join(ROOT, 'packages/daemon/dist/main.js')

/** Not 5180. A developer's own `make dev` must not be disturbed by a check. */
const PORT = 5188
const DEBUG_PORT = 9424

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
  console.error('check-journeys: no Chrome found. Set CHROME_PATH.')
  process.exit(1)
}
for (const [what, path] of [
  ['the frontend', join(DIST, 'index.html')],
  ['the daemon', DAEMON],
]) {
  if (!existsSync(path)) {
    console.error(`check-journeys: ${what} is not built. Run "make build build-app" first.`)
    process.exit(1)
  }
}

/**
 * The journeys, and where each one ends.
 *
 * `steps` are testids tapped in order. Two are special because automation has
 * no paper and no coordinator:
 *
 *   remember   read the seed off the screen that is showing it
 *   word       answer the backup check from what was remembered
 *
 * Journeys that need an artifact this device cannot produce for itself are
 * listed with the screen they reach rather than the screen they finish on, and
 * say so. Signing needs a PSBT, which needs a wallet layer this build does not
 * have; multisig needs a descriptor from a coordinator.
 */
const JOURNEYS = [
  {
    id: 'new-wallet',
    goal: 'start-goal-new-wallet',
    steps: [
      'start-begin', 'network-signet', 'mode-dice', 'setup-start',
      'dice-roll-rest', 'dice-continue', 'remember', 'seed-ack', 'seed-confirm',
      'word', 'word', 'word',
      'type:correcthorsebattery', 'passphrase-confirm', 'type:correcthorsebattery',
      'passphrase-submit',
    ],
    ends: 'finish-screen',
    heartbeatBefore: 'entropy.fromDice',
  },
  {
    id: 'restore-wallet',
    goal: 'start-goal-restore-wallet',
    // The official all-abandon vector at 256 bits. Typing it exercises the word
    // keyboard the way a person recovering a wallet does, including the case
    // that used to dead-end: "art" is a prefix of "artefact", "artist" and
    // "artwork", so nothing commits on its own and the suggestion strip is the
    // only way forward.
    steps: [
      'start-begin',
      `mnemonic:${'abandon '.repeat(23)}art`,
      'import-submit',
    ],
    ends: 'passphrase-screen',
    heartbeatBefore: 'wallet.import',
  },
  {
    id: 'receive',
    goal: 'start-goal-receive',
    steps: ['start-begin', 'receive-verify'],
    ends: 'receive-screen',
    needsWallet: true,
  },
  {
    id: 'protect-device',
    goal: 'start-goal-protect-device',
    steps: ['start-begin', 'backup-choose-create'],
    ends: 'backup-create',
    needsWallet: true,
    stopsShort: 'writing one needs somewhere to write it to',
  },
  {
    id: 'multisig',
    goal: 'start-goal-multisig',
    steps: ['start-begin'],
    ends: 'multisig-screen',
    needsWallet: true,
    stopsShort: 'registering a quorum needs a descriptor from a coordinator',
  },
  {
    id: 'sign',
    goal: 'start-goal-sign',
    steps: ['start-begin'],
    ends: 'psbt-screen',
    needsWallet: true,
    stopsShort: 'signing needs a PSBT, and building one needs a wallet layer this build omits',
  },
]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
}

/**
 * Every IPC method the frontend called, in order.
 *
 * The proxy sees all of it, which is what makes one particular assertion cheap.
 * See HEARTBEAT_BEFORE below.
 */
const called = []

function serve(socketPath) {
  return createServer((request, response) => {
    if (request.url === '/ipc' && request.method === 'POST') {
      let body = ''
      request.on('data', (chunk) => {
        body += chunk.toString('utf8')
      })
      request.on('end', () => {
        try {
          const method = JSON.parse(body).method
          if (typeof method === 'string') called.push(method)
        } catch {
          /* the daemon will reject it and say so */
        }
        const socket = connect(socketPath)
        let buffer = ''
        socket.on('connect', () => socket.write(`${body.trim()}\n`))
        socket.on('data', (chunk) => {
          buffer += chunk.toString('utf8')
          const newline = buffer.indexOf('\n')
          if (newline === -1) return
          socket.end()
          response.setHeader('content-type', 'application/json')
          response.end(buffer.slice(0, newline))
        })
        socket.on('error', (error) => {
          response.statusCode = 502
          response.end(JSON.stringify({ error: { code: 'proxy', message: error.message } }))
        })
      })
      return
    }

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
}

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
  const work = mkdtempSync(join(tmpdir(), 'nullroute-journeys-'))
  const socketPath = join(work, 'd.sock')
  const storeDir = join(work, 'store')

  const daemon = spawn(process.execPath, [DAEMON], {
    env: {
      ...process.env,
      NULLROUTE_SOCKET: socketPath,
      NULLROUTE_STORE: storeDir,
      NULLROUTE_ROOT: ROOT,
    },
    stdio: 'ignore',
  })

  const server = serve(socketPath)
  const failures = []

  try {
    for (let attempt = 0; attempt < 80 && !existsSync(socketPath); attempt += 1) await sleep(150)
    if (!existsSync(socketPath)) throw new Error('the daemon never created its socket')

    await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve))

    const chrome = spawn(
      chromePath,
      [
        '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        '--no-sandbox', '--disable-dev-shm-usage',
        `--remote-debugging-port=${String(DEBUG_PORT)}`,
        `--user-data-dir=${join(work, 'chrome')}`,
        `--window-size=${String(WIDTH)},${String(HEIGHT)}`,
        'about:blank',
      ],
      { stdio: 'ignore' }
    )

    let wsUrl
    for (let attempt = 0; attempt < 80 && wsUrl === undefined; attempt += 1) {
      await sleep(150)
      try {
        const listed = await (await fetch(`http://127.0.0.1:${String(DEBUG_PORT)}/json/list`)).json()
        wsUrl = listed.find((target) => target.type === 'page')?.webSocketDebuggerUrl
      } catch {
        /* not up yet */
      }
    }
    if (wsUrl === undefined) throw new Error('Chrome never opened a debugging port')

    const page = new WebSocket(wsUrl)
    await new Promise((resolve) => {
      page.addEventListener('open', resolve, { once: true })
    })
    const state = { seq: 0 }

    const thrown = []
    page.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params.exceptionDetails
        thrown.push(String(details?.exception?.description ?? details?.text ?? '').split('\n')[0])
      }
    })

    await cdp(page, 'Page.enable', {}, state)
    await cdp(page, 'Runtime.enable', {}, state)
    await cdp(
      page,
      'Emulation.setDeviceMetricsOverride',
      { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false },
      state
    )

    const evaluate = async (expression) =>
      (await cdp(page, 'Runtime.evaluate', { expression, returnByValue: true }, state)).result.value

    /** A real tap. See the header: el.click() fires no pointerdown. */
    const tap = async (testId) => {
      const box = await evaluate(`(() => {
        const el = document.querySelector('[data-testid=' + ${JSON.stringify(JSON.stringify(testId))} + ']')
        if (el === null) return 'missing'
        if (el.disabled === true) return 'disabled'
        el.scrollIntoView({ block: 'center' })
        const r = el.getBoundingClientRect()
        if (r.width === 0 && r.height === 0) return 'invisible'
        return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) })
      })()`)
      if (typeof box !== 'string' || !box.startsWith('{')) return String(box)
      const { x, y } = JSON.parse(box)
      for (const type of ['mousePressed', 'mouseReleased']) {
        await cdp(
          page,
          'Input.dispatchMouseEvent',
          { type, x, y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 },
          state
        )
        await sleep(25)
      }
      return 'ok'
    }

    const screenOf = async () =>
      evaluate(`(() => {
        const s = document.querySelector('.nr-screen')
        return s === null ? null : s.getAttribute('data-testid')
      })()`)

    let words = []

    for (const journey of JOURNEYS) {
      thrown.length = 0
      called.length = 0

      await cdp(page, 'Page.navigate', { url: `http://127.0.0.1:${String(PORT)}/` }, state)
      for (let attempt = 0; attempt < 100; attempt += 1) {
        await sleep(80)
        if ((await evaluate('document.readyState')) === 'complete') break
      }
      await sleep(1200)

      // Into the goal hub, the way somebody who has not used this before gets
      // there. On a device with a wallet the lock screen's Guide me is gone,
      // so the menu is the route.
      let entered = await tap('lock-guide')
      if (entered !== 'ok') {
        await tap('nav-menu-button')
        await sleep(300)
        entered = await tap('nav-guide')
      }
      await sleep(600)
      if (entered !== 'ok') {
        failures.push(`${journey.id}: could not reach the goal hub (${entered})`)
        continue
      }

      let broke = null
      for (const step of [journey.goal, ...journey.steps]) {
        if (step === 'remember') {
          words = JSON.parse(
            String(
              await evaluate(`(() => {
                const box = document.querySelector('[data-testid="seed-words"]')
                if (box === null) return '[]'
                return JSON.stringify([...box.children].map((el) => {
                  const t = el.querySelector('.nr-word__text')
                  return t === null ? '' : t.textContent.trim()
                }))
              })()`)
            )
          )
          if (words.length === 0) {
            broke = 'remember: no seed words on screen to read'
            break
          }
          continue
        }

        if (step === 'word') {
          const title = String(
            await evaluate(`(() => {
              const t = document.querySelector('.nr-screen__title')
              return t === null ? '' : t.textContent
            })()`)
          )
          const which = /Word (\d+)/.exec(title)
          if (which === null) {
            broke = `word: expected a word check and the screen said "${title}"`
            break
          }
          const want = words[Number(which[1]) - 1]
          for (const letter of want) {
            const status = await evaluate(`(() => {
              const w = document.querySelector('[data-testid="kb-words"]')
              if (w !== null && (w.textContent || '').includes(${JSON.stringify(want)})) return 'committed'
              return document.querySelector('[data-testid="kb-suggest-' + ${JSON.stringify(want)} + '"]') === null
                ? 'typing' : 'suggested'
            })()`)
            if (status === 'committed') break
            if (status === 'suggested') {
              await tap(`kb-suggest-${want}`)
              break
            }
            const typed = await tap(`kb-key-${letter}`)
            if (typed !== 'ok') {
              broke = `word: the key "${letter}" of "${want}" was ${typed}`
              break
            }
            await sleep(50)
          }
          if (broke !== null) break
          await sleep(250)
          const sent = await tap('seed-check-submit')
          if (sent !== 'ok') {
            broke = `word: the answer for "${want}" could not be submitted (${sent})`
            break
          }
          await sleep(800)
          continue
        }

        if (step.startsWith('mnemonic:')) {
          for (const want of step.slice(9).trim().split(/\s+/u)) {
            let entered = false
            for (const letter of want) {
              const status = await evaluate(`(() => {
                const w = document.querySelector('[data-testid="kb-words"]')
                const chips = w === null ? [] : [...w.children]
                const last = chips.length === 0 ? '' : (chips[chips.length - 1].textContent || '').trim()
                if (last === ${JSON.stringify(want)}) return 'committed'
                return document.querySelector('[data-testid="kb-suggest-' + ${JSON.stringify(want)} + '"]') === null
                  ? 'typing' : 'suggested'
              })()`)
              if (status === 'committed') { entered = true; break }
              if (status === 'suggested') {
                await tap(`kb-suggest-${want}`)
                entered = true
                break
              }
              const typed = await tap(`kb-key-${letter}`)
              if (typed !== 'ok') {
                broke = `mnemonic: the key "${letter}" of "${want}" was ${typed}`
                break
              }
              await sleep(30)
            }
            if (broke !== null) break
            if (!entered) {
              // Every letter typed and still not a word: the suggestion strip
              // is the only remaining route and nothing offered it.
              const rescued = await tap(`kb-suggest-${want}`)
              if (rescued !== 'ok') {
                broke = `mnemonic: "${want}" could not be entered (${rescued})`
                break
              }
            }
            await sleep(40)
          }
          if (broke !== null) break
          continue
        }

        if (step.startsWith('type:')) {
          for (const character of step.slice(5)) {
            const typed = await tap(`pk-key-${character}`)
            if (typed !== 'ok') {
              broke = `type: the key "${character}" was ${typed}`
              break
            }
            await sleep(35)
          }
          if (broke !== null) break
          continue
        }

        const result = await tap(step)
        if (result !== 'ok') {
          broke = `${step} was ${result}, on ${String(await screenOf())}`
          break
        }
        await sleep(800)
      }

      if (broke !== null) {
        failures.push(`${journey.id}: ${broke}`)
        continue
      }

      let landed = await screenOf()
      for (let attempt = 0; attempt < 40 && landed !== journey.ends; attempt += 1) {
        await sleep(200)
        landed = await screenOf()
      }
      if (landed !== journey.ends) {
        failures.push(`${journey.id}: ended on ${String(landed)}, expected ${journey.ends}`)
        continue
      }

      // An action that fails silently is the whole reason this file exists.
      if (thrown.length > 0) {
        failures.push(`${journey.id}: reached ${journey.ends} but threw: ${thrown.join('; ')}`)
        continue
      }

      /*
       * A PERSON WAS SEEN BEFORE THE SEED WAS LOADED.
       *
       * The daemon closes a wallet ten minutes after the last human touch, and
       * only `session.heartbeat` counts as one. The frontend used to send those
       * only while a wallet was open, and setting one up happens with no wallet
       * open by definition, so on any device that had been on for ten minutes
       * the seed was locked the instant it was created and the words were gone.
       *
       * Reaching the end of the journey does not catch that: this check starts
       * a fresh daemon, whose clock has not expired, which is exactly why the
       * bug survived in the first place. Waiting ten minutes in a check is not
       * an option and making the window configurable would be a setting that
       * turns a lock off, which is a setting worth attacking.
       *
       * So assert the behaviour rather than the symptom: a heartbeat has to
       * have reached the daemon before the seed did.
       */
      if (journey.heartbeatBefore !== undefined) {
        const beat = called.indexOf('session.heartbeat')
        const loaded = called.indexOf(journey.heartbeatBefore)
        if (beat === -1 || (loaded !== -1 && beat > loaded)) {
          failures.push(
            `${journey.id}: no session.heartbeat reached the daemon before ` +
              `${journey.heartbeatBefore}, so a device that had been on for ten ` +
              `minutes would lock the seed at the moment it was created`
          )
          continue
        }
      }

      const note = journey.stopsShort === undefined ? '' : `  (stops at ${journey.ends}: ${journey.stopsShort})`
      console.log(`  ok    ${journey.id}${note}`)
    }

    page.close()
    chrome.kill()
  } finally {
    server.close()
    daemon.kill()
    // Chrome writes to its profile directory for a moment after it is killed,
    // so a removal straight away fails with ENOTEMPTY and takes the whole run
    // down after every journey has already passed. Retried, and a temporary
    // directory left behind is not worth failing a check over.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        rmSync(work, { recursive: true, force: true })
        break
      } catch {
        await sleep(200)
      }
    }
  }

  if (failures.length > 0) {
    console.error('\ncheck-journeys: a guided journey did not complete.\n')
    for (const failure of failures) console.error(`  ${failure}`)
    console.error(
      '\n  A journey that stops early is a device somebody cannot use. This ran\n' +
        '  the real frontend against a real daemon, so a failure here is a\n' +
        '  failure a person would hit, not a fixture that drifted.\n'
    )
    process.exit(1)
  }

  console.log(`\ncheck-journeys: ${String(JOURNEYS.length)} guided journeys complete`)
}

await main()
