/**
 * Tests for building a multisig descriptor on the device.
 *
 * Forming a quorum used to require coordinator software: the device could
 * export its own key and import a finished descriptor, and nothing in between.
 * For a fleet of air-gapped devices that made a networked machine mandatory to
 * CREATE the wallet, which is a strange requirement for a design whose whole
 * point is that the signing devices never touch a network. Three Pis in a room
 * could not agree on a wallet without a fourth computer.
 *
 * What matters here is almost entirely the refusals. Every one of them is a way
 * to produce a descriptor that parses, derives addresses, receives money, and
 * cannot be spent from, or that needs fewer distinct devices than it appears to.
 * None of them looks wrong on a screen.
 */

import { describe, expect, it } from 'vitest'
import { AssembleError, assembleQuorum } from '../src/descriptor/assemble.js'
import { parseDescriptor } from '../src/descriptor/parse.js'
import { multisigShape } from '../src/descriptor/multisig.js'
import { verifyChecksum } from '../src/descriptor/checksum.js'

const XPUB_A =
  'xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL'
const XPUB_B =
  'xpub6DkFAXWQ2dHxq2vatrt9qyA3bXYU4ToWQwCHbf5XB2mSTexcHZCeKS1VZYcPoBd5X8yVcbXFHJR9R8UCVpt82VX1VhR28mCyxUFL4r6KFrf'
const XPUB_C =
  'xpub6FQya7zGhR92kacYsNnjreouvnHJMpXYsUXnW6NJJAJRCKsa26TzDy4LdnGhEurr3d6y1J8PJ7EEMKQp74XTqYvmGJNogYXSKDszYHtF8mX'

const key = (xpub: string, fingerprint: string): string =>
  `[${fingerprint}/48h/0h/0h/2h]${xpub}/<0;1>/*`

const A = key(XPUB_A, 'aaaaaaaa')
const B = key(XPUB_B, 'bbbbbbbb')
const C = key(XPUB_C, 'cccccccc')

