/**
 * Tests for daemon.multisig.
 *
 * Registration is the boundary at which a descriptor stops being a suggestion
 * and becomes the wallet. So these are written as the things a coordinator can
 * hand over: a quorum the user is not in, a quorum with a threshold of one, a
 * descriptor whose checksum does not match, one carrying a fingerprint that
 * lies about whose key it is.
 */

import { describe, expect, it } from 'vitest'
import {
  MAINNET,
  SIGNET,
  deriveAccountXpub,
  mnemonicToSeed,
  withChecksum,
} from '@nullroute/core'
import { MultisigError, multisigAccountPath, reviewRegistration } from '../src/multisig.js'

const OURS =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const COSIGNER_B =
  'legal winner thank year wave sausage worth useful legal winner thank yellow'
const COSIGNER_C =
  'letter advice cage absurd amount doctor acoustic avoid letter advice cage above'

/** The multisig account xpub for a given mnemonic on a given network. */
function accountXpub(mnemonic: string, network = MAINNET): string {
  using seed = mnemonicToSeed(mnemonic, '')
  return deriveAccountXpub(seed, network, multisigAccountPath(network)).xpub
}

function descriptor(
  xpubs: readonly string[],
  { threshold = 2, kind = 'wsh', sorted = true } = {}
): string {
  const keys = xpubs.map((x) => `${x}/<0;1>/*`).join(',')
  const fn = sorted ? 'sortedmulti' : 'multi'
  const inner = `${fn}(${String(threshold)},${keys})`
  const body = kind === 'sh' ? `sh(${inner})` : `wsh(${inner})`
  return withChecksum(body)
}

function review(body: string, mnemonic = OURS, network = MAINNET) {
  using seed = mnemonicToSeed(mnemonic, '')
  return reviewRegistration(body, seed, network)
}

