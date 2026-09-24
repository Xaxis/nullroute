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
 * Run: node tools/checks/check-journeys.mjs
 * Needs: Chrome, `make build` and `make build-app`.
 */

import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as btc from '@scure/btc-signer'
import { base64, hex } from '@scure/base'
import { chromeBinary, finish, reap, waitForDebugEndpoint } from '../lib/browser.mjs'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const DIST = join(ROOT, 'packages/ui/dist-app')
const DAEMON = join(ROOT, 'packages/daemon/dist/main.js')

/** Not 5180. A developer's own `make dev` must not be disturbed by a check. */
/**
 * --shots <dir> writes a PNG after every step of every journey.
 *
 * The gallery in tools/screens is hand-written fixtures, and it has drifted
 * from the real application three separate ways at once: no verification
 * banner, no step counter, and twelve seed words where the device shows twenty
 * four. Every visual check in the repository was green while the device could
 * not create a wallet. So when a screenshot of the gallery shows something
 * wrong, the first question is whether the device does that or whether the
 * fixture does, and answering it by hand means rebuilding this walk manually.
 *
 * This is the same walk against the same daemon, so the images are the product.
 * Off by default: it is for looking at, not for CI.
 */
const SHOTS = (() => {
  const at = process.argv.indexOf('--shots')
  if (at === -1) return null
  const dir = process.argv[at + 1]
  if (dir === undefined) {
    console.error('check-journeys: --shots needs a directory')
    process.exit(2)
  }
  mkdirSync(dir, { recursive: true })
  return dir
})()

const PORT = 5188
const DEBUG_PORT = 9424

/** The panel. Not a breakpoint, a fixed piece of hardware. */
const WIDTH = 800
const HEIGHT = 480

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
      'start-begin',
      'network-signet',
      'mode-dice',
      'setup-start',
      'dice-roll-rest',
      'dice-continue',
      'remember',
      'seed-ack',
      'seed-confirm',
      'word',
      'word',
      'word',
      'type:correcthorsebattery',
      'passphrase-confirm',
      'type:correcthorsebattery',
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
    steps: ['start-begin', `mnemonic:${'abandon '.repeat(23)}art`, 'import-submit'],
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
    // `paste` puts a transaction built for the open wallet into the field, the
    // way a camera or an SD card would. See buildPsbt.
    steps: ['start-begin', 'paste', 'psbt-review', 'scroll', 'psbt-sign'],
    ends: 'psbt-signed',
    needsWallet: true,
  },
]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Address parameters per network, asked of the daemon rather than assumed.
 *
 * The first version hard-coded regtest and the journey sets the device to
 * signet, so every address came back as tb1 and the decoder rejected it. The
 * device is the authority on which network it is on; this reads it.
 */
const NETWORKS = {
  mainnet: btc.NETWORK,
  testnet4: btc.TEST_NETWORK,
  signet: btc.TEST_NETWORK,
  regtest: { bech32: 'bcrt', pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef },
}

/**
 * A transaction for the wallet that is open, so the signing journey has
 * something to sign.
 *
 * THIS DEVICE CANNOT BUILD ONE. Choosing coins and setting a fee is the wallet
 * layer, which is phase 5 and deliberately absent: the signer proposes nothing
 * and signs what it is handed. So the check hands it one, which is exactly the
 * position a coordinator is in.
 *
 * The input is fabricated. That is not a shortcut, it is what the device sees:
 * it has no network, so it cannot know whether an outpoint exists, and a PSBT
 * naming one that does not is indistinguishable to it from one that does. The
 * script is the wallet's own, because that is what makes the input signable.
 */
async function buildPsbt(rpc) {
  const status = await rpc('device.status')
  const params = NETWORKS[status.network?.id]
  if (params === undefined) {
    throw new Error(`no address parameters for network "${String(status.network?.id)}"`)
  }
  const listed = await rpc('wallet.addresses', {
    scriptType: 'p2wpkh',
    change: false,
    start: 0,
    count: 2,
  })
  const [from, to] = listed.addresses
  const tx = new btc.Transaction()
  tx.addInput({
    txid: hex.decode('11'.repeat(32)),
    index: 0,
    witnessUtxo: {
      script: btc.OutScript.encode(btc.Address(params).decode(from.address)),
      amount: 100_000n,
    },
  })
  tx.addOutputAddress(to.address, 99_000n, params)
  return base64.encode(tx.toPSBT())
}

