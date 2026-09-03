import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Running a browser from a check, without it becoming the flaky part.
 *
 * WHY THIS IS A MODULE AND NOT FIVE COPIES OF TWO LINES.
 *
 * Six checks in this directory drive a real browser, and every one of them ends
 * by asking the browser politely to go away. Headless Chrome does not reliably
 * honour SIGTERM. When it does not, its process handle keeps Node's event loop
 * alive, so the check prints its verdict and then never exits: `make check`
 * sits there behind a check that has already passed, and the output on screen
 * says it succeeded. That was observed at twenty minutes before anyone thought
 * to look at `ps`, and the tell is that the result line is already printed.
 *
 * check-dev-server was fixed on its own, and the other five were then found to
 * have the same shape and a worse version of it: a bare `child.kill()`, which
 * is SIGTERM to that one process and nothing else.
 *
 * A check that can hang forever gets switched off, which is the same argument
 * check-dev-server already makes about which port it listens on.
 */

/**
 * SIGTERM, then SIGKILL, to a process group where there is one and to the
 * child otherwise. Never waits to find out which worked: by the time this runs
 * the verdict is decided, and a check has nothing left to learn from a browser.
 *
 * Every call is wrapped, because the common case for a throw here is that the
 * process is already gone, which is the outcome being asked for.
 */
/**
 * A Chrome profile directory nothing else is using.
 *
 * Six of the seven browser checks shared Chrome's default profile, and `make
 * check` runs them one after another. A previous Chrome still letting go of the
 * profile lock stops the next one starting, which surfaces as "Chrome did not
 * expose a debugging endpoint" partway through an otherwise green run: a
 * failure with nothing to do with the thing being checked.
 *
 * check-journeys already did this, and is the one that never had the problem.
 *
 * The directory goes under the system temp dir with the check's name in it, so
 * a leftover is obvious. Chrome creates it; nothing here has to.
 */
export function chromeProfile(name) {
  return `--user-data-dir=${join(tmpdir(), `nullroute-${name}-${String(process.pid)}`)}`
}

export function reap(...children) {
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    for (const child of children) {
      if (child === null || child === undefined || child.pid === undefined) continue
      try {
        // Detached children get the whole group: npx forks the real binary, and
        // killing the wrapper leaves the server holding the port.
        process.kill(-child.pid, signal)
      } catch {
        try {
          child.kill(signal)
        } catch {
          // Already gone.
        }
      }
    }
  }
}

/**
 * Leave, now, with the verdict already printed.
 *
 * Explicit because anything still holding the event loop open at this point is
 * a stray handle on something reap() has killed, not work in progress. Letting
 * Node decide when to exit is what produced the hang.
 */
export function finish(code = 0) {
  process.exit(code)
}

/**
 * One step of a gallery reach list, as an expression to evaluate in the page.
 *
 * A step is a testid to tap, or `type:<testid>:<text>` to fill a field with.
 *
 * WHY TYPING IS A STEP AND NOT A SEQUENCE OF TAPS. Most fields on this device
 * are filled from an on-screen keyboard, and tapping its keys is the honest
 * way to reach a state, so that is what a plain testid does. Three fields are
 * not: the typed-mnemonic escape hatch, and the two confirmations that ask you
 * to copy a checksum or a wallet name back. Those are real textareas, and
 * reaching them by tapping would be forty keystrokes of harness standing in
 * for one paste.
 *
 * Set through the native value setter, because React installs its own on the
 * element and assigning to `.value` updates the DOM without telling React: the
 * field shows the text, the component's state stays empty, and the button the
 * step exists to enable stays disabled. That failure looks exactly like a
 * fixture that forgot to fill something in.
 *
 * Returns a status rather than throwing, so the caller decides what a step
 * that reached nothing means. It is never nothing: a step that silently did
 * not happen leaves the harness measuring the screen before it and calling it
 * the screen after.
 */
export function reachStep(step) {
  /*
   * `wait:<testid>` reaches a state that arrives on its own.
   *
   * Almost everything on this device appears in response to a tap. The camera
   * does not: it opens, plays, and pulls its first frame through the decoder on
   * a 200ms timer, so the screen that says the frames belong to two different
   * transfers exists about two seconds after the screen does. The harness
   * measured at 120ms and concluded the banner had never been drawn, which was
   * true and was a fact about the harness.
   *
   * Not a sleep. The callers poll for the element and give up loudly, so a
   * state that stops arriving fails rather than being quietly skipped, which is
   * the failure mode a fixed delay has.
   */
  if (step.startsWith('wait:')) {
    return `(document.querySelector('[data-testid="' + ${JSON.stringify(step.slice('wait:'.length))} + '"]') === null ? 'missing' : 'clicked')`
  }
  /*
   * `scroll` reads the screen to the end, which on this device is an act.
   *
   * The transaction review says "Nothing is signed until you have read it" and
   * runs about 800px past a 480px panel, so Sign is refused until the body has
   * reached its end. A reach list that taps Sign without scrolling is a list
   * that describes something a person cannot do, and the harness correctly
   * reports it as disabled.
   *
   * Every scrollable container, twice, which is what SCROLL_TO_END does at the
   * end of a measurement. Here it happens mid-journey instead.
   */
  if (step === 'scroll') {
    return `(() => {
      for (let pass = 0; pass < 2; pass += 1) {
        for (const el of document.querySelectorAll('*')) {
          if (el.scrollHeight > el.clientHeight) el.scrollTop = el.scrollHeight
        }
      }
      return 'clicked'
    })()`
  }
  if (step.startsWith('type:')) {
    const cut = step.indexOf(':', 'type:'.length)
    const testId = step.slice('type:'.length, cut)
    const text = step.slice(cut + 1)
    return `(() => {
      const el = document.querySelector('[data-testid="' + ${JSON.stringify(testId)} + '"]')
      if (el === null) return 'missing'
      if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return 'not-a-field'
      const proto = el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
      setter.call(el, ${JSON.stringify(text)})
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return 'clicked'
    })()`
  }
  return `(() => {
    const el = document.querySelector('[data-testid="' + ${JSON.stringify(step)} + '"]')
    if (el === null) return 'missing'
    // A disabled control accepts .click() and does nothing, so the harness
    // would go on to measure the screen it was already on and report the
    // unreached state as fitting. That happened: a reach list pointed at a
    // submit button that needed a filled field.
    if (el.disabled === true || el.getAttribute('aria-disabled') === 'true') return 'disabled'
    // Scrolled to first, because a user cannot tap what is not on the panel.
    // Without this the harness clicked controls at coordinates nobody could
    // reach, and then measured the response against a scroll position the user
    // was never at: a banner rendered directly under an inline button read as
    // 373px below the fold. Controls in the fixed action bar are unaffected,
    // which is where all but a handful of these live.
    el.scrollIntoView({ block: 'center' })
    el.click()
    return 'clicked'
  })()`
}

/** The element a reach step acts on, for waiting on before acting. */
export function reachTarget(step) {
  // Nothing to wait for: the body is already there or the screen has not
  // rendered, which the caller's own settle handles.
  if (step === 'scroll') return '.nr-screen__body'
  if (step.startsWith('wait:')) return `[data-testid="${step.slice('wait:'.length)}"]`
  if (!step.startsWith('type:')) return `[data-testid="${step}"]`
  const cut = step.indexOf(':', 'type:'.length)
  return `[data-testid="${step.slice('type:'.length, cut)}"]`
}
