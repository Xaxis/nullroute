/**
 * BIP-380 output descriptor parsing.
 *
 * Spec: core.descriptor.parse
 *
 * A descriptor says which scripts belong to a wallet. Everything downstream
 * rests on it: an output is labelled CHANGE only if its address re-derives from
 * a registered descriptor (INV-PSBT-2), and an input is signable only if its
 * script matches one (INV-PSBT-1). A parser that guesses is a parser that
 * eventually labels an attacker's address as change.
 *
 * So the rule throughout is: understand it exactly, or refuse it. There is no
 * lenient mode, no best-effort fallback, and no branch that returns a partial
 * parse. Unknown function names, trailing characters, malformed key origins and
 * out-of-range indices are all hard errors.
 *
 * This exists because @scure/btc-signer implements no part of BIP-380. That was
 * verified, not assumed.
 *
 * What is supported here is the single-signature surface of phase 2: pk, pkh,
 * wpkh, sh(wpkh), and tr key-path. The AST carries the multisig node types so
 * that phase 3 extends the evaluator rather than reshaping the parse tree, but
 * anything not yet evaluable is refused rather than silently accepted.
 */

import { hexToBytes } from '@noble/hashes/utils.js'
import { HARDENED_OFFSET, PathError, parsePath } from '../derive/path.js'
import { verifyChecksum } from './checksum.js'

export class DescriptorParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DescriptorParseError'
  }
}

/** Where a key came from, if the descriptor says. */
export interface KeyOrigin {
  /** Master key fingerprint, eight lowercase hex characters. */
  readonly fingerprint: string
  /** Canonical path from the master key to this key. */
  readonly path: string
}

/** A raw public key written directly into the descriptor. */
export interface RawKey {
  readonly kind: 'raw'
  readonly origin?: KeyOrigin
  readonly hex: string
  /** 32 for x-only, 33 for compressed, 65 for uncompressed. */
  readonly byteLength: number
}

/** An extended key, optionally with a derivation suffix. */
export interface ExtendedKey {
  readonly kind: 'extended'
  readonly origin?: KeyOrigin
  readonly xpub: string
  /**
   * Derivation applied to the extended key, canonicalised. Empty when the
   * descriptor names the key with no suffix.
   */
  readonly path: string
  /** True when the descriptor ends in `/*`, making it a range. */
  readonly ranged: boolean
  /**
   * BIP-389 multipath. When present the descriptor described `/<a;b>`, which
   * denotes two descriptors sharing everything else, conventionally receive and
   * change.
   */
  readonly multipath?: readonly number[]
}

export type KeyExpression = RawKey | ExtendedKey

export type ScriptNode =
  | { readonly kind: 'pk'; readonly key: KeyExpression }
  | { readonly kind: 'pkh'; readonly key: KeyExpression }
  | { readonly kind: 'wpkh'; readonly key: KeyExpression }
  | { readonly kind: 'combo'; readonly key: KeyExpression }
  | { readonly kind: 'sh'; readonly inner: ScriptNode }
  | { readonly kind: 'wsh'; readonly inner: ScriptNode }
  | { readonly kind: 'tr'; readonly key: KeyExpression }
  | {
      readonly kind: 'multi' | 'sortedmulti' | 'multi_a' | 'sortedmulti_a'
      readonly threshold: number
      readonly keys: readonly KeyExpression[]
    }
  | { readonly kind: 'addr'; readonly address: string }
  | { readonly kind: 'raw'; readonly hex: string }

export interface Descriptor {
  readonly script: ScriptNode
  /** The descriptor without its checksum. */
  readonly body: string
  /** The checksum as written, when one was present. */
  readonly checksum: string | undefined
  readonly checksumValid: boolean
  /** True when any key in the descriptor is ranged. */
  readonly ranged: boolean
}

const FUNCTIONS = new Set([
  'pk',
  'pkh',
  'wpkh',
  'combo',
  'sh',
  'wsh',
  'tr',
  'multi',
  'sortedmulti',
  'multi_a',
  'sortedmulti_a',
  'addr',
  'raw',
])

const HEX = /^[0-9a-fA-F]+$/
const FINGERPRINT = /^[0-9a-fA-F]{8}$/

/**
 * Split a comma-separated argument list at the TOP level only.
 *
 * Nesting matters: `sh(wsh(multi(2,A,B)))` has one top-level argument, and a
 * naive split on commas would produce three. Bracket depth is tracked for the
 * same reason, since a key origin contains slashes and could contain a comma in
 * a malformed descriptor.
 */
