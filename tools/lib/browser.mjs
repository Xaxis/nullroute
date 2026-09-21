import { existsSync } from 'node:fs'
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
/**
 * The Chrome this machine has, or a refusal naming what to set.
 *
 * WHY IT LIVES HERE. Ten harnesses in this repository drive a browser and each
 * one found its own binary. Eight walked a candidate list beginning with
 * CHROME_PATH; two had the macOS path written into the spawn call. Those two
 * cannot run anywhere else, and the place they cannot run is CI, which is the
 * only machine that ever sees this project on Linux. They failed with `spawn
 * /Applications/Google Chrome.app/... ENOENT` the first time the workflow was
 * valid enough to start them.
 *
 * One implementation, so a path cannot be right in eight files and wrong in
 * two. check-make-targets fails a harness that spawns a browser without asking
 * here.
 */
export function chromeBinary(who) {
  const candidates = [
    process.env['CHROME_PATH'],
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean)
  const found = candidates.find((path) => existsSync(path))
  if (found === undefined) {
    console.error(`${who}: no Chrome found. Set CHROME_PATH.`)
    process.exit(1)
  }
  return found
}

/**
 * Wait for a spawned Chrome to answer on its debugging port, or say why not.
 *
 * ONE IMPLEMENTATION, for the reason chromeBinary gives one line up: a wait
 * cannot be right in two harnesses and wrong in four. Every one of them had
 * written its own, all of them spawned with stdio: 'ignore', and all of them
 * could only report "Chrome did not expose a debugging endpoint". That sentence
 * is the symptom: it cannot separate a browser still starting from one that
 * exited on the spot, and those want opposite responses. CI spent a run on it.
 *
 * So the pipes are read, the exit is recorded, and the failure quotes both. The
 * poll stops the moment the process dies rather than spending the rest of the
 * budget on a port nothing is listening to.
 *
 * Thirty seconds, where the harnesses had six or twelve. Those were guesses
 * made on a workstation; the machine that fails is a cold runner under the load
 * of a full check. Waiting longer costs nothing when the common case answers in
 * well under a second, and a rerun of the suite costs minutes.
 *
 * Pass the child from `spawn(..., { stdio: ['ignore', 'pipe', 'pipe'] })`.
 */
