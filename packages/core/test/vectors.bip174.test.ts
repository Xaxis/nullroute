/**
 * The published BIP-174 test vectors.
 *
 * BIP-174 prints its vectors in the BIP text rather than shipping a file, so
 * spec/vectors/bip174-psbt.json is an extraction, pinned by hash in
 * parse.spec.yaml and sign.spec.yaml. Its source is the "Test Vectors" section
 * of bip-0174.mediawiki at bitcoin/bips d1d2042c857f337c147785c1d02cfd9f9d3c84fb,
 * and it was produced by:
 *
 *   node tools/extract-bip174-vectors.mjs bip-0174.mediawiki <commit>
 *
 * which copies each hex and base64 string verbatim out of its <pre> block, in
 * the order the BIP prints them, into the list the BIP puts it under. Running
 * it on that commit reproduces the file byte for byte. The first test here
 * checks that every hex and base64 pair encode the same bytes, which is the
 * check a transcription error would fail.
 *
 * Every PSBT goes through parsePsbt twice, once as base64 text and once as raw
 * bytes, because the device accepts both (a QR code carries text, a card
 * carries a file) and a vector that one path accepted and the other refused
 * would be a bug in exactly the place an attacker controls the input.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as btc from '@scure/btc-signer'
import { base64 } from '@scure/base'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { parsePsbt } from '../src/psbt/parse.js'
import { PsbtError } from '../src/psbt/review.js'
import { AUX_RAND } from '../src/psbt/sign.js'

interface Case {
  readonly description: string
  readonly hex: string
  readonly base64: string
}

interface RoleStep {
  readonly step: string
  readonly hex: string
  readonly base64: string
}

interface Vectors {
  readonly source: string
  readonly bipsCommit: string
  readonly invalid: readonly Case[]
  readonly valid: readonly Case[]
  readonly signerChecks: readonly Case[]
  readonly roles: readonly RoleStep[]
}

/**
 * The Transaction Extractor's output, which the extraction leaves out because
 * it is a raw transaction rather than a PSBT. Copied from bip-0174.mediawiki
 * line 833 at bitcoin/bips d1d2042c857f337c147785c1d02cfd9f9d3c84fb, the
 * commit the vector file names; the test checks it only by reproducing it.
 */
const PUBLISHED_EXTRACTED_TX =
  '0200000000010258e87a21b56daf0c23be8e7070456c336f7cbaa5c8757924f545887bb2abdd7500' +
  '000000da00473044022074018ad4180097b873323c0015720b3684cc8123891048e7dbcd9b55ad67' +
  '9c99022073d369b740e3eb53dcefa33823c8070514ca55a7dd9544f157c167913261118c01483045' +
  '022100f61038b308dc1da865a34852746f015772934208c6d24454393cd99bdf2217770220056e67' +
  '5a675a6d0a02b85b14e5e29074d8a25a9b5760bea2816f661910a006ea01475221029583bf39ae0a' +
  '609747ad199addd634fa6108559d6c5cd39b4c2183f1ab96e07f2102dab61ff49a14db6a7d02b0cd' +
  '1fbb78fc4b18312b5b4e54dae4dba2fbfef536d752aeffffffff838d0427d0ec650a68aa46bb0b09' +
  '8aea4422c071b2ca78352a077959d07cea1d01000000232200208c2353173743b595dfb4a07b72ba' +
  '8e42e3797da74e87fe7d9d7497e3b2028903ffffffff0270aaf00800000000160014d85c2b71d006' +
  '0b09c9886aeb815e50991dda124d00e1f5050000000016001400aea9a2e5f0f876a588df5546e874' +
  '2d1d87008f000400473044022062eb7a556107a7c73f45ac4ab5a1dddf6f7075fb1275969a7f383e' +
  'fff784bcb202200c05dbb7470dbf2f08557dd356c7325c1ed30913e996cd3840945db12228da5f01' +
  '473044022065f45ba5998b59a27ffe1a7bed016af1f1f90d54b3aa8f7450aa5f56a25103bd02207f' +
  '724703ad1edb96680b284b56d4ffcb88f7fb759eabbe08aa30f29b851383d20147522103089dc10c' +
  '7ac6db54f91329af617333db388cead0c231f723379d1b99030b02dc21023add904f3d6dcf59ddb9' +
  '06b0dee23529b7ffb9ed50e5e86151926860221f0e7352ae00000000'

const VECTORS = JSON.parse(
  readFileSync(new URL('../../../spec/vectors/bip174-psbt.json', import.meta.url), 'utf8')
) as Vectors

/**
 * Published vectors whose outcome here differs from what the BIP says.
 *
 * If a library or parser change makes a valid vector fail or an invalid one
 * parse, the case goes here with the reason rather than the expected result
 * being changed to match. The expected results are the BIP's, not ours. Each
 * entry is asserted to still differ, so one that stops applying fails the
 * suite instead of lingering.
 *
 * The three below are from the BIP's "Fails Signer checks" list, which it
 * calls well formed and says a signer must refuse to sign. @scure/btc-signer
 * 2.4 checks each script against the hash it claims when it decodes, so these
 * are refused whole at parse instead of parsed and refused at the defective
 * input. Nothing is signed either way (INV-SIG-8); the difference is that the
 * intact input beside the bad one is not signed either, which is the louder
 * failure CLAUDE.md asks for in a signing path.
 */
