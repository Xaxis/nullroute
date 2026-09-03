/**
 * BIP-329 label files, in and out.
 *
 * A label is a note and decides nothing, which is why this is the smallest
 * table here and why nothing in it can refuse.
 *
 * One of thirteen tables that make up the IPC surface. See ipc/context.ts for
 * why they are tables rather than one switch.
 */

import { exportLabels, importLabels } from '@nullroute/core'
import { params, requireString } from '../params.js'
import { type HandlerContext, type MethodTable } from '../context.js'

export function labelsMethods(ctx: HandlerContext): MethodTable {
  const { session } = ctx

  return {
    /**
     * Read a BIP-329 label file.
     *
     * Nothing is stored and nothing is trusted. Labels are text shown beside
     * things this device already recognised by re-deriving them, and the
     * response carries the lines that were dropped so a screen can say the
     * import was partial rather than leaving the user to notice.
     */
    'labels.import': (request) => {
      const result = importLabels(requireString(request, 'text'))
      // Held for this session when asked, so the review screen can show a
      // label beside an output. Not sealed: a label file can hold thousands
      // of entries about transactions this device has never seen, and
      // growing the encrypted blob without bound for something that decides
      // nothing is a bad trade.
      const load = params(request)['load'] === true
      if (load) session.setLabels(result.labels)
      return {
        labels: result.labels,
        skipped: result.skipped,
        loaded: load ? result.labels.length : 0,
        note:
          'Labels are text. Nothing here decides whether an address is yours: that is ' +
          'decided by re-deriving it from your seed.',
      }
    },

    /** Write a BIP-329 label file, byte identical for the same labels. */
    'labels.export': (request) => {
      const raw = params(request)['labels']
      if (!Array.isArray(raw)) {
        throw new Error('Parameter "labels" is required and must be an array.')
      }
      return { text: exportLabels(raw as Parameters<typeof exportLabels>[0]) }
    },
  }
}
