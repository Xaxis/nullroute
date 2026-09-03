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
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromeProfile, finish, reachStep, reachTarget, reap } from './lib/browser.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIST = join(ROOT, 'tools/screens/dist')
// 8931 rather than something in the 9400s. Chrome refuses to connect to a list
// of ports it considers unsafe, and does it by failing the navigation while
// Page.navigate still returns a loaderId and no errorText, so the page comes
// back blank and every diagnostic says the load succeeded.
/**
 * Is the scroll shadow actually visible against the ground it is painted on?
 *
 * Most states on this device have content below the fold, and that gradient at
 * the bottom of the body is the only thing that says so. It was written as a
 * literal rgb(0 0 0 / 45%), a black shadow, which over the dark theme's #08090b
 * moves a pixel from (8,9,11) to (5,5,6): a luminance difference of about 3 out
 * of 255, which nobody can see. It was obvious in light mode, which is how it
 * survived being looked at.
 *
 * Composited here rather than sampled from a screenshot, because the question
 * is about two colours and not about a rendering: read the scrim and the ground
 * as the browser resolves them, put one over the other, and compare. That also
 * means it can be asked of a theme without rendering a screen in it.
 */
const SCRIM = `(() => {
  const probe = document.createElement('div')
  document.body.appendChild(probe)
  const read = (value) => {
    probe.style.backgroundColor = ''
    probe.style.backgroundColor = value
    const shown = getComputedStyle(probe).backgroundColor
    const n = shown.match(/[0-9.]+/g)
    if (n === null) return null
    return { r: +n[0], g: +n[1], b: +n[2], a: n.length > 3 ? +n[3] : 1 }
  }
  const style = getComputedStyle(document.documentElement)
  const scrim = read(style.getPropertyValue('--color-scroll-scrim').trim())
  const ground = read(style.getPropertyValue('--color-bg').trim())
  probe.remove()
  if (scrim === null || ground === null) return JSON.stringify({ missing: true })

  // Source-over, which is what the gradient does to the ground beneath it.
  const over = (c) => scrim[c] * scrim.a + ground[c] * (1 - scrim.a)
  const lum = (o) => 0.2126 * o.r + 0.7152 * o.g + 0.0722 * o.b
  const blended = { r: over('r'), g: over('g'), b: over('b') }
  return JSON.stringify({
    delta: Math.abs(lum(blended) - lum(ground)),
    scrim: scrim,
    ground: ground,
  })
})()`

/* Comfortably above the 3 the black-on-black scrim produced and well under the
   40 and 94 the themes measure now. It is a floor on perceptibility, not a
   design target. */
const MIN_SCRIM_DELTA = 12

const DIM = '\u001b[2m'
const OFF = '\u001b[0m'

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
 * The tallest the header may be, in CSS pixels.
 *
 * The header is a system rather than a per-screen decision: brand, title,
 * identity, menu, in that order, on all thirty six states. A header that is 74px
 * on most screens and 94px on eight of them is not that system, it is that
 * system with eight exceptions, and the exceptions were not chosen. They were
 * subtitles four characters too long for the title column, which wrapped to a
 * second line and took the whole header with them.
 *
 * That costs the body 20px on the screens least able to spare it, and it costs
 * the interface something worse: the title moves between screens, so the one
 * fixed point on a panel with no browser chrome is not fixed.
 *
 * 78 rather than 74, so the floor is set by the type and not by this number.
 * A subtitle that needs two lines is a subtitle to shorten.
 */
const MAX_HEADER = 78

/**
 * The gap two adjacent controls need, in CSS pixels.
 *
 * Targets that meet the size rule and touch each other still produce mis-taps,
 * because a fingertip is wider than the point the browser reports. Only
 * neighbours are checked: a control far from anything else can be any distance
 * from the rest of the screen.
 */
const MIN_GAP = 6

/**
 * Every statement in the product that is marked as one somebody has to see.
 *
 * Read from the source rather than from what the gallery happens to render,
 * because the question this answers is the one the gallery cannot: which of
 * these has NEVER been drawn at 800x480.
 *
 * The distinction matters more than it sounds. data-must-see is measured only
 * on states that exist, so marking thirty seven banners and building three
 * states produces a green line that means "the three fit" while reading as
 * "the rule holds". Nineteen error banners were asserted by unit tests and
 * rendered by nothing, and two of them turned out to be off the bottom of the
 * panel the first time anything drew them. jsdom computes no box, so a banner
 * nobody can see passes every assertion written against it.
 *
 * Only the ones carrying a testid, which is the identifier a gallery state and
 * a unit test can both name. One card on the seed screen is marked without one
 * and is on that screen unconditionally.
 */
