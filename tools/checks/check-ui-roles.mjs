#!/usr/bin/env node
/**
 * Explanation on this device is written one of three ways, on purpose.
 *
 *   Banner  something is wrong, or is about to be. Toned, boxed.
 *   Info    what this screen is for and what to do. Neutral, a left rule.
 *   Hint    micro-copy belonging to one control. Unboxed, beside it.
 *
 * Before the Info component existed there were only the other two, so guidance
 * about a screen was written as whichever came to hand: 38 uses of `nr-note` at
 * 14px and 69 of `nr-hint` at 13px, the same thing at two brightnesses, chosen
 * by whoever wrote the screen. Seventeen paragraphs of screen-level guidance sat
 * directly in a body in one of those two styles, which is the position an Info
 * belongs in.
 *
 * WHAT THIS ENFORCES, and it is narrow on purpose: prose sitting as a direct
 * child of the screen body is guidance, and guidance is an Info. Inside a card
 * or beside a field it is micro-copy and this says nothing about it.
 *
 * The exception is marked rather than guessed at. `data-prose="result"` is for a
 * line that reports what just happened rather than telling somebody what to do,
 * which from the outside looks identical.
 *
 * Needs: Chrome, and the gallery built (make screens).
 *
 * Run: node tools/checks/check-ui-roles.mjs
 */
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { chromeBinary, chromeProfile, finish, reachStep, reap } from '../lib/browser.mjs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const DIST = join(ROOT, 'tools/screens/dist')
const PORT = 8981
const DEBUG = 9461
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
function cdp(ws, method, params, st) {
  const id = (st.seq += 1)
  return new Promise((res, rej) => {
    const on = (e) => {
      const m = JSON.parse(e.data)
      if (m.id !== id) return
      ws.removeEventListener('message', on)
      if (m.error) rej(new Error(m.error.message))
      else res(m.result)
    }
    ws.addEventListener('message', on)
    ws.send(JSON.stringify({ id, method, params }))
  })
}
const PROBE = `(() => {
  const body=document.querySelector('.nr-screen__body'); if(!body) return '[]'
  const bad=[]
  for(const el of body.children){
    const c=(el.className||'').toString()
    // Marked, not guessed at: a line reporting what just happened looks like
    // guidance from out here.
    if(el.getAttribute('data-prose') === 'result') continue
    if(/\\bnr-note\\b|\\bnr-hint\\b/.test(c)) bad.push({cls:c, text:(el.textContent||'').trim().slice(0,60)})
  }
  return JSON.stringify(bad)
})()`
async function main() {
  await new Promise((r) => server.listen(PORT, r))
  chrome = spawn(
    chromeBinary('check-ui-roles'),
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--hide-scrollbars',
      `--remote-debugging-port=${DEBUG}`,
      chromeProfile('check-ui-roles'),
      'about:blank',
    ],
    { stdio: 'ignore', detached: true }
  )
  let ws
  for (let i = 0; i < 100; i++) {
    await sleep(150)
    try {
      ws = (await (await fetch(`http://127.0.0.1:${DEBUG}/json/version`)).json())
        .webSocketDebuggerUrl
      break
    } catch {
      /* not up yet */
    }
  }
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
        { expression: 'JSON.stringify(window.NULLROUTE_SCREENS??[])', returnByValue: true },
        st
      )
    ).result.value
  )
  const seen = new Map()
  for (const { name, reach } of screens) {
    await cdp(page, 'Page.navigate', { url: `http://127.0.0.1:${PORT}/?screen=${name}` }, st)
    await sleep(500)
    // Retried for the same reason check-contrast retries: a step that found
    // nothing yet is not a step to walk past.
    for (const step of reach) {
      for (let a = 0; a < 40; a += 1) {
        const r = await cdp(
          page,
          'Runtime.evaluate',
          { expression: reachStep(step), returnByValue: true, awaitPromise: true },
          st
        )
        if (r.result.value === 'clicked') break
        await sleep(80)
      }
      await sleep(300)
    }
    for (const r of JSON.parse(
      (await cdp(page, 'Runtime.evaluate', { expression: PROBE, returnByValue: true }, st)).result
        .value
    )) {
      const k = name + '|' + r.text
      if (!seen.has(k)) seen.set(k, { name, ...r })
    }
  }
  if (seen.size > 0) {
    console.error(
      `\ncheck-ui-roles: ${seen.size} paragraph(s) of guidance not written as an Info:\n`
    )
    for (const v of seen.values())
      console.error(`    ${v.name.padEnd(24)} ${v.cls.padEnd(22)} ${v.text}`)
    console.error(
      `\n  Prose sitting directly in a screen body is guidance about the screen, and\n` +
        `  guidance is an <Info>. A note or a hint there is the same words in one of the\n` +
        `  two styles that existed before there was a box for this. If it reports what\n` +
        `  just happened rather than telling somebody what to do, mark it\n` +
        `  data-prose="result" and say why.\n`
    )
    reap(chrome)
    server.close()
    finish(1)
  }
  console.log(`check-ui-roles: ${screens.length} screen states, guidance is an Info everywhere`)
  reap(chrome)
  server.close()
  finish(0)
}
main().catch((err) => {
  reap(chrome)
  try {
    server.close()
  } catch {
    /* already closed */
  }
  console.error(`check-ui-roles: ${err.message}`)
  process.exit(1)
})
