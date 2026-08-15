/**
 * Taproot addresses, including script paths.
 *
 * Spec: core.descriptor.taproot
 *
 * BIP-386 `tr()` comes in two shapes and they are not variations on a theme.
 * `tr(KEY)` commits to nothing but the key. `tr(KEY, TREE)` tweaks the internal
 * key by the merkle root of the script tree, so the SAME internal key produces a
 * completely different address depending on what is hanging off it. A wallet
 * that ignored the tree would derive addresses nobody else in the quorum agrees
 * with, silently, which is the same failure mode as getting sortedmulti's key
 * order wrong.
 *
 * TREE SHAPE IS PART OF THE COMMITMENT. `{{A,B},C}` and `{A,{B,C}}` contain the
 * same three leaves and hash to different merkle roots. The parser preserves the
 * shape as written and this preserves it through derivation, so neither
 * flattens a tree into a set.
 *
 * None of the tweak arithmetic is written here. `@scure/btc-signer` provides
 * `p2tr` with a script tree and `p2tr_ms` for `multi_a`, which is the project
 * rule: primitives come from noble or scure. What this module does is walk the
 * descriptor and hand that library the right shape.
 */

import * as btc from '@scure/btc-signer'
import { type Network } from '../network/networks.js'
import {
  DescriptorParseError,
  tapTreeLeaves,
  type Descriptor,
  type KeyExpression,
  type ScriptNode,
  type TapTree,
} from './parse.js'
import { derivePubkeyAt } from './derive-key.js'

export interface TaprootAddress {
  readonly address: string
  readonly index: number
  /** True when the descriptor has a script path as well as a key path. */
  readonly hasScriptPath: boolean
}

export interface DeriveTaprootOptions {
  readonly network: Network
  readonly change?: boolean
  readonly start?: number
  readonly count?: number
}

/**
 * The library's leaf and tree types, inferred rather than imported.
 *
 * `P2Ret` and `TaprootScriptTree` are declared in the signer's payment module
 * and not re-exported from its index, so naming them would mean reaching into a
 * subpath. Inferring from the functions we already call keeps this correct if
 * the library changes their shape.
 */
type TapLeaf = ReturnType<typeof btc.p2tr_pk> | ReturnType<typeof btc.p2tr_ms>
type TapScriptTree = ReturnType<typeof btc.taprootListToTree>

/** x-only, which is what taproot uses everywhere. */
function xOnly(pubkey: Uint8Array): Uint8Array {
  return pubkey.length === 32 ? pubkey : pubkey.slice(1, 33)
}

/**
 * Turn one descriptor leaf into a tapscript.
 *
 * Only the forms this device will actually sign for. Anything else is refused
 * rather than approximated, because an unrecognised leaf changes the merkle
 * root and therefore the address, so guessing produces a wallet whose addresses
 * are wrong in a way nothing on screen would reveal.
 */
function leafScript(node: ScriptNode, index: number, change: boolean): TapLeaf {
  switch (node.kind) {
    case 'pk': {
      const key = xOnly(derivePubkeyAt(node.key, index, change))
      return btc.p2tr_pk(key)
    }
    case 'multi_a':
    case 'sortedmulti_a': {
      const keys = node.keys.map((k) => xOnly(derivePubkeyAt(k, index, change)))
      // BIP-387: sortedmulti_a sorts the x-only keys lexicographically at each
      // index, exactly as sortedmulti does for its compressed keys. Sorting the
      // parents once would be wrong for the same reason.
      const ordered =
        node.kind === 'sortedmulti_a' ? [...keys].sort((a, b) => compareBytes(a, b)) : keys
      return btc.p2tr_ms(node.threshold, ordered)
    }
    default:
      throw new DescriptorParseError(
        `A taproot leaf of kind ${node.kind} is not supported. This device signs tr() trees ` +
          `containing pk(), multi_a() and sortedmulti_a() only.`
      )
  }
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const length = Math.min(a.length, b.length)
  for (let i = 0; i < length; i += 1) {
    const left = a[i] ?? 0
    const right = b[i] ?? 0
    if (left !== right) return left - right
  }
  return a.length - b.length
}

