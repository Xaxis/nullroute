/**
 * The IPC method table.
 *
 * INV-KEY-1 lives here in practice: this is the boundary the frontend talks to,
 * and every method returns public data by construction. There is no method that
 * returns a private key, and no debug flag that enables one.
 *
 * The single exception is `seed.reveal`, which exists because a user has to
 * write their mnemonic down and therefore has to see it. It is gated by session
 * state rather than by a parameter, refused once backup is confirmed, and
 * refused outright for a seed loaded from storage. It lives in
 * ipc/methods/seed.ts, on its own, so the exception is four methods a reviewer
 * can read end to end rather than four cases inside two thousand lines.
 *
 * Methods are deliberately coarse. A fine-grained API ("give me the root key",
 * "now derive") would put the composition of sensitive steps in the untrusted
 * caller. The daemon performs whole operations and returns their results.
 *
 * WHAT THIS FILE USED TO BE. One function of 1915 lines, holding a 62-label
 * switch and eight helpers in the same closure, in a file of 2084. Every method
 * could see every other method's locals, the sections were marked with comment
 * banners that had drifted (session.lock and session.heartbeat were filed under
 * "Backup and restore"), and a spec describing machine entropy sat in
 * entropy/ pointing at `handler.ts::createHandler` because there was nowhere
 * more specific to point.
 *
 * It is thirteen tables now, one per domain, and this file is the dispatch and
 * nothing else. See ipc/context.ts for what a table is handed and for the one
 * property a switch had that a table has to be given back.
 */

import { type IpcHandler, type IpcRequest } from './ipc/socket.js'
import { type DaemonState, createContext, mergeTables } from './ipc/context.js'
import { backupMethods } from './ipc/methods/backup.js'
import { bip85Methods } from './ipc/methods/bip85.js'
import { deviceMethods } from './ipc/methods/device.js'
import { entropyMethods } from './ipc/methods/entropy.js'
import { labelsMethods } from './ipc/methods/labels.js'
import { messageMethods } from './ipc/methods/message.js'
import { multisigMethods } from './ipc/methods/multisig.js'
import { psbtMethods } from './ipc/methods/psbt.js'
import { seedMethods } from './ipc/methods/seed.js'
import { sessionMethods } from './ipc/methods/session.js'
import { storeMethods } from './ipc/methods/store.js'
import { walletMethods } from './ipc/methods/wallet.js'
import { walletsMethods } from './ipc/methods/wallets.js'

export { type DaemonState } from './ipc/context.js'

export function createHandler(state: DaemonState): IpcHandler {
  const ctx = createContext(state)
  const { session } = ctx

  /* Built once, at construction, so a duplicate method name is a startup
     failure rather than something discovered when the wrong code answers a
     request. See mergeTables. */
  const methods = mergeTables([
    deviceMethods(ctx),
    entropyMethods(ctx),
    seedMethods(ctx),
    walletMethods(ctx),
    psbtMethods(ctx),
    multisigMethods(ctx),
    storeMethods(ctx),
    walletsMethods(ctx),
    backupMethods(ctx),
    messageMethods(ctx),
    labelsMethods(ctx),
    bip85Methods(ctx),
    sessionMethods(ctx),
  ])

  return async (request: IpcRequest): Promise<unknown> => {
    await Promise.resolve()

    // Checked before dispatch, so a request arriving after the deadline finds
    // a locked wallet rather than being served by one that should already be
    // shut. The daemon also sweeps on a timer, because a frontend that has
    // crashed sends nothing at all and the seed must not outlive it either.
    if (state.idle?.expired() === true && session.hasWallet) {
      session.lock()
    }

    const method = methods[request.method]
    if (method === undefined) {
      throw new Error(`Unknown method "${request.method}".`)
    }
    return method(request)
  }
}