/** One request to the daemon, over its socket, the way the proxy does it. */
function daemonRpc(socketPath) {
  let id = 0
  return (method, params = {}) =>
    new Promise((resolve, reject) => {
      const socket = connect(socketPath)
      let buffer = ''
      socket.on('connect', () => {
        socket.write(`${JSON.stringify({ id: String((id += 1)), method, params })}\n`)
      })
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8')
        const newline = buffer.indexOf('\n')
        if (newline === -1) return
        socket.end()
        const message = JSON.parse(buffer.slice(0, newline))
        if (message.error) reject(new Error(`${method}: ${message.error.message}`))
        else resolve(message.result)
      })
      socket.on('error', reject)
    })
}

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

  /*
   * THE DAEMON'S OUTPUT IS KEPT, because without it this check cannot tell a
   * slow start from a dead one.
   *
   * It was spawned with stdio: 'ignore'. When the socket failed to appear on
   * CI, all this could say was "the daemon never created its socket", which is
   * the symptom and says nothing about why: a crash on startup, a missing
   * build, a permission, a port. Twelve seconds of waiting and then a sentence
   * that rules nothing out, on the only machine where it was happening.
   *
   * So the pipes are read and the exit is recorded, and the failure below
   * quotes them. Same argument as the daemon's own rule about swallowed
   * exceptions, one level up: a harness that discards the evidence reports the
   * thing it noticed rather than the thing that happened.
   */
  const daemon = spawn(process.execPath, [DAEMON], {
    env: {
      ...process.env,
      NULLROUTE_SOCKET: socketPath,
      NULLROUTE_STORE: storeDir,
      NULLROUTE_ROOT: ROOT,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let said = ''
  let ended = null
  daemon.stdout.on('data', (chunk) => {
    said += String(chunk)
  })
  daemon.stderr.on('data', (chunk) => {
    said += String(chunk)
  })
  daemon.on('exit', (code, signal) => {
    ended = signal === null ? `exit ${String(code)}` : `signal ${signal}`
  })

  const server = serve(socketPath)
  const rpc = daemonRpc(socketPath)
  const failures = []

  try {
    for (let attempt = 0; attempt < 80 && !existsSync(socketPath); attempt += 1) await sleep(150)
    if (!existsSync(socketPath)) {
      const why = ended === null ? 'it is still running' : `it ended with ${ended}`
      const tail = said.trim() === '' ? 'and printed nothing' : `and said:\n${said.trim()}`
      throw new Error(`the daemon never created its socket at ${socketPath}: ${why} ${tail}`)
    }

    await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve))

    const chrome = spawn(
      chromeBinary('check-journeys'),
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        `--remote-debugging-port=${String(DEBUG_PORT)}`,
        `--user-data-dir=${join(work, 'chrome')}`,
        `--window-size=${String(WIDTH)},${String(HEIGHT)}`,
        'about:blank',
      ],
      /*
       * CHROME'S OUTPUT IS KEPT, for the reason written out above the daemon
       * forty lines up, which was not applied here at the time.
       *
       * This said "Chrome never opened a debugging port" and nothing else, on a
       * CI run where the journeys themselves were fine. That sentence is the
       * symptom. It does not distinguish a browser that was still starting from
       * one that exited immediately, and those want opposite responses: wait
       * longer, or read what it printed.
       */
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )

    /*
     * TWO QUESTIONS, and only the first is the browser's. waitForDebugEndpoint
     * answers "is Chrome up", with its output quoted if it is not, which is the
     * part every harness was writing for itself. What this one needs after that
     * is a PAGE target rather than the browser endpoint, so the second wait
     * stays here.
     */
    await waitForDebugEndpoint(chrome, DEBUG_PORT)

    let wsUrl
    for (let attempt = 0; attempt < 80 && wsUrl === undefined; attempt += 1) {
      try {
        const listed = await (
          await fetch(`http://127.0.0.1:${String(DEBUG_PORT)}/json/list`)
        ).json()
        wsUrl = listed.find((target) => target.type === 'page')?.webSocketDebuggerUrl
      } catch {
        /* the browser answered on /json/version, so this is a page it has not opened yet */
      }
      if (wsUrl === undefined) await sleep(150)
    }
    if (wsUrl === undefined) {
      throw new Error(`Chrome is up on ${String(DEBUG_PORT)} and opened no page to drive`)
    }

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
    /**
     * Tap a control, waiting for it to be there and to be live.
     *
     * IT USED TO LOOK ONCE. Every step slept 800ms and then asked, so a screen
     * that took longer than that to render, or a submit button enabled a frame
     * after its last keystroke landed, failed the run. Two consecutive runs on
     * a loaded machine failed in two different places, which is the signature of
     * a timing bug rather than a defect: "psbt-sign was missing" once and "the
     * answer for below could not be submitted (disabled)" the next.
     *
     * A check that fails at random gets ignored, and then switched off, which is
     * the same argument the browser checks make about hanging.
     *
     * Waiting weakens nothing. A control that never appears still fails, after a
     * bounded wait, and the reported reason is the last state actually seen
     * rather than a generic timeout. A person in front of the panel waits for
     * the screen too.
     */
    const tap = async (testId) => {
      let last = 'missing'
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const state = await tapOnce(testId)
        if (state === 'ok') return 'ok'
        last = state
        await sleep(70)
      }
      return last
    }

    const tapOnce = async (testId) => {
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

    /**
     * Wait until the screen has stopped changing, rather than sleeping at it.
     *
     * WHAT THE FIXED SLEEP COULD NOT DO. Every generic step used to tap and
     * then sleep 800ms. `tap` retries for four seconds, so a control that
     * appears late is already handled; what a fixed sleep cannot handle is the
     * opposite case. If a transition has not landed within 800ms and the NEXT
     * step's testid also exists on the screen still showing, the harness taps
     * it immediately, on the wrong screen, and the journey goes somewhere
     * nobody asked for. Retrying does not help, because the control is there.
     *
     * That is the same shape as the word-keyboard bug fixed alongside this one:
     * reading a screen before it has finished becoming the screen.
     *
     * Two consecutive agreeing reads, because one read of the old screen looks
     * exactly like one read of a screen that is not going to change. Fast in
     * the common case, which most of these are, and patient when it matters.
     *
     * NOT THE SCREEN NAME ALONE. That was the first attempt and it broke the
     * signing journey: tapping Review renders the whole transaction inside the
     * SAME screen, so the name was stable before any of it existed, the scroll
     * step then had nothing to scroll, and Sign stayed refused because the
     * review had not been read. The signature below is the screen plus how much
     * there is to read, which is what actually changes when content lands.
     */
    const settled = async () => {
      let previous = null
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const now = String(
          await evaluate(`(() => {
            const s = document.querySelector('.nr-screen')
            const b = document.querySelector('.nr-screen__body')
            const a = document.querySelector('.nr-screen__actions')
            return [
              s === null ? 'none' : s.getAttribute('data-testid'),
              b === null ? 0 : b.scrollHeight,
              document.querySelectorAll('[data-testid]').length,
              /* The action bar's own text, because a call in flight changes
                 nothing else. Tapping Review leaves the screen name, the
                 content and the element count exactly as they were while the
                 daemon works, and the only thing that moves is the button
                 reading "Reading" instead of "Review". Without this the
                 harness scrolled a body that had not been filled in yet and
                 then found Sign refused, which is true and was not the
                 device's fault. */
              a === null ? '' : (a.textContent || '').trim(),
            ].join('|')
          })()`)
        )
        if (previous === now) return now
        previous = now
        await sleep(80)
      }
      return previous
    }

    let words = []

    /**
     * Named by journey, order and the screen actually on show, so a directory
     * listing reads as the walk and a wrong screen is visible without opening
     * anything.
     */
    let shotSeq = 0
    const capture = async (label) => {
      if (SHOTS === null) return
      const on = String(await screenOf())
      const name = `${String(shotSeq).padStart(3, '0')}-${label}-${on}`.replace(
        /[^a-zA-Z0-9._-]/g,
        '_'
      )
      shotSeq += 1
      const shot = await cdp(page, 'Page.captureScreenshot', { format: 'png' }, state)
      writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(shot.data, 'base64'))
    }

    for (const journey of JOURNEYS) {
      thrown.length = 0
      called.length = 0

      await cdp(page, 'Page.navigate', { url: `http://127.0.0.1:${String(PORT)}/` }, state)
      for (let attempt = 0; attempt < 100; attempt += 1) {
        await sleep(80)
        if ((await evaluate('document.readyState')) === 'complete') break
      }
      await sleep(1200)
      await settled()

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
      await settled()
      if (entered !== 'ok') {
        failures.push(`${journey.id}: could not reach the goal hub (${entered})`)
        continue
      }

      let broke = null
      for (const step of [journey.goal, ...journey.steps]) {
        /*
         * Reading the screen to the end, which the review now requires.
         *
         * PsbtScreen's subtitle says "Nothing is signed until you have read
         * it" and Sign sits in the fixed bar, so a transaction could be signed
         * with its amounts, fee and inputs never on the panel. Sign is refused
         * until the body reaches its end, which means a journey that presses
         * it has to do what a person does first. Without this the step reports
         * `disabled`, correctly.
         */
        if (step === 'scroll') {
          /*
           * Scroll until the screen stops growing under it.
           *
           * A single pass is not enough and the reason is the interesting one.
           * The review arrives from the daemon, so the body can still be empty
           * when this runs: scrolling nothing leaves the body at the top, the
           * content then lands, and the screen correctly refuses to sign
           * because it has not been read. The failure said exactly that,
           * "Scroll to the end first", once the harness was made to report what
           * the screen was saying rather than only which screen it was.
           *
           * `settled()` cannot cover it either. While a call is in flight the
           * DOM is perfectly stable, so two agreeing reads mean "nothing is
           * happening yet" and "nothing is going to happen" alike.
           *
           * So: scroll, look again, and stop when the height has stopped
           * changing and the end is reached. Which is what a person does.
           */
          let height = -1
          for (let attempt = 0; attempt < 40; attempt += 1) {
            const at = String(
              await evaluate(`(() => {
                for (let pass = 0; pass < 2; pass += 1) {
                  for (const el of document.querySelectorAll('*')) {
                    if (el.scrollHeight > el.clientHeight) el.scrollTop = el.scrollHeight
                  }
                }
                const b = document.querySelector('.nr-screen__body')
                if (b === null) return '0|false'
                return b.scrollHeight + '|' + (b.scrollTop + b.clientHeight >= b.scrollHeight - 1)
              })()`)
            )
            const [now, ended] = at.split('|')
            if (String(now) === String(height) && ended === 'true') break
            height = Number(now)
            await sleep(120)
          }
          continue
        }

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

          /**
           * What the word keyboard is showing right now.
           *
           * `committed` means the word is in the entered list, which this
           * keyboard does BY ITSELF as soon as one word is the only match:
           * "ente" is already "enter", so the fifth keystroke would start a
           * new word rather than finish this one.
           */
          /*
           * HOW MANY WORDS ARE ENTERED, which is not what the text says.
           * kb-prefix, the chip holding a half typed word, is rendered INSIDE
           * kb-words, so the textContent test below reports "committed" the
           * moment the prefix spells the target. For a word that commits by
           * itself that is the same answer; for one that does not, it is the
           * wrong one, and it is the case this whole branch exists for.
           * WordKeyboard's own comment calls kb-count the only authority on how
           * many words exist, after a half typed chip contradicted the counter
           * on screen. It is the authority here too.
           */
          const counted = async () =>
            Number(
              await evaluate(`(() => {
                const el = document.querySelector('[data-testid="kb-count"]')
                if (el === null) return -1
                const m = /^\\s*(\\d+)/.exec(el.textContent || '')
                return m === null ? -1 : Number(m[1])
              })()`)
            )
          const entered = await counted()

          /*
           * COMMITTED MEANS THE COUNTER MOVED, not that the word appears in the
           * text. kb-words also holds the keyboard's hints and its counter:
           * "Tap letters to begin.", "Tap the word below to enter it" and "0 of
           * 1 words". Five BIP-39 words are substrings of that, begin, below,
           * enter, letter and word, so asking for "enter" read as committed
           * after one letter and the rescue found no strip at the prefix "e".
           * About one run in a hundred and fifty, never twice in a row.
           */
          const state = async () =>
            String(
              await evaluate(`(() => {
                const c = document.querySelector('[data-testid="kb-count"]')
                const n = c === null ? null : /^\\s*(\\d+)/.exec(c.textContent || '')
                if (n !== null && Number(n[1]) === ${String(entered + 1)}) return 'committed'
                if (document.querySelector('[data-testid="kb-suggest-' + ${JSON.stringify(want)} + '"]') !== null) {
                  return 'suggested'
                }
                const p = document.querySelector('[data-testid="kb-prefix"]')
                return 'typing:' + (p === null ? '' : (p.textContent || '').trim())
              })()`)
            )

          for (const letter of want) {
            const before = await state()
            if (before === 'committed') break
            if (before === 'suggested') {
              await tap(`kb-suggest-${want}`)
              break
            }
            const typed = await tap(`kb-key-${letter}`)
            if (typed !== 'ok') {
              broke = `word: the key "${letter}" of "${want}" was ${typed}`
              break
            }
            /*
             * WAITED FOR, not slept through. This was a flat 50ms, and under
             * the load of a full `make check` the render after a keystroke
             * lands later than that: the next pass read a stale prefix, typed
             * one letter too many, and the auto-committed word was left with a
             * dangling prefix behind it, which disables the submit. The
             * failure read "the answer for enter could not be submitted
             * (disabled)" and passed on every rerun, which is the shape of a
             * timing bug rather than a defect in the device.
             */
            for (let wait = 0; wait < 60; wait += 1) {
              if ((await state()) !== before) break
              await sleep(50)
            }
          }
          if (broke !== null) break

          /*
           * THE STRIP IS CHECKED AFTER THE LAST LETTER, NOT ONLY BEFORE ONE.
           * The loop above reads the state at the top of each iteration, so it
           * can only act on a suggestion while letters remain to type. A word
           * whose strip appears on its FINAL letter never reaches that branch:
           * the loop ends, nothing taps, and the answer sits in the prefix with
           * the submit button correctly disabled behind it.
           *
           * That is 49 of the 2048 words, the ones that are a prefix of a
           * longer word, and the seed check asks for whichever words it likes
           * out of a mnemonic generated per run. So this failed about one run
           * in fourteen and passed on the rerun. CI failed on "fat", which is
           * "fatal", "father" and "fatigue" waiting behind it.
           *
           * The mnemonic step twenty lines down has always done this. Only this
           * one was missing it.
           */
          if ((await counted()) !== entered + 1) {
            const rescued = await tap(`kb-suggest-${want}`)
            if (rescued !== 'ok') {
              broke = `word: "${want}" is not committed and the suggestion strip ${rescued}`
              break
            }
            let landed = false
            for (let wait = 0; wait < 60; wait += 1) {
              if ((await counted()) === entered + 1) {
                landed = true
                break
              }
              await sleep(50)
            }
            if (!landed) {
              broke = `word: "${want}" was tapped on the suggestion strip and did not commit`
              break
            }
          }

          // Same again for the button: enabled when the answer is complete,
          // rather than after a delay somebody guessed at.
          for (let wait = 0; wait < 60; wait += 1) {
            const ready = await evaluate(`(() => {
              const b = document.querySelector('[data-testid="seed-check-submit"]')
              return b !== null && b.disabled !== true
            })()`)
            if (ready === true) break
            await sleep(50)
          }
          const sent = await tap('seed-check-submit')
          if (sent !== 'ok') {
            broke = `word: the answer for "${want}" could not be submitted (${sent})`
            break
          }
          /* Wait for the screen to move on rather than for 800ms. The next
             step reads the title to learn which word is being asked for, so
             arriving while the previous one is still on show asks about the
             wrong word, and that is the same fixed-delay bug one line up. */
          for (let wait = 0; wait < 60; wait += 1) {
            const moved = await evaluate(`(() => {
              const t = document.querySelector('.nr-screen__title')
              return t === null ? '' : t.textContent
            })()`)
            if (String(moved) !== title) break
            await sleep(50)
          }
          continue
        }

        if (step === 'paste') {
          const psbt = await buildPsbt(rpc)
          // Through the native setter and an input event, because React tracks
          // the value it last rendered and ignores one assigned around it.
          const filled = await evaluate(`(() => {
            const field = document.querySelector('[data-testid="psbt-input"]')
            if (field === null) return 'missing'
            const setter = Object.getOwnPropertyDescriptor(
              window.HTMLTextAreaElement.prototype, 'value'
            ).set
            setter.call(field, ${JSON.stringify(psbt)})
            field.dispatchEvent(new Event('input', { bubbles: true }))
            return 'ok'
          })()`)
          if (filled !== 'ok') {
            broke = `paste: the transaction field was ${String(filled)}`
            break
          }
          await sleep(300)
          continue
        }

        if (step.startsWith('mnemonic:')) {
          for (const want of step.slice(9).trim().split(/\s+/u)) {
            let entered = false
            // By the counter, as in the word step above. This compared the
            // last child of kb-words to the word, and the last child is always
            // the counter itself, so "committed" could never be returned.
            const before = Number(
              await evaluate(`(() => {
                const c = document.querySelector('[data-testid="kb-count"]')
                const n = c === null ? null : /^\\s*(\\d+)/.exec(c.textContent || '')
                return n === null ? -1 : Number(n[1])
              })()`)
            )
            for (const letter of want) {
              const status = await evaluate(`(() => {
                const c = document.querySelector('[data-testid="kb-count"]')
                const n = c === null ? null : /^\\s*(\\d+)/.exec(c.textContent || '')
                if (n !== null && Number(n[1]) === ${String(before + 1)}) return 'committed'
                return document.querySelector('[data-testid="kb-suggest-' + ${JSON.stringify(want)} + '"]') === null
                  ? 'typing' : 'suggested'
              })()`)
              if (status === 'committed') {
                entered = true
                break
              }
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
          /*
           * What the screen was SAYING, not just which screen it was.
           *
           * "psbt-sign was disabled, on psbt-screen" is true and does not say
           * whether the device refused, whether a call was still running, or
           * whether the button had simply not been reached. Every one of those
           * needs a different fix, and finding out meant screenshotting the
           * run by hand. The refusal line beside the button, any banner, and
           * the label of the control itself answer it in the failure text.
           */
          const saying = String(
            await evaluate(`(() => {
              const bits = []
              for (const sel of ['[data-testid$="-error"]', '.nr-status--fail', '.nr-banner--danger']) {
                for (const el of document.querySelectorAll(sel)) {
                  const t = (el.textContent || '').replace(/\\s+/g, ' ').trim()
                  if (t.length > 0 && !bits.includes(t)) bits.push(t.slice(0, 90))
                }
              }
              const target = document.querySelector('[data-testid="${step}"]')
              if (target !== null) {
                bits.push('the control reads "' + (target.textContent || '').trim().slice(0, 30) + '"')
              }
              return bits.join(' / ')
            })()`)
          )
          broke =
            `${step} was ${result}, on ${String(await screenOf())}` +
            (saying === '' || saying === 'null' ? '' : `: ${saying}`)
          break
        }
        /* Both, deliberately. The fixed delay stays because replacing it made
           things worse rather than better: the signing journey depends on an
           earlier one leaving a wallet open, and stepping faster changed
           behaviour I had not accounted for. settled() is added to it, so this
           is strictly more patient than what was here, which is the only
           direction that fixes a flake. */
        await sleep(800)
        await settled()
        await capture(`${journey.id}-${step}`)
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

      await capture(`${journey.id}-ARRIVED`)

      const note =
        journey.stopsShort === undefined
          ? ''
          : `  (stops at ${journey.ends}: ${journey.stopsShort})`
      console.log(`  ok    ${journey.id}${note}`)
    }

    page.close()
    reap(chrome)
  } finally {
    server.close()
    reap(daemon)
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
  // The verdict is printed and nothing is left to wait for. See tools/lib/reap.mjs.
  finish(0)
}

await main()
