/**
 * What every IPC method is handed, and why the dispatch is a table.
 *
 * WHY THIS EXISTS. createHandler was one function of 1915 lines holding a
 * 62-label switch: the daemon's entire IPC surface in a single closure, in a
 * 2084-line file. Every method could see every helper and every other method's
 * locals, and finding the one that answers `multisig.register` meant scrolling
 * through the other fifty eight.
 *
 * A table gives that up in exchange for one thing a switch had for free:
 * duplicate case labels are a compile error, and two tables claiming the same
 * method name are not. So `mergeTables` refuses a duplicate rather than letting
 * the later one win silently, which on this device would mean a method quietly
 * answered by code nobody thought was reachable.
 *
 * The context is deliberately narrow. It carries the daemon's state, the
 * session, and the eight helpers that more than one table needs. It does NOT
 * carry a way to reach another method: a table that wants another table's work
 * calls the underlying module, so the call graph stays visible.
 */

import { type KdfCost } from '../store/envelope.js'
import { type WalletStore } from '../store/store.js'
import { type WalletColour, WalletRegistry } from '../store/registry.js'
import { type BootAttestation } from '../boot/attestation.js'
import { DeviceIdentityStore } from '../store/identity.js'
import { IdleClock } from '../idle.js'
import { Session } from '../session.js'
import { type IpcRequest } from './socket.js'
import {
  deriveQuorumAddresses,
  fingerprintsNamedBy,
  parseDescriptor,
  parsePsbt,
  type QuorumKey,
  attributeSignatures,
  describeWaiting,
} from '@nullroute/core'
import { WALLET_COLOURS } from '../store/registry.js'
import { reviewRegistration } from '../multisig.js'
import { params } from './params.js'

export interface DaemonState {
  readonly attestation: BootAttestation
  readonly session: Session
  /**
   * Where a wallet persists between sessions. Optional so that a daemon can be
   * run with no storage at all, which is what the browser-free unit tests and a
   * throwaway signing session both want.
   */
  readonly store?: WalletStore
  /**
   * Several wallets, each in its own directory.
   *
   * Optional alongside `store` so a daemon can still be run with a single
   * store, which is what the unit tests and a throwaway signing session want.
   * When present it is the only thing that touches persistence.
   */
  readonly registry?: WalletRegistry
  /**
   * What this physical device is called.
   *
   * Optional, because a daemon started without storage has nowhere to keep it,
   * and because a device with one wallet and no siblings does not need a name.
   */
  readonly identity?: DeviceIdentityStore
  /**
   * When the wallet closes itself because nobody is at the device.
   *
   * Optional so a daemon can be run without one, which is what a unit test
   * calling a single method wants. Absent means no idle lock, and the status
   * method says so rather than reporting a window that does not exist.
   */
  readonly idle?: IdleClock /**
   * The key derivation cost a new backup is sealed with. Unset on a device,
   * where backups take the production cost. Tests set a low one, as they do
   * for the store: at the production cost, pure-JS Argon2id blocks the thread
   * for seconds per backup, and several test workers doing it at once on a
   * busy machine stalled one test for five minutes. Restoring reads the cost
   * from the file, where it is authenticated, so only creation takes it here.
   */
  readonly backupKdf?: KdfCost
}

/**
 * One method, as the socket layer will call it.
 *
 * `unknown`, and a method may return a promise of one: the dispatch returns it
 * from an async function, so both are awaited. Not declared as
 * `unknown | Promise<unknown>`, which lint correctly points out means
 * `unknown`.
 *
 * Nothing is marked async for the sake of a uniform signature. All fifty nine
 * of these turn out to be synchronous, which is worth knowing and was invisible
 * while they sat inside one async switch: the daemon's whole IPC surface, seed
 * derivation and Argon2id included, computes its answer and returns it. When
 * one does need to await something, it says so, and that will be the
 * interesting thing about it.
 */
export type MethodTable = Readonly<Record<string, (request: IpcRequest) => unknown>>

