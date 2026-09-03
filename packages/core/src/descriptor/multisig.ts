/**
 * Addresses from a multisig descriptor.
 *
 * Spec: core.descriptor.multisig
 *
 * The descriptor parser already understands `wsh(sortedmulti(...))`. This turns
 * one into addresses, which is the part that decides whether the device can
 * check its own change, and therefore the part that decides whether a multisig
 * wallet is safe to use here at all.
 *
 * KEY ORDER IS THE WHOLE PROBLEM. `multi` uses the order written in the
 * descriptor; `sortedmulti` sorts the derived public keys lexicographically at
 * every index, per BIP-67. They produce different scripts and therefore
 * different addresses from the same keys, and nothing about an address says
 * which was meant. Getting this wrong does not throw: it silently produces a
 * wallet whose addresses nobody else agrees with, and the failure surfaces when
 * a coordinator sends funds somewhere the device cannot see them.
 *
 * The sort is on the DERIVED key at each index, not on the parent xpubs.
 * Sorting parents once would be cheaper and is wrong, because lexicographic
 * order is not preserved through derivation: two cosigners can swap places
 * between index 4 and index 5. That is the single most common way to get
 * sortedmulti subtly wrong, so it is asserted in the tests rather than assumed.
 */

import * as btc from '@scure/btc-signer'
import { base58 } from '@scure/base'
import { type Network } from '../network/networks.js'
import { derivePubkeyAt } from './derive-key.js'
import { taprootQuorum } from './taproot.js'
import {
  DescriptorParseError,
  type Descriptor,
  type KeyExpression,
  type ScriptNode,
} from './parse.js'

/** The shapes this device will derive. Anything else is refused. */
export type MultisigKind = 'wsh' | 'sh-wsh' | 'sh'

export interface MultisigShape {
  readonly kind: MultisigKind
  readonly threshold: number
  readonly total: number
  /** True when the keys are sorted at each index, per BIP-67. */
  readonly sorted: boolean
  readonly keys: readonly KeyExpression[]
}

export interface MultisigAddress {
  readonly address: string
  /** The index within the branch, not a full path: cosigners differ in path. */
  readonly index: number
  /** Derived public keys in the order they appear in the script. */
  readonly pubkeys: readonly string[]
}

export interface DeriveMultisigOptions {
  readonly network: Network
  /** Which branch. Applied only when the descriptor is multipath or ranged. */
  readonly change?: boolean
  readonly start?: number
  readonly count?: number
}

/**
 * Recognise the multisig shape of a descriptor, or say why not.
 *
 * Deliberately narrow. A descriptor this device does not fully understand must
 * be refused rather than approximated, because the consequence of a near miss
 * is a wallet whose addresses are not the ones the quorum agreed on.
 */
export function multisigShape(descriptor: Descriptor): MultisigShape {
  const { script } = descriptor

  const inner = (node: ScriptNode): ScriptNode => node

  let kind: MultisigKind
  let body: ScriptNode

  if (script.kind === 'wsh') {
    kind = 'wsh'
    body = inner(script.inner)
  } else if (script.kind === 'sh' && script.inner.kind === 'wsh') {
    kind = 'sh-wsh'
    body = inner(script.inner.inner)
  } else if (script.kind === 'sh') {
    kind = 'sh'
    body = inner(script.inner)
  } else {
    throw new DescriptorParseError(
      `This is a ${script.kind} descriptor, not a multisig one. Expected wsh(...), ` +
        `sh(wsh(...)) or sh(...).`
    )
  }

  if (body.kind !== 'multi' && body.kind !== 'sortedmulti') {
    throw new DescriptorParseError(
      `Expected multi() or sortedmulti() inside, found ${body.kind}. ` +
        `Taproot multisig (multi_a) is not supported by this device yet.`
    )
  }

  const total = body.keys.length
  if (body.threshold < 1 || body.threshold > total) {
    throw new DescriptorParseError(
      `A ${String(body.threshold)}-of-${String(total)} quorum is not satisfiable.`
    )
  }
  // Consensus limit for bare and P2SH multisig. Beyond 15 keys the redeem
  // script exceeds 520 bytes and the output is unspendable, which is a much
  // worse thing to discover after funding than before.
  if (kind !== 'wsh' && total > 15) {
    throw new DescriptorParseError(
      `${String(total)} keys will not fit in a P2SH redeem script. Use wsh() for more than 15.`
    )
  }
  if (total > 20) {
    throw new DescriptorParseError(`${String(total)} keys exceeds the 20 key consensus limit.`)
  }

  return {
    kind,
    threshold: body.threshold,
    total,
    sorted: body.kind === 'sortedmulti',
    keys: body.keys,
  }
}