const REFUSED_AT_PARSE =
  'Refused at parse by @scure/btc-signer 2.4 (script does not match its hash); the BIP expects a parse and a refusal at signing'
const KNOWN_EXCEPTIONS: ReadonlyMap<string, string> = new Map<string, string>([
  ['redeemScript with non-witness UTXO does not match the scriptPubKey', REFUSED_AT_PARSE],
  ['redeemScript with witness UTXO does not match the scriptPubKey', REFUSED_AT_PARSE],
  ['witnessScript with witness UTXO does not match the redeemScript', REFUSED_AT_PARSE],
])

function refuses(input: string | Uint8Array): boolean {
  try {
    parsePsbt(input)
    return false
  } catch (err) {
    // Only a PsbtError counts as refusal. Anything else is a crash in the
    // parser, which is a different bug from accepting bad input.
    expect(err).toBeInstanceOf(PsbtError)
    return true
  }
}

/** The two keys the walk-through's first signer holds, and the second's. */
const TESTNET_WIF = btc.WIF(btc.TEST_NETWORK)
const FIRST_SIGNER = [
  'cP53pDbR5WtAD8dYAW9hhTjuvvTVaEiQBdrz9XPrgLBeRFiyCbQr',
  'cR6SXDoyfQrcp4piaiHE97Rsgta9mNhGTen9XeonVgwsh4iSgw6d',
].map((key) => TESTNET_WIF.decode(key))
const SECOND_SIGNER = [
  'cT7J9YpCwY3AVRFSjN6ukeEeWY6mhpbJPxRaDaP5QTdygQRxP9Au',
  'cNBc3SWUip9PPm1GjRoLEJT6T41iNzCYtD7qro84FMnM5zEqeJsE',
].map((key) => TESTNET_WIF.decode(key))

/**
 * Sign the way psbt/sign.ts does: Transaction.sign with the allowed sighash
 * list and the zero aux_rand, treating "No inputs signed" as a key that owns
 * nothing here rather than as a failure.
 */
function signLikeTheDevice(tx: btc.Transaction, key: Uint8Array): number {
  try {
    return tx.sign(key, [btc.SigHash.ALL], AUX_RAND)
  } catch (err) {
    if (/No inputs signed/i.test((err as Error).message)) return 0
    throw err
  }
}

/** An input's fields as comparable text. */
function describeInput(tx: btc.Transaction, index: number): string {
  return JSON.stringify(tx.getInput(index), (_key, value: unknown) =>
    value instanceof Uint8Array
      ? bytesToHex(value)
      : typeof value === 'bigint'
        ? value.toString()
        : value
  )
}

function signatureCounts(tx: btc.Transaction): number[] {
  const counts: number[] = []
  for (let i = 0; i < tx.inputsLength; i += 1) counts.push(tx.getInput(i).partialSig?.length ?? 0)
  return counts
}

describe('core.psbt.parse published BIP-174 vectors', () => {
  it('extraction-is-faithful', () => {
    expect(VECTORS.bipsCommit).toBe('d1d2042c857f337c147785c1d02cfd9f9d3c84fb')
    expect(VECTORS.source).toContain(VECTORS.bipsCommit)
    // The counts at the pinned commit. A re-extraction that lost or gained a
    // case changes one of these.
    expect(VECTORS.invalid).toHaveLength(20)
    expect(VECTORS.valid).toHaveLength(10)
    expect(VECTORS.signerChecks).toHaveLength(4)
    expect(VECTORS.roles).toHaveLength(13)
    const all = [...VECTORS.invalid, ...VECTORS.valid, ...VECTORS.signerChecks, ...VECTORS.roles]
    for (const c of all) expect(bytesToHex(base64.decode(c.base64))).toBe(c.hex)
  })

  /** INV-PSBT-9. Every PSBT the BIP lists as invalid is refused. */
  it('refuses-every-published-invalid-psbt', () => {
    for (const c of VECTORS.invalid) {
      if (KNOWN_EXCEPTIONS.has(c.description)) continue
      expect(refuses(c.base64), `base64: ${c.description}`).toBe(true)
      expect(refuses(hexToBytes(c.hex)), `bytes: ${c.description}`).toBe(true)
    }
  })

  /**
   * INV-PSBT-18. Every PSBT the BIP lists as valid parses, as do the four under
   * "Fails Signer checks" (well formed, but a signer must refuse them, which
   * the signing tests below cover) and every PSBT in the role walk-through.
   */
  it('parses-every-published-valid-psbt', () => {
    const valid = [
      ...VECTORS.valid.map((c) => ({ name: c.description, ...c })),
      ...VECTORS.signerChecks.map((c) => ({ name: c.description, ...c })),
      ...VECTORS.roles.map((c, i) => ({ name: `role step ${String(i)}: ${c.step}`, ...c })),
    ]
    for (const c of valid) {
      const differs = KNOWN_EXCEPTIONS.has(c.name)
      expect(refuses(c.base64), `base64: ${c.name}`).toBe(differs)
      expect(refuses(hexToBytes(c.hex)), `bytes: ${c.name}`).toBe(differs)
    }
  })
})