export function createContext(state: DaemonState): HandlerContext {
  const { session } = state

  const requireStore = (): WalletStore => {
    if (state.store === undefined) {
      throw new Error('This daemon was started without storage, so nothing can be persisted.')
    }
    return state.store
  }

  const requireRegistry = (): WalletRegistry => {
    if (state.registry === undefined) {
      throw new Error('This daemon was started without storage, so nothing can be persisted.')
    }
    return state.registry
  }

  /**
   * Which cosigner still has to sign a transaction, when the quorum is known.
   *
   * The join runs through the PSBT's own derivation records, so it needs the
   * registered descriptor to know who the cosigners ARE. A device that has not
   * registered the quorum says so rather than returning an empty list, because
   * "nobody signed" and "this device cannot tell who signed" are different
   * things and a screen must not render the second as the first.
   *
   * WHICH quorum, on a device registered in more than one, is decided by how
   * many of each quorum's fingerprints the transaction actually names.
   *
   * The obvious test, "did any cosigner in this quorum sign", is wrong on the
   * exact setup this feature is for. A device in two quorums holds the SAME
   * account key in both, so once it signs, both quorums report a signature and
   * the answer becomes whichever happened to be registered first.
   *
   * A PSBT names every key of the quorum being spent from. Another quorum
   * shares only what the two have in common, which on one device is usually
   * exactly one key: this one. So the best match wins, a tie is not an answer,
   * and a single shared key is not a match.
   */
  const whoStillHasToSign = (
    tx: ReturnType<typeof parsePsbt>,
    signedBy: readonly string[]
  ): { cosigners: unknown; unattributed: number; waiting: string } => {
    const names = new Map<string, string>(
      session.cosigners.map((entry) => [entry.xpub, entry.label])
    )

    const named = fingerprintsNamedBy(tx)
    const candidates: { quorum: QuorumKey[]; score: number }[] = []

    for (const descriptor of session.registrations) {
      let review
      try {
        review = reviewRegistration(descriptor, session.requireSeed(), session.network)
      } catch {
        // A registration this build cannot read leaves the others to answer.
        // Never swallowed into a pass: the loop simply moves on, and a device
        // that can read none of them falls through to the unregistered case.
        continue
      }

      const quorum = review.cosigners.map((cosigner) => {
        // A raw key in a quorum has no extended key to look a name up by, and
        // registration refuses those anyway. Guarded rather than asserted, so
        // this cannot throw on a descriptor from outside.
        const name = cosigner.fullXpub === undefined ? undefined : names.get(cosigner.fullXpub)
        return {
          position: cosigner.position,
          // A cosigner written with no fingerprint cannot be matched to a
          // signature, and the empty string matches nothing, which is the
          // correct outcome rather than a fallback that matches everything.
          fingerprint: cosigner.fingerprint ?? '',
          ...(name === undefined ? {} : { name }),
          isThisDevice: cosigner.isThisDevice,
        }
      })

      candidates.push({
        quorum,
        score: quorum.filter((key) => named.has(key.fingerprint.toLowerCase())).length,
      })
    }

    const ranked = [...candidates].sort((left, right) => right.score - left.score)
    const best = ranked[0]
    const runnerUp = ranked[1]

    // TWO CONDITIONS, and both matter. More than one key in common, because one
    // is what any two quorums on this device share by construction. And a
    // strictly better match than the next one, because a tie means this device
    // cannot tell which quorum the transaction belongs to, and naming the wrong
    // set of cosigners is worse than saying so.
    const decided =
      best !== undefined &&
      best.score > 1 &&
      (runnerUp === undefined || best.score > runnerUp.score)

    if (!decided) {
      const none = attributeSignatures(tx, [], signedBy)
      return {
        cosigners: none.cosigners,
        unattributed: none.unattributed,
        waiting:
          candidates.length === 0
            ? describeWaiting(none)
            : 'This device is registered in more than one quorum and cannot tell which of them ' +
              'this transaction spends from, so it will not guess at who still has to sign.',
      }
    }

    const attributed = attributeSignatures(tx, best.quorum, signedBy)
    return {
      cosigners: attributed.cosigners,
      unattributed: attributed.unattributed,
      waiting: describeWaiting(attributed),
    }
  }

  /**
   * Addresses for a registered quorum, whichever script kind it is.
   *
   * TAPROOT AND THE OLDER KINDS DERIVE THROUGH DIFFERENT FUNCTIONS, and these
   * two methods called only the older one. Registration, change detection and
   * signing all handled taproot quorums correctly; the two methods that show a
   * user an address refused them, so a taproot quorum could be agreed to,
   * signed for and recognised, and never displayed. The Receive screen's quorum
   * tab and the compare-addresses screen both errored.
   *
   * Dispatched here, once, rather than at each call site, because that is how
   * the divergence happened: buildOwnedIndex and the registration smoke test
   * both branch on the kind and these did not.
   */
  const quorumAddresses = (
    descriptor: ReturnType<typeof parseDescriptor>,
    change: boolean,
    start: number,
    count: number
  ): readonly { address: string; index: number }[] =>
    deriveQuorumAddresses(descriptor, { network: session.network, change, start, count })

  /** A wallet id from a request, validated before it reaches any path. */
  const requireWalletId = (request: IpcRequest): string => {
    const value = params(request)['id']
    if (!WalletRegistry.isId(value)) {
      throw new Error('That is not a wallet id.')
    }
    return value
  }

  const requireColour = (request: IpcRequest): WalletColour => {
    const value = params(request)['colour']
    const found = WALLET_COLOURS.find((colour) => colour === value)
    if (found === undefined) {
      throw new Error(`Unknown colour. Expected one of: ${WALLET_COLOURS.join(', ')}.`)
    }
    return found
  }

  /**
   * Close the single-wallet surface once this device holds named wallets.
   *
   * The two APIs address different files: store.* works on the blob at the root
   * of the store directory, wallets.* on the per-wallet directories. Leaving
   * both open produced two distinct hazards. One seed could be sealed through
   * each under two passphrases, with the weaker governing the money and nothing
   * showing they were the same wallet, because the registry cannot see a store
   * written behind its back. And store.destroy reported destroyed:true having
   * removed nothing at all, which is the worst possible answer to "did you
   * erase my wallet".
   *
   * store.status is deliberately still allowed: it is read-only, it reports on
   * a file that will not exist, and the lock screen calls it before anything
   * else is known.
   */
  const refuseLegacyStore = (replacement: string): void => {
    if (state.registry === undefined) return
    throw new Error(
      `This device holds named wallets, so that operation would act on a file that is not ` +
        `one of them. Use ${replacement} instead.`
    )
  }

  /**
   * What every response naming a wallet says.
   *
   * Read off the session rather than off a request or a hint, so it is the
   * authenticated identity of the seed that is actually loaded.
   */
  const activeWallet = (): Record<string, unknown> | null => {
    const active = session.active
    if (active === undefined) return null
    return { id: active.id, label: active.label, colour: active.colour }
  }
  return {
    state,
    session,
    requireStore,
    requireRegistry,
    whoStillHasToSign,
    quorumAddresses,
    requireWalletId,
    requireColour,
    refuseLegacyStore,
    activeWallet,
  }
}

