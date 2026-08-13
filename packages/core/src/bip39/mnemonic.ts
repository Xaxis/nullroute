/**
 * BIP-39 mnemonic handling.
 *
 * Spec: core.bip39.mnemonic
 *
 * Deliberately thin. Everything here is plain BIP-39 with no nullroute-specific
 * behaviour anywhere in the conversion, which is what makes INV-INTEROP-1 true:
 * a wallet is recoverable from the mnemonic alone, with third-party software
 * and no nullroute code. Any cleverness added here would be a lock-in bug.
 *
 * The passphrase deserves its own note, because it is the single most common
 * way people lose funds. It is not a password on an account, it is part of the
 * key. A wrong passphrase does not error: it silently derives a different,
 * perfectly valid, empty wallet. The fingerprint is the only defence, which is
 * why it is computed here and displayed before any funds-related action.
 */

import {
  entropyToMnemonic,
  mnemonicToEntropy,
  mnemonicToSeedSync,
  validateMnemonic,
} from '@scure/bip39'
import { wordlist as english } from '@scure/bip39/wordlists/english.js'
import { Secret } from '../util/secret.js'

/** Entropy sizes BIP-39 permits, in bytes, and the word count each produces. */
const WORD_COUNTS: Readonly<Record<number, number>> = {
  16: 12,
  20: 15,
  24: 18,
  28: 21,
  32: 24,
}

export class MnemonicError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MnemonicError'
  }
}

/**
 * Convert entropy to a mnemonic.
 *
 * nullroute generates 32 bytes (24 words) exclusively. Shorter lengths are
 * accepted on import for compatibility with wallets that produced them, but
 * never generated: 128 bits is fine today and this device is meant to outlive
 * that judgement.
 */
export function entropyToWords(entropy: Secret): string {
  const bytes = entropy.bytes
  const words = WORD_COUNTS[bytes.length]
  if (words === undefined) {
    throw new MnemonicError(
      `Entropy must be 16, 20, 24, 28 or 32 bytes, got ${String(bytes.length)}.`
    )
  }
  return entropyToMnemonic(bytes, english)
}

/** Validate a mnemonic's wordlist membership and checksum. */
export function isValidMnemonic(mnemonic: string): boolean {
  return validateMnemonic(normalizeMnemonic(mnemonic), english)
}

/**
 * Canonical form: single spaces, no leading or trailing whitespace, lowercase.
 *
 * BIP-39 seeds are derived from the NFKD-normalised UTF-8 of the mnemonic, so
 * a stray double space changes the seed. Users pasting from a text file hit
 * this, and the failure is silent: a valid mnemonic deriving a different wallet.
 */
export function normalizeMnemonic(mnemonic: string): string {
  return mnemonic.normalize('NFKD').trim().toLowerCase().split(/\s+/u).join(' ')
}

/** Recover the entropy a mnemonic encodes. Throws if the checksum fails. */
export function wordsToEntropy(mnemonic: string): Secret {
  const normalized = normalizeMnemonic(mnemonic)
  if (!validateMnemonic(normalized, english)) {
    throw new MnemonicError(
      'Mnemonic is not valid: a word is not in the BIP-39 English list, or the checksum does not match. ' +
        'A single mistyped word usually fails here. A mistyped word that still checksums produces a ' +
        'different wallet, so check the fingerprint.'
    )
  }
  return Secret.fromBytes(mnemonicToEntropy(normalized, english), 'mnemonic-entropy')
}

/**
 * Derive the 64-byte BIP-39 seed.
 *
 * The passphrase is not recoverable and is not stored. Forgetting it loses the
 * funds; there is no reset, because it is part of the key rather than a
 * credential guarding it.
 */
export function mnemonicToSeed(mnemonic: string, passphrase = ''): Secret {
  const normalized = normalizeMnemonic(mnemonic)
  if (!validateMnemonic(normalized, english)) {
    throw new MnemonicError('Refusing to derive a seed from an invalid mnemonic.')
  }
  return Secret.fromBytes(
    mnemonicToSeedSync(normalized, passphrase.normalize('NFKD')),
    'bip39-seed'
  )
}

/** Word count for a mnemonic, without validating it. */
export function wordCount(mnemonic: string): number {
  const normalized = normalizeMnemonic(mnemonic)
  return normalized.length === 0 ? 0 : normalized.split(' ').length
}