export async function waitForDebugEndpoint(chrome, port, attempts = 200) {
  let said = ''
  let ended = null
  chrome.stdout?.on('data', (chunk) => {
    said += String(chunk)
  })
  chrome.stderr?.on('data', (chunk) => {
    said += String(chunk)
  })
  chrome.on('exit', (code, signal) => {
    ended = signal === null ? `exit ${String(code)}` : `signal ${signal}`
  })

  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (ended !== null) break
    await pause(150)
    try {
      const res = await fetch(`http://127.0.0.1:${String(port)}/json/version`)
      const url = (await res.json()).webSocketDebuggerUrl
      if (url) return url
    } catch {
      /* still starting */
    }
  }

  const why = ended === null ? 'it is still running' : `it ended with ${ended}`
  const tail = said.trim() === '' ? 'and printed nothing' : `and said:\n${said.trim()}`
  // No harness name in here: every caller prints one already, and the two
  // together read as a stutter.
  throw new Error(`Chrome never exposed a debugging endpoint on ${String(port)}: ${why} ${tail}`)
}

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
  /*
   * `keys:<text>` types on the device's own keyboard, key by key.
   *
   * WHY THIS EXISTS RATHER THAN `type:`. That one finds an input and sets its
   * value through the React setter, which is what a workstation with a real
   * keyboard does and is not available on this hardware: no virtual keyboard is
   * installed in the image and cage provides none. Four screens shipped with
   * fields that could be filled perfectly under `make dev` and not at all on
   * the panel, and `type:` reported every one of them as reachable.
   *
   * This taps the keys. So it fails when a string cannot be produced on the
   * keyboard the device actually has, which is the claim worth checking on a
   * screen that will not erase a wallet until its name has been typed out.
   *
   * The layers are handled the way a finger handles them: shift is one-shot and
   * resets itself, the symbol layer is sticky and has to be tapped off again.
   *
   * VERIFIED RATHER THAN ASSUMED. Each tap is a separate discrete event, and
   * this loop depends on React having flushed the previous one before the next
   * key is looked up: on the symbol layer the key being reached for does not
   * exist until the tap before it has rendered. So the count in the readout is
   * compared against the text at the end, and a step that typed sixteen of
   * twenty seven characters says so instead of leaving the caller measuring a
   * half-filled screen and calling it the screen after.
   */
  if (step.startsWith('keys:')) {
    const text = step.slice('keys:'.length)
    /*
     * ASYNC, AND THAT IS THE WHOLE DIFFICULTY. React 18 schedules a discrete
     * update at sync priority and flushes it in a microtask, not inside the
     * click, so a synchronous loop of `.click()` calls runs entirely against
     * the DOM as it was before the first key: every tap reads the same stale
     * `value` prop, so "abc" comes out as "c", and the shift key produces no
     * upper-case layer to find `pk-key-C` on.
     *
     * That is not a hypothetical. The first version of this was synchronous,
     * and it failed on the third character of a wallet name with `no-key-C`,
     * which is the shape of the bug being reported honestly by accident.
     *
     * A macrotask rather than a microtask between taps, because React may
     * schedule the flush as a microtask itself and a macrotask is guaranteed to
     * run after the queue drains.
     *
     * Callers pass awaitPromise, which is harmless for every other step: CDP
     * returns a non-promise result unchanged.
     */
    return `(async () => {
      // JSON.stringify rather than concatenating quotes, because two of the
      // keys on the symbol layer are a double quote and a backslash, and both
      // of those end or escape their way out of an attribute selector written
      // by hand. CSS string escaping and JSON string escaping agree on the two
      // characters that matter here.
      const find = (id) => document.querySelector('[data-testid=' + JSON.stringify(id) + ']')
      const settle = () => new Promise((resolve) => { setTimeout(resolve, 0) })
      const tap = async (id) => {
        const el = find(id)
        if (el === null || el.disabled === true) return false
        el.click()
        await settle()
        return true
      }
      const onSymbols = () => {
        const el = find('pk-symbols')
        return el !== null && el.textContent.trim() === 'abc'
      }
      if (find('pk-space') === null) return 'missing'
      const wanted = ${JSON.stringify(text)}
      for (const character of wanted) {
        if (character === ' ') {
          if (!(await tap('pk-space'))) return 'no-space-key'
          continue
        }
        const letter = /[a-zA-Z]/.test(character)
        // The letter layers and the symbol layer are exclusive, so reaching a
        // letter from the symbol layer means tapping it off first, and reaching
        // a symbol from either letter layer means tapping it on.
        if (letter === onSymbols() && !(await tap('pk-symbols'))) return 'no-layer-key'
        // Shift is one-shot: it returns to lower case on the next key, which is
        // why this is inside the loop rather than latched once.
        if (/[A-Z]/.test(character) && !(await tap('pk-shift'))) return 'no-shift-key'
        // The symbols are two pages, so a symbol missing from the one showing
        // is on the other rather than absent. Checked by looking rather than by
        // holding a copy of the split here, which would go stale the first time
        // a character moved page and would then report it as unreachable.
        if (!letter && find('pk-key-' + character) === null) {
          if (!(await tap('pk-symbols-more'))) return 'no-page-key'
        }
        if (!(await tap('pk-key-' + character))) return 'no-key-' + character
      }
      const length = find('pk-length')
      if (length === null) return 'no-readout'
      if (length.textContent.trim() !== String(wanted.length)) {
        return 'typed-' + length.textContent.trim() + '-of-' + wanted.length
      }
      return 'clicked'
    })()`
  }
  /*
   * `word:<letters>` enters one word on the WORD keyboard, by tapping letters.
   *
   * A DIFFERENT KEYBOARD FROM `keys:`, with a different job. That one accepts
   * any string; this one narrows a finger down to one of 2048 known words and
   * commits as soon as only one is reachable, so "aba" is the whole of
   * `abandon` and there is nothing to tap afterwards.
   *
   * WHY IT EXISTS. `.nr-kb__entered` is the box holding the words already
   * entered, and the stylesheet calls it the only thing on the screen that
   * grows. Its cap is 6rem, chosen because at 7rem a full twenty four words
   * pushed the bottom row of keys under the action bar. That was a hand
   * measurement, and no reach list in the gallery contained a single tap on
   * this keyboard, so nothing had ever drawn that box with a word in it. The
   * suite measured the empty case and called the screen fitting.
   *
   * A PREFIX THAT DOES NOT RESOLVE IS TAPPED, not refused. This used to type
   * letters and nothing else, on the reasoning that every caller passed a
   * prefix which resolves. That was true of the hand written reach lists and
   * false of the journeys, which enter whichever word the device asks them to
   * check, out of a mnemonic generated fresh on every run. 49 of the 2048
   * words are a prefix of another one, so roughly one run in fourteen asked
   * for a word this could not enter, and CI failed on "fat" with the device
   * behaving perfectly and the suggestion strip sitting there unclicked.
   */
  if (step.startsWith('word:')) {
    const letters = step.slice('word:'.length)
    return `(async () => {
      const find = (id) => document.querySelector('[data-testid=' + JSON.stringify(id) + ']')
      const settle = () => new Promise((resolve) => { setTimeout(resolve, 0) })
      // The counter, because the component says so: its own comment calls
      // kb-count the only authority on how many words exist, after a half
      // typed chip was rendered as an entered one and contradicted it.
      const counted = () => {
        const el = find('kb-count')
        if (el === null) return null
        const n = /^\\s*(\\d+)/.exec(el.textContent || '')
        return n === null ? null : Number(n[1])
      }
      const before = counted()
      if (before === null) return 'no-counter'
      for (const letter of ${JSON.stringify(letters)}) {
        const key = find('kb-key-' + letter)
        if (key === null) return 'no-key-' + letter
        if (key.disabled === true) return 'dead-key-' + letter
        key.click()
        await settle()
      }
      // Committed, rather than left half typed in the prefix. A word that did
      // not commit is a reach list describing something that did not happen.
      if (counted() !== before + 1) {
        // A WORD THAT IS A PREFIX OF ANOTHER WORD. 49 of the 2048 are: act,
        // add, car, fat, top. The keyboard cannot commit those on the last
        // letter, because longer words are still reachable, so it shows the
        // suggestion strip and the user taps their word. Doing the same here
        // is not a workaround, it is the step a person performs, and it is the
        // only way this harness reaches those 49 at all.
        const pick = find('kb-suggest-' + ${JSON.stringify(letters)})
        if (pick === null) {
          const prefix = find('kb-prefix')
          return 'uncommitted-' + (prefix === null ? '?' : prefix.textContent.trim())
        }
        pick.click()
        await settle()
        if (counted() !== before + 1) return 'suggestion-did-not-commit'
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
  // A keyboard rather than a field: the space key, which every layer renders.
  if (step.startsWith('keys:')) return '[data-testid="pk-space"]'
  // The counter, which only the word keyboard renders and which is present
  // whatever has been typed.
  if (step.startsWith('word:')) return '[data-testid="kb-count"]'
  if (!step.startsWith('type:')) return `[data-testid="${step}"]`
  const cut = step.indexOf(':', 'type:'.length)
  return `[data-testid="${step.slice('type:'.length, cut)}"]`
}

/**
 * Walk a reach list, and say what the page said when it did not arrive.
 *
 * reachStep goes to real trouble to return a specific status. Its own docblock
 * sets the contract: "Returns a status rather than throwing, so the caller
 * decides what a step that reached nothing means." The statuses it can hand
 * back include `missing`, `disabled`, `no-shift-key`, `no-key-C` and
 * `typed-16-of-27`, and the comment on that last one says a step that typed
 * sixteen of twenty seven characters "says so instead of leaving the caller
 * measuring a half-filled screen".
 *
 * TWO OF THE FOUR CALLERS THREW ALL OF IT AWAY. check-ui-roles and
 * check-contrast polled for `clicked`, kept a boolean, and on failure printed
 * the step name plus a sentence naming two causes: either the step is wrong, or
 * the state it waits for stopped arriving. Neither one is the cause that
 * actually fires. The one that fires is a busy machine, because the budget was
 * forty attempts at 80ms and the `wait:` step this polling exists for reaches a
 * state that arrives about two seconds after the screen. That is 1.2 seconds of
 * headroom, and a workstation running something else eats it. It read as a
 * regression in a gallery that no commit had touched, and was looked for as
 * one.
 *
 * check-screen-fit is the caller that reports the status, and this is that made
 * the only one. The budget is a number here rather than three numbers in three
 * files, for the same reason the top of this module gives about the browser
 * path and the debug endpoint: the copy that is wrong is never the copy anyone
 * is reading.
 *
 * Raising the budget is close to free. A step that lands on its first
 * evaluation costs one evaluation; the budget is only ever spent in full by a
 * step that was going to fail, and a check that is about to fail can afford
 * eight seconds to be right about why.
 *
 * `evaluate` takes the expression and returns the page's value, because the
 * four callers each wrap CDP differently and none of that is this function's
 * business.
 */
export async function walkReach(reach, evaluate, { attempts = 80, gap = 100, between = 300 } = {}) {
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  for (const step of reach) {
    // Never a bare boolean. The last thing the page said is the finding.
    let status = 'nothing, because it was never evaluated'
    let landed = false
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      status = String(await evaluate(reachStep(step)))
      if (status === 'clicked') {
        landed = true
        break
      }
      await pause(gap)
    }
    if (!landed) return { reached: false, step, status, waitedMs: attempts * gap }
    // A step lands the moment its control is clickable, which is before the
    // screen it opens has rendered. The next step looks for that screen.
    await pause(between)
  }
  return { reached: true, step: null, status: 'clicked', waitedMs: 0 }
}

/**
 * The one sentence a harness prints when a walk did not arrive.
 *
 * Three harnesses described the same event at three levels of detail, and the
 * least detailed was on the check that walks the most states.
 *
 * The selector is named because for half the step kinds the step does not name
 * it. `keys:Cold storage` acts on the on-screen keyboard and fails with
 * `no-key-C`, and the element it wanted was `[data-testid="pk-space"]`: nothing
 * in the step or the status says that, and whether the keyboard was on screen
 * at all is the first thing worth knowing.
 */
export function unreachedBecause({ step, status, waitedMs }) {
  return (
    `stopped at ${step}: the page said "${status}" for ${String(waitedMs / 1000)}s ` +
    `while waiting on ${reachTarget(step)}`
  )
}
