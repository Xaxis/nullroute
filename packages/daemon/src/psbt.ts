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
  deriveQuorumAddresses,
  findOwnKey,
  deriveAccountXpub,
  multisigShape,
  normalizePath,
  taprootQuorum,
  parseDescriptor,
  rootFromSeed,
  type SignatureProgress,
} from '@nullroute/core'
import { bytesToHex } from '@noble/hashes/utils.js'
import { multisigAccountPath } from './multisig.js'

/** Every script type the device derives. Order is display order. */
export const SCRIPT_TYPES: readonly ScriptType[] = ['p2wpkh', 'p2tr', 'p2sh-p2wpkh', 'p2pkh']

export interface OwnedAddress {
  readonly address: string
  /** Absolute path, e.g. m/84'/0'/0'/1/4. */
  readonly path: string
  readonly scriptType: ScriptType | 'multisig'
  readonly change: boolean
  readonly index: number
  /** The descriptor this came from, when it came from a registered quorum. */
  readonly descriptor?: string
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
  options: {
    readonly gapLimit?: number
    readonly account?: number
    /**
     * Registered multisig descriptors.
     *
     * Without these a multisig change output is reported as a payment to a
     * stranger. That is the safe direction to be wrong in, and it is still
     * wrong: the user sees a warning about money leaving on every transaction
     * their own wallet builds, which is exactly the way to train someone to
     * ignore the warning that matters.
     */
    readonly registrations?: readonly string[]
  } = {}
): { index: Map<string, OwnedAddress>; unreadable: number } {
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

  /*
   * A registration that cannot be read is COUNTED, not just skipped.
   *
   * Five paths in addRegistration used to `return` into silence, so a quorum
   * that stopped parsing, or whose key could no longer be located, simply
   * vanished from this index and every address it owns became a stranger's.
   * On the review screen that renders as "money leaving the wallet" against
   * the user's own change: the safe direction for the label, and the worst
   * direction for behaviour, because it teaches somebody that the warning on
   * this screen is noise.
   *
   * multisig.registrations has always reported the same failure honestly, as
   * `unreadable`. The screen a person reads before authorising a spend did not.
   *
   * Not-ours is not counted. A device registered in one quorum and holding a
   * descriptor for another legitimately has no key in the second.
   */
  let unreadable = 0
  for (const body of options.registrations ?? []) {
    if (addRegistration(index, body, seed, network, gapLimit, account) === 'unreadable') {
      unreadable += 1
    }
  }

  return { index, unreadable }
}

/**
 * Fold a registered quorum's addresses into the index.
 *
 * The path recorded is the one THIS DEVICE signs with, not the descriptor's:
 * each cosigner reaches the same address by a different derivation, and the
 * signing path is the only one that is any use later.
 *
 * A registration that no longer parses, or that no longer contains this
 * device's key, is skipped rather than thrown on. It was verified when it was
 * registered, so reaching here means something changed underneath, and refusing
 * to review any transaction at all would be a worse failure than reviewing this
 * one with a quorum's outputs shown as payments.
 */
/**
 * What became of one registered quorum.
 *
 * `not-ours` is not a failure: a device registered in two quorums holds a key
 * in each, and a descriptor it has kept for reference holds none. Only
 * `unreadable` is worth telling the user about, which is why these are three
 * outcomes rather than a boolean.
 */
type RegistrationOutcome = 'added' | 'not-ours' | 'unreadable'

function addRegistration(
  index: Map<string, OwnedAddress>,
  body: string,
  seed: Secret,
  network: Network,
  gapLimit: number,
  account: number
): RegistrationOutcome {
  let descriptor
  try {
    descriptor = parseDescriptor(body)
  } catch {
    return 'unreadable'
  }

  let ourPosition: number
  try {
    const ours = deriveAccountXpub(seed, network, multisigAccountPath(network, account))
    const found = findOwnKey(descriptor, ours.xpub)
    if (found === undefined) return 'not-ours'
    ourPosition = found.position
  } catch {
    return 'unreadable'
  }

  // Taproot quorums live in a script tree rather than in a wsh, so the key list
  // comes from a different place. Everything after this is identical.
  const taproot = descriptor.script.kind === 'tr'
  let keys: readonly import('@nullroute/core').KeyExpression[]
  try {
    if (taproot) {
      const quorum = taprootQuorum(descriptor)
      if (quorum === undefined) return 'unreadable'
      keys = quorum.keys
    } else {
      keys = multisigShape(descriptor).keys
    }
  } catch {
    return 'unreadable'
  }

  const ourKey = keys[ourPosition]
  if (ourKey?.kind !== 'extended') return 'unreadable'

  const base = normalizePath(multisigAccountPath(network, account))

  for (const change of [false, true]) {
    // Which branch this device derives through for that side of the wallet.
    // A multipath key names both; a single-branch key already carries one, and
    // deriving `change` on top of it would produce a path nobody shares.
    const branch = branchOf(ourKey.multipath, ourKey.path, change)
    if (branch === undefined) continue

    let derived
    try {
      derived = deriveQuorumAddresses(descriptor, { network, change, start: 0, count: gapLimit })
    } catch {
      return 'unreadable'
    }

    for (const entry of derived) {
      // A single-branch descriptor produces the same addresses for both passes.
      // Recording them once keeps the receive reading rather than overwriting
      // it with a change one, which would label a deposit as change.
      if (index.has(entry.address)) continue
      index.set(entry.address, {
        address: entry.address,
        path: `${base}/${String(branch)}/${String(entry.index)}`,
        scriptType: 'multisig',
        change,
        index: entry.index,
        descriptor: body,
      })
    }
  }
  return 'added'
}