/** Lexicographic order on the compressed encoding, per BIP-67. */
function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const length = Math.min(a.length, b.length)
  for (let i = 0; i < length; i += 1) {
    const left = a[i] ?? 0
    const right = b[i] ?? 0
    if (left !== right) return left - right
  }
  return a.length - b.length
}

/**
 * Derive addresses from a multisig descriptor.
 *
 * Every address is built from keys derived at that exact index. Nothing is
 * cached across indexes and no ordering is reused, because for `sortedmulti`
 * the order can differ from one index to the next.
 */
export function deriveMultisigAddresses(
  descriptor: Descriptor,
  options: DeriveMultisigOptions
): MultisigAddress[] {
  const shape = multisigShape(descriptor)
  const { network } = options
  const change = options.change ?? false
  const start = options.start ?? 0
  const count = options.count ?? 20

  if (count < 0 || count > 1000) {
    throw new DescriptorParseError(`Refusing to derive ${String(count)} addresses.`)
  }

  const out: MultisigAddress[] = []
  for (let i = 0; i < count; i += 1) {
    const index = start + i
    const derived = shape.keys.map((key) => derivePubkeyAt(key, index, change))

    // Sorted per index, on the derived keys. See the note at the top of this
    // file: sorting the parent xpubs once would be wrong.
    const ordered = shape.sorted ? [...derived].sort(compareBytes) : derived

    const multisig = btc.p2ms(shape.threshold, ordered)
    const payment =
      shape.kind === 'wsh'
        ? btc.p2wsh(multisig, network)
        : shape.kind === 'sh-wsh'
          ? btc.p2sh(btc.p2wsh(multisig, network), network)
          : btc.p2sh(multisig, network)

    // The library types `address` as always present for these payment kinds,
    // so there is no undefined branch to guard. p2ms, p2wsh and p2sh all
    // produce an address by construction.
    out.push({
      address: payment.address,
      index,
      pubkeys: ordered.map((k) => bytesToHex(k)),
    })
  }
  return out
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Whether this device holds one of the keys in a descriptor, and which.
 *
 * The check that stops a user registering a quorum they are not part of. A
 * coordinator that supplied a descriptor with the user's key replaced would
 * produce a wallet that looks entirely normal, shows plausible addresses, and
 * cannot be spent from. Worse, the user would believe they held a key in it.
 *
 * Matched on the extended key itself rather than on the fingerprint in the
 * origin, because a fingerprint is four bytes of unauthenticated hint that an
 * attacker writes into the descriptor by hand. Comparing the actual xpub is the
 * only version of this check worth having.
 */
export function findOwnKey(
  descriptor: Descriptor,
  accountXpub: string
): { readonly position: number; readonly origin?: string } | undefined {
  // Works for both quorum shapes. A taproot quorum keeps its keys in a script
  // leaf rather than in a wsh, and membership means the same thing in both, so
  // splitting this by descriptor kind at every call site would be two places to
  // get the same question wrong.
  const keys = quorumKeys(descriptor)
  if (keys === undefined) return undefined
  const mine = normalizeXpub(accountXpub)

  for (const [position, key] of keys.entries()) {
    if (key.kind !== 'extended') continue
    if (normalizeXpub(key.xpub) !== mine) continue
    return key.origin === undefined ? { position } : { position, origin: key.origin.path }
  }
  return undefined
}

/**
 * The cosigner keys of a quorum, whatever script kind expresses it.
 *
 * Returns undefined when the descriptor holds no quorum at all, which is a
 * normal answer for a single-signature descriptor rather than an error.
 */
function quorumKeys(descriptor: Descriptor): readonly KeyExpression[] | undefined {
  if (descriptor.script.kind === 'tr') {
    return taprootQuorum(descriptor)?.keys
  }
  try {
    return multisigShape(descriptor).keys
  } catch {
    return undefined
  }
}

/**
 * Compare extended keys by the material they carry, not by their text.
 *
 * The same key serialises differently under xpub, ypub, zpub and their testnet
 * spellings, and a wallet that compared strings would report "your key is not
 * in this quorum" for a descriptor that in fact contains it. Only the version
 * bytes differ, so they are dropped and the remaining 74 bytes compared.
 */
function normalizeXpub(value: string): string {
  try {
    const raw = base58.decode(value)
    // 4 version + 74 payload + 4 checksum. Drop version and checksum.
    if (raw.length < 78) return value
    return bytesToHex(raw.slice(4, 78))
  } catch {
    return value
  }
}
