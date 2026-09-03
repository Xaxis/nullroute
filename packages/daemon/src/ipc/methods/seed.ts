/**
 * The one exception to INV-KEY-1.
 *
 * A user has to write their mnemonic down, so they have to see it. Gated by
 * session state rather than by a parameter, refused once backup is confirmed,
 * and refused outright for a seed loaded from storage. Four methods, in one
 * file, so the exception is a place a reviewer can read end to end.
 *
 * One of thirteen tables that make up the IPC surface. See ipc/context.ts for
 * why they are tables rather than one switch.
 */

import { randomBytes } from 'node:crypto'
import { requireString, requireNumber } from '../params.js'
import { type HandlerContext, type MethodTable } from '../context.js'

export function seedMethods(ctx: HandlerContext): MethodTable {
  const { session } = ctx

  return {
    /**
     * Show the mnemonic so it can be written down.
     *
     * Valid only between generating a seed and confirming the backup. See the
     * note at the top of session.ts.
     */
    'seed.reveal': () => {
      const mnemonic = session.revealMnemonic()
      return {
        words: mnemonic.split(' '),
        fingerprint: session.fingerprint,
      }
    },

    'seed.confirmBackup': () => {
      session.confirmBackup()
      return { backupConfirmed: true }
    },

    /**
     * Which words to ask the user to type back.
     *
     * CHOSEN HERE, not in the frontend, and not because the choice is a
     * secret: the screen has just shown every word, so nothing about it is
     * hidden from the untrusted side. It is here because Math.random is
     * banned on this device and the frontend has no other source, which is
     * the rule doing its job rather than getting in the way. randomBytes is
     * a few lines away in the process that already holds the seed.
     *
     * What the randomness is actually for is stopping somebody learning that
     * the check always asks for words one, two and three, and writing only
     * those down.
     *
     * Returns positions, never words. Nothing about this response tells the
     * caller anything it did not already display.
     */
    'seed.checkPositions': (request) => {
      const count = Math.min(requireNumber(request, 'count', 3), 24)
      const total = session.peekWordsForVerification().length
      if (total === 0) {
        throw new Error('No mnemonic is available to check.')
      }

      const chosen = new Set<number>()
      // Rejection sampling on a byte, discarding values in the short tail, so
      // no position is likelier than another. A modulo of a raw byte would
      // favour the low indexes, which is a small bias and a free one to
      // avoid.
      const limit = 256 - (256 % total)
      while (chosen.size < Math.min(count, total)) {
        const byte = randomBytes(1)[0] ?? 0
        if (byte >= limit) continue
        chosen.add(byte % total)
      }

      return { positions: [...chosen].sort((left, right) => left - right), total }
    },

    /**
     * Check a word the user types back, without ever showing the rest.
     *
     * The verification step asks for a handful of words by position. This
     * compares one and returns a boolean, so the untrusted side never learns
     * a word it did not already have.
     */
    'seed.checkWord': (request) => {
      const index = requireNumber(request, 'index')
      const word = requireString(request, 'word').trim().toLowerCase()
      const words = session.peekWordsForVerification()
      const expected = words[index]
      if (expected === undefined) throw new Error(`Word index ${String(index)} is out of range.`)
      const correct = expected === word
      // A wrong answer costs one of the session's budget. See
      // Session.peekWordsForVerification: this returns a boolean with no key
      // derivation behind it, over a 2048 word public list, so without a
      // budget the method is the mnemonic itself in about 25,000 calls.
      if (!correct) session.recordWrongWord()
      return { correct }
    },
  }
}
