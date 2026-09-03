/**
 * Reading what other wallets export, and writing something they can read.
 *
 * Spec: core.descriptor.coordinator
 *
 * Every coordinator has its own idea of what a multisig setup file looks like.
 * Coldcard writes a text block of key-value lines, Sparrow and Specter write
 * JSON around a descriptor, Bitcoin Core writes an `importdescriptors` array,
 * and BIP-129 defines an actual standard that some of them implement. A device
 * that only accepted a bare descriptor string would work with none of them
 * without the user hand-editing a file, which is exactly the moment
 * transcription errors get introduced into a wallet.
 *
 * WHAT THIS MODULE IS NOT. It does not decide whether a descriptor should be
 * trusted, and importing is not registering. Everything here does is turn some
 * vendor's file into a canonical descriptor string; the membership check that
 * proves this device holds a key in the quorum happens afterwards, in the
 * daemon, on the result. Keeping those apart matters: a permissive reader is
 * fine precisely because nothing downstream believes what it produces.
 *
 * The input is a file from another program, arriving across the air gap. It is
 * parsed defensively and every extracted descriptor is re-parsed by our own
 * strict parser before it is returned, so a format-specific reader cannot smuggle
 * through something the descriptor parser would reject.
 */

import { parseDescriptor, type Descriptor } from './parse.js'
import { withChecksum } from './checksum.js'

export class CoordinatorFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CoordinatorFormatError'
  }
}

export type CoordinatorFormat =
  'descriptor' | 'coldcard' | 'bsms' | 'json' | 'core-importdescriptors'

export interface ImportedDescriptor {
  /** Canonical descriptor with a valid checksum, whatever arrived. */
  readonly descriptor: string
  /** Parsed, so a caller does not immediately re-parse it. */
  readonly parsed: Descriptor
  /** Which branch this descriptor covers, when the file said. */
  readonly change?: boolean
}

export interface CoordinatorImport {
  readonly format: CoordinatorFormat
  /** The wallet name the file carried, when it had one. */
  readonly name?: string
  readonly descriptors: readonly ImportedDescriptor[]
  /**
   * Anything the file asserted that this device does not verify.
   *
   * A coordinator file states its own policy and derivation in prose. Those
   * lines are a hint about what the writer intended, never evidence: the
   * descriptor is the only part that determines addresses. They are surfaced so
   * a user can notice a disagreement, and are never used to decide anything.
   */
  readonly unverifiedClaims: readonly string[]
}

const MAX_INPUT_BYTES = 100_000

/**
 * Read whatever a coordinator exported.
 *
 * Format is detected from the content rather than from a file extension, since
 * the file arrives by camera or on a card and may have no name at all.
 */
