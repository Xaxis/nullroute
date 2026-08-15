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
import { HDKey } from '@scure/bip32'
import { base58 } from '@scure/base'
import { type Network } from '../network/networks.js'
import { DescriptorParseError, type Descriptor, type KeyExpression, type ScriptNode } from './parse.js'

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

  return { kind, threshold: body.threshold, total, sorted: body.kind === 'sortedmulti', keys: body.keys }
}

/**
 * The public key a descriptor key expression produces at a given index.
 *
 * The parser has already canonicalised the suffix, and its representation is
 * what this has to work from rather than the original text:
 *
 *   - `path` is the derivation with the wildcard REMOVED, so `xpub/0/*` parses
 *     to `m/0` and `ranged: true`. The index is appended, it does not replace
 *     anything.
 *   - `multipath: [a, b]` records a BIP-389 `<a;b>`, and the final segment of
 *     `path` already holds the first branch. Selecting the change branch means
 *     replacing that segment, not appending to it.
 *   - A key with no wildcard is fixed. It is legal, occasionally intended, and
 *     the index does not apply to it at all.
 *
 * `change` therefore only means something for a multipath descriptor. A wallet
 * registered as a pair of `/0/*` and `/1/*` descriptors carries the branch in
 * the descriptor itself, and applying `change` again would derive `0/1/index`.
 */
function derivePubkey(key: KeyExpression, index: number, change: boolean): Uint8Array {
  if (key.kind === 'raw') {
    // A fixed key. Legal in a descriptor and constant across indexes.
    return hexToBytes(key.hex)
  }

  const segments: number[] = []
  for (const part of key.path.split('/')) {
    if (part.length === 0 || part === 'm') continue
    if (part.endsWith("'") || part.endsWith('h')) {
      // A hardened step cannot be taken from a public key, and a descriptor
      // that asks for one after the xpub is malformed rather than unsupported.
      throw new DescriptorParseError(
        `Descriptor derives through hardened step "${part}" from an extended PUBLIC key, ` +
          `which is impossible. The hardened part belongs in the key origin.`
      )
    }
    const value = Number(part)
    if (!Number.isInteger(value) || value < 0) {
      throw new DescriptorParseError(`Cannot derive through path segment "${part}".`)
    }
    segments.push(value)
  }

  const branches = key.multipath
  if (branches !== undefined) {
    const chosen = change ? branches[1] : branches[0]
    if (chosen === undefined) {
      throw new DescriptorParseError('A multipath descriptor did not name both branches.')
    }
    if (segments.length === 0) {
      throw new DescriptorParseError('A multipath descriptor has no branch segment to replace.')
    }
    segments[segments.length - 1] = chosen
  }

  if (key.ranged) segments.push(index)

  // The version bytes are taken from the key itself, not from the network.
  //
  // Passing the network's versions makes the library reject any key with a
  // different prefix, which broke multisig on every network but mainnet: a
  // signet descriptor carries tpubs and the default assumption is xpub. Passing
  // the network's versions the other way is no better, because BIP-380 treats
  // the prefix as a label rather than as part of the key, and coordinators
  // legitimately emit xpub, ypub, Zpub and tpub for the same wallet.
  //
  // This is safe because the prefix genuinely carries no key material: the same
  // 74 bytes derive identical public keys whatever four bytes precede them, and
  // the address encoding downstream is what makes a testnet address testnet.
  //
  // Network confusion is caught where it can actually be caught, in
  // `findOwnKey`: this device's account key is derived under the session
  // network's coin type, so a mainnet quorum simply does not contain the key
  // this device holds on signet.
  const versions = { public: readVersion(key.xpub), private: 0 }
  let derived = HDKey.fromExtendedKey(key.xpub, versions)
  for (const segment of segments) derived = derived.deriveChild(segment)

  const pubkey = derived.publicKey
  if (pubkey === null) {
    throw new DescriptorParseError('A descriptor key produced no public key.')
  }
  return pubkey
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

/**
 * The four version bytes an extended key was serialised with.
 *
 * Read rather than assumed, so that xpub, tpub, ypub and Zpub are all accepted.
 * Falls back to mainnet for anything unreadable, which then fails in the
 * library with its own error rather than here with a worse one.
 */
function readVersion(extended: string): number {
  try {
    const raw = base58.decode(extended)
    if (raw.length < 4) return 0x0488b21e
    return ((raw[0] ?? 0) << 24) | ((raw[1] ?? 0) << 16) | ((raw[2] ?? 0) << 8) | (raw[3] ?? 0)
  } catch {
    return 0x0488b21e
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
    const derived = shape.keys.map((key) => derivePubkey(key, index, change))

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
  const shape = multisigShape(descriptor)
  const mine = normalizeXpub(accountXpub)

  for (const [position, key] of shape.keys.entries()) {
    if (key.kind !== 'extended') continue
    if (normalizeXpub(key.xpub) !== mine) continue
    return key.origin === undefined ? { position } : { position, origin: key.origin.path }
  }
  return undefined
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