/** Build the library's tree, preserving the shape the descriptor wrote. */
function buildTree(tree: TapTree, index: number, change: boolean): TapLeaf | unknown[] {
  if (Array.isArray(tree)) {
    const [left, right] = tree as readonly [TapTree, TapTree]
    return [buildTree(left, index, change), buildTree(right, index, change)]
  }
  return leafScript((tree as { readonly leaf: ScriptNode }).leaf, index, change)
}

/**
 * Derive addresses for a `tr()` descriptor.
 *
 * Handles both the key-path-only form and the script-path form. The internal
 * key is derived at each index like any other, then tweaked by the tree, which
 * is why an address cannot be computed from the internal key alone.
 */
export function deriveTaprootAddresses(
  descriptor: Descriptor,
  options: DeriveTaprootOptions
): TaprootAddress[] {
  const { script } = descriptor
  if (script.kind !== 'tr') {
    throw new DescriptorParseError(`This is a ${script.kind} descriptor, not a tr() one.`)
  }

  const { network } = options
  const change = options.change ?? false
  const start = options.start ?? 0
  const count = options.count ?? 20
  if (count < 0 || count > 1000) {
    throw new DescriptorParseError(`Refusing to derive ${String(count)} addresses.`)
  }

  // Refused up front rather than per index, so an unsupported leaf fails before
  // any address is produced instead of half way through a list.
  if (script.tree !== undefined) {
    for (const leaf of tapTreeLeaves(script.tree)) {
      if (leaf.kind !== 'pk' && leaf.kind !== 'multi_a' && leaf.kind !== 'sortedmulti_a') {
        throw new DescriptorParseError(
          `A taproot leaf of kind ${leaf.kind} is not supported. This device signs tr() trees ` +
            `containing pk(), multi_a() and sortedmulti_a() only.`
        )
      }
    }
  }

  const out: TaprootAddress[] = []
  for (let i = 0; i < count; i += 1) {
    const index = start + i
    const internal = xOnly(derivePubkeyAt(script.key, index, change))

    const payment =
      script.tree === undefined
        ? btc.p2tr(internal, undefined, network)
        : btc.p2tr(internal, buildTree(script.tree, index, change) as TapScriptTree, network)

    out.push({
      address: payment.address,
      index,
      hasScriptPath: script.tree !== undefined,
    })
  }
  return out
}

/** The quorum a `tr()` script path describes, when it holds exactly one. */
export interface TaprootQuorum {
  readonly threshold: number
  readonly total: number
  readonly sorted: boolean
  readonly keys: readonly KeyExpression[]
}

/**
 * The single multisig leaf of a taproot descriptor, if there is exactly one.
 *
 * Returns undefined for a key-path-only descriptor or for a tree with no
 * multisig leaf, and throws when there is more than one, because "the quorum"
 * is not a well-defined question about a tree with two of them and answering it
 * with the first would be a guess.
 */
export function taprootQuorum(descriptor: Descriptor): TaprootQuorum | undefined {
  const { script } = descriptor
  if (script.kind !== 'tr' || script.tree === undefined) return undefined

  const multisig = tapTreeLeaves(script.tree).filter(
    (leaf) => leaf.kind === 'multi_a' || leaf.kind === 'sortedmulti_a'
  )
  if (multisig.length === 0) return undefined
  if (multisig.length > 1) {
    throw new DescriptorParseError(
      `This tree holds ${String(multisig.length)} multisig leaves. Which one is "the quorum" ` +
        `has no single answer, so it is not summarised rather than guessed at.`
    )
  }

  const only = multisig[0]
  if (only === undefined || (only.kind !== 'multi_a' && only.kind !== 'sortedmulti_a')) {
    return undefined
  }
  return {
    threshold: only.threshold,
    total: only.keys.length,
    sorted: only.kind === 'sortedmulti_a',
    keys: only.keys,
  }
}