export function importCoordinatorFile(input: string): CoordinatorImport {
  if (input.length > MAX_INPUT_BYTES) {
    throw new CoordinatorFormatError(
      `That file is ${String(input.length)} characters, which is far larger than any wallet ` +
        `export. Refusing it.`
    )
  }
  const text = input.trim()
  if (text.length === 0) throw new CoordinatorFormatError('That file is empty.')

  if (text.startsWith('{') || text.startsWith('[')) return importJson(text)
  if (/^BSMS\s/i.test(text)) return importBsms(text)
  if (/^\s*(#|Name:|Policy:|Derivation:|Format:)/im.test(text) && text.includes(':')) {
    return importColdcard(text)
  }
  return importBareDescriptor(text)
}

/** A descriptor on its own, which is what a well-behaved export already is. */
function importBareDescriptor(text: string): CoordinatorImport {
  return {
    format: 'descriptor',
    descriptors: [canonicalise(text)],
    unverifiedClaims: [],
  }
}

/**
 * Coldcard's multisig setup file, and the several wallets that copy it.
 *
 * A header of `Key: value` lines, then one `FINGERPRINT: xpub` line per
 * cosigner. There is no descriptor in the file at all, so one is assembled from
 * Policy, Derivation and Format. That assembly is the risky part of this module
 * and it is why `Format` is required rather than defaulted: guessing P2WSH for a
 * file that meant P2SH would produce a wallet with entirely different addresses
 * and nothing on screen would say so.
 */
function importColdcard(text: string): CoordinatorImport {
  const header = new Map<string, string>()
  const cosigners: { fingerprint: string; xpub: string }[] = []

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) continue

    const separator = line.indexOf(':')
    if (separator === -1) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()

    if (/^[0-9a-fA-F]{8}$/.test(key)) {
      cosigners.push({ fingerprint: key.toLowerCase(), xpub: value })
    } else {
      header.set(key.toLowerCase(), value)
    }
  }

  if (cosigners.length === 0) {
    throw new CoordinatorFormatError(
      'That looks like a Coldcard setup file but it names no cosigners. A cosigner line is ' +
        'an eight character fingerprint, a colon, and an extended public key.'
    )
  }

  const policy = header.get('policy')
  const derivation = header.get('derivation')
  const format = header.get('format')

  if (policy === undefined || derivation === undefined || format === undefined) {
    const missing = [
      policy === undefined ? 'Policy' : '',
      derivation === undefined ? 'Derivation' : '',
      format === undefined ? 'Format' : '',
    ].filter((entry) => entry.length > 0)
    throw new CoordinatorFormatError(
      `That Coldcard setup file is missing ${missing.join(', ')}. The descriptor is assembled ` +
        `from those lines, and guessing any of them would produce a different wallet.`
    )
  }

  // "2 of 3", and nothing else. A file that says something else is not one this
  // device knows how to assemble.
  const quorum = /^\s*(\d+)\s+of\s+(\d+)\s*$/i.exec(policy)
  if (quorum === null) {
    throw new CoordinatorFormatError(`Cannot read the policy ${JSON.stringify(policy)}.`)
  }
  const threshold = Number(quorum[1])
  const total = Number(quorum[2])
  if (total !== cosigners.length) {
    throw new CoordinatorFormatError(
      `The policy says ${String(total)} cosigners and the file lists ` +
        `${String(cosigners.length)}. Refusing to guess which is right.`
    )
  }
  if (threshold < 1 || threshold > total) {
    throw new CoordinatorFormatError(`A ${policy} quorum is not satisfiable.`)
  }

  const origin = derivation.replace(/^m/i, '').replace(/h/g, "'")
  const keys = cosigners.map((c) => `[${c.fingerprint}${origin}]${c.xpub}`)

  const wrap = wrapperFor(format)
  const descriptors = [false, true].map((change) => {
    const branch = change ? '1' : '0'
    const inner = `sortedmulti(${String(threshold)},${keys.map((k) => `${k}/${branch}/*`).join(',')})`
    return { ...canonicalise(wrap(inner)), change }
  })

  const name = header.get('name')
  return {
    format: 'coldcard',
    ...(name === undefined ? {} : { name }),
    descriptors,
    unverifiedClaims: [
      `Policy line says ${policy}.`,
      `Derivation line says ${derivation}.`,
      `Format line says ${format}.`,
    ],
  }
}

/**
 * The script wrapper a Coldcard `Format:` line names.
 *
 * Unknown formats are refused. P2TR is absent because a Coldcard-style file has
 * no way to express a taproot script tree, so a taproot wallet cannot be
 * described by this format at all and pretending otherwise would produce a
 * descriptor nobody else derives.
 */
function wrapperFor(format: string): (inner: string) => string {
  switch (
    format
      .trim()
      .toUpperCase()
      .replace(/[-_\s]/g, '')
  ) {
    case 'P2WSH':
      return (inner) => `wsh(${inner})`
    case 'P2SHP2WSH':
    case 'P2WSHP2SH':
      return (inner) => `sh(wsh(${inner}))`
    case 'P2SH':
      return (inner) => `sh(${inner})`
    default:
      throw new CoordinatorFormatError(
        `Unknown script format ${JSON.stringify(format)}. Expected P2WSH, P2SH-P2WSH or P2SH.`
      )
  }
}

/**
 * BIP-129 Bitcoin Secure Multisig Setup, round 2.
 *
 * A version line, a descriptor template using `/**` for both branches, the
 * paths that template expands to, and a first address the coordinator computed.
 *
 * That address is NOT trusted. It is the coordinator's claim about what the
 * descriptor derives to, and checking it against our own derivation is the
 * caller's job, which is the entire point of BIP-129's final round. It is
 * surfaced as an unverified claim rather than silently ignored.
 */
function importBsms(text: string): CoordinatorImport {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const version = lines[0] ?? ''
  if (!/^BSMS\s+1\.0$/i.test(version)) {
    throw new CoordinatorFormatError(
      `This build reads BSMS 1.0 and that file says ${JSON.stringify(version)}.`
    )
  }

  const template = lines[1]
  if (template === undefined) {
    throw new CoordinatorFormatError('That BSMS file has no descriptor template.')
  }
  const paths = lines[2] ?? '/0/*,/1/*'
  const firstAddress = lines[3]

  // `/**` is BIP-129 shorthand for the receive and change branches together.
  // Expanded rather than passed through, because our parser deals in explicit
  // paths and a wildcard it does not understand would be refused outright.
  const branches = paths
    .split(',')
    .map((path) => path.trim())
    .filter((path) => path.length > 0)

  const descriptors = branches.map((path, index) => {
    const expanded = template.replace(/\/\*\*/g, path)
    return { ...canonicalise(expanded), change: index === 1 }
  })

  const claims = [`Paths line says ${paths}.`]
  if (firstAddress !== undefined && firstAddress.length > 0) {
    claims.push(
      `The coordinator says the first address is ${firstAddress}. Compare it against what ` +
        `this device derives; nothing here has checked it.`
    )
  }

  return { format: 'bsms', descriptors, unverifiedClaims: claims }
}

/**
 * JSON, which covers Sparrow, Specter and Bitcoin Core between them.
 *
 * They disagree about the shape but agree that a descriptor is in there
 * somewhere, so this walks the structure looking for descriptor-shaped strings
 * rather than encoding each vendor's schema. A vendor that changes its wrapper
 * keeps working; one that stops emitting a descriptor at all fails loudly.
 */
function importJson(text: string): CoordinatorImport {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new CoordinatorFormatError(`That file is not valid JSON. ${(err as Error).message}`)
  }

  const found: { descriptor: string; internal?: boolean }[] = []
  let name: string | undefined
  const seen = new Set<string>()

  const walk = (value: unknown, depth: number): void => {
    if (depth > 12 || found.length > 64) return
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry, depth + 1)
      return
    }
    if (typeof value !== 'object' || value === null) return
    const record = value as Record<string, unknown>

    for (const [key, entry] of Object.entries(record)) {
      if (typeof entry === 'string') {
        if (name === undefined && (key === 'name' || key === 'label' || key === 'wallet_name')) {
          name = entry
        }
        if (looksLikeDescriptor(entry) && !seen.has(entry)) {
          seen.add(entry)
          const internal = record['internal']
          found.push({
            descriptor: entry,
            ...(typeof internal === 'boolean' ? { internal } : {}),
          })
        }
      } else {
        walk(entry, depth + 1)
      }
    }
  }
  walk(parsed, 0)

  if (found.length === 0) {
    throw new CoordinatorFormatError(
      'That JSON holds no output descriptor. Sparrow, Specter and Bitcoin Core all put one in ' +
        'a "desc" or "descriptor" field; this file has none.'
    )
  }

  // Bitcoin Core's importdescriptors array is the one shape worth naming, since
  // its `internal` flag is the only reliable statement of which branch a
  // descriptor covers.
  const isCore = Array.isArray(parsed) && found.some((entry) => entry.internal !== undefined)

  return {
    format: isCore ? 'core-importdescriptors' : 'json',
    ...(name === undefined ? {} : { name }),
    descriptors: found.map((entry) => ({
      ...canonicalise(entry.descriptor),
      ...(entry.internal === undefined ? {} : { change: entry.internal }),
    })),
    unverifiedClaims: [],
  }
}

