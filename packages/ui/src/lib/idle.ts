/**
 * The frontend half of the idle lock.
 *
 * Spec: ui.idle
 *
 * The daemon owns the deadline and does the locking, because the daemon is what
 * holds the seed. What it cannot see is whether a person is at the device: no
 * request arrives while somebody reads a transaction, and requests arrive
 * constantly from a screen nobody is looking at. That is what this supplies.
 *
 * TWO JOBS, and they are separate on purpose.
 *
 * The heartbeat says a person is here. It fires on a touch or a key, throttled,
 * so a scrolling finger does not become a stream of IPC.
 *
 * The countdown warns before the deadline rather than at it. Somebody comparing
 * an address against a phone for ten minutes is not idle in any sense that
 * matters, and locking them out is how a security feature teaches people to work
 * around it. A minute of warning and one touch clears it.
 *
 * THE WINDOW COMES FROM THE DAEMON. It could be a constant here that matched the
 * one there, and the two would drift the first time somebody changed one. The
 * first heartbeat asks.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * At most one heartbeat every this many seconds.
 *
 * A finger dragging a list produces a pointer event per frame. The clock only
 * needs to know somebody was there in the last few seconds, so the resolution
 * costs nothing and the traffic saved is three orders of magnitude.
 */
const THROTTLE_SECONDS = 15

/** How often the countdown recomputes. One second, because it is displayed. */
const TICK_MS = 1000

export interface IdleWindow {
  readonly seconds: number
  readonly warnAt: number
}

export interface IdleState {
  /** Seconds until the wallet locks itself, or null when nothing is unlocked. */
  readonly remaining: number | null
  /** Whether the deadline is close enough to say so. */
  readonly warning: boolean
  /** Push the deadline back. Wired to the button on the warning. */
  readonly stayOpen: () => void
}

export interface UseIdleLockOptions {
  /** Whether a wallet is open. No wallet, no clock, no banner. */
  readonly unlocked: boolean
  /** Sends `session.heartbeat` and returns the window the daemon is using. */
  readonly beat: () => Promise<IdleWindow | null>
  /** Sends `session.lock`. Called when the countdown reaches zero. */
  readonly lock: () => void
}

/**
 * Track the deadline, send heartbeats, and say when to warn.
 *
 * The countdown here is a MIRROR of the daemon's, not the authority. If the two
 * disagree the daemon wins, because it is the one holding the seed, and the
 * visible cost of disagreement is a banner that appears slightly early or a lock
 * that arrives while the banner still says four seconds. Neither loses anything:
 * the next request finds a locked wallet either way.
 */
export function useIdleLock(options: UseIdleLockOptions): IdleState {
  const { unlocked, beat, lock } = options

  const [window_, setWindow] = useState<IdleWindow | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)

  // Refs rather than state: these change on every touch and every tick, and
  // re-rendering the whole application because a finger moved would make the
  // device feel broken on hardware this slow.
  const lastBeat = useRef(0)
  const deadline = useRef<number | null>(null)

  const send = useCallback(
    (force: boolean): void => {
      const now = Date.now()
      if (!force && now - lastBeat.current < THROTTLE_SECONDS * 1000) return
      lastBeat.current = now
      void beat().then(
        (found) => {
          if (found === null) return
          setWindow(found)
          deadline.current = Date.now() + found.seconds * 1000
        },
        () => {
          // Never swallowed silently in a signing path, and this is not one: a
          // failed heartbeat means the daemon did not hear us, so the safe
          // reading is that the deadline stands. Doing nothing is that reading.
        }
      )
    },
    [beat]
  )

  // Touches and keys, on the whole document, in the capture phase so a control
  // that stops propagation does not also stop the device noticing a person.
  //
  // NOT GATED ON `unlocked`, AND THAT WAS A BUG THAT BROKE WALLET CREATION.
  //
  // This used to return early while locked, on the reading that a clock about
  // an open wallet has nothing to do while none is open. The daemon's clock
  // starts at boot and only `session.heartbeat` resets it, so on a device left
  // alone for ten minutes it was already expired, and nothing during setup sent
  // a heartbeat because no wallet was open yet.
  //
  // Then `entropy.fromDice` loads the seed it has just derived, the session has
  // a wallet for the first time, and the very next request runs the daemon's
  // pre-dispatch check: expired, and hasWallet, so lock. `seed.reveal` answers
  // "No wallet is loaded" and the words are gone. Rolling a hundred dice and
  // getting nothing.
  //
  // The window is meant to mean "ten minutes since a person last touched this",
  // and that sentence has nothing to do with whether a wallet happens to be
  // open. Somebody rolling dice is as present as somebody reading a
  // transaction. The `unlocked` gate belongs on the countdown and the warning
  // banner, which are about an open wallet, and it is still on both.
  useEffect(() => {
    const onActivity = (): void => {
      send(false)
    }
    document.addEventListener('pointerdown', onActivity, true)
    document.addEventListener('keydown', onActivity, true)
    return () => {
      document.removeEventListener('pointerdown', onActivity, true)
      document.removeEventListener('keydown', onActivity, true)
    }
  }, [send])

  // One heartbeat when a wallet opens, to learn the window and start the clock.
  useEffect(() => {
    if (!unlocked) {
      deadline.current = null
      setRemaining(null)
      return
    }
    send(true)
  }, [unlocked, send])

  useEffect(() => {
    if (!unlocked || window_ === null) return
    const tick = setInterval(() => {
      const at = deadline.current
      if (at === null) return
      const left = Math.max(0, Math.ceil((at - Date.now()) / 1000))
      setRemaining(left)
      if (left === 0) {
        deadline.current = null
        lock()
      }
    }, TICK_MS)
    return () => {
      clearInterval(tick)
    }
  }, [unlocked, window_, lock])

  return {
    remaining,
    warning:
      window_ !== null && remaining !== null && remaining > 0 && remaining <= window_.warnAt,
    stayOpen: useCallback(() => {
      send(true)
    }, [send]),
  }
}
