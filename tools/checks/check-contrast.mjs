#!/usr/bin/env node
/**
 * Text on this panel is legible, in both themes.
 *
 * WHY A DEVICE LIKE THIS CARES. The whole interface is somebody reading
 * characters off a 7 inch panel and acting on them: twenty four seed words
 * copied onto paper in order, an address compared against a payer's screen, a
 * manifest root compared against a published release. It is used in whatever
 * light the room has, at arm's length, by whoever owns it rather than by
 * somebody with good eyes and a calibrated monitor. Dim text here is not a
 * styling preference, it is the failure mode.
 *
 * WHAT IT FOUND. Forty three (theme, class) pairs under WCAG AA. The worst was
 * the ordinals beside the seed words, at 1.9:1 in both themes, sharing a colour
 * token with `:disabled`: the numbers that keep twenty four words in order,
 * drawn in the colour of a control that does nothing. The whole faint tier sat
 * around 3.1 to 3.5, and the step counter was a button fill colour used as text
 * on the light theme, at 2.9.
 *
 * WHAT IT SKIPS, and why that is not a loophole. Inactive controls: WCAG 1.4.3
 * exempts them, and a disabled button is supposed to look inert. Nothing else.
 *
 * MEASURED, NOT ASSERTED ABOUT TOKENS. The ground under a run of text is
 * whatever composites beneath it, which on this device is often a translucent
 * `color-mix` over a card over the panel. Reading the tokens would miss that;
 * so would sampling a screenshot, which cannot separate text from its
 * background. This composites the chain the browser resolved.
 *
 * Needs: Chrome, and the gallery built (make screens).
 *
 * Run: node tools/checks/check-contrast.mjs
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { readFileSync, existsSync, statSync } from 'node:fs'
import {
  chromeBinary,
  chromeProfile,
  finish,
  reachStep,
  reap,
  waitForDebugEndpoint,
} from '../lib/browser.mjs'
import { join, extname, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const DIST = join(ROOT, 'tools/screens/dist')
const PORT = 8971
const DEBUG = 9451
/* AA. 4.5 for normal text, 3.0 where it is large enough that the eye needs
   less, which is what the `large` flag below decides. */
