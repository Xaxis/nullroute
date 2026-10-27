/**
 * The descriptor vectors BIPs 381 to 387 and 389 publish, and what this device
 * does with each one.
 *
 * Each spec/vectors/bip<N>-descriptors.json is an extraction made by
 * tools/extract-descriptor-vectors.mjs and pinned by hash in
 * quorum-addresses.spec.yaml, or parse.spec.yaml for BIP-389. The tests for each BIP list, case by case, which
 * of three things happens to every valid descriptor and which of two to every
 * invalid one. A list rather than a rule, so that a change moving a case from
 * one to another fails a test instead of passing quietly.
 *
 * A VALID descriptor is one of:
 *
 *   - derived: deriveQuorumAddresses, the one place this device turns a
 *     descriptor into addresses, produces exactly the published scripts.
 *   - parsed: a kind this device reads but derives nothing from, so
 *     deriveQuorumAddresses refuses it. The parse is still checked against
 *     the published scripts: the test rebuilds each script from the parse
 *     tree, with every key derived through derivePubkeyAt, the function the
 *     device's own derivation uses. What that proves is the parse and the key
 *     derivation, not an evaluator the device does not have.
 *   - refused: parseDescriptor refuses it by design, because it carries a
 *     private key (INV-DPARSE-4) or, in BIP-389, a multipath element with
 *     further steps after it (INV-DPARSE-3).
 *
 * An INVALID descriptor is refused at parse, or parsed and then refused by
 * deriveQuorumAddresses. Only a DescriptorParseError counts as a refusal at
 * either stage; anything else is a crash, which is a different bug.
 *
 * BIP-389 lists, under each valid multipath descriptor, the descriptors it
 * expands into rather than scripts, and checkMultipath compares against those.
 */

import { readFileSync } from 'node:fs'
import { expect } from 'vitest'
import * as btc from '@scure/btc-signer'
import { sha256 } from '@noble/hashes/sha2.js'
import { ripemd160 } from '@noble/hashes/legacy.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { HARDENED_OFFSET } from '../../src/derive/path.js'
import {
  DescriptorParseError,
  descriptorKeys,
  parseDescriptor,
  type Descriptor,
  type KeyExpression,
  type ScriptNode,
} from '../../src/descriptor/parse.js'
import { withChecksum } from '../../src/descriptor/checksum.js'
import { derivePubkeyAt } from '../../src/descriptor/derive-key.js'
import { deriveQuorumAddresses } from '../../src/descriptor/quorum-addresses.js'
import { MAINNET } from '../../src/network/networks.js'

export interface ValidCase {
  readonly descriptor: string
  /** One script per child index, or for combo() the several scripts of one key. */
  readonly scripts?: readonly string[]
  /** BIP-384's per-child groups, where it labels them. */
  readonly children?: readonly { readonly label: string; readonly scripts: readonly string[] }[]
  /** BIP-389: the descriptors a multipath descriptor expands into, in order. */
  readonly expansions?: readonly string[]
}

export interface InvalidCase {
  readonly description: string
  readonly descriptor: string
}

export interface DescriptorVectors {
  readonly source: string
  readonly bipsCommit: string
  readonly bip: number
  readonly valid: readonly ValidCase[]
  readonly invalid: readonly InvalidCase[]
}

export function loadDescriptorVectors(bip: number): DescriptorVectors {
  return JSON.parse(
    readFileSync(
      new URL(`../../../../spec/vectors/bip${String(bip)}-descriptors.json`, import.meta.url),
      'utf8'
    )
  ) as DescriptorVectors
}

export type ValidOutcome =
  | { readonly kind: 'derived' }
  | { readonly kind: 'parsed'; readonly why: string }
  | { readonly kind: 'refused'; readonly why: string; readonly pattern: RegExp }

export type InvalidOutcome =
  | { readonly stage: 'parse'; readonly pattern: RegExp }
  | { readonly stage: 'evaluate'; readonly pattern: RegExp }

export const DERIVED: ValidOutcome = { kind: 'derived' }

