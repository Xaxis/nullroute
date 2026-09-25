/**
 * The published BIP-341 wallet test vectors, read from the file the BIP ships.
 *
 * spec/vectors/bip341-wallet-test-vectors.json is bip-0341/wallet-test-vectors.json
 * from bitcoin/bips at d1d2042c857f337c147785c1d02cfd9f9d3c84fb, unmodified and
 * pinned by hash in taproot.spec.yaml and sign.spec.yaml. Nothing in it came
 * from this code.
 *
 * TWO LEVELS OF COVERAGE, AND THEY ARE NOT THE SAME CLAIM.
 *
 * scriptPubKey: a tree whose leaves are all `<32-byte key> OP_CHECKSIG` at leaf
 * version 0xc0 is `pk()` in a descriptor, so it goes through this device's own
 * path: parseDescriptor, then deriveTaprootAddresses. Five of the seven cases
 * are like that. The other two carry leaves this device never builds (a leaf
 * version of 0xfa, and a bare push with no key), and deriveTaprootAddresses
 * refuses those by design (INV-TR-4). For all seven, the test also runs the
 * @scure/btc-signer `p2tr` call that deriveTaprootAddresses makes, and checks
 * the merkle root and control blocks, which the device never exposes. For the
 * two unusual trees that library check is ALL the coverage there is.
 *
 * keyPathSpending: the device signs a PSBT through signTransaction, which
 * derives each key from a seed. The vectors give raw private keys, not a seed,
 * so signTransaction itself cannot be driven with them. What it calls can be:
 * the PSBT goes through parsePsbt, and each input is signed with
 * `Transaction.sign(key, allowed, AUX_RAND)`, the exact call and the exact
 * aux_rand constant in psbt/sign.ts. The published signatures were made with a
 * zero aux_rand, so they are what this device's call must produce.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as btc from '@scure/btc-signer'
import { schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { parseDescriptor } from '../src/descriptor/parse.js'
import { deriveTaprootAddresses } from '../src/descriptor/taproot.js'
import { MAINNET } from '../src/network/networks.js'
import { parsePsbt } from '../src/psbt/parse.js'
import { AUX_RAND } from '../src/psbt/sign.js'

interface Leaf {
  readonly id: number
  readonly script: string
  readonly leafVersion: number
}
type Tree = Leaf | readonly Tree[]

interface ScriptPubKeyCase {
  readonly given: { readonly internalPubkey: string; readonly scriptTree: Tree | null }
  readonly intermediary: {
    readonly merkleRoot: string | null
    readonly tweakedPubkey: string
    readonly leafHashes?: readonly string[]
  }
  readonly expected: {
    readonly scriptPubKey: string
    readonly bip350Address: string
    readonly scriptPathControlBlocks?: readonly string[]
  }
}

interface InputSpending {
  readonly given: {
    readonly txinIndex: number
    readonly internalPrivkey: string
    readonly merkleRoot: string | null
    readonly hashType: number
  }
  readonly intermediary: { readonly internalPubkey: string; readonly sigHash: string }
  readonly expected: { readonly witness: readonly string[] }
}

interface Vectors {
  readonly version: number
  readonly scriptPubKey: readonly ScriptPubKeyCase[]
  readonly keyPathSpending: readonly {
    readonly given: {
      readonly rawUnsignedTx: string
      readonly utxosSpent: readonly { readonly scriptPubKey: string; readonly amountSats: number }[]
    }
    readonly inputSpending: readonly InputSpending[]
  }[]
}

const VECTORS = JSON.parse(
  readFileSync(
    new URL('../../../spec/vectors/bip341-wallet-test-vectors.json', import.meta.url),
    'utf8'
  )
) as Vectors

interface LibraryLeaf {
  readonly script: Uint8Array
  readonly leafVersion: number
}
type LibraryTree = LibraryLeaf | LibraryTree[]

/**
 * The library's tree type, inferred as descriptor/taproot.ts infers it,
 * because the signer does not export the name from its index.
 */
type TapScriptTree = ReturnType<typeof btc.taprootListToTree>

