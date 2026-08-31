/**
 * Kill the subprocesses a check spawned, and mean it.
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
