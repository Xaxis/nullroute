/**
 * Turning a descriptor key expression into a public key at an index.
 *
 * Shared by every script kind, because the rules are the same whatever the
 * surrounding script is and two copies would be two chances to disagree about
 * what `/<0;1>/*` means.
 */

import { HDKey } from '@scure/bip32'
import { base58 } from '@scure/base'
import { DescriptorParseError, type KeyExpression } from './parse.js'

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
export function derivePubkeyAt(key: KeyExpression, index: number, change: boolean): Uint8Array {
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

