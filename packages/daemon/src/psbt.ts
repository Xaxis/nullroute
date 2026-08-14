/**
 * The wallet's own view of a transaction.
 *
 * Spec: daemon.psbt
 *
 * Reviewing a PSBT needs one question answered repeatedly: is this address
 * mine, and at what path? Everything the review screen promises rests on that
 * being answered by re-derivation from the seed rather than by trusting a
 * derivation hint carried inside the PSBT. A PSBT is attacker-controlled, so a
 * `bip32Derivation` field in it is a claim, not evidence, and an attacker who
 * could make the device believe an address of theirs was change would have the
 * user approving a transfer that reads on screen as "returned to your wallet".
 *
 * So this builds the index the only way that is safe: derive every address this
 * wallet can produce, up to a gap limit, and look up by exact match.
 */

import {
  type Network,
  type ScriptType,
  type Secret,
  accountPath,
  addressFromScript,
  deriveAddresses,
  normalizePath,
  rootFromSeed,
} from '@nullroute/core'

/** Every script type the device derives. Order is display order. */
export const SCRIPT_TYPES: readonly ScriptType[] = ['p2wpkh', 'p2tr', 'p2sh-p2wpkh', 'p2pkh']

export interface OwnedAddress {
  readonly address: string
  /** Absolute path, e.g. m/84'/0'/0'/1/4. */
  readonly path: string
  readonly scriptType: ScriptType
  readonly change: boolean
  readonly index: number
}

/**
 * Every address this wallet can produce within the gap limit, keyed by address.
 *
 * The gap limit is a real bound on what this can detect. An output paying a
 * change address beyond it is reported as a payment to a stranger, which is the
 * safe direction to be wrong in: the user sees a warning about money leaving,
 * rather than a reassuring "change" label on an address the device did not
 * actually verify.
 */
export function buildOwnedIndex(
  seed: Secret,
  network: Network,
  options: { readonly gapLimit?: number; readonly account?: number } = {}
): Map<string, OwnedAddress> {
  const gapLimit = Math.min(options.gapLimit ?? 100, 1000)
  const account = options.account ?? 0
  const index = new Map<string, OwnedAddress>()

  const root = rootFromSeed(seed, network)
  try {
    for (const scriptType of SCRIPT_TYPES) {
      const base = normalizePath(accountPath(scriptType, network, account))
      const accountKey = root.derive(base)
      for (const change of [false, true]) {
        const derived = deriveAddresses(accountKey, {
          scriptType,
          network,
          change,
          start: 0,
          count: gapLimit,
        })
        for (const entry of derived) {
          index.set(entry.address, {
            address: entry.address,
            path: `${base}/${entry.path}`,
            scriptType,
            change,
            index: Number(entry.path.split('/')[1] ?? 0),
          })
        }
      }
    }
  } finally {
    root.wipePrivateData()
  }

  return index
}

/**
 * The change-detection function the review takes.
 *
 * Returns a path only for an address that both re-derives AND sits on the
 * change branch. A receive address of ours that appears as an output is a
 * payment to ourselves, not change, and labelling it change would hide a
 * self-send that the user may not have intended.
 */
export function changeLookup(
  index: Map<string, OwnedAddress>
): (address: string) => string | undefined {
  return (address: string) => {
    const owned = index.get(address)
    // A receive address of ours is a self-send, not change. Only the change
    // branch earns the label.
    if (!owned?.change) return undefined
    return owned.path
  }
}

/**
 * The derivation paths that own this transaction's inputs.
 *
 * Each input's locking script is mapped back to an address and looked up. An
 * input we do not own contributes nothing, which is normal: this device may
 * hold one key of a quorum.
 */
export function signingPathsFor(
  scripts: readonly (Uint8Array | undefined)[],
  index: Map<string, OwnedAddress>,
  network: Network
): string[] {
  const paths = new Set<string>()
  for (const script of scripts) {
    if (script === undefined) continue
    const address = addressFromScript(script, network)
    if (address === undefined) continue
    const owned = index.get(address)
    if (owned !== undefined) paths.add(owned.path)
  }
  return [...paths]
}