function markedInSource() {
  const found = new Map()
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(path)
        continue
      }
      if (!entry.name.endsWith('.tsx')) continue
      const source = readFileSync(path, 'utf8')
      // One JSX opening tag at a time, so an attribute pair is only counted
      // when both attributes are on the same element. Split on '<' and require
      // the fragment to close before the next tag opens.
      for (const fragment of source.split('<')) {
        const end = fragment.indexOf('>')
        if (end === -1) continue
        const tag = fragment.slice(0, end)
        // Either written out, or a Refusal, which renders the marker itself.
        // WITHOUT THE SECOND HALF THIS LEDGER SILENTLY EMPTIES. Twenty four of
        // these banners were hand-written markup and became <Refusal>, and the
        // count went from thirty one to ten on a green run: the marker was
        // still on every one of them, one level down, and the scrape could no
        // longer see it. A coverage check that stops asking is worse than none,
        // because the number it prints still looks like an answer.
        const isRefusal = /^Refusal[\s/>]/.test(tag)
        if (!tag.includes('data-must-see') && !isRefusal) continue
        const id = (isRefusal ? /testId="([^"]+)"/ : /data-testid="([^"]+)"/).exec(tag)
        if (id === null) continue
        const where = found.get(id[1]) ?? new Set()
        where.add(path.slice(path.indexOf('packages/')))
        found.set(id[1], where)
      }
    }
  }
  walk(join(ROOT, 'packages/ui/src'))

  /* The assumption the Refusal half rests on, stated where it is relied upon.
     If that component stops marking itself, every screen using it drops out of
     this ledger at once and nothing else would say so. */
  const refusal = readFileSync(join(ROOT, 'packages/ui/src/components/Refusal.tsx'), 'utf8')
  if (!refusal.includes('data-must-see')) {
    throw new Error(
      'Refusal no longer renders data-must-see, so every refusal on the device has ' +
        'silently left this ledger. Put the marker back or stop counting Refusal here.'
    )
  }
  return found
}

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
  const MAX_HEADER = ${MAX_HEADER}
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

  const head = document.querySelector('.nr-screen__head')
  if (head !== null) {
    const hr = head.getBoundingClientRect()
    // A step counter is a deliberate extra line above the title, on the screens
    // a guided journey passes through, so those headers are legitimately one
    // line taller. The rule is that the header is one of TWO heights and never
    // a third: what it exists to catch is a subtitle four characters too long
    // wrapping and taking the header with it.
    const steps = document.querySelector('.nr-steps')
    const limit = steps === null ? MAX_HEADER : MAX_HEADER + 20
    if (hr.height > limit) {
      const sub = document.querySelector('.nr-screen__subtitle')
      problems.push({
        kind: 'header-too-tall',
        detail: 'the header is ' + Math.round(hr.height) + 'px and the limit ' +
          (steps === null ? 'without' : 'with') + ' a step counter is ' + limit +
          (sub === null ? '' : ', so this subtitle wraps: "' + sub.textContent.trim() + '"'),
      })
    }
  }

  /*
   * THE BODY FILLS THE PANEL, and the banner strip is not empty.
   *
   * Both halves of one bug that shipped and that nothing here could see.
   *
   * .nr-screen was a three row grid and Screen renders four children the moment
   * a banner exists, so grid gave the 1fr to the banner strip and put the body
   * in an implicit auto row. The strip stretched to fill the panel and the body
   * shrank to the height of its own text. Separately, App built the banner as a
   * fragment with two conditional children, which on a mainnet device with no
   * idle warning is an element that renders nothing, so the strip appeared with
   * nothing in it and then took 180px of an 800x480 panel.
   *
   * Every existing assertion passed throughout. The action bar was still at the
   * bottom, every control was still on screen, and the body had stopped
   * overflowing precisely because it had collapsed.
   *
   * So: nothing between the body and the bar, and no strip without content.
   */
  const screenBody = document.querySelector('.nr-screen__body')
  const actionBar = document.querySelector('.nr-screen__actions')
  if (screenBody !== null && actionBar !== null) {
    const gap = Math.round(actionBar.getBoundingClientRect().top - screenBody.getBoundingClientRect().bottom)
    if (gap > 1) {
      problems.push({
        kind: 'body-does-not-fill',
        detail: 'there is a ' + gap + 'px gap between the bottom of the body and the action bar, ' +
          'so something other than the body is taking the panel height',
      })
    }
  }

  const strip = document.querySelector('.nr-screen__banners')
  if (strip !== null && strip.getBoundingClientRect().height > 0) {
    let content = 0
    for (const child of strip.children) {
      const cr = child.getBoundingClientRect()
      if (cr.width > 0 && cr.height > 0) content += 1
    }
    if (content === 0) {
      problems.push({
        kind: 'empty-banner-strip',
        detail: 'the banner strip is rendered and holds nothing, so it is ' +
          Math.round(strip.getBoundingClientRect().height) + 'px of border and padding ' +
          'announcing a warning that is not there',
      })
    }
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

  /*
   * A control with something painted over it is not a target.
   *
   * The navigation menu opens a panel over the screen behind it, with a scrim
   * across the rest, and every control underneath keeps its geometry: the
   * harness read a menu entry and a button four layers below it as neighbours
   * 0px apart. They are not neighbours, because a finger landing on either
   * point reaches the panel or the scrim, and never the button.
   *
   * Tested at the centre, and only against the top layer being an ancestor or
   * a descendant, so a control that is genuinely half-buried still fails. This
   * does not weaken the under-the-action-bar check: that one measures whether a
   * control can be SCROLLED clear, and asks a different question of a different
   * geometry.
   */
  const covered = (el, r) => {
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false
    const top = document.elementFromPoint(x, y)
    if (top === null) return false
    return !el.contains(top) && !top.contains(el)
  }

  /*
   * How much of a control is actually painted.
   *
   * A scrolling body clips its children, and the header above it is opaque, so
   * a control scrolled halfway under the header is only tappable from where it
   * emerges. The harness measured the whole rect and read a header button and a
   * body button scrolled beneath it as neighbours 0px apart, when nothing on
   * screen ever showed them touching. That was a blind spot the whole time: it
   * only surfaced once the header had a control in it to compare against.
   *
   * Intersected with every clipping ancestor, so this reports what a finger can
   * reach rather than what the layout would like to exist.
   */
  const painted = (el, r) => {
    let box = { top: r.top, bottom: r.bottom, left: r.left, right: r.right }
    for (let p = el.parentElement; p !== null; p = p.parentElement) {
      const style = getComputedStyle(p)
      const clips =
        style.overflow !== 'visible' ||
        style.overflowX !== 'visible' ||
        style.overflowY !== 'visible'
      if (!clips) continue
      const c = p.getBoundingClientRect()
      box = {
        top: Math.max(box.top, c.top),
        bottom: Math.min(box.bottom, c.bottom),
        left: Math.max(box.left, c.left),
        right: Math.min(box.right, c.right),
      }
    }
    return {
      top: box.top,
      bottom: Math.max(box.top, box.bottom),
      left: box.left,
      right: Math.max(box.left, box.right),
    }
  }

  const targets = []
  for (const el of document.querySelectorAll('button, a[href], input, textarea, summary, [role="button"]')) {
    if (!visible(el)) continue
    const r = hitBox(el)
    if (r.width === 0 && r.height === 0) continue
    if (!onScreen(el, r)) continue
    if (covered(el, r)) continue
    // A field the user types into is sized by its content and is not a target
    // in the same sense: nothing sits beside it to mis-hit.
    const typed = el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type !== 'checkbox')
    // The raw rect for size, because a control clipped by a scroll can be
    // scrolled back into view and is still the size it is. The painted rect for
    // adjacency, because two controls never shown side by side cannot be
    // mis-tapped for each other.
    targets.push({ el, r, p: painted(el, r), typed, name: label(el) })
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

      // Gap along each axis, between the parts that are actually painted. A
      // negative value on both means they overlap.
      const dx = Math.max(a.p.left - b.p.right, b.p.left - a.p.right)
      const dy = Math.max(a.p.top - b.p.bottom, b.p.top - a.p.bottom)
      const gap = Math.max(dx, dy)
      if (gap >= MIN_GAP) continue
      // Only when they actually sit beside each other: two controls in
      // different columns and different rows are not confusable.
      const overlapsX = a.p.left < b.p.right && b.p.left < a.p.right
      const overlapsY = a.p.top < b.p.bottom && b.p.top < a.p.bottom
      if (!overlapsX && !overlapsY) continue

      problems.push({
        kind: 'targets-too-close',
        detail: '"' + a.name + '" and "' + b.name + '" are ' + Math.round(Math.max(gap, 0)) +
          'px apart, and adjacent targets need ' + MIN_GAP + 'px',
      })
    }
  }

  /* How far this screen runs past the fold.
     NOT a failure. Some screens are genuinely lists: a transaction with eight
     outputs does not fit in 480px and should not be made to, and the seed is
     twenty four words. What was wrong was that nobody could see the number.
     This harness printed "68 screen states fit 800x480" while 52 of them had
     content below the fold, which is a different sentence from the one it was
     printing. The body element above is this same one, read after the scroll,
     which changes neither measurement. */
  const overflow = body === null ? 0 : Math.max(0, body.scrollHeight - body.clientHeight)

  return JSON.stringify({ problems: problems.slice(0, 10), overflow: overflow })
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