/**
 * What a method table is handed.
 *
 * Written out rather than inferred from createContext, because inferring it
 * would make the interface and the function each other's definition. The
 * signatures are the ones the helpers had as locals.
 */
export interface HandlerContext {
  readonly state: DaemonState
  readonly session: Session
  readonly requireStore: () => WalletStore
  readonly requireRegistry: () => WalletRegistry
  readonly whoStillHasToSign: (
    tx: ReturnType<typeof parsePsbt>,
    signedBy: readonly string[]
  ) => { cosigners: unknown; unattributed: number; waiting: string }
  readonly quorumAddresses: (
    descriptor: ReturnType<typeof parseDescriptor>,
    change: boolean,
    start: number,
    count: number
  ) => readonly { address: string; index: number }[]
  readonly requireWalletId: (request: IpcRequest) => string
  readonly requireColour: (request: IpcRequest) => WalletColour
  readonly refuseLegacyStore: (replacement: string) => void
  readonly activeWallet: () => Record<string, unknown> | null
}

/**
 * Every table in one, refusing a name two of them claim.
 *
 * The switch this replaced could not have this bug: TypeScript rejects a
 * duplicate case label. A table can hold one silently, and the loser would be
 * whichever module was merged first, so a method would be answered by code the
 * author of the other table believed was running.
 */
export function mergeTables(tables: readonly MethodTable[]): MethodTable {
  const merged: Record<string, (request: IpcRequest) => unknown> = {}
  for (const table of tables) {
    for (const [method, fn] of Object.entries(table)) {
      if (method in merged) {
        throw new Error(
          `Two IPC tables both define "${method}". One of them would have been ` +
            `unreachable, and nothing else would have said so.`
        )
      }
      merged[method] = fn
    }
  }
  return merged
}