export const SINGLE_KEY: ValidOutcome = {
  kind: 'parsed',
  why:
    'single-key descriptor: this device derives single-key addresses from its own seed ' +
    '(core.address), never from a descriptor',
}
export const BARE_MULTI: ValidOutcome = {
  kind: 'parsed',
  why: 'bare multi() at the top level: this device derives multisig only under sh() or wsh()',
}
export const COMBO: ValidOutcome = {
  kind: 'parsed',
  why: 'combo(): one key standing for several script types, which this device derives none of',
}
export const RAW_SCRIPT: ValidOutcome = {
  kind: 'parsed',
  why: 'raw(): a script with no keys, so nothing this device could sign for or recognise as change',
}
export const ADDRESS: ValidOutcome = {
  kind: 'parsed',
  why: 'addr(): an address with no keys, so nothing this device could sign for or recognise as change',
}
export const WIF: ValidOutcome = {
  kind: 'refused',
  why: 'a WIF private key, which is neither an extended public key nor hex (INV-DPARSE-4)',
  pattern: /neither an extended public key nor hex/,
}
export const XPRV: ValidOutcome = {
  kind: 'refused',
  why: 'an extended private key (INV-DPARSE-4)',
  pattern: /extended PRIVATE key/,
}
export const MULTIPATH_BEFORE_LAST_STEP: ValidOutcome = {
  kind: 'refused',
  why:
    'a BIP-389 multipath element with further steps after it, which this device reads only ' +
    'as the last step before the wildcard (INV-DPARSE-3)',
  pattern: /read only as the last step/,
}

export function atParse(pattern: RegExp): InvalidOutcome {
  return { stage: 'parse', pattern }
}
export function atEvaluation(pattern: RegExp): InvalidOutcome {
  return { stage: 'evaluate', pattern }
}

/** parseDescriptor's refusal, or undefined when it parsed. The checksum is supplied. */
export function parseRefusal(descriptor: string): string | undefined {
  try {
    parseDescriptor(withChecksum(descriptor))
    return undefined
  } catch (err) {
    expect(err, descriptor).toBeInstanceOf(DescriptorParseError)
    return (err as Error).message
  }
}

/** deriveQuorumAddresses' refusal, or undefined when it derived. */
export function evaluationRefusal(descriptor: Descriptor): string | undefined {
  try {
    deriveQuorumAddresses(descriptor, { network: MAINNET, count: 1 })
    return undefined
  } catch (err) {
    expect(err, descriptor.body).toBeInstanceOf(DescriptorParseError)
    return (err as Error).message
  }
}

/** The scriptPubKeys deriveQuorumAddresses produces at indexes 0 to count - 1. */
function derivedScripts(descriptor: Descriptor, count: number): string[] {
  const decoder = btc.Address(btc.NETWORK)
  return deriveQuorumAddresses(descriptor, { network: MAINNET, start: 0, count }).map(
    ({ address }) => bytesToHex(btc.OutScript.encode(decoder.decode(address)))
  )
}

function hash160(data: Uint8Array): Uint8Array {
  return ripemd160(sha256(data))
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0)
    if (difference !== 0) return difference
  }
  return a.length - b.length
}

function only(scripts: readonly string[]): Uint8Array {
  const [script] = scripts
  if (scripts.length !== 1 || script === undefined) throw new Error('expected one inner script')
  return hexToBytes(script)
}

/**
 * The scripts a parse tree commits to at one index, rebuilt by the test.
 *
 * Templates from @scure/btc-signer's script encoder and keys from
 * derivePubkeyAt. The device has no evaluator for these kinds; this is how the
 * test checks that what it parsed is what the BIP's published script means.
 */
