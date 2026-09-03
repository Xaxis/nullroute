/**
 * Locking, and the heartbeat that decides when to lock on its own.
 *
 * Two methods. Their smallness is the point: this is the boundary the idle
 * clock acts across, and it should be readable in one screen.
 *
 * One of thirteen tables that make up the IPC surface. See ipc/context.ts for
 * why they are tables rather than one switch.
 */

import { IDLE_WARN_SECONDS } from '../../idle.js'
import { type HandlerContext, type MethodTable } from '../context.js'

export function sessionMethods(ctx: HandlerContext): MethodTable {
  const { state, session } = ctx

  return {
    'session.lock': () => {
      session.lock()
      return { unlocked: false }
    },

    /**
     * A person touched the screen.
     *
     * The ONLY thing that resets the idle clock. Every other method is a
     * screen doing its work, and counting those would let a screen that
     * refreshes hold a seed in memory indefinitely, which is the exact
     * failure the idle lock exists to end.
     *
     * Returns the window so the frontend counts down from a number the
     * daemon owns rather than a copy of it, and so a change here cannot
     * leave a screen warning at the wrong moment.
     */
    'session.heartbeat': () => {
      state.idle?.touch()
      return {
        idle:
          state.idle === undefined
            ? null
            : { seconds: state.idle.seconds, warnAt: IDLE_WARN_SECONDS },
        unlocked: session.hasWallet,
      }
    },
  }
}
