/**
 * BIP-32 hierarchical deterministic key derivation.
 *
 * Spec: core.derive.hd
 *
 * A thin, network-aware layer over the audited implementation. What it adds is
 * the three things that are easy to get wrong and expensive to get wrong:
 *
 *   1. Path notation is normalised, so a descriptor from Bitcoin Core (which
 *      writes `84h`) does not throw where one from BIP-32 (`84'`) works.
 *   2. Version bytes are threaded through from the network on BOTH the
 *      serialise and the parse side. Omitting them on parse throws "Version
 *      mismatch", and omitting them on serialise silently emits an xpub for a
 *      testnet key, which is worse.
 *   3. Private material is wrapped in `Secret`, and the public half is plain
 *      data. That boundary is INV-KEY-1: the frontend receives the second and
 *      never the first.
 */

import { HDKey } from '@scure/bip32'
import { bytesToHex } from '@noble/hashes/utils.js'
import { Secret } from '../util/secret.js'
import { type Network } from '../network/networks.js'
import { normalizePath, parsePath } from './path.js'

export class DerivationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DerivationError'
  }
}

/**
 * The public half of a derived key. Safe to show, safe to export, safe to send
 * to the frontend. Contains nothing from which a private key can be recovered.
 */
export interface AccountXpub {
  /** Extended public key, serialised with the network's version bytes. */
  readonly xpub: string
  /** Canonical derivation path, apostrophe form. */
  readonly path: string
  /** Fingerprint of the MASTER key, as descriptors record it. */
  readonly masterFingerprint: string
  /** Fingerprint of this key itself. */
  readonly fingerprint: string
  readonly depth: number
  readonly network: Network
}

/** Four bytes of the key's own fingerprint, lowercase hex, as descriptors use. */
function fingerprintHex(value: number): string {
  return value.toString(16).padStart(8, '0')
}

/**
 * Root key from a BIP-39 seed.
 *
 * The caller owns the seed and is responsible for disposing it. This does not
 * take ownership, because a seed is usually needed for more than one derivation.
 */
export function rootFromSeed(seed: Secret, network: Network): HDKey {
  return HDKey.fromMasterSeed(seed.bytes, {
    public: network.bip32.public,
    private: network.bip32.private,
  })
}

/**
 * Derive at a path and return only the public half.
 *
 * This is the function the daemon exposes toward the UI. It returns no private
 * material by construction, which is a stronger guarantee than remembering not
 * to serialise it.
 */
export function deriveAccountXpub(seed: Secret, network: Network, path: string): AccountXpub {
  const canonical = normalizePath(path)
  const root = rootFromSeed(seed, network)
  const masterFingerprint = fingerprintHex(root.fingerprint)

  const child = root.derive(canonical)
  const xpub = child.publicExtendedKey

  // Wiping the private material we no longer need. The library holds it in
  // plain arrays that we do not own, so this is best effort and is not a
  // substitute for the system-level ones in provisioning/HARDENING.md.
  root.wipePrivateData()

  return {
    xpub,
    path: canonical,
    masterFingerprint,
    fingerprint: fingerprintHex(child.fingerprint),
    depth: child.depth,
    network,
  }
}

/**
 * The master key fingerprint, which identifies a seed without revealing it.
 *
 * This is what the UI shows at unlock. A passphrase produces a different
 * fingerprint, and that is the ONLY signal a user gets that they typed it
 * wrongly: a wrong passphrase derives a valid, empty, different wallet rather
 * than an error. Displaying this before any funds-related action is the
 * defence.
 */
export function masterFingerprint(seed: Secret, network: Network): string {
  const root = rootFromSeed(seed, network)
  const value = fingerprintHex(root.fingerprint)
  root.wipePrivateData()
  return value
}

/** Parse an extended key, using the network's version bytes. */
export function parseExtendedKey(extended: string, network: Network): HDKey {
  try {
    return HDKey.fromExtendedKey(extended, {
      public: network.bip32.public,
      private: network.bip32.private,
    })
  } catch (err) {
    throw new DerivationError(
      `Could not parse the extended key as ${network.label}: ${(err as Error).message}. ` +
        `Extended keys carry network version bytes, so a mainnet xpub will not parse as testnet ` +
        `and the reverse.`
    )
  }
}

/**
 * Derive a child public key from an xpub alone, for address generation.
 *
 * Rejects any hardened component: hardened derivation requires the private key
 * by definition, and a path that asks for it here is a caller error rather
 * than something to attempt and fail at deeper in the library.
 */
export function derivePublic(parent: HDKey, path: string): HDKey {
  const parsed = parsePath(path)
  const hardened = parsed.indices.find((i) => i >= 0x80000000)
  if (hardened !== undefined) {
    throw new DerivationError(
      `Cannot derive ${parsed.canonical} from a public key: it contains a hardened component. ` +
        `Hardened derivation requires the private key.`
    )
  }
  return parent.derive(parsed.canonical)
}

/** Compressed public key bytes, as scripts and descriptors use them. */
export function publicKeyHex(key: HDKey): string {
  const pub = key.publicKey
  if (pub === null) throw new DerivationError('Key has no public part.')
  return bytesToHex(pub)
}