/**
 * The on-screen keyboard, before anything is scrolled.
 *
 * This device has no other input device. Everything else on a screen may sit
 * below the fold and be scrolled to, which is why MEASURE runs after
 * SCROLL_TO_END, but a keyboard cannot: somebody typing is looking at the keys,
 * and a keyboard whose bottom row is off the panel is one where the keys move
 * under the finger between one character and the next.
 *
 * It found the unlock gate, which is the first screen anybody touches on a
 * provisioned device, with Space and Back 242px past the bottom of the panel.
 * The grid was nine columns wide on a 760px row, spending width it had on
 * height it did not.
 *
 * Measured against the action bar rather than the viewport: the bar is opaque
 * and fixed, so a key beneath it is as gone as one below the screen edge.
 */
/**
 * Statements that have to be on the panel when the screen arrives.
 *
 * Almost everything here may sit below the fold and be scrolled to. A few
 * things may not, and they are the ones where acting without having read them
 * loses the money: the seed screen's "do not photograph this", the fingerprint
 * that is the only thing distinguishing a mistyped passphrase from the right
 * one, the note that a signature on this transaction belongs to nobody in the
 * quorum.
 *
 * WHAT WENT WRONG WITHOUT THIS. SeedScreen carries a comment reading "Side by
 * side they both fit under the grid with room to spare". They do not. Both were
 * cut through the middle of a sentence, on the one screen in the product that
 * shows a seed and then never shows it again. Somebody measured once, a network
 * banner and a step counter arrived later, and nothing re-measured. That is
 * what a comment is worth against a check.
 *
 * Marked in the markup rather than guessed at from the class, because there is
 * no way to tell a warning from a caption by looking: the untraced-signature
 * note was a plain nr-note, the same class as ordinary secondary text.
 *
 * Runs BEFORE the scroll, for the same reason the keyboard does: reachable by
 * scrolling is not the claim being made.
 */
