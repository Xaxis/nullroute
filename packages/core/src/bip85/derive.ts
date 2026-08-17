/**
 * BIP-85: deterministic child seeds from one master seed.
 *
 * Spec: core.bip85
 *
 * One mnemonic on paper, many independent wallets derived from it. The child
 * seeds are one-way: holding a child tells you nothing about the master or
 * about its siblings, so a child can be given to a piece of software you trust
 * less than this device without putting anything else at risk.
 *
 * WHAT THIS IS NOT. It is not a passphrase and it is not a hardware boundary. A
 * child derived here has exactly one backup, and it is the master mnemonic:
 * writing the child's words down as well does not make it independently
 * recoverable, it makes a second copy of a thing the master already implies.
 * The only recovery that matters is the master plus the path, which is why
 * every derivation here reports the path it used, in full, for the user to
 * record beside the words.
 *
 * THE DANGEROUS PROPERTY. Every child is a real wallet with real addresses, and
 * nothing about a child says which master it came from or at which index. A user
 * who derives at index 0, funds it, and later derives at index 0 again with a
 * different word count gets a completely different wallet with no error. So the
 * path is the identity, and the caller is given it rather than being expected to
 * reconstruct it.
 *
 * No cryptography is invented here. The derivation is BIP-32 from @scure/bip32
 * and HMAC-SHA512 from @noble/hashes, in the arrangement BIP-85 specifies.
 */

import { HDKey } from '@scure/bip32'
import { hmac } from '@noble/hashes/hmac.js'
import { sha512 } from '@noble/hashes/sha2.js'
import { base64 } from '@scure/base'
import { Secret } from '../util/secret.js'
import { MAINNET } from '../network/networks.js'
import { rootFromSeed } from '../derive/hd.js'
import { entropyToWords } from '../bip39/mnemonic.js'

export class Bip85Error extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Bip85Error'
  }
}

/**
 * The purpose field, 83696968', which is "BIPS" in ASCII read as a number.
 *
 * Fixed by the standard. Every BIP-85 path starts here, which is what keeps
 * these derivations from colliding with an ordinary account tree.
 */
const PURPOSE = 83696968

/** Application numbers, as BIP-85 assigns them. */
const APP_BIP39 = 39
const APP_HEX = 128169
const APP_PWD_BASE64 = 707764

/** BIP-39 language 0 is English. This device ships one wordlist. */
const LANGUAGE_ENGLISH = 0

/**
 * The HMAC key, as a literal ASCII string.
 *
 * Written out rather than referenced, because it is the one value here that a
 * reader has to check against the standard and a constant named after itself
 * would hide it.
 */
const HMAC_KEY = new TextEncoder().encode('bip-entropy-from-k')

/** Word counts BIP-39 defines, with the entropy each needs. */
const WORD_ENTROPY: Readonly<Record<number, number>> = { 12: 16, 18: 24, 24: 32 }

/**
 * The same thing from a seed, which is what this device holds.
 *
 * The network only decides version bytes for serialisation and nothing here
 * serialises. Mainnet is fixed rather than taken from the session, because a
 * child that depended on which network happened to be selected would be
 * irreproducible by anyone following the standard.
 */
function entropyFromSeed(seed: Secret, path: string): Secret {
  const root: HDKey = rootFromSeed(seed, MAINNET)
  return bip85Entropy(root, path)
}

export interface Bip85Derivation {
  /**
   * The full path, for the user to record.
   *
   * The child is unrecoverable without it. Two derivations differing only in
   * word count produce different wallets and neither says so.
   */
  readonly path: string
}

export interface Bip85Mnemonic extends Bip85Derivation {
  readonly words: string
  readonly wordCount: number
}

export interface Bip85Hex extends Bip85Derivation {
  readonly hex: string
  readonly bytes: number
}

export interface Bip85Password extends Bip85Derivation {
  readonly password: string
  readonly length: number
}

function assertIndex(index: number): void {
  // BIP-32 hardened indices run to 2^31 - 1. Anything outside that is not a
  // path, and silently wrapping it would derive a wallet the user did not ask
  // for at a path they cannot write down.
  if (!Number.isInteger(index) || index < 0 || index > 0x7fffffff) {
    throw new Bip85Error(
      `Index ${String(index)} is not a hardened BIP-32 index. It must be a whole number from 0 ` +
        `to 2147483647.`
    )
  }
}

