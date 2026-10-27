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
import { deriveQuorumAddresses } from './quorum-addresses.js'
import { networkById } from '../network/networks.js'

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
  /**
   * The wallet's first address as a BSMS file stated it, present only once it
   * has been checked against this device's own derivation and matched
   * (INV-COORD-7). A file whose statement does not match is refused, so this
   * is never a claim.
   */
  readonly firstAddress?: string
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
  // Coldcard is recognised by its own lines, a header it builds from or a
  // cosigner line, and not by a `#` comment. Sparrow heads its descriptor export
  // with `# Receive and change descriptor:`, and that file was read as a
  // Coldcard setup naming no cosigners (INV-COORD-1).
  if (
    /^\s*(Name|Policy|Derivation|Format)\s*:/im.test(text) ||
    /^\s*[0-9a-fA-F]{8}\s*:/m.test(text)
  ) {
    return importColdcard(text)
  }
  return importBareDescriptor(text)
}

/**
 * Descriptors one per line, which is what a well-behaved export already is.
 *
 * Read line by line (INV-COORD-1). Sparrow and others write a wallet's receive
 * and change descriptors on separate lines, and the whole file used to be read
 * as one descriptor: the checksum check then took everything after the first
 * `#` as the supplied checksum and refused a correct file as "altered since it
 * was written". That message accuses someone of tampering, so it is the one
 * that must never be wrong. Blank lines and `#` comment lines are skipped; a
 * descriptor's own checksum never starts a line.
 */
function importBareDescriptor(text: string): CoordinatorImport {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
  if (lines.length === 0) {
    throw new CoordinatorFormatError('That file holds comments and no descriptor.')
  }
  return {
    format: 'descriptor',
    descriptors: lines.map((line) => canonicalise(line)),
    unverifiedClaims: [],
  }
}

/**
 * Coldcard's multisig setup file, and the several wallets that copy it.
 *
 * A header of `Key: value` lines, then one `FINGERPRINT: xpub` line per
 * cosigner, under a Derivation line in the header or one above each cosigner
 * where their paths differ. There is no descriptor in the file at all, so one
 * is assembled from Policy, Derivation and Format. That assembly is the risky
 * part of this module and it is why `Format` is required rather than defaulted:
 * guessing P2WSH for a file that meant P2SH would produce a wallet with
 * entirely different addresses and nothing on screen would say so.
 */
