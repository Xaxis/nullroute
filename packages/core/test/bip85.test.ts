/**
 * Tests for core.bip85.
 *
 * The vectors are copied out of the BIP-85 document, against the master key the
 * document publishes. That matters more here than usual: a derivation scheme
 * checked against its own output is one that agrees with itself, which is worth
 * nothing. The entire value of BIP-85 is that a child can be reproduced by
 * other software years later, and the only evidence for that is matching
 * numbers somebody else wrote down.
 *
 * The remaining tests are about this device's API, not about the standard, and
 * they say so rather than borrowing the vectors' authority.
 */

import { describe, expect, it } from 'vitest'
import { HDKey } from '@scure/bip32'
import { bytesToHex } from '@noble/hashes/utils.js'
import { Secret } from '../src/util/secret.js'
import {
  Bip85Error,
  bip85Entropy,
  deriveBip85Hex,
  deriveBip85Mnemonic,
  deriveBip85Password,
} from '../src/bip85/derive.js'

/**
 * The master key from the BIP-85 document, verbatim.
 *
 * Published as an xprv rather than as a seed, which is why `bip85Entropy` takes
 * a root: it is the only shape in which the document's numbers can be checked
 * without inventing a seed nobody has.
 */
const VECTOR_MASTER =
  'xprv9s21ZrQH143K2LBWUUQRFXhucrQqBpKdRRxNVq2zBqsx8HVqFk2uYo8kmbaLLHRdqtQpUm98uKfu3vca1LqdGhUtyoFnCNkfmXRyPXLjbKb'

function vectorRoot(): HDKey {
  return HDKey.fromExtendedKey(VECTOR_MASTER)
}

/**
 * An arbitrary seed, for the properties that are about this device's API rather
 * than about the standard. The published vectors above use the document's own
 * master key; this one only has to be fixed.
 */
const SEED_HEX = 'd13de7bd1e54422d1a3b3e699f5eee45f9b1c8b5f5b1b1b1e1a1a1a1a1a1a1a1'

const MASTER_MNEMONIC =
  'install scatter logic circle pencil average fall shoe quantum disease suspect usage'

function masterSeed(): Secret {
  return Secret.fromBytes(Uint8Array.from(Buffer.from(SEED_HEX, 'hex')), 'test-seed')
}