function splitArguments(input: string): string[] {
  const parts: string[] = []
  let depth = 0
  let bracket = 0
  let current = ''

  for (const character of input) {
    if (character === '(') depth += 1
    else if (character === ')') depth -= 1
    else if (character === '[') bracket += 1
    else if (character === ']') bracket -= 1

    if (character === ',' && depth === 0 && bracket === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += character
  }
  parts.push(current)
  return parts
}

/** Parse a `[fingerprint/path]` prefix, returning it and the remainder. */
function parseOrigin(input: string): { origin: KeyOrigin | undefined; rest: string } {
  if (!input.startsWith('[')) return { origin: undefined, rest: input }

  const close = input.indexOf(']')
  if (close === -1) {
    throw new DescriptorParseError(
      `Key origin is missing its closing bracket in ${JSON.stringify(input)}.`
    )
  }

  const inner = input.slice(1, close)
  const slash = inner.indexOf('/')
  const fingerprint = (slash === -1 ? inner : inner.slice(0, slash)).toLowerCase()

  if (!FINGERPRINT.test(fingerprint)) {
    throw new DescriptorParseError(
      `Key origin fingerprint ${JSON.stringify(fingerprint)} must be exactly 8 hex characters.`
    )
  }

  // The origin path is relative to the master key, so it is written without a
  // leading "m". parsePath wants one, and normalising here means both hardened
  // notations work exactly as they do everywhere else.
  const rawPath = slash === -1 ? '' : inner.slice(slash + 1)
  let path = 'm'
  if (rawPath.length > 0) {
    try {
      path = parsePath(`m/${rawPath}`).canonical
    } catch (err) {
      throw new DescriptorParseError(
        `Key origin path ${JSON.stringify(rawPath)} is not valid: ${(err as Error).message}`
      )
    }
  }

  return { origin: { fingerprint, path }, rest: input.slice(close + 1) }
}

/**
 * Parse the derivation suffix on an extended key.
 *
 * Handles a plain path, a trailing `/*` wildcard, and BIP-389 `/<a;b>`
 * multipath. Rejects anything else rather than ignoring it: a suffix nobody
 * understood is a descriptor describing scripts nobody enumerated.
 */
function parseDerivation(suffix: string): {
  path: string
  ranged: boolean
  multipath: number[] | undefined
} {
  if (suffix.length === 0) return { path: '', ranged: false, multipath: undefined }

  let working = suffix
  let ranged = false
  if (working.endsWith('/*')) {
    ranged = true
    working = working.slice(0, -2)
  } else if (working.endsWith("/*'") || working.endsWith('/*h')) {
    // A hardened wildcard requires the private key to derive, so a descriptor
    // carrying only an xpub cannot enumerate it. Refused rather than accepted
    // and failed later at derivation time.
    throw new DescriptorParseError(
      'A hardened wildcard (/*h) cannot be derived from an extended public key.'
    )
  }

  let multipath: number[] | undefined
  const open = working.indexOf('<')
  if (open !== -1) {
    const close = working.indexOf('>')
    if (close === -1 || close < open) {
      throw new DescriptorParseError('Multipath is missing its closing angle bracket.')
    }
    const options = working.slice(open + 1, close).split(';')
    if (options.length < 2) {
      throw new DescriptorParseError('Multipath must offer at least two alternatives.')
    }
    multipath = options.map((option) => {
      const hardened = /['hH]$/.test(option)
      const digits = hardened ? option.slice(0, -1) : option
      if (!/^[0-9]+$/.test(digits)) {
        throw new DescriptorParseError(
          `Multipath element ${JSON.stringify(option)} is not a number.`
        )
      }
      const index = Number(digits)
      if (!Number.isSafeInteger(index) || index >= HARDENED_OFFSET) {
        throw new DescriptorParseError(`Multipath element ${option} is out of range.`)
      }
      return hardened ? index + HARDENED_OFFSET : index
    })
    // Replace the multipath element with a placeholder so the rest of the path
    // parses normally. The alternatives are carried separately.
    working = working.slice(0, open) + '0' + working.slice(close + 1)
  }

  let path = ''
  if (working.length > 0) {
    try {
      path = parsePath(`m${working}`).canonical
    } catch (err) {
      if (err instanceof PathError) {
        throw new DescriptorParseError(`Derivation ${JSON.stringify(suffix)}: ${err.message}`)
      }
      throw err
    }
  }

  return { path, ranged, multipath }
}

/** Parse one key expression: an optional origin followed by a key. */
export function parseKeyExpression(input: string): KeyExpression {
  const trimmed = input.trim()
  if (trimmed.length === 0) {
    throw new DescriptorParseError('Empty key expression.')
  }

  const { origin, rest } = parseOrigin(trimmed)
  if (rest.length === 0) {
    throw new DescriptorParseError('Key origin is present but no key follows it.')
  }

  // An extended key is base58 and starts with a recognised prefix. Everything
  // else must be raw hex; there is no third case, and a WIF private key is
  // deliberately not accepted, because a descriptor holding a private key has
  // no business on this device.
  const prefix = rest.slice(0, 4)
  const isExtended = ['xpub', 'ypub', 'zpub', 'tpub', 'upub', 'vpub'].includes(prefix)

  if (isExtended) {
    const slash = rest.indexOf('/')
    const xpub = slash === -1 ? rest : rest.slice(0, slash)
    const suffix = slash === -1 ? '' : rest.slice(slash)
    const { path, ranged, multipath } = parseDerivation(suffix)

    return {
      kind: 'extended',
      ...(origin === undefined ? {} : { origin }),
      xpub,
      path,
      ranged,
      ...(multipath === undefined ? {} : { multipath }),
    }
  }

  if (rest.startsWith('xprv') || rest.startsWith('tprv')) {
    throw new DescriptorParseError(
      'This descriptor contains an extended PRIVATE key. nullroute does not accept private ' +
        'key material in a descriptor: descriptors are for describing which scripts belong to ' +
        'a wallet, and a key belongs in the encrypted store.'
    )
  }

  if (!HEX.test(rest)) {
    throw new DescriptorParseError(
      `Key ${JSON.stringify(rest.slice(0, 24))} is neither an extended public key nor hex.`
    )
  }

  const byteLength = rest.length / 2
  if (![32, 33, 65].includes(byteLength)) {
    throw new DescriptorParseError(
      `A raw key must be 32 bytes (x-only), 33 (compressed) or 65 (uncompressed), got ` +
        `${String(byteLength)}.`
    )
  }
  // Parsed to confirm it is well-formed hex of the stated length, and discarded:
  // the descriptor keeps the canonical lowercase text.
  hexToBytes(rest)

  return {
    kind: 'raw',
    ...(origin === undefined ? {} : { origin }),
    hex: rest.toLowerCase(),
    byteLength,
  }
}

function parseThreshold(raw: string, keyCount: number, fn: string): number {
  if (!/^[0-9]+$/.test(raw)) {
    throw new DescriptorParseError(`${fn} threshold ${JSON.stringify(raw)} is not a number.`)
  }
  const threshold = Number(raw)
  if (threshold < 1 || threshold > keyCount) {
    throw new DescriptorParseError(
      `${fn} threshold ${String(threshold)} is out of range for ${String(keyCount)} keys.`
    )
  }
  return threshold
}

/** Parse a script expression, recursively. */
function parseScript(input: string): ScriptNode {
  const trimmed = input.trim()
  const open = trimmed.indexOf('(')

  if (open === -1 || !trimmed.endsWith(')')) {
    throw new DescriptorParseError(
      `${JSON.stringify(trimmed.slice(0, 32))} is not a script expression. ` +
        `A descriptor is a function call such as wpkh(...).`
    )
  }

  const fn = trimmed.slice(0, open)
  const args = trimmed.slice(open + 1, -1)

  if (!FUNCTIONS.has(fn)) {
    throw new DescriptorParseError(
      `Unknown descriptor function ${JSON.stringify(fn)}. Refusing to guess what it means.`
    )
  }

  const parts = splitArguments(args)

  switch (fn) {
    case 'pk':
    case 'pkh':
    case 'wpkh':
    case 'combo':
    case 'tr': {
      if (parts.length !== 1) {
        throw new DescriptorParseError(
          `${fn}() takes exactly one key, got ${String(parts.length)} arguments. ` +
            (fn === 'tr'
              ? 'Taproot script trees are not supported yet and are refused rather than ignored.'
              : '')
        )
      }
      const only = parts[0]
      if (only === undefined) throw new DescriptorParseError(`${fn}() has no argument.`)
      return { kind: fn, key: parseKeyExpression(only) }
    }

    case 'sh':
    case 'wsh': {
      if (parts.length !== 1) {
        throw new DescriptorParseError(`${fn}() takes exactly one inner script.`)
      }
      const only = parts[0]
      if (only === undefined) throw new DescriptorParseError(`${fn}() has no argument.`)
      return { kind: fn, inner: parseScript(only) }
    }

    case 'multi':
    case 'sortedmulti':
    case 'multi_a':
    case 'sortedmulti_a': {
      if (parts.length < 2) {
        throw new DescriptorParseError(`${fn}() needs a threshold and at least one key.`)
      }
      const [thresholdRaw, ...keyParts] = parts
      if (thresholdRaw === undefined) throw new DescriptorParseError(`${fn}() has no threshold.`)
      const keys = keyParts.map((part) => parseKeyExpression(part))
      return { kind: fn, threshold: parseThreshold(thresholdRaw.trim(), keys.length, fn), keys }
    }

    case 'addr': {
      const only = parts[0]
      if (parts.length !== 1 || only === undefined || only.trim().length === 0) {
        throw new DescriptorParseError('addr() takes exactly one address.')
      }
      return { kind: 'addr', address: only.trim() }
    }

    case 'raw': {
      const only = parts[0]
      if (parts.length !== 1 || only === undefined || !HEX.test(only.trim())) {
        throw new DescriptorParseError('raw() takes exactly one hex script.')
      }
      return { kind: 'raw', hex: only.trim().toLowerCase() }
    }

    default:
      throw new DescriptorParseError(`Unhandled descriptor function ${JSON.stringify(fn)}.`)
  }
}

/** True when any key in the tree is ranged. */
function isRanged(node: ScriptNode): boolean {
  switch (node.kind) {
    case 'pk':
    case 'pkh':
    case 'wpkh':
    case 'combo':
    case 'tr':
      return node.key.kind === 'extended' && node.key.ranged
    case 'sh':
    case 'wsh':
      return isRanged(node.inner)
    case 'multi':
    case 'sortedmulti':
    case 'multi_a':
    case 'sortedmulti_a':
      return node.keys.some((key) => key.kind === 'extended' && key.ranged)
    case 'addr':
    case 'raw':
      return false
  }
}

export interface ParseOptions {
  /**
   * Accept a descriptor with no checksum or a wrong one.
   *
   * Defaults to false, and should stay false anywhere a descriptor arrives from
   * outside. The checksum is the only defence against a transcription error,
   * and a single wrong character otherwise yields a valid descriptor for a
   * DIFFERENT wallet.
   */
  readonly allowBadChecksum?: boolean
}

/**
 * Parse a descriptor, verifying its checksum.
 *
 * Throws on anything not understood exactly. There is no partial parse: a
 * descriptor decides which scripts belong to the wallet, and a parser that
 * guesses eventually labels someone else's address as change.
 */
export function parseDescriptor(input: string, options: ParseOptions = {}): Descriptor {
  const trimmed = input.trim()
  if (trimmed.length === 0) throw new DescriptorParseError('Empty descriptor.')

  const verdict = verifyChecksum(trimmed)
  if (!verdict.valid && options.allowBadChecksum !== true) {
    throw new DescriptorParseError(
      verdict.provided === undefined
        ? `Descriptor has no checksum. Expected "#${verdict.expected}". ` +
          `The checksum is the only defence against a mistyped character, and a single wrong ` +
          `character produces a valid descriptor for a different wallet.`
        : `Descriptor checksum is "${verdict.provided}" but should be "${verdict.expected}". ` +
          `Something was transcribed incorrectly. Do not use this descriptor.`
    )
  }

  const script = parseScript(verdict.body)

  return {
    script,
    body: verdict.body,
    checksum: verdict.provided,
    checksumValid: verdict.valid,
    ranged: isRanged(script),
  }
}

/** Every key expression in a descriptor, in order. */
export function descriptorKeys(node: ScriptNode): KeyExpression[] {
  switch (node.kind) {
    case 'pk':
    case 'pkh':
    case 'wpkh':
    case 'combo':
    case 'tr':
      return [node.key]
    case 'sh':
    case 'wsh':
      return descriptorKeys(node.inner)
    case 'multi':
    case 'sortedmulti':
    case 'multi_a':
    case 'sortedmulti_a':
      return [...node.keys]
    case 'addr':
    case 'raw':
      return []
  }
}