/** The branch index this key expression uses for the receive or change side. */
function branchOf(
  multipath: readonly number[] | undefined,
  path: string,
  change: boolean
): number | undefined {
  if (multipath !== undefined) return change ? multipath[1] : multipath[0]
  // Single branch: it is written into the path, and the change flag does not
  // apply. Only the receive pass records anything.
  if (change) return undefined
  const last = path
    .split('/')
    .filter((p) => p.length > 0 && p !== 'm')
    .pop()
  if (last === undefined) return undefined
  const value = Number(last)
  return Number.isInteger(value) && value >= 0 ? value : undefined
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

/** What signing on this device would do to a transaction's quorum. */
export interface ThisDeviceProgress {
  /**
   * Whether signing here leaves every input with the signatures it needs.
   * Null when any input's requirement cannot be read, because a screen that
   * guessed would be telling somebody they are finished on a script this code
   * did not understand.
   */
  readonly completesIfSigned: boolean | null
  /**
   * The most signatures any one input would still lack after this device
   * signs, or null when that cannot be read. Zero exactly when
   * `completesIfSigned` is true.
   */
  readonly stillNeeded: number | null
  /** How many inputs this device would add a signature to. */
  readonly adds: number
  /** True when this device owns inputs and has already signed every one. */
  readonly alreadySigned: boolean
}

/**
 * Per input, whether this device can sign it and whether it already has.
 *
 * The signing screen said "yours would be the last signature" by comparing
 * totals summed over every input: present plus one against required. This
 * device adds one signature to EACH input it owns, not one in total, and none
 * to an input it already signed, so a 2-of-3 with two inputs, both signed by
 * cosigner one, read as "not the last" when this signature completes it, and
 * a transaction scanned back after signing read as "the last" when signing
 * again adds nothing. The answer is worked out here, per input, from the keys
 * that signed and the key this device holds for that input.
 */
export function thisDeviceProgress(
  scripts: readonly (Uint8Array | undefined)[],
  index: Map<string, OwnedAddress>,
  seed: Secret,
  network: Network,
  signatures: SignatureProgress
): ThisDeviceProgress {
  const root = rootFromSeed(seed, network)
  try {
    let adds = 0
    let owned = 0
    let signedByUs = 0
    let completes: boolean | null = true
    let shortfall = 0
    for (const [position, input] of signatures.inputs.entries()) {
      const script = scripts[position]
      const address = script === undefined ? undefined : addressFromScript(script, network)
      const mine = address === undefined ? undefined : index.get(address)
      let signed = false
      if (mine !== undefined) {
        owned += 1
        const key = root.derive(mine.path).publicKey
        const compressed = key === null ? '' : bytesToHex(key)
        signed =
          input.signedBy.includes(compressed) ||
          input.signedBy.includes(compressed.slice(2)) ||
          (mine.scriptType === 'p2tr' && input.signedBy.includes('taproot-key-path'))
        if (signed) signedByUs += 1
        else adds += 1
      }
      if (input.required === undefined) {
        completes = null
        continue
      }
      const after = input.present + (mine !== undefined && !signed ? 1 : 0)
      shortfall = Math.max(shortfall, input.required - after)
      if (completes !== null && after < input.required) completes = false
    }
    return {
      completesIfSigned: signatures.inputs.length === 0 ? null : completes,
      stillNeeded: signatures.inputs.length === 0 || completes === null ? null : shortfall,
      adds,
      alreadySigned: owned > 0 && signedByUs === owned,
    }
  } finally {
    root.wipePrivateData()
  }
}