function isLeaf(tree: Tree): tree is Leaf {
  return !Array.isArray(tree)
}

/** The vector's tree in the shape `p2tr` takes, preserving left and right. */
function libraryTree(tree: Tree): LibraryTree {
  if (isLeaf(tree)) return { script: hexToBytes(tree.script), leafVersion: tree.leafVersion }
  return tree.map(libraryTree)
}

/**
 * The same tree as a descriptor, or undefined when a leaf is not `pk()`.
 *
 * A pk() tapleaf is exactly 0x20, the 32-byte key, OP_CHECKSIG (0xac), at leaf
 * version 0xc0. Anything else has no descriptor form this device accepts.
 */
function descriptorTree(tree: Tree): string | undefined {
  if (isLeaf(tree)) {
    const s = tree.script
    const isPk =
      tree.leafVersion === 0xc0 && s.length === 68 && s.startsWith('20') && s.endsWith('ac')
    return isPk ? `pk(${s.slice(2, 66)})` : undefined
  }
  const parts = tree.map(descriptorTree)
  if (parts.some((part) => part === undefined)) return undefined
  return `{${parts.join(',')}}`
}

function descriptorFor(c: ScriptPubKeyCase): string | undefined {
  const { internalPubkey, scriptTree } = c.given
  if (scriptTree === null) return `tr(${internalPubkey})`
  const tree = descriptorTree(scriptTree)
  return tree === undefined ? undefined : `tr(${internalPubkey},${tree})`
}

describe('core.descriptor.taproot published BIP-341 vectors', () => {
  it('reads-every-published-bip341-vector', () => {
    expect(VECTORS.version).toBe(1)
    expect(VECTORS.scriptPubKey).toHaveLength(7)
    expect(VECTORS.keyPathSpending).toHaveLength(1)
    expect(VECTORS.keyPathSpending[0]?.inputSpending).toHaveLength(7)
  })

  /** INV-TR-6. The device's own descriptor path, for every tree it can express. */
  it('derives-the-published-taproot-address-from-a-descriptor', () => {
    const expressible = VECTORS.scriptPubKey.filter((c) => descriptorFor(c) !== undefined)
    // Cases 0, 1, 2, 5 and 6. Cases 3 and 4 have non-pk() leaves.
    expect(expressible).toHaveLength(5)
    for (const c of expressible) {
      const text = descriptorFor(c) ?? ''
      const [first] = deriveTaprootAddresses(parseDescriptor(text, { allowBadChecksum: true }), {
        network: MAINNET,
        count: 1,
      })
      expect(first?.address, text).toBe(c.expected.bip350Address)
      expect(first?.hasScriptPath, text).toBe(c.given.scriptTree !== null)
    }
  })

  /**
   * INV-TR-6. The library call deriveTaprootAddresses makes, on all seven
   * cases, including the two trees the device cannot express. For those two
   * this is library coverage only.
   */
  it('matches-every-published-output-key-merkle-root-and-control-block', () => {
    for (const [index, c] of VECTORS.scriptPubKey.entries()) {
      const internal = hexToBytes(c.given.internalPubkey)
      const tree = c.given.scriptTree
      const where = `scriptPubKey case ${String(index)}`
      if (tree === null) {
        const payment = btc.p2tr(internal, undefined, MAINNET)
        expect(bytesToHex(payment.tweakedPubkey), where).toBe(c.intermediary.tweakedPubkey)
        expect(bytesToHex(payment.script), where).toBe(c.expected.scriptPubKey)
        expect(payment.address, where).toBe(c.expected.bip350Address)
        expect(c.intermediary.merkleRoot, where).toBeNull()
        continue
      }
      // allowUnknownOutputs lets p2tr hash leaves it has no template for, which
      // is what the two unusual trees need. It changes nothing for pk() leaves.
      const payment = btc.p2tr(internal, libraryTree(tree) as TapScriptTree, MAINNET, true)
      expect(bytesToHex(payment.tweakedPubkey), where).toBe(c.intermediary.tweakedPubkey)
      expect(bytesToHex(payment.script), where).toBe(c.expected.scriptPubKey)
      expect(payment.address, where).toBe(c.expected.bip350Address)
      expect(bytesToHex(payment.tapMerkleRoot), where).toBe(c.intermediary.merkleRoot)
      // Leaves come back in left-to-right order, the same order the vector
      // numbers them and lists their control blocks. The control block is
      // read from tapLeafScript, the field a PSBT input carries it in.
      expect(
        payment.leaves.map((leaf) => bytesToHex(leaf.hash)),
        where
      ).toEqual(c.intermediary.leafHashes)
      expect(
        (payment.tapLeafScript ?? []).map(([block]) =>
          bytesToHex(btc.TaprootControlBlock.encode(block))
        ),
        where
      ).toEqual(c.expected.scriptPathControlBlocks)
    }
  })
})