export function scriptsFromTree(node: ScriptNode, index: number, change = false): string[] {
  const key = (expression: KeyExpression): Uint8Array => derivePubkeyAt(expression, index, change)
  const encode = (output: Parameters<typeof btc.OutScript.encode>[0]): string =>
    bytesToHex(btc.OutScript.encode(output))

  switch (node.kind) {
    case 'pk':
      return [encode({ type: 'pk', pubkey: key(node.key) })]
    case 'pkh':
      return [encode({ type: 'pkh', hash: hash160(key(node.key)) })]
    case 'wpkh':
      return [encode({ type: 'wpkh', hash: hash160(key(node.key)) })]
    case 'combo': {
      // BIP-384: P2PK and P2PKH always, P2WPKH and P2SH-P2WPKH for a compressed key.
      const pubkey = key(node.key)
      const both = [encode({ type: 'pk', pubkey }), encode({ type: 'pkh', hash: hash160(pubkey) })]
      if (pubkey.length !== 33) return both
      const wpkh = btc.OutScript.encode({ type: 'wpkh', hash: hash160(pubkey) })
      return [...both, bytesToHex(wpkh), encode({ type: 'sh', hash: hash160(wpkh) })]
    }
    case 'sh':
      return [
        encode({ type: 'sh', hash: hash160(only(scriptsFromTree(node.inner, index, change))) }),
      ]
    case 'wsh':
      return [
        encode({ type: 'wsh', hash: sha256(only(scriptsFromTree(node.inner, index, change))) }),
      ]
    case 'multi':
    case 'sortedmulti': {
      const keys = node.keys.map(key)
      // BIP-383: sortedmulti sorts the derived keys, at this index.
      const ordered = node.kind === 'sortedmulti' ? [...keys].sort(compareBytes) : keys
      return [encode({ type: 'ms', m: node.threshold, pubkeys: ordered })]
    }
    case 'raw':
      return [node.hex]
    case 'addr':
      return [encode(btc.Address(btc.NETWORK).decode(node.address))]
    default:
      throw new Error(`The test does not rebuild ${node.kind}().`)
  }
}

/**
 * The published scripts grouped by child index.
 *
 * For combo() the BIP lists several scripts for one key; everywhere else each
 * script is the next child index.
 */
function expectedByIndex(c: ValidCase, combo: boolean): (readonly string[])[] {
  if (c.children !== undefined) return c.children.map((child) => child.scripts)
  const scripts = c.scripts ?? []
  return combo ? [scripts] : scripts.map((script) => [script])
}

export function checkValid(c: ValidCase, outcome: ValidOutcome | undefined): void {
  if (outcome === undefined) throw new Error(`No outcome listed for ${c.descriptor}`)
  const where = c.descriptor.slice(0, 60)

  if (outcome.kind === 'refused') {
    expect(parseRefusal(c.descriptor), where).toMatch(outcome.pattern)
    return
  }

  expect(parseRefusal(c.descriptor), where).toBeUndefined()
  const descriptor = parseDescriptor(withChecksum(c.descriptor))
  const expected = expectedByIndex(c, descriptor.script.kind === 'combo')
  expect(expected.length, where).toBeGreaterThan(0)

  if (outcome.kind === 'derived') {
    for (const group of expected) expect(group, where).toHaveLength(1)
    expect(derivedScripts(descriptor, expected.length), where).toEqual(
      expected.map((group) => group[0])
    )
    return
  }

  for (const [index, group] of expected.entries()) {
    expect(scriptsFromTree(descriptor.script, index), `${where} index ${String(index)}`).toEqual(
      group
    )
  }
  expect(evaluationRefusal(descriptor), `${where}: ${outcome.why}`).toBeDefined()
}

export function checkInvalid(c: InvalidCase, outcome: InvalidOutcome | undefined): void {
  if (outcome === undefined) throw new Error(`No outcome listed for ${c.descriptor}`)
  const where = `${c.description}: ${c.descriptor.slice(0, 50)}`
  const parsing = parseRefusal(c.descriptor)

  if (outcome.stage === 'parse') {
    expect(parsing, where).toMatch(outcome.pattern)
    return
  }

  // Accepted by the parser, which does not check where a script may appear or
  // which keys a context allows; the evaluator that consumes it refuses.
  expect(parsing, where).toBeUndefined()
  const refusal = evaluationRefusal(parseDescriptor(withChecksum(c.descriptor)))
  expect(refusal, where).toMatch(outcome.pattern)
}

/**
 * A parse tree at one branch of its BIP-389 multipath keys: each such key's
 * last step set to that branch's value, which is how the BIP writes the
 * expansion.
 */