const AA_NORMAL = 4.5
const AA_LARGE = 3.0
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
}
const server = createServer((rq, rs) => {
  const u = new URL(rq.url ?? '/', `http://127.0.0.1:${PORT}`)
  let f = join(DIST, normalize(u.pathname).replace(/^(\.\.[/\\])+/, ''))
  if (!f.startsWith(DIST)) return void rs.writeHead(403).end()
  if (!existsSync(f) || statSync(f).isDirectory()) f = join(DIST, 'index.html')
  rs.writeHead(200, { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream' })
  rs.end(readFileSync(f))
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let chrome
function cdp(ws, method, params, state) {
  const id = (state.seq += 1)
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.id !== id) return
      ws.removeEventListener('message', onMessage)
      if (message.error) reject(new Error(message.error.message))
      else resolve(message.result)
    }
    ws.addEventListener('message', onMessage)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

const PROBE = `(() => {
  const lum = (c) => { const f=(v)=>{v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4)}
    return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2]) }
  // rgb() gives 0..255; color-mix() computes to color(srgb r g b / a) with 0..1
  // floats. Reading those as 0..255 made every mixed background come out black,
  // which is how the idle chip appeared to be dark text on dark in light mode.
  const parse = (s) => {
    const str = s || ''
    const n = str.match(/[0-9.]+/g)
    if (!n) return null
    const unit = str.startsWith('color(') ? 255 : 1
    return { r: +n[0]*unit, g: +n[1]*unit, b: +n[2]*unit, a: n.length>3 ? +n[3] : 1 }
  }
  const over = (fg,bg) => [fg.r*fg.a+bg[0]*(1-fg.a), fg.g*fg.a+bg[1]*(1-fg.a), fg.b*fg.a+bg[2]*(1-fg.a)]
  const groundOf = (el) => {
    let n = el, acc = null
    const stack = []
    while (n && n.nodeType === 1) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0) stack.push(c); n = n.parentElement }
    // The page's own ground, per theme, not a constant. Hardcoding the dark
    // background made every light-mode element with a transparent ancestor
    // chain read as dark text on dark.
    const root = parse(getComputedStyle(document.body).backgroundColor) ||
                 parse(getComputedStyle(document.documentElement).backgroundColor)
    let base = (root && root.a > 0) ? [root.r, root.g, root.b] : [8,9,11]
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base)
    return base
  }
  const out = []
  for (const el of document.querySelectorAll('*')) {
    if (el.children.length > 0) continue
    const t = (el.textContent||'').trim(); if (t.length === 0) continue
    const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.opacity === '0') continue
    if (el.disabled === true || el.getAttribute('aria-disabled') === 'true') continue
    if (el.closest('button:disabled, [aria-disabled="true"]') !== null) continue
    const fg = parse(cs.color); if (!fg) continue
    const bg = groundOf(el)
    const c = over(fg, bg)
    const L1 = Math.max(lum(c), lum(bg)), L2 = Math.min(lum(c), lum(bg))
    const ratio = (L1 + 0.05) / (L2 + 0.05)
    const px = parseFloat(cs.fontSize)
    const bold = parseInt(cs.fontWeight,10) >= 700
    const large = px >= 24 || (bold && px >= 18.66)
    out.push({ ratio: Math.round(ratio*100)/100, large, px, text: t.slice(0,40), cls: (el.className||'').toString().slice(0,34) })
  }
  return JSON.stringify(out)
})()`

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) {
    console.error('check-contrast: the screen gallery is not built. Run "make screens" first.')
    process.exit(1)
  }
  await new Promise((r) => server.listen(PORT, r))
  chrome = spawn(
    chromeBinary('check-contrast'),
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      `--remote-debugging-port=${DEBUG}`,
      chromeProfile('check-contrast'),
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], detached: true }
  )
  const ws = await waitForDebugEndpoint(chrome, DEBUG)
  const st = { seq: 0 }
  const b = new WebSocket(ws)
  await new Promise((r) => b.addEventListener('open', r, { once: true }))
  const { targetId } = await cdp(b, 'Target.createTarget', { url: 'about:blank' }, st)
  const list = await (await fetch(`http://127.0.0.1:${DEBUG}/json/list`)).json()
  const page = new WebSocket(list.find((t) => t.id === targetId).webSocketDebuggerUrl)
  await new Promise((r) => page.addEventListener('open', r, { once: true }))
  await cdp(page, 'Page.enable', {}, st)
  await cdp(
    page,
    'Emulation.setDeviceMetricsOverride',
    { width: 800, height: 480, deviceScaleFactor: 1, mobile: false },
    st
  )
  await cdp(page, 'Page.navigate', { url: `http://127.0.0.1:${PORT}/` }, st)
  await sleep(1400)
  const screens = JSON.parse(
    (
      await cdp(
        page,
        'Runtime.evaluate',
        { expression: 'JSON.stringify(window.NULLROUTE_SCREENS ?? [])', returnByValue: true },
        st
      )
    ).result.value
  )
  if (screens.length === 0) throw new Error('the gallery listed no screens, so this check is blind')

  /*
   * Severity is a colour, and two severities may not be the same colour.
   *
   * WHAT WENT WRONG. --color-caution-* held exactly the values of
   * --color-danger-*, in both themes, down to the hex. So a device that would
   * not sign and a device saying "this is signet, the coins are worth nothing"
   * were drawn identically: same border, same text, near-identical fill. The
   * stylesheet distinguishes them in a comment ("Blocking. The device will not
   * sign, as opposed to merely disliking it") and the panel did not.
   *
   * It is not a missing distinction so much as an inverted one. The testnet
   * strip is PERMANENT on any device not on mainnet, so every screen spent its
   * time teaching somebody that this particular red means nothing, and then a
   * refusal arrived wearing it.
   *
   * Nothing else here could see it. Every contrast run passed, because both
   * colours are perfectly legible; they are legible and they are the same.
   *
   * Checked as resolved values rather than by reading the file, so an alias
   * pointing one set at the other still fails.
   */
  const FAMILIES = ['accent', 'caution', 'danger', 'verify']

  /* 20 degrees. A floor on telling two of these apart, not a design target:
     the four sit at 2, 27, 53 and 159, so the tightest real pair has 26. */
  const MIN_HUE_GAP = 20

  const SEVERITY = `(() => {
    const style = getComputedStyle(document.documentElement)
    const probe = document.createElement('div')
    document.body.appendChild(probe)
    // Resolved through the browser, so an alias or a color-mix() still answers
    // in numbers rather than in whatever was typed.
    const rgb = (name) => {
      probe.style.color = ''
      probe.style.color = style.getPropertyValue(name).trim()
      const n = getComputedStyle(probe).color.match(/[0-9.]+/g)
      return n === null ? null : { r: +n[0], g: +n[1], b: +n[2] }
    }
    const hue = (c) => {
      const max = Math.max(c.r, c.g, c.b)
      const min = Math.min(c.r, c.g, c.b)
      if (max === min) return null
      const d = max - min
      const h = max === c.r
        ? ((c.g - c.b) / d) % 6
        : max === c.g
          ? (c.b - c.r) / d + 2
          : (c.r - c.g) / d + 4
      return ((h * 60) % 360 + 360) % 360
    }
    const out = {}
    for (const family of ${JSON.stringify(FAMILIES)}) {
      const c = rgb('--color-' + family + '-text')
      out[family] = c === null ? null : { hue: hue(c), rgb: c }
    }
    probe.remove()
    return JSON.stringify(out)
  })()`

  /* Worst case per (theme, class), because one class failing on nine screens is
     one thing to fix and nine lines of output is a wall. */
  const worst = new Map()
  /** Themes whose caution and danger palettes are the same colour. */
  const collapsed = []
  let runs = 0
  for (const theme of ['dark', 'light']) {
    for (const { name, reach } of screens) {
      await cdp(page, 'Page.navigate', { url: `http://127.0.0.1:${PORT}/?screen=${name}` }, st)
      await sleep(420)
      await cdp(
        page,
        'Runtime.evaluate',
        { expression: `document.documentElement.setAttribute('data-theme', '${theme}')` },
        st
      )
      await sleep(200)
      for (const step of reach) {
        // Retried, because some of these states arrive on their own clock: the
        // scan screen's refusal is two seconds of camera and decoder after the
        // screen itself. Walking past a step that found nothing measures the
        // screen before it and calls it the screen after.
        for (let attempt = 0; attempt < 40; attempt += 1) {
          const acted = await cdp(
            page,
            'Runtime.evaluate',
            { expression: reachStep(step), returnByValue: true, awaitPromise: true },
            st
          )
          if (acted.result.value === 'clicked') break
          await sleep(80)
        }
        await sleep(260)
      }
      const rows = JSON.parse(
        (await cdp(page, 'Runtime.evaluate', { expression: PROBE, returnByValue: true }, st)).result
          .value
      )
      if (!collapsed.some((c) => c.theme === theme)) {
        const sev = JSON.parse(
          (await cdp(page, 'Runtime.evaluate', { expression: SEVERITY, returnByValue: true }, st))
            .result.value
        )
        for (let i = 0; i < FAMILIES.length; i += 1) {
          for (let j = i + 1; j < FAMILIES.length; j += 1) {
            const a = sev[FAMILIES[i]]
            const b = sev[FAMILIES[j]]
            if (a === null || b === null || a.hue === null || b.hue === null) {
              collapsed.push({ theme, a: FAMILIES[i], b: FAMILIES[j], gap: null, sev })
              continue
            }
            const raw = Math.abs(a.hue - b.hue)
            const gap = Math.min(raw, 360 - raw)
            if (gap >= MIN_HUE_GAP) continue
            collapsed.push({ theme, a: FAMILIES[i], b: FAMILIES[j], gap, sev })
          }
        }
      }
      runs += rows.length
      for (const r of rows) {
        const need = r.large ? AA_LARGE : AA_NORMAL
        if (r.ratio >= need) continue
        const key = `${theme}|${r.cls}`
        if (!worst.has(key) || worst.get(key).ratio > r.ratio)
          worst.set(key, { ...r, theme, screen: name, need })
      }
    }
  }

  reap(chrome)
  server.close()

  if (collapsed.length > 0) {
    console.error(`\ncheck-contrast: two meanings are drawn in the same colour:\n`)
    for (const c of collapsed) {
      const gap = c.gap === null ? 'one of them is grey' : `${c.gap.toFixed(1)} degrees apart`
      console.error(
        `    ${c.theme.padEnd(5)} ${c.a} and ${c.b}: ${gap}, and ${String(MIN_HUE_GAP)} is the floor`
      )
      for (const family of FAMILIES) {
        const v = c.sev[family]
        console.error(
          `          ${family.padEnd(8)} ${v === null || v.hue === null ? 'no hue' : `${v.hue.toFixed(1)}deg`}` +
            `  rgb(${v === null ? '?' : `${String(v.rgb.r)} ${String(v.rgb.g)} ${String(v.rgb.b)}`})`
        )
      }
    }
    console.error(
      `\n  These four mean four different things and somebody has to tell them apart on\n` +
        `  a 7 inch panel in whatever light the room has. --color-caution-* once held\n` +
        `  exactly the values of --color-danger-*, so a device that would not sign and a\n` +
        `  permanent strip saying the coins are worth nothing were the same colour: not a\n` +
        `  missing distinction so much as training somebody to ignore the one that\n` +
        `  matters. Nothing else here can see it, because both are perfectly legible.\n`
    )
    finish(1)
  }

  const failing = [...worst.values()].sort((a, b) => a.ratio - b.ratio)
  if (failing.length > 0) {
    console.error(`\ncheck-contrast: ${String(failing.length)} class(es) below WCAG AA:\n`)
    for (const r of failing) {
      console.error(
        `    ${r.theme.padEnd(5)} ${String(r.ratio).padStart(5)}:1  needs ${String(r.need)}  ` +
          `${String(Math.round(r.px)).padStart(2)}px  ${(r.cls || '(no class)').padEnd(30)} ` +
          `${r.screen}: ${r.text}`
      )
    }
    console.error(
      `\n  Contrast is measured against what actually composites under the text, so a\n` +
        `  token that looks fine on the panel can still fail on a card or a translucent\n` +
        `  banner. Raise the colour rather than the font size unless the text is genuinely\n` +
        `  decorative, and remember that the same token has to clear this in both themes.\n`
    )
    finish(1)
  }

  console.log(
    `check-contrast: ${String(runs)} text run(s) across ${String(screens.length)} states in ` +
      `2 themes, all at WCAG AA or better`
  )
  finish(0)
}

main().catch((err) => {
  reap(chrome)
  try {
    server.close()
  } catch {
    /* already closed */
  }
  console.error(`check-contrast: ${err.message}`)
  process.exit(1)
})