const MUST_SEE = `(() => {
  const body = document.querySelector('.nr-screen__body')
  if (body === null) return JSON.stringify({ problems: [] })
  const limit = body.getBoundingClientRect()
  const problems = []
  for (const el of document.querySelectorAll('[data-must-see]')) {
    const r = el.getBoundingClientRect()
    if (r.height === 0) continue
    const under = Math.round(r.bottom - limit.bottom)
    const over = Math.round(limit.top - r.top)
    if (under <= 1 && over <= 1) continue
    // Doubled, because this is a template literal: the browser has to receive
    // \\s. Written singly it collapsed to the letter s, so the regex replaced
    // every s in the sentence with a space and the failure read "1 ignature on
    // thi tran action". Lint caught it.
    const text = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 60)
    problems.push({
      kind: 'must-see-below-the-fold',
      detail:
        (under > 1 ? under + 'px of it is under the fold' : over + 'px of it is above the top') +
        ' when the screen arrives: "' + text + '"',
    })
  }
  // Which of them this state actually drew, for the coverage ledger below.
  // Height, not presence: a banner React did not render has no box, and one
  // rendered into a collapsed container is not on the panel either.
  const drawn = []
  for (const el of document.querySelectorAll('[data-must-see][data-testid]')) {
    if (el.getBoundingClientRect().height > 0) drawn.push(el.getAttribute('data-testid'))
  }
  return JSON.stringify({ problems: problems, drawn: drawn })
})()`