/** Cheap shape test, before the real parser is asked. */
function looksLikeDescriptor(value: string): boolean {
  return /^(wsh|sh|wpkh|pkh|pk|tr|combo|addr|raw)\(/.test(value.trim())
}

/**
 * Parse with our own strict parser and re-emit with a checksum.
 *
 * Every path into this module ends here, so a vendor-specific reader cannot
 * produce something the descriptor parser would reject. A checksum is recomputed
 * rather than trusted: some exporters omit it, and one that supplied a wrong one
 * would otherwise be recorded verbatim.
 */
function canonicalise(body: string): { descriptor: string; parsed: Descriptor } {
  const trimmed = body.trim()
  const withoutChecksum = trimmed.includes('#') ? trimmed.slice(0, trimmed.indexOf('#')) : trimmed

  let parsed: Descriptor
  try {
    parsed = parseDescriptor(withChecksum(withoutChecksum))
  } catch (err) {
    throw new CoordinatorFormatError(
      `That file holds something this device will not accept as a descriptor. ` +
        (err as Error).message
    )
  }

  // A checksum that was present and wrong is worth saying out loud: it means
  // the file was edited or corrupted after the exporter wrote it.
  if (trimmed.includes('#')) {
    const supplied = trimmed.slice(trimmed.indexOf('#'))
    const computed = withChecksum(withoutChecksum)
    if (!computed.endsWith(supplied)) {
      throw new CoordinatorFormatError(
        `The descriptor in that file carries checksum ${supplied}, and its contents check to ` +
          `${computed.slice(computed.indexOf('#'))}. The file has been altered since it was written.`
      )
    }
  }

  return { descriptor: withChecksum(withoutChecksum), parsed }
}

/**
 * Write a bundle a coordinator can read back.
 *
 * JSON rather than a vendor's own format, because every coordinator worth using
 * reads a descriptor out of JSON and none of them agree on anything else. The
 * canonical descriptor is the payload; the rest is context for a human.
 */
export interface BundleOptions {
  readonly name: string
  readonly network: string
  readonly descriptors: readonly { readonly descriptor: string; readonly change: boolean }[]
  /** This device's own key, so a coordinator can identify which cosigner we are. */
  readonly ourKey?: { readonly fingerprint: string; readonly path: string; readonly xpub: string }
}

export function exportBundle(options: BundleOptions): string {
  const document = JSON.stringify(
    {
      format: 'nullroute-descriptor-bundle',
      version: 1,
      name: options.name,
      network: options.network,
      descriptors: options.descriptors.map((entry) => ({
        desc: entry.descriptor,
        internal: entry.change,
        active: true,
        timestamp: 'now',
        range: [0, 999],
      })),
      ...(options.ourKey === undefined
        ? {}
        : {
            cosigner: {
              fingerprint: options.ourKey.fingerprint,
              path: options.ourKey.path,
              xpub: options.ourKey.xpub,
              key_expression: `[${options.ourKey.fingerprint}${options.ourKey.path.slice(1)}]${options.ourKey.xpub}`,
            },
          }),
    },
    null,
    2
  )
  // A trailing newline, because this is written to a file and a file that does
  // not end in one is a nuisance in every tool that reads it.
  return document + '\n'
}