/**
 * The 64 bytes BIP-85 produces at a path, from a root key.
 *
 * HMAC-SHA512 of the derived private key, under a fixed key. Public, and taking
 * a root rather than a seed, for one reason: the BIP-85 test vectors are
 * published as an xprv and a path, so this is the shape in which they can be
 * checked directly. A reviewer can paste the document's master key in and
 * compare bytes without going through a seed nobody has.
 *
 * The applications below take a seed, which is what the device actually holds.
 */
export function bip85Entropy(root: HDKey, path: string): Secret {
  const child = root.derive(path)

  const privateKey = child.privateKey
  if (privateKey === null) {
    throw new Bip85Error(`Deriving ${path} produced no private key.`)
  }

  // Wrapped immediately. This is key material, and the HMAC below is the only
  // thing that should ever see it.
  using key = Secret.copyOf(privateKey, 'bip85-child-key')
  const derived = hmac(sha512, HMAC_KEY, key.bytes)
  return Secret.fromBytes(derived, 'bip85-entropy')
}

/**
 * A child mnemonic.
 *
 * The returned words are a real wallet's backup and must be treated as one. The
 * path is returned with them because it is the other half: without it, the
 * master mnemonic cannot reproduce this child.
 */
export function deriveBip85Mnemonic(
  seed: Secret,
  wordCount: number,
  index: number
): Bip85Mnemonic {
  const bytes = WORD_ENTROPY[wordCount]
  if (bytes === undefined) {
    throw new Bip85Error(
      `BIP-85 produces mnemonics of 12, 18 or 24 words, not ${String(wordCount)}.`
    )
  }
  assertIndex(index)

  const path = `m/${String(PURPOSE)}'/${String(APP_BIP39)}'/${String(LANGUAGE_ENGLISH)}'/${String(wordCount)}'/${String(index)}'`
  using entropy = entropyFromSeed(seed, path)
  using trimmed = Secret.copyOf(entropy.bytes.subarray(0, bytes), 'bip85-mnemonic-entropy')

  return { words: entropyToWords(trimmed), wordCount, path }
}

/**
 * Raw entropy as hex, for software that wants bytes rather than words.
 *
 * BIP-85 allows 16 to 64 bytes. The bound is the standard's, and the lower end
 * is 128 bits, which is the least this device will hand out as a key.
 */
export function deriveBip85Hex(seed: Secret, bytes: number, index: number): Bip85Hex {
  if (!Number.isInteger(bytes) || bytes < 16 || bytes > 64) {
    throw new Bip85Error(
      `BIP-85 hex entropy is 16 to 64 bytes, not ${String(bytes)}. Below 16 is under 128 bits.`
    )
  }
  assertIndex(index)

  const path = `m/${String(PURPOSE)}'/${String(APP_HEX)}'/${String(bytes)}'/${String(index)}'`
  using entropy = entropyFromSeed(seed, path)

  let hex = ''
  for (const byte of entropy.bytes.subarray(0, bytes)) {
    hex += byte.toString(16).padStart(2, '0')
  }
  return { hex, bytes, path }
}

/**
 * A password, as base64 of the derived entropy.
 *
 * BIP-85 allows 20 to 86 characters. This is for logins on other machines, not
 * for anything on this device: a passphrase protecting a wallet here should be
 * one a human chose and can remember, because a password nobody can reproduce
 * from memory has exactly one copy and it is on paper.
 */
export function deriveBip85Password(
  seed: Secret,
  length: number,
  index: number
): Bip85Password {
  if (!Number.isInteger(length) || length < 20 || length > 86) {
    throw new Bip85Error(
      `BIP-85 passwords are 20 to 86 characters, not ${String(length)}.`
    )
  }
  assertIndex(index)

  const path = `m/${String(PURPOSE)}'/${String(APP_PWD_BASE64)}'/${String(length)}'/${String(index)}'`
  using entropy = entropyFromSeed(seed, path)

  // The whole 64 bytes are encoded and then cut, which is what the standard
  // says. Encoding only the bytes needed would produce a different string.
  const password = base64.encode(entropy.bytes).slice(0, length)
  return { password, length, path }
}