const KEYBOARD = `(() => {
  const bar = document.querySelector('.nr-screen__actions')
  const limit = bar === null ? document.documentElement.clientHeight : bar.getBoundingClientRect().top
  const problems = []

  const kb = document.querySelector('.nr-kb__keys')
  /*
   * A refusal on screen changes which state this rule is about.
   *
   * The rule is that somebody TYPING can see the keys. A refusal is about the
   * attempt before this one, costs about 50px at the top of the body, and on
   * six screens that was enough to push the bottom row under the action bar.
   * Those screens clear the refusal on the next keystroke, so the state a
   * person types in has no banner in it and the keys are all there.
   *
   * That claim is checked rather than believed: the caller taps a key and asks
   * again. A screen that keeps its refusal while somebody retypes still fails,
   * and now fails saying so.
   */
  const refusal = document.querySelector('.nr-screen__body [data-must-see].nr-banner')
  if (kb !== null) {
    const r = kb.getBoundingClientRect()
    if (r.bottom > limit + 1) {
      problems.push({
        kind: 'keyboard-below-the-fold',
        clearedByTyping: refusal !== null,
        detail: 'the keys span ' + Math.round(r.top) + '..' + Math.round(r.bottom) +
          ' and the action bar starts at ' + Math.round(limit) +
          ', so ' + Math.round(r.bottom - limit) + 'px of keyboard needs scrolling to' +
          (refusal === null ? '' : ', with a refusal above them taking ' +
            Math.round(refusal.getBoundingClientRect().height) + 'px'),
      })
    }
  }

  /*
   * A QR code, whole.
   *
   * The same rule as the keyboard and for a sharper reason. A code three
   * quarters on screen looks scannable: it is square, it has its quiet zone on
   * three sides, and nothing about it says the bottom rows are missing. The
   * user points a phone at it and gets nothing, and the thing they conclude is
   * that the camera is bad or the light is wrong, because the screen looks
   * right.
   *
   * This is also the whole outbound half of the air gap. Everything this device
   * hands back leaves through one of these.
   */
  for (const el of document.querySelectorAll('.nr-qr__code')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    if (r.bottom <= limit + 1) continue
    /*
     * Inside a region that declares itself scrollable is the one exception,
     * and it is a declaration in the markup rather than a list of screen names
     * here. A class of nr-fill means "this is a reference page you scroll",
     * which is true of the export tab: the quorum descriptor comes first on
     * that screen for a reason that has nothing to do with layout, and it is
     * 250px on its own.
     *
     * The exception is narrow on purpose. Everywhere else the code has to be
     * on the screen when the screen arrives, which is what put it beside the
     * text on receive, on the signed transaction, and on the export itself
     * rather than under it.
     */
    if (el.closest('.nr-fill') !== null) continue
    problems.push({
      kind: 'qr-below-the-fold',
      detail: 'the code spans ' + Math.round(r.top) + '..' + Math.round(r.bottom) +
        ' and the action bar starts at ' + Math.round(limit) +
        ', so ' + Math.round(r.bottom - limit) + 'px of it is under the bar, which looks' +
        ' like a scannable code and is not',
    })
  }

  return JSON.stringify({ problems: problems })
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
      chromeProfile('check-screen-fit'),
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

  /**
   * Wait for a selector to be in the document, up to a bound.
   *
   * Returns either way: the caller's own assertion is what decides, and a
   * timeout here should read as whatever that assertion says rather than as a
   * separate kind of failure.
   */
  const settled = async (selector) => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const there = await cdp(
        page,
        'Runtime.evaluate',
        {
          expression: `document.querySelector(${JSON.stringify(selector)}) !== null`,
          returnByValue: true,
        },
        state
      )
      if (there.result.value === true) {
        // One more frame, so a just-mounted subtree has been laid out.
        await sleep(120)
        return
      }
      await sleep(60)
    }
  }

  let failed = 0
  /** States whose body scrolls, with how far. Reported, never failed. */
  const below = []
  /** Marked statements this run actually drew, and the state that drew each. */
  const drawn = new Map()

  /*
   * The affordance those scrolling states depend on, checked once per theme.
   *
   * Asked here rather than in a stylesheet test because the value is a token
   * whose meaning depends on the theme resolving around it, and asked at all
   * because a scrim the same colour as its ground is not a subtle bug: it looks
   * finished in the source and does nothing on the device.
   */
  for (const theme of ['dark', 'light']) {
    await cdp(
      page,
      'Runtime.evaluate',
      { expression: `document.documentElement.setAttribute('data-theme', '${theme}')` },
      state
    )
    const measured = JSON.parse(
      (await cdp(page, 'Runtime.evaluate', { expression: SCRIM, returnByValue: true }, state))
        .result.value
    )
    if (measured.missing === true) {
      failed += 1
      console.error(
        `\nthe ${theme} theme defines no --color-scroll-scrim, so nothing marks ` +
          `the edge of a scrolling screen.`
      )
      continue
    }
    if (measured.delta < MIN_SCRIM_DELTA) {
      failed += 1
      console.error(
        `\nthe ${theme} theme's scroll shadow is invisible against its own ground:\n` +
          `    --color-scroll-scrim over --color-bg differs by ${measured.delta.toFixed(1)} ` +
          `of 255, and ${String(MIN_SCRIM_DELTA)} is the floor.\n` +
          `    Most states here have content below the fold and this gradient is the only\n` +
          `    thing that says so. A scrim has to contrast with the ground it sits on, which\n` +
          `    means it is a per-theme token and never a literal colour.`
      )
    }
  }
  await cdp(
    page,
    'Runtime.evaluate',
    { expression: `document.documentElement.removeAttribute('data-theme')` },
    state
  )
  for (const { name, reach } of screens) {
    const label = reach.length === 0 ? name : `${name} after ${reach.join(' then ')}`

    await cdp(
      page,
      'Page.navigate',
      { url: `http://127.0.0.1:${String(PORT)}/?screen=${name}` },
      state
    )
    /* WAIT FOR THE SCREEN, do not guess at 700ms.
       Under load this harness measured states that had not rendered: one
       reported "no action bar at all" and another that a tab it was told to tap
       was missing, on two consecutive runs, in different places. That is a
       timing bug wearing the costume of a layout failure, and a check that
       fails at random is one people learn to re-run rather than read. */
    await settled('.nr-screen__actions, .nr-screen__body')

    // Tapped in order, and a testid that no longer exists fails rather than
    // being skipped: a reach list that quietly stopped reaching anywhere would
    // report every state as fitting while measuring only the first.
    let unreachable = null
    for (const step of reach) {
      // Same reason: a control one render behind is not a missing control.
      await settled(reachTarget(step))
      const acted = await cdp(
        page,
        'Runtime.evaluate',
        { expression: reachStep(step), returnByValue: true },
        state
      )
      if (acted.result.value !== 'clicked') {
        unreachable = `${step} (${String(acted.result.value)})`
        break
      }
      await sleep(250)
    }

    if (unreachable !== null) {
      failed += 1
      console.error(`\n${label}:`)
      console.error(`    unreachable: ${unreachable}`)
      continue
    }

    // BEFORE the scroll, deliberately. Everything else here asks what the user
    // can reach; this one asks what they can see while typing.
    let keys = await cdp(
      page,
      'Runtime.evaluate',
      { expression: KEYBOARD, returnByValue: true },
      state
    )
    /* BEFORE the keystroke below, deliberately. This asks what is on the panel
       when the screen arrives, and the retry's keystroke is not part of that:
       it dismisses the very refusal being recorded. Ordering these the other
       way round emptied five screens out of the coverage ledger. */
    const seen = await cdp(
      page,
      'Runtime.evaluate',
      { expression: MUST_SEE, returnByValue: true },
      state
    )

    /*
     * A keyboard displaced by a refusal gets asked again after one keystroke.
     *
     * The screens that do this promise the banner goes when typing starts, and
     * this is where that promise is tested rather than trusted. One key: enough
     * to change the value, and the smallest thing a person could do next.
     */
    if (JSON.parse(keys.result.value).problems.some((p) => p.clearedByTyping === true)) {
      await cdp(
        page,
        'Runtime.evaluate',
        {
          expression: `(() => {
            const key = document.querySelector('.nr-kb__keys button:not([disabled])')
            if (key !== null) key.click()
          })()`,
        },
        state
      )
      await sleep(220)
      keys = await cdp(
        page,
        'Runtime.evaluate',
        { expression: KEYBOARD, returnByValue: true },
        state
      )
    }

    await cdp(page, 'Runtime.evaluate', { expression: SCROLL_TO_END }, state)
    await sleep(150)

    const { result } = await cdp(
      page,
      'Runtime.evaluate',
      { expression: MEASURE, returnByValue: true },
      state
    )
    const measured = JSON.parse(result.value)
    const mustSee = JSON.parse(seen.result.value)
    for (const id of mustSee.drawn) {
      if (!drawn.has(id)) drawn.set(id, label)
    }
    const problems = [
      ...JSON.parse(keys.result.value).problems,
      ...mustSee.problems,
      ...measured.problems,
    ]
    if (measured.overflow > 0) below.push({ label, px: measured.overflow })

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
  reap(chrome)
  server.close()

  /*
   * The coverage ledger: which marked statements no state ever drew.
   *
   * Failing rather than reporting, because a marker on a banner nothing
   * renders is worse than no marker. It reads, in the source and in every
   * review, as "this is checked", and the check it names never ran. That is
   * the shape of the bug this whole harness exists for: an assertion that
   * passes because it was never asked.
   *
   * The fix is a gallery state, not a removed marker.
   */
  const marked = markedInSource()
  const uncovered = [...marked.keys()].filter((id) => !drawn.has(id)).sort()
  if (uncovered.length > 0) {
    failed += 1
    console.error(
      `\ncheck-screen-fit: ${String(uncovered.length)} of ${String(marked.size)} marked ` +
        `statements were never drawn:\n`
    )
    for (const id of uncovered) {
      console.error(`    ${id}${DIM}  ${[...marked.get(id)].join(', ')}${OFF}`)
    }
    console.error(
      `\n  Each of these is marked data-must-see, which claims it is fully on the\n` +
        `  panel when its screen arrives. No state in tools/screens/gallery.tsx\n` +
        `  renders it, so nothing has ever measured that claim, and a unit test\n` +
        `  cannot: jsdom computes no box model. Add a gallery state that produces\n` +
        `  it, with a reach list if it takes a tap. Do not remove the marker.\n`
    )
  }

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
        `  A must-see statement below the fold: something marked data-must-see is\n` +
        `  not fully on the panel when the screen arrives. That marking means acting\n` +
        `  without having read it loses the money, so scrolling to it is not the\n` +
        `  claim. Shorten it or give it the room, and do not remove the marker to\n` +
        `  make this pass.\n\n` +
        `  A state reported unreachable: the tap list in tools/screens/gallery.tsx\n` +
        `  names a testid that is gone, or one that is disabled in that state.\n` +
        `  Either is a state the harness never reached, so what it measured was\n` +
        `  the screen before it. Fix the list or give the fixture what the\n` +
        `  control needs to be enabled.\n`
    )
    process.exit(1)
  }
  console.log(
    `check-screen-fit: ${String(screens.length)} screen states fit ` +
      `${String(WIDTH)}x${String(HEIGHT)}` +
      (below.length === 0 ? '' : `, ${String(below.length)} with content below the fold`) +
      `, ${String(marked.size)} marked statements all drawn`
  )

  /*
   * The states that scroll, deepest first, printed rather than counted.
   *
   * "Fit" was doing two jobs and only saying one. Everything this harness
   * fails on is a control somebody cannot reach; a screen that scrolls is a
   * screen somebody has to scroll, which is a different and much weaker claim.
   * Reporting the second as the first is how 52 of 68 states came to have
   * content under the fold with a green line above them.
   *
   * Not a failure and not a cap. A transaction with eight outputs does not fit
   * in 480px and should not be made to. What this is for is the next person
   * adding a paragraph to a screen that already ran 300px over.
   */
  if (below.length > 0) {
    const deepest = [...below].sort((a, b) => b.px - a.px).slice(0, 8)
    for (const { label, px } of deepest) {
      console.log(`${DIM}    ${String(px).padStart(4)}px  ${label}${OFF}`)
    }
    if (below.length > deepest.length) {
      console.log(`${DIM}    and ${String(below.length - deepest.length)} more${OFF}`)
    }
  }

  // The verdict is printed and nothing is left to wait for. See tools/lib/reap.mjs.
  finish(0)
}

main().catch((err) => {
  console.error(`check-screen-fit: ${err.message}`)
  process.exit(1)
})