describe('daemon.multisig', () => {
  it('registers-a-quorum-this-device-is-part-of', () => {
    const xpubs = [accountXpub(OURS), accountXpub(COSIGNER_B), accountXpub(COSIGNER_C)]
    const registration = review(descriptor(xpubs))

    expect(registration.threshold).toBe(2)
    expect(registration.total).toBe(3)
    expect(registration.sorted).toBe(true)
    expect(registration.ourPosition).toBe(0)
    expect(registration.cosigners.filter((c) => c.isThisDevice)).toHaveLength(1)
    expect(registration.warnings).toHaveLength(0)
  })

  it('finds-our-key-wherever-it-sits-in-the-quorum', () => {
    const others = [accountXpub(COSIGNER_B), accountXpub(COSIGNER_C)]
    for (const position of [0, 1, 2]) {
      const xpubs = [...others]
      xpubs.splice(position, 0, accountXpub(OURS))
      const registration = review(descriptor(xpubs))
      expect(registration.ourPosition, `position ${String(position)}`).toBe(position)
      expect(registration.cosigners[position]?.isThisDevice).toBe(true)
    }
  })

  /**
   * INV-MULTI-6. The attack that produces a wallet which receives forever and
   * spends never.
   *
   * A descriptor with the user's key swapped out is entirely well formed. Its
   * addresses are valid, deposits confirm, and the failure surfaces the first
   * time somebody tries to spend and finds the quorum cannot be met.
   */
  it('refuses-a-quorum-this-device-is-not-in', () => {
    const strangers = [
      accountXpub(COSIGNER_B),
      accountXpub(COSIGNER_C),
      accountXpub('zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong'),
    ]
    expect(() => review(descriptor(strangers))).toThrow(MultisigError)
    expect(() => review(descriptor(strangers))).toThrow(/holds no key in that quorum/)
    // And it says which key to look for, so the user can tell the coordinator.
    expect(() => review(descriptor(strangers))).toThrow(/multisig key/)
  })

  /**
   * INV-MULTI-7. A fingerprint is four unauthenticated bytes chosen by whoever
   * wrote the descriptor. Believing one would let a coordinator present a
   * stranger's key as the user's own.
   */
  it('ignores-a-fingerprint-that-claims-to-be-ours', () => {
    using seed = mnemonicToSeed(OURS, '')
    const ourFingerprint = deriveAccountXpub(
      seed,
      MAINNET,
      multisigAccountPath(MAINNET)
    ).masterFingerprint

    // Three keys, none of them ours, but the first one is labelled with our
    // master fingerprint and our exact derivation path.
    const path = multisigAccountPath(MAINNET).replace(/^m\//, '').replace(/'/g, 'h')
    const keys = [
      `[${ourFingerprint}/${path}]${accountXpub(COSIGNER_B)}/<0;1>/*`,
      `${accountXpub(COSIGNER_C)}/<0;1>/*`,
      `${accountXpub('zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong')}/<0;1>/*`,
    ]
    const body = withChecksum(`wsh(sortedmulti(2,${keys.join(',')}))`)

    expect(() => review(body)).toThrow(/holds no key in that quorum/)
  })

  // A descriptor arrives from outside, so a transcription error must not
  // silently become a different wallet.
  it('requires-a-valid-checksum', () => {
    const xpubs = [accountXpub(OURS), accountXpub(COSIGNER_B), accountXpub(COSIGNER_C)]
    const good = descriptor(xpubs)
    expect(() => review(good.replace(/#.*$/, ''))).toThrow(MultisigError)
    expect(() => review(good.replace(/#.*$/, '#00000000'))).toThrow(MultisigError)
  })

  // INV-MULTI-8. Quorum shapes that are legal and probably not what the user
  // thinks they agreed to.
  it('warns-about-a-threshold-of-one', () => {
    const xpubs = [accountXpub(OURS), accountXpub(COSIGNER_B), accountXpub(COSIGNER_C)]
    const registration = review(descriptor(xpubs, { threshold: 1 }))
    const warning = registration.warnings.find((w) => w.kind === 'threshold')
    expect(warning?.message).toContain('1-of-3')
    expect(warning?.message).toContain('without you')
  })

  it('warns-when-every-cosigner-is-required', () => {
    const xpubs = [accountXpub(OURS), accountXpub(COSIGNER_B), accountXpub(COSIGNER_C)]
    const registration = review(descriptor(xpubs, { threshold: 3 }))
    expect(
      registration.warnings.some((w) => w.message.includes('unspendable'))
    ).toBe(true)
  })

  it('warns-when-key-order-is-significant', () => {
    const xpubs = [accountXpub(OURS), accountXpub(COSIGNER_B), accountXpub(COSIGNER_C)]
    const registration = review(descriptor(xpubs, { sorted: false }))
    expect(registration.sorted).toBe(false)
    const warning = registration.warnings.find((w) => w.kind === 'ordering')
    expect(warning?.message).toContain('exactly this order')
  })

  it('warns-about-legacy-p2sh', () => {
    const xpubs = [accountXpub(OURS), accountXpub(COSIGNER_B), accountXpub(COSIGNER_C)]
    const registration = review(descriptor(xpubs, { kind: 'sh' }))
    expect(registration.kind).toBe('sh')
    expect(registration.warnings.some((w) => w.kind === 'script')).toBe(true)
  })

  /**
   * The multisig account is a different branch from the single-signature one.
   * Reusing the same key across both would link the two wallets on chain, and
   * BIP-48 exists to keep them apart.
   */
  it('uses-a-bip48-account-distinct-from-single-signature', () => {
    expect(multisigAccountPath(MAINNET)).toBe("m/48'/0'/0'/2'")
    expect(multisigAccountPath(SIGNET)).toBe("m/48'/1'/0'/2'")
    expect(accountXpub(OURS, MAINNET)).not.toBe(accountXpub(OURS, SIGNET))
  })

  // A quorum registered on one network is not the same wallet on another, and
  // our key is derived under a different coin type there.
  it('refuses-a-mainnet-quorum-on-signet', () => {
    const xpubs = [accountXpub(OURS), accountXpub(COSIGNER_B), accountXpub(COSIGNER_C)]
    expect(() => review(descriptor(xpubs), OURS, SIGNET)).toThrow(/holds no key in that quorum/)
  })

  it('reports-each-cosigner-so-a-user-can-compare-them-aloud', () => {
    const xpubs = [accountXpub(OURS), accountXpub(COSIGNER_B), accountXpub(COSIGNER_C)]
    const registration = review(descriptor(xpubs))

    expect(registration.cosigners).toHaveLength(3)
    for (const cosigner of registration.cosigners) {
      // Abbreviated rather than full: 111 characters of base58 on a 7 inch
      // panel gets skimmed, and a skimmed key is worse than a short one.
      expect(cosigner.xpub).toContain('...')
      expect(cosigner.xpub.length).toBeLessThan(30)
    }
    // The recorded descriptor always carries a checksum, whatever arrived.
    expect(registration.descriptor).toMatch(/#[a-z0-9]{8}$/)
  })

  it('refuses-something-that-is-not-multisig-at-all', () => {
    const single = withChecksum(`wpkh(${accountXpub(OURS)}/<0;1>/*)`)
    expect(() => review(single)).toThrow(/not a multisig one/)
  })
})