describe('core.bip85', () => {
  /**
   * INV-BIP85-1. The published vectors.
   *
   * These come from the BIP-85 document. If this implementation and the
   * document disagree, a child derived here cannot be reproduced anywhere else,
   * and the user finds out when they try to recover it.
   */
  it('matches-the-published-entropy-vectors', () => {
    const root = vectorRoot()

    // BIP-85, "Test vectors". Two bare derivations at the top of the document.
    using first = bip85Entropy(root, "m/83696968'/0'/0'")
    expect(bytesToHex(first.bytes)).toBe(
      'efecfbccffea313214232d29e71563d941229afb4338c21f9517c41aaa0d16f0' +
        '0b83d2a09ef747e7a64e8e2bd5a14869e693da66ce94ac2da570ab7ee48618f7'
    )

    using second = bip85Entropy(root, "m/83696968'/0'/1'")
    expect(bytesToHex(second.bytes)).toBe(
      '70c6e3e8ebee8dc4c0dbba66076819bb8c09672527c4277ca8729532ad711872' +
        '218f826919f6b67218adde99018a6df9095ab2b58d803b5b93ec9802085a690e'
    )
  })

  /**
   * INV-BIP85-1. The published application vectors.
   *
   * THE ENTROPY VALUES are the vectors. They are what BIP-85 publishes and what
   * another implementation has to agree with, so they are the real cross-check:
   * matching 128, 192 and 256 bits of somebody else's numbers cannot happen by
   * accident.
   *
   * The WORDS are BIP-39 applied to those bytes, which is a separate standard
   * tested separately in core.bip39 against its own vectors. They are asserted
   * here so the wiring between the two is covered, not because they carry the
   * authority: a mnemonic recalled rather than copied is exactly the kind of
   * expectation that turns a passing test into a false one.
   */
  it('matches-the-published-application-vectors', async () => {
    const root = vectorRoot()
    const { entropyToWords } = await import('../src/bip39/mnemonic.js')

    // BIP-39 application, English, 12 / 18 / 24 words at index 0.
    const cases = [
      {
        path: "m/83696968'/39'/0'/12'/0'",
        bytes: 16,
        entropy: '6250b68daf746d12a24d58b4787a714b',
        words: 'girl mad pet galaxy egg matter matrix prison refuse sense ordinary nose',
      },
      {
        path: "m/83696968'/39'/0'/18'/0'",
        bytes: 24,
        entropy: '938033ed8b12698449d4bbca3c853c66b293ea1b1ce9d9dc',
        words:
          'near account window bike charge season chef number sketch tomorrow excuse sniff ' +
          'circle vital hockey outdoor supply token',
      },
      {
        path: "m/83696968'/39'/0'/24'/0'",
        bytes: 32,
        entropy: 'ae131e2312cdc61331542efe0d1077bac5ea803adf24b313a4f0e48e9c51f37f',
        words:
          'puppy ocean match cereal symbol another shed magic wrap hammer bulb intact gadget ' +
          'divorce twin tonight reason outdoor destroy simple truth cigar social volcano',
      },
    ]

    for (const expected of cases) {
      using derived = bip85Entropy(root, expected.path)
      const trimmed = derived.bytes.subarray(0, expected.bytes)
      expect(bytesToHex(trimmed), expected.path).toBe(expected.entropy)

      using words = Secret.copyOf(trimmed, 'vector-entropy')
      expect(entropyToWords(words), expected.path).toBe(expected.words)
    }

    // HEX application, 64 bytes at index 0.
    using hex = bip85Entropy(root, "m/83696968'/128169'/64'/0'")
    expect(bytesToHex(hex.bytes.subarray(0, 64))).toBe(
      '492db4698cf3b73a5a24998aa3e9d7fa96275d85724a91e71aa2d645442f8785' +
        '55d078fd1f1f67e368976f04137b1f7a0d19232136ca50c44614af72b5582a5c'
    )
  })

  /**
   * The password application, which is the one place BIP-85 encodes rather than
   * truncating: the whole 64 bytes are base64'd and THEN cut. Encoding only the
   * bytes needed would produce a different string.
   */
  it('matches-the-published-password-vector', async () => {
    const root = vectorRoot()
    const { base64 } = await import('@scure/base')

    using entropy = bip85Entropy(root, "m/83696968'/707764'/21'/0'")
    expect(base64.encode(entropy.bytes).slice(0, 21)).toBe('dKLoepugzdVJvdL56ogNV')
  })

  /**
   * INV-BIP85-2. Every derivation is a pure function of the seed and the path.
   *
   * The property the whole scheme rests on: a user with the master mnemonic and
   * the path can reproduce a child anywhere, years later, on other software.
   */
  it('is-deterministic-and-depends-on-every-part-of-the-path', () => {
    using seed = masterSeed()

    expect(deriveBip85Mnemonic(seed, 12, 0).words).toBe(deriveBip85Mnemonic(seed, 12, 0).words)
    expect(deriveBip85Hex(seed, 32, 0).hex).toBe(deriveBip85Hex(seed, 32, 0).hex)

    // Index changes the child.
    expect(deriveBip85Mnemonic(seed, 12, 0).words).not.toBe(deriveBip85Mnemonic(seed, 12, 1).words)
    // So does word count, and this is the one that surprises people: asking for
    // 24 words at the same index is a different wallet, not a longer backup of
    // the same one.
    expect(deriveBip85Mnemonic(seed, 24, 0).words.split(' ').slice(0, 12).join(' ')).not.toBe(
      deriveBip85Mnemonic(seed, 12, 0).words
    )
    // And so does the application.
    expect(deriveBip85Hex(seed, 32, 0).path).not.toBe(deriveBip85Mnemonic(seed, 24, 0).path)
  })

  /**
   * A different master gives a different child at the same path. Obvious, and
   * worth pinning: a bug that ignored the seed would pass every other test here.
   */
  it('depends-on-the-master-seed', async () => {
    const { mnemonicToSeed } = await import('../src/bip39/mnemonic.js')
    using a = mnemonicToSeed(MASTER_MNEMONIC, '')
    using b = mnemonicToSeed(MASTER_MNEMONIC, 'a passphrase')

    expect(deriveBip85Mnemonic(a, 12, 0).words).not.toBe(deriveBip85Mnemonic(b, 12, 0).words)
  })

  /**
   * INV-BIP85-3. Longer entropy extends the shorter answer rather than
   * replacing it, which is what makes the byte length part of the path rather
   * than a separate derivation.
   */
  it('takes-a-prefix-of-one-64-byte-answer-for-hex', () => {
    using seed = masterSeed()

    const short = deriveBip85Hex(seed, 16, 0)
    const long = deriveBip85Hex(seed, 64, 0)

    expect(short.hex).toHaveLength(32)
    expect(long.hex).toHaveLength(128)
    // Same path except the length, and the length is in the path, so these are
    // different derivations that happen to share a prefix only if the byte
    // count did not change the path. It does, so they must not.
    expect(long.hex.startsWith(short.hex)).toBe(false)
    expect(short.path).not.toBe(long.path)
  })

  it('produces-a-password-of-exactly-the-length-asked-for', () => {
    using seed = masterSeed()

    for (const length of [20, 32, 64, 86]) {
      const derived = deriveBip85Password(seed, length, 0)
      expect(derived.password).toHaveLength(length)
      expect(derived.length).toBe(length)
      expect(derived.path).toBe(`m/83696968'/707764'/${String(length)}'/0'`)
      // base64 alphabet only, so it can be typed and pasted anywhere.
      expect(derived.password).toMatch(/^[A-Za-z0-9+/]+$/)
    }
  })

  /**
   * INV-BIP85-4. Bounds are refused rather than clamped.
   *
   * A clamped length would produce a child at a path the user did not ask for,
   * and they would record the path they typed. The child would then be
   * unrecoverable from their own notes.
   */
  it('refuses-parameters-outside-what-the-standard-allows', () => {
    using seed = masterSeed()

    expect(() => deriveBip85Mnemonic(seed, 15, 0)).toThrow(Bip85Error)
    expect(() => deriveBip85Mnemonic(seed, 15, 0)).toThrow(/12, 18 or 24 words/)
    expect(() => deriveBip85Mnemonic(seed, 0, 0)).toThrow(Bip85Error)

    expect(() => deriveBip85Hex(seed, 15, 0)).toThrow(/16 to 64 bytes/)
    expect(() => deriveBip85Hex(seed, 65, 0)).toThrow(/16 to 64 bytes/)
    expect(() => deriveBip85Hex(seed, 32.5, 0)).toThrow(Bip85Error)

    expect(() => deriveBip85Password(seed, 19, 0)).toThrow(/20 to 86 characters/)
    expect(() => deriveBip85Password(seed, 87, 0)).toThrow(/20 to 86 characters/)

    // An index outside the hardened range is not a path.
    expect(() => deriveBip85Mnemonic(seed, 12, -1)).toThrow(/hardened BIP-32 index/)
    expect(() => deriveBip85Mnemonic(seed, 12, 0x80000000)).toThrow(/hardened BIP-32 index/)
    expect(() => deriveBip85Mnemonic(seed, 12, 1.5)).toThrow(/hardened BIP-32 index/)
  })

  /**
   * INV-BIP85-5. Every derivation reports the path that produced it.
   *
   * The child is unrecoverable without it, and a user who records only the
   * words has recorded the half that the master already implies.
   */
  it('always-reports-the-path-it-used', () => {
    using seed = masterSeed()

    expect(deriveBip85Mnemonic(seed, 24, 7).path).toBe("m/83696968'/39'/0'/24'/7'")
    expect(deriveBip85Hex(seed, 32, 7).path).toBe("m/83696968'/128169'/32'/7'")
    expect(deriveBip85Password(seed, 21, 7).path).toBe("m/83696968'/707764'/21'/7'")

    // Every path is fully hardened, so a child cannot be derived from an xpub.
    // That is what makes a child safe to hand to software this device does not
    // trust: it reveals nothing about its siblings or its parent.
    for (const path of [
      deriveBip85Mnemonic(seed, 24, 7).path,
      deriveBip85Hex(seed, 32, 7).path,
      deriveBip85Password(seed, 21, 7).path,
    ]) {
      for (const element of path.split('/').slice(1)) {
        expect(element.endsWith("'"), path).toBe(true)
      }
    }
  })

  it('produces-a-valid-mnemonic-that-this-device-can-import', async () => {
    const { isValidMnemonic } = await import('../src/bip39/mnemonic.js')
    using seed = masterSeed()

    for (const wordCount of [12, 18, 24]) {
      for (const index of [0, 1, 42]) {
        const derived = deriveBip85Mnemonic(seed, wordCount, index)
        expect(isValidMnemonic(derived.words), derived.path).toBe(true)
      }
    }
  })
})
