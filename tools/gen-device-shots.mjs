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
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  chromeBinary,
  chromeProfile,
  finish,
  reap,
  unreachedBecause,
  waitForDebugEndpoint,
  walkReach,
} from './lib/browser.mjs'

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

/*
 * THE SHARED RESOLVER, and this used to be a fourth copy of the candidate list.
 *
 * check-make-targets has a rule against exactly that, and the rule scanned
 * tools/checks only, so this file sat next to it for the whole of its life
 * without being asked. The rule's own comment explains the cost: the right
 * answer written out several times is how two of them came to be different,
 * and the machine they are wrong on is the one that runs this on Linux.
 */
const chromePath = chromeBinary('gen-device-shots')
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
    // Piped, not ignored, so the wait below has something to quote when the
    // browser exits instead of starting.
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )

  /*
   * THE SHARED WAIT, and this used to be its own poll loop.
   *
   * It threw "Chrome did not expose a debugging endpoint", which is the symptom
   * and not the reason, and with stdio 'ignore' the reason had already been
   * discarded. That sentence cannot separate a browser still starting from one
   * that died on the spot, and those want opposite responses.
   */
  const wsUrl = await waitForDebugEndpoint(chrome, DEBUG)

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

  /*
   * WHAT THESE IMAGES WERE RENDERED FROM, AND WHERE.
   *
   * THE PROBLEM WITH COMPARING PIXELS. This check exists so the site cannot go
   * on showing a device that has been redesigned since, and it answered that by
   * hashing the PNG. Chrome rasterises through CoreText on macOS and FreeType
   * on Linux, so the same markup in the same font comes out different: all six
   * images failed the first time CI ran this, and none of them was stale.
   *
   * The staleness question does not need the pixels. It needs to know whether
   * the frontend changed after the images were made, and that is a hash of what
   * they were made from: the gallery bundle these screens are rendered out of.
   * That answer is the same on every machine.
   *
   * So the stamp is the gate everywhere, and the pixels are compared as well on
   * the platform that produced them. Where they cannot be compared this says so
   * rather than passing quietly, which is the same three-state rule the image
   * verifiers use: could-not-check is not a pass.
   */
  const bundle = createHash('sha256')
  for (const name of readdirSync(join(GALLERY, 'assets')).sort()) {
    bundle.update(name).update(readFileSync(join(GALLERY, 'assets', name)))
  }
  const stamp = {
    bundle: bundle.digest('hex'),
    platform: `${process.platform}-${process.arch}`,
    screens: SCREENS.map((s) => s.as).join(','),
  }
  const stampFile = join(OUT, 'rendered-from.json')
  const previous = existsSync(stampFile)
    ? JSON.parse(readFileSync(stampFile, 'utf8'))
    : { bundle: '', platform: '', screens: '' }
  const comparable = previous.platform === stamp.platform

  const stale = []
  for (const screen of SCREENS) {
    await cdp(page, 'Page.navigate', {
      url: `http://127.0.0.1:${String(PORT)}/?screen=${screen.name}`,
    })
    await sleep(1200)
    /*
     * AND THIS ONE TOOK THE PICTURE ANYWAY.
     *
     * The three checks each refuse to walk past a step that never landed, and
     * each carries a comment explaining that measuring the screen before a step
     * and calling it the screen after is the failure being avoided. This loop
     * ran out of attempts, fell through, and photographed whatever was on the
     * panel. The published shot is what nullroute.diy shows a stranger as the
     * device, so a wrong one is worse here than in a check: a check that is
     * wrong fails, and a screenshot that is wrong gets committed.
     *
     * Dormant rather than harmless. No entry in SCREENS sets `reach`, so
     * `screen.reach ?? []` has always been empty and the loop has never run.
     * It was a trap set for whoever adds the first screenshot that needs a
     * reach list, which is the same reason the rule about the browser path was
     * written before any harness was getting it wrong on purpose.
     */
    const walk = await walkReach(screen.reach ?? [], async (expression) => {
      const r = await cdp(page, 'Runtime.evaluate', {
        expression,
        returnByValue: true,
        // A `keys:` step types on the on-screen keyboard and has to wait for
        // React between taps, so it resolves rather than returning. Harmless
        // for the rest: CDP returns a non-promise result unchanged.
        awaitPromise: true,
      })
      return r.result.value
    })
    if (!walk.reached) {
      console.error(`\ngen-device-shots: ${screen.name} was never reached, so there is no`)
      console.error(`picture of it to take:\n`)
      console.error(`    ${unreachedBecause(walk)}\n`)
      console.error(
        '  Shooting the screen this stopped on would publish it under the name of\n' +
          '  the one it did not reach.\n'
      )
      reap(chrome)
      server.close()
      finish(1)
    }
    const shot = await cdp(page, 'Page.captureScreenshot', { format: 'png' })
    const bytes = Buffer.from(shot.data, 'base64')
    const file = join(OUT, `${screen.as}.png`)

    if (check) {
      // Compared by content, not by presence. A committed screenshot of a
      // screen that has since been redesigned is a picture of a device that no
      // longer exists, which is worse than no picture.
      //
      // ONLY WHERE THE PIXELS CAN BE COMPARED AT ALL. See `platform` below:
      // Chrome rasterises through CoreText on macOS and FreeType on Linux, so
      // the same font and the same markup produce different bytes, and all six
      // of these differed by every byte that matters when CI first ran this.
      if (!existsSync(file)) {
        stale.push(`${screen.as} (no committed image)`)
      } else if (comparable) {
        const current = readFileSync(file)
        const same =
          createHash('sha256').update(current).digest('hex') ===
          createHash('sha256').update(bytes).digest('hex')
        if (!same) stale.push(screen.as)
      }
    } else {
      writeFileSync(file, bytes)
    }
  }

  page.close()
  browser.close()
  reap(chrome)
  server.close()

  if (!check) writeFileSync(stampFile, `${JSON.stringify(stamp, null, 2)}\n`)

  if (check) {
    // THE GATE THAT WORKS EVERYWHERE. The bundle these screens are rendered out
    // of, hashed. If it moved and the images did not, the site is showing a
    // device that has been redesigned since, and that is true whatever machine
    // is asking.
    if (previous.bundle !== stamp.bundle || previous.screens !== stamp.screens) {
      console.error(
        'gen-device-shots: the frontend has changed since these screenshots were made.\n'
      )
      console.error(`  rendered from  ${previous.bundle.slice(0, 16) || '(no stamp)'}`)
      console.error(`  built now      ${stamp.bundle.slice(0, 16)}`)
      console.error('\n  Regenerate with "make device-shots" and look at what changed.\n')
      finish(1)
    }

    if (stale.length > 0) {
      console.error(
        `gen-device-shots: ${String(stale.length)} committed screenshot(s) no longer match the ` +
          `frontend: ${stale.join(', ')}\n`
      )
      console.error('  The site would be showing a device that has been redesigned since.')
      console.error('  Regenerate with "make device-shots" and look at what changed.\n')
      process.exit(1)
    }
    console.log(
      comparable
        ? `gen-device-shots: ${String(SCREENS.length)} screenshots match the frontend, pixel for pixel`
        : `gen-device-shots: ${String(SCREENS.length)} screenshots were rendered from this exact ` +
            `frontend. They were made on ${previous.platform} and this is ${stamp.platform}, and ` +
            `Chrome rasterises differently on each, so the pixels are not compared here.`
    )
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