describe('core.descriptor.assemble', () => {
  /**
   * INV-ASM-1. The result is a descriptor the rest of the system reads, with a
   * valid checksum, and it round-trips through the parser to the shape asked
   * for.
   *
   * The strongest available check short of a coordinator: this module writes a
   * string, and a module that had nothing to do with writing it reads back the
   * same threshold, the same total and the same keys.
   */
  it('builds-a-descriptor-the-parser-agrees-with', () => {
    const built = assembleQuorum({ threshold: 2, keys: [A, B, C] })

    expect(verifyChecksum(built.descriptor).valid).toBe(true)
    expect(built.checksum).toHaveLength(8)
    expect(built.descriptor.endsWith(`#${built.checksum}`)).toBe(true)

    const shape = multisigShape(parseDescriptor(built.descriptor))
    expect(shape.threshold).toBe(2)
    expect(shape.total).toBe(3)
    expect(shape.sorted).toBe(true)
  })

  /**
   * INV-ASM-1. sortedmulti, not multi, and not configurable.
   *
   * `multi` makes the address depend on the ORDER the keys were written, so
   * every cosigner has to enter them identically or their addresses silently
   * differ. BIP-67 exists because people kept making that mistake.
   */
  it('always-sorts-at-derivation-rather-than-trusting-key-order', () => {
    const built = assembleQuorum({ threshold: 2, keys: [A, B, C] })
    expect(built.descriptor).toContain('sortedmulti(')
    expect(built.descriptor).not.toContain('wsh(multi(')
    expect(multisigShape(parseDescriptor(built.descriptor)).sorted).toBe(true)
  })

  /**
   * INV-ASM-1. The same keys in any order produce the same STRING, so the same
   * checksum.
   *
   * This is separate from sortedmulti and was found by writing the test above.
   * Sorting at derivation makes the addresses agree; it does nothing about the
   * descriptor text, which still differs, and therefore nothing about the
   * checksum. docs/FLEET.md tells people to compare those eight characters
   * across devices and treat a difference as proof that one has a different
   * wallet. Without this, that advice fires on three devices that agree
   * perfectly, purely because somebody scanned the keys in a different
   * sequence, and a check that cries wolf is a check people wave through.
   */
  it('produces-the-same-checksum-whatever-order-the-keys-arrive-in', () => {
    const orders = [
      [A, B, C],
      [C, A, B],
      [B, C, A],
      [C, B, A],
    ]
    const built = orders.map((keys) => assembleQuorum({ threshold: 2, keys }))

    for (const one of built) {
      expect(one.descriptor).toBe(built[0]?.descriptor)
      expect(one.checksum).toBe(built[0]?.checksum)
    }
    // And the returned keys are the canonical order, not what was typed, so a
    // screen shows what actually went in.
    expect(built[1]?.keys).toEqual(built[0]?.keys)
  })

  it('builds-nested-segwit-when-asked', () => {
    const built = assembleQuorum({ threshold: 2, keys: [A, B], script: 'sh-wsh' })
    expect(built.descriptor.startsWith('sh(wsh(sortedmulti(2,')).toBe(true)
    expect(verifyChecksum(built.descriptor).valid).toBe(true)
  })

  /**
   * INV-ASM-2. A key twice is a quorum needing fewer distinct devices than it
   * appears to, and it looks completely normal on every screen.
   *
   * Compared by extended key rather than by the whole expression: the same key
   * written with two different origins is still one key.
   */
  it('refuses-the-same-key-twice', () => {
    expect(() => assembleQuorum({ threshold: 2, keys: [A, B, A] })).toThrow(AssembleError)
    expect(() => assembleQuorum({ threshold: 2, keys: [A, B, A] })).toThrow(/same extended key/)

    // Different origin, same key: still one key.
    const sameKeyOtherOrigin = `[dddddddd/48h/0h/1h/2h]${XPUB_A}/<0;1>/*`
    expect(() => assembleQuorum({ threshold: 2, keys: [A, sameKeyOtherOrigin] })).toThrow(
      /same extended key/
    )
  })

  /**
   * INV-ASM-2. A key with no origin cannot be traced to a seed, so a device
   * restoring the wallet later cannot tell whether it is able to sign for it.
   */
  it('refuses-a-key-with-no-origin', () => {
    expect(() => assembleQuorum({ threshold: 2, keys: [A, `${XPUB_B}/<0;1>/*`] })).toThrow(
      /no origin/
    )
  })

  /**
   * INV-ASM-3. Thresholds that produce something nobody meant to build. Both
   * are valid descriptors, which is exactly why they have to be refused here.
   */
  it('refuses-a-threshold-nothing-could-satisfy', () => {
    expect(() => assembleQuorum({ threshold: 4, keys: [A, B, C] })).toThrow(
      /more signatures than there are keys/
    )
    expect(() => assembleQuorum({ threshold: 0, keys: [A, B] })).toThrow(/at least one/)
    expect(() => assembleQuorum({ threshold: 1.5, keys: [A, B] })).toThrow(/whole number/)
  })

  it('refuses-fewer-than-two-keys-and-more-than-the-consensus-limit', () => {
    expect(() => assembleQuorum({ threshold: 1, keys: [A] })).toThrow(/at least two keys/)
    const many = Array.from({ length: 21 }, (_, i) =>
      key(XPUB_A.slice(0, -2) + String(i).padStart(2, '0'), 'aaaaaaaa')
    )
    expect(() => assembleQuorum({ threshold: 2, keys: many })).toThrow(/consensus limit/)
  })

  /**
   * INV-ASM-3. Mismatched derivation suffixes produce a wallet that receives on
   * one branch and never recognises its own change, which is a slow way to
   * lose track of money rather than a parse error.
   */
  it('refuses-keys-whose-branches-do-not-match', () => {
    const noMultipath = `[bbbbbbbb/48h/0h/0h/2h]${XPUB_B}/0/*`
    expect(() => assembleQuorum({ threshold: 2, keys: [A, noMultipath] })).toThrow(
      /matching derivation suffixes/
    )

    const notRanged = `[bbbbbbbb/48h/0h/0h/2h]${XPUB_B}`
    expect(() => assembleQuorum({ threshold: 2, keys: [A, notRanged] })).toThrow(
      /matching derivation suffixes/
    )
  })

  it('names-which-key-it-could-not-read', () => {
    expect(() => assembleQuorum({ threshold: 2, keys: [A, 'not a key'] })).toThrow(/Key 2/)
  })

  /**
   * A 1-of-n and an n-of-n are both buildable and both worth a second thought,
   * but they are legitimate: refusing them here would be this module deciding
   * policy. The daemon's review path already warns about both, which is the
   * right place, because that is where somebody is about to commit to one.
   */
  it('builds-the-degenerate-thresholds-and-leaves-the-warning-to-review', () => {
    expect(assembleQuorum({ threshold: 1, keys: [A, B] }).threshold).toBe(1)
    expect(assembleQuorum({ threshold: 2, keys: [A, B] }).threshold).toBe(2)
  })

  /*
   * The same quorum, spelled three legal ways, is one checksum.
   *
   * BIP-380 lets a hardened step be written ' or h or H, and a fingerprint is
   * hex, so it is case-insensitive. The parser has always known that and
   * normalises all of them to the same object. The assembler did not use it:
   * it sorted the keys canonically and then wrote each one out as the user had
   * typed it, so three co-signers who spell their paths differently got
   * jjr083g6, ywnhl0n9 and 9dpw2jny for one wallet.
   *
   * That is not a cosmetic difference. docs/FLEET.md tells the user to treat a
   * checksum difference as proof of a different wallet and to stop, which is
   * the right instruction and the reason this had to be wrong in the direction
   * of a false alarm rather than a false match.
   */
  it('writes-one-checksum-however-the-keys-were-spelled', () => {
    const apostrophes = [A, B, C].map((k) => k.replaceAll('h/', "'/").replace('h]', "']"))
    const shouted = [A, B, C].map((k) =>
      k.replace(/^\[([0-9a-f]{8})/, (_m, f: string) => `[${f.toUpperCase()}`)
    )

    const one = assembleQuorum({ threshold: 2, keys: [A, B, C] })
    const two = assembleQuorum({ threshold: 2, keys: apostrophes })
    const three = assembleQuorum({ threshold: 2, keys: shouted })

    expect(two.checksum).toBe(one.checksum)
    expect(three.checksum).toBe(one.checksum)
    expect(two.descriptor).toBe(one.descriptor)
    expect(three.descriptor).toBe(one.descriptor)

    // And the one spelling it settles on is the one BIP-380 examples use, so
    // what this device shows matches what a coordinator shows.
    expect(one.descriptor).toContain("/48'/0'/0'/2'")
    expect(one.descriptor).not.toContain('48h')
    expect(verifyChecksum(one.descriptor).valid).toBe(true)
  })

  // Reordering already produced one descriptor. Kept beside the spelling case
  // so the two halves of the same promise fail separately.
  it('writes-one-checksum-however-the-keys-were-ordered', () => {
    const forward = assembleQuorum({ threshold: 2, keys: [A, B, C] })
    const backward = assembleQuorum({ threshold: 2, keys: [C, B, A] })
    expect(backward.descriptor).toBe(forward.descriptor)
  })
})