describe('core.psbt.sign published BIP-341 vectors', () => {
  const spend = VECTORS.keyPathSpending[0]
  if (spend === undefined) throw new Error('no keyPathSpending vector')
  const scripts = spend.given.utxosSpent.map((utxo) => hexToBytes(utxo.scriptPubKey))
  const amounts = spend.given.utxosSpent.map((utxo) => BigInt(utxo.amountSats))

  /**
   * The vector's unsigned transaction as a PSBT, carried through parsePsbt the
   * way every PSBT reaches the signer. BIP-341 commits to every spent output,
   * so every input gets its previous output, not only the one being signed.
   */
  function psbtFor(input: InputSpending): btc.Transaction {
    // The second output's script is 32 arbitrary bytes that do not even
    // decode as script (0xf5 is not an opcode). The library refuses to build
    // such a transaction unless told not to check output scripts.
    const tx = btc.Transaction.fromRaw(hexToBytes(spend?.given.rawUnsignedTx ?? ''), {
      allowUnknownOutputs: true,
      disableScriptCheck: true,
    })
    for (const [i, script] of scripts.entries()) {
      tx.updateInput(i, { witnessUtxo: { script, amount: amounts[i] ?? 0n } })
    }
    const { txinIndex, merkleRoot, hashType } = input.given
    tx.updateInput(txinIndex, {
      sighashType: hashType,
      tapInternalKey: hexToBytes(input.intermediary.internalPubkey),
      ...(merkleRoot === null ? {} : { tapMerkleRoot: hexToBytes(merkleRoot) }),
    })
    return parsePsbt(tx.toPSBT())
  }

  /** INV-SIG-7. The sighash the signature commits to, for every hash type used. */
  it('computes-every-published-taproot-sighash', () => {
    // 0, 1, 2, 3, 0x81, 0x82 and 0x83: DEFAULT, ALL, NONE, SINGLE and the
    // three ANYONECANPAY forms.
    expect(new Set(spend.inputSpending.map((input) => input.given.hashType)).size).toBe(7)
    for (const input of spend.inputSpending) {
      const { txinIndex, hashType } = input.given
      const tx = psbtFor(input)
      const digest = tx.preimageWitnessV1(txinIndex, scripts, hashType, amounts)
      expect(bytesToHex(digest), `input ${String(txinIndex)}`).toBe(input.intermediary.sigHash)
    }
  })

  /**
   * INV-SIG-7 and INV-SIG-1. The device's signing call, with the device's zero
   * aux_rand, produces the published witness byte for byte, including the
   * trailing hash type byte that every type but DEFAULT carries.
   */
  it('signs-every-published-key-path-input-with-zero-aux-rand', () => {
    for (const input of spend.inputSpending) {
      const { txinIndex, internalPrivkey, hashType } = input.given
      const where = `input ${String(txinIndex)}`
      const privateKey = hexToBytes(internalPrivkey)
      expect(bytesToHex(schnorr.getPublicKey(privateKey)), where).toBe(
        input.intermediary.internalPubkey
      )
      const tx = psbtFor(input)
      expect(tx.sign(privateKey, [hashType], AUX_RAND), where).toBe(1)
      const signature = tx.getInput(txinIndex).tapKeySig
      expect(bytesToHex(signature ?? new Uint8Array()), where).toBe(input.expected.witness[0])
      expect(input.expected.witness).toHaveLength(1)
    }
  })
})