function atBranch(node: ScriptNode, branch: number): ScriptNode {
  const key = (expression: KeyExpression): KeyExpression => {
    if (expression.kind !== 'extended' || expression.multipath === undefined) return expression
    const { multipath, ...single } = expression
    const value = multipath[branch]
    if (value === undefined) throw new Error(`No branch ${String(branch)} in ${expression.xpub}`)
    const step = value >= HARDENED_OFFSET ? `${String(value - HARDENED_OFFSET)}'` : String(value)
    return { ...single, path: single.path.replace(/[^/]+$/, step) }
  }
  switch (node.kind) {
    case 'pk':
    case 'pkh':
    case 'wpkh':
    case 'combo':
      return { ...node, key: key(node.key) }
    case 'sh':
    case 'wsh':
      return { ...node, inner: atBranch(node.inner, branch) }
    case 'multi':
    case 'sortedmulti':
    case 'multi_a':
    case 'sortedmulti_a':
      return { ...node, keys: node.keys.map(key) }
    default:
      throw new Error(`The test does not expand ${node.kind}().`)
  }
}

/**
 * A valid BIP-389 descriptor against the descriptors the BIP expands it into.
 *
 * A parsed one is checked two ways. Its parse tree at each branch has to equal
 * the parse of that branch's expansion, for every value its tuples name. And
 * at the first two branches, with keys from derivePubkeyAt's receive and
 * change selection, it has to produce the scripts of the first two
 * expansions: that selection is the only way this device derives from a
 * multipath key, the first value for receive and the second for change, as
 * BIP-389 (line 53) says a wallet should. A third value has no derivation
 * path here.
 */
export function checkMultipath(c: ValidCase, outcome: ValidOutcome | undefined): void {
  if (outcome === undefined) throw new Error(`No outcome listed for ${c.descriptor}`)
  const where = c.descriptor.slice(0, 60)
  const expansions = c.expansions ?? []
  expect(expansions.length, where).toBeGreaterThanOrEqual(2)

  if (outcome.kind === 'refused') {
    expect(parseRefusal(c.descriptor), where).toMatch(outcome.pattern)
    return
  }
  if (outcome.kind === 'derived') {
    throw new Error(
      `No BIP-389 vector was a kind deriveQuorumAddresses derives. Write that check: ${where}`
    )
  }

  expect(parseRefusal(c.descriptor), where).toBeUndefined()
  const descriptor = parseDescriptor(withChecksum(c.descriptor))
  for (const key of descriptorKeys(descriptor.script)) {
    if (key.kind !== 'extended' || key.multipath === undefined) continue
    expect(key.multipath, where).toHaveLength(expansions.length)
  }

  const expanded = expansions.map((expansion) => parseDescriptor(withChecksum(expansion)))
  for (const [branch, expansion] of expanded.entries()) {
    expect(atBranch(descriptor.script, branch), `${where} branch ${String(branch)}`).toStrictEqual(
      expansion.script
    )
  }

  const indexes = descriptor.ranged ? [0, 1, 2] : [0]
  for (const [branch, expansion] of expanded.slice(0, 2).entries()) {
    for (const index of indexes) {
      expect(
        scriptsFromTree(descriptor.script, index, branch === 1),
        `${where} branch ${String(branch)} index ${String(index)}`
      ).toEqual(scriptsFromTree(expansion.script, index))
    }
  }
  expect(evaluationRefusal(descriptor), `${where}: ${outcome.why}`).toBeDefined()
}

/** Every published script, for the extraction counts. */
export function scriptCount(vectors: DescriptorVectors): number {
  return vectors.valid.reduce(
    (n, c) =>
      n +
      (c.scripts?.length ?? 0) +
      (c.children ?? []).reduce((m, child) => m + child.scripts.length, 0),
    0
  )
}

/** Every published script is even-length lowercase hex, as a transcription check. */
export function expectScriptsAreHex(vectors: DescriptorVectors): void {
  for (const c of vectors.valid) {
    const scripts = [...(c.scripts ?? []), ...(c.children ?? []).flatMap((ch) => ch.scripts)]
    for (const script of scripts)
      expect(script, c.descriptor.slice(0, 40)).toMatch(/^([0-9a-f]{2})+$/)
  }
}
