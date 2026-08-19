/**
 * Lock the wallet when nobody is at the device.
 *
 * Spec: daemon.idle
 *
 * THE GAP THIS CLOSES. An unlocked wallet holds a seed in daemon memory, and
 * nothing took it back out. A device unlocked to check one address and then put
 * down stayed unlocked until somebody remembered to lock it or pulled the power,
 * and the screen that displays a mnemonic for backup is one of the places it
 * could be left. The seed was resident for as long as the process ran.
 *
 * WHAT IT DEFENDS AGAINST, exactly: the device being LEFT. It is worth nothing
 * against somebody standing at it, who simply touches the screen and keeps it
 * open, and it is worth nothing against an attacker who takes an unlocked device
 * and reads its memory in the next few seconds. Neither is a reason not to have
 * it, and both are reasons not to describe it as more than it is. See
 * docs/THREAT-MODEL.md.
 *
 * ACTIVITY IS A PERSON, NOT A REQUEST. Only `session.heartbeat` resets the
 * clock, and the frontend sends it on a touch or a key. Counting every IPC
 * request would mean a screen that polls holds the seed open forever, which is
 * the failure this is supposed to prevent dressed up as a feature.
 *
 * The inverse case matters more. Somebody reading a transaction for ten minutes
 * before signing it sends no requests at all, and locking them out mid-review is
 * how a security feature teaches people to disable it. So the frontend warns
 * before the deadline rather than at it, and a single touch is enough.
 *
 * NO CLOCK IS TRUSTED FOR ANYTHING BUT THIS. `now` is injected, so the tests run
 * without timers, and a wrong system clock costs an early or a late lock and
 * nothing else. Nothing derived from a key depends on it.
 */

/**
 * Ten minutes.
 *
 * Long enough that reading a transaction, comparing an address against a phone,
 * or writing down twelve of twenty four words does not hit it. Short enough that
 * a device left on a desk over lunch is closed.
 *
 * Not configurable, and that is deliberate rather than unfinished. A setting
 * that turns a lock off is a setting worth attacking, and the honest place for
 * this number is one every user of the device shares and can read here.
 */
export const IDLE_LOCK_SECONDS = 600

/**
 * How long before the deadline the frontend starts saying so.
 *
 * A minute, because the warning has to be survivable by somebody who is looking
 * at the screen but not touching it, which is the whole population this would
 * otherwise interrupt.
 */
export const IDLE_WARN_SECONDS = 60

export interface IdleClockOptions {
  /** Injected so tests need no timers, and so a fake clock cannot be a surprise. */
  readonly now?: () => number
  readonly seconds?: number
}

export class IdleClock {
  readonly #now: () => number
  readonly #seconds: number
  #lastActivity: number

  constructor(options: IdleClockOptions = {}) {
    this.#now = options.now ?? ((): number => Date.now())
    this.#seconds = options.seconds ?? IDLE_LOCK_SECONDS
    this.#lastActivity = this.#now()
  }

  /** The configured window, so a screen can count down without duplicating it. */
  get seconds(): number {
    return this.#seconds
  }

  /** A person did something. Called only from `session.heartbeat`. */
  touch(): void {
    this.#lastActivity = this.#now()
  }

  /**
   * Seconds left, floored at zero.
   *
   * Floored rather than allowed to go negative so a caller cannot accidentally
   * read a large negative number as "plenty of time left" after a clock jump.
   */
  remaining(): number {
    const elapsed = (this.#now() - this.#lastActivity) / 1000
    return Math.max(0, Math.ceil(this.#seconds - elapsed))
  }

  expired(): boolean {
    return this.remaining() <= 0
  }
}