function importColdcard(text: string): CoordinatorImport {
  const header = new Map<string, string>()
  const cosigners: { fingerprint: string; xpub: string; derivation: string | undefined }[] = []

  // INV-COORD-5. A Derivation line applies to the cosigner lines after it, which
  // is how Coldcard and Electrum write a quorum whose cosigners sit on different
  // paths. Read as a single header, the LAST Derivation line was applied to every
  // key, so a key origin the file stated plainly was replaced by another
  // cosigner's, silently, and the device looking for its own key under that
  // origin would not find it.
  let derivation: string | undefined
  const derivations: string[] = []

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) continue

    const separator = line.indexOf(':')
    if (separator === -1) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()

    if (/^[0-9a-fA-F]{8}$/.test(key)) {
      cosigners.push({ fingerprint: key.toLowerCase(), xpub: value, derivation })
    } else {
      header.set(key.toLowerCase(), value)
      if (key.toLowerCase() === 'derivation') {
        derivation = value
        if (!derivations.includes(value)) derivations.push(value)
      }
    }
  }

  if (cosigners.length === 0) {
    throw new CoordinatorFormatError(
      'That looks like a Coldcard setup file but it names no cosigners. A cosigner line is ' +
        'an eight character fingerprint, a colon, and an extended public key.'
    )
  }

  const policy = header.get('policy')
  const format = header.get('format')
  const underived = cosigners.some((cosigner) => cosigner.derivation === undefined)

  if (policy === undefined || underived || format === undefined) {
    const missing = [
      policy === undefined ? 'Policy' : '',
      underived ? 'Derivation' : '',
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

  const keys = cosigners.map((c) => {
    // Refused above; checked again here because this is where it is used.
    if (c.derivation === undefined) {
      throw new CoordinatorFormatError(`Cosigner ${c.fingerprint} has no Derivation line above it.`)
    }
    return `[${c.fingerprint}${c.derivation.replace(/^m/i, '').replace(/h/g, "'")}]${c.xpub}`
  })

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
      ...derivations.map((path) => `Derivation line says ${path}.`),
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
 * THAT ADDRESS IS CHECKED HERE, AND IT CAN ONLY REFUSE (INV-COORD-7). BIP-129
 * has the signer verify it because "an attacker who tampers with the multisig
 * configuration must also change the wallet's first address". This device used
 * to show it as an unverified claim and leave the comparison to the user, while
 * Sparrow refused the same files outright. A check whose only outcome is a
 * refusal cannot make a file more trusted, so it does not break INV-COORD-4:
 * the descriptor still decides every address, and the statement can only stop
 * the import.
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

  // BIP-129: "A descriptor template must be accompanied by derivation path
  // restrictions", and each "must start with /". Checked before expanding
  // (INV-COORD-3). Expanding first spliced "No path restrictions", or the first
  // address when the restrictions line was left blank, into every key, and the
  // refusal that followed said a cosigner's key was not valid base58: it blamed
  // a good key for what the file left out.
  if (
    template.includes('/**') &&
    (branches.length === 0 || !branches.every((path) => path.startsWith('/')))
  ) {
    throw new CoordinatorFormatError(
      `That BSMS file has a descriptor template, and BIP-129 requires a template to come with ` +
        `path restrictions such as /0/*,/1/*. Where they belong it has ${JSON.stringify(paths)}.`
    )
  }

  const descriptors = branches.map((path, index) => {
    const expanded = template.replace(/\/\*\*/g, path)
    return { ...canonicalise(expanded), change: index === 1 }
  })

  const claims = [`Paths line says ${paths}.`]
  const receive = descriptors[0]
  if (firstAddress === undefined || firstAddress.length === 0 || receive === undefined) {
    // BIP-129 says the line must be there. Without it there is nothing to
    // compare, and this device's own derivation is what the user confirms with
    // the other signers either way, so the file is read rather than refused.
    return { format: 'bsms', descriptors, unverifiedClaims: claims }
  }
  checkFirstAddress(receive.parsed, firstAddress, branches[0] ?? 'the descriptor')
  return { format: 'bsms', descriptors, unverifiedClaims: claims, firstAddress }
}

/**
 * Whether a stated first address is this descriptor's first address.
 *
 * BIP-129: "If there are path restrictions, use the first address from the
 * first path restriction", so it is index 0 of the first descriptor the file
 * expands to, or the one address a fixed descriptor has.
 *
 * The file does not say which network it is for, so the address is derived
 * once per address family (mainnet, testnet, regtest) and any one matching is
 * a match: the question is whether the descriptor is the one the coordinator
 * computed from, and a script is the same script on every network. Compared
 * as written and lowercased, because bech32 may be written in capitals and
 * base58 may not be changed at all.
 */
function checkFirstAddress(descriptor: Descriptor, stated: string, restriction: string): void {
  const derived = (['mainnet', 'testnet3', 'regtest'] as const).map(
    (id) => deriveQuorumAddresses(descriptor, { network: networkById(id), count: 1 })[0]?.address
  )
  if (derived.some((address) => address === stated || address === stated.toLowerCase())) return
  // The refusal shows the address in the family the file wrote, so the two
  // can be compared by eye: a mainnet address beside a testnet one differs in
  // every character and says nothing about which key changed.
  const family = /^bcrt1/i.test(stated) ? 2 : /^(tb1|[mn2])/i.test(stated) ? 1 : 0
  throw new CoordinatorFormatError(
    `That BSMS file says the wallet's first address is ${stated}, and its descriptor derives ` +
      `${derived[family] ?? 'nothing'} from ${restriction}. BIP-129 states that address so a signer ` +
      `can tell the setup was altered after the coordinator computed it. Ask the coordinator ` +
      `for the file again before registering anything.`
  )
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