describe('core.psbt.sign published BIP-174 vectors', () => {
  /**
   * INV-SIG-8. The walk-through's two signers, reproduced byte for byte.
   *
   * The BIP gives WIF keys, not a seed, so signTransaction (which derives keys
   * from a seed) cannot be driven with them. This runs what it runs instead:
   * parsePsbt, then Transaction.sign with SIGHASH_ALL and AUX_RAND. The BIP's
   * signer "uses RFC6979 for nonce generation", so a match is also a check of
   * INV-SIG-1's ECDSA half against a published value.
   */
  it('reproduces-both-published-signer-steps', () => {
    const [, , updated, firstSigned, secondSigned] = VECTORS.roles
    if (updated === undefined || firstSigned === undefined || secondSigned === undefined) {
      throw new Error('role walk-through is incomplete')
    }
    expect(updated.step).toMatch(/adds SIGHASH_ALL/)
    expect(firstSigned.step).toMatch(/RFC6979/)
    for (const [keys, expected] of [
      [FIRST_SIGNER, firstSigned],
      [SECOND_SIGNER, secondSigned],
    ] as const) {
      const tx = parsePsbt(updated.base64)
      const signed = keys.reduce((n, key) => n + signLikeTheDevice(tx, key), 0)
      expect(signed).toBe(2)
      expect(base64.encode(tx.toPSBT())).toBe(expected.base64)
    }
  })

  /**
   * INV-SIG-12. The finalised transaction the device hands back is the one
   * BIP-174's Input Finalizer and Transaction Extractor publish.
   *
   * signTransaction finalises a copy once its signature completes the
   * transaction (`finaliseCopy` in sign.ts: Transaction.fromPSBT of the signed
   * PSBT, then finalize and extract). This runs that call on the walk-through's
   * combiner output. The vector file carried the finalizer's PSBT and nothing
   * checked it, "since nullroute does not play those roles", while the signer
   * was playing both whenever a quorum completed.
   */
  it('reproduces-the-published-finalizer-and-extractor-steps', () => {
    const combined = VECTORS.roles[5]
    const finalized = VECTORS.roles[6]
    if (combined === undefined || finalized === undefined) {
      throw new Error('role walk-through is incomplete')
    }
    expect(combined.step).toMatch(/a combiner must create this PSBT/)
    expect(finalized.step).toMatch(/an input finalizer must create this PSBT/)

    const copy = btc.Transaction.fromPSBT(
      btc.Transaction.fromPSBT(base64.decode(combined.base64)).toPSBT()
    )
    copy.finalize()
    expect(base64.encode(copy.toPSBT())).toBe(finalized.base64)
    expect(bytesToHex(copy.extract())).toBe(PUBLISHED_EXTRACTED_TX)
  })

  /**
   * INV-SIG-8. "Fails Signer checks": a signature never lands on the defective
   * input.
   *
   * Three of the four are the walk-through's second signer output (role step
   * 4, which already carries that signer's signatures) with one input's script
   * data corrupted, so the first signer's published keys apply. Each key signs
   * its own input if that input is intact and is refused if it is not. The
   * first case is a different transaction whose keys the BIP does not publish,
   * so nothing here can sign it and it says nothing about signing; it is
   * checked only to parse, above.
   */
  it('signs-nothing-on-an-input-the-bip-says-a-signer-must-refuse', () => {
    const [unkeyed, ...keyed] = VECTORS.signerChecks
    expect(unkeyed?.description).toMatch(/Witness UTXO is provided for a non-witness input/)
    expect(keyed).toHaveLength(3)

    const intact = VECTORS.roles[4]
    if (intact === undefined) throw new Error('role walk-through is incomplete')
    const reference = parsePsbt(intact.base64)

    for (const c of keyed) {
      if (KNOWN_EXCEPTIONS.has(c.description)) {
        // Refused whole, so nothing can be signed on any input of it.
        expect(refuses(c.base64), c.description).toBe(true)
        continue
      }
      const tx = parsePsbt(c.base64)
      // Which input was corrupted: the one that differs from the intact PSBT.
      const defective: number[] = []
      for (let i = 0; i < tx.inputsLength; i += 1) {
        if (describeInput(tx, i) !== describeInput(reference, i)) defective.push(i)
      }
      expect(defective, c.description).toHaveLength(1)
      const bad = defective[0] ?? -1

      const before = signatureCounts(tx)
      for (const key of FIRST_SIGNER) signLikeTheDevice(tx, key)
      const after = signatureCounts(tx)
      expect(after[bad], `${c.description}: input ${String(bad)}`).toBe(before[bad])
      // The intact input did gain a signature, so the unchanged count above is a
      // refusal and not a key that was simply absent.
      const gained = after.filter((n, i) => i !== bad && n > (before[i] ?? 0))
      expect(gained, c.description).toHaveLength(1)
    }
  })
})
