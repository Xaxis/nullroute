/**
 * Registering a multisig quorum on this device.
 *
 * Spec: daemon.multisig
 *
 * A registration is the device agreeing to treat a descriptor as its own
 * wallet: to derive addresses from it, to call its outputs change, and to sign
 * for it. Everything that makes multisig safe here happens at this boundary,
 * because after registration the descriptor is trusted.
 *
 * THE ATTACK THIS EXISTS TO STOP. A coordinator hands over a descriptor. If the
 * device accepts it without checking, several things can be wrong with it and
 * none of them look wrong on screen:
 *
 *   - The user's key is not in it at all. The wallet accepts deposits and can
 *     never be spent from. Every address is valid, every screen is normal.
 *   - The user's key is in it, but the threshold is 1, so any single cosigner
 *     can spend without them.
 *   - It is a different quorum from the one the other cosigners registered, so
 *     change goes to an address the rest of the group cannot see.
 *
 * So registration verifies membership against the device's own key material,
 * refuses a descriptor it is not part of, and reports the quorum in terms a
 * person can compare with the other cosigners out loud. It does not decide
 * whether a 1-of-3 is a good idea; it makes sure the user is told that is what
 * they are agreeing to.
 */

import {
  type Descriptor,
  type Network,
  type Secret,
  deriveAccountXpub,
  deriveMultisigAddresses,
  deriveTaprootAddresses,
  findOwnKey,
  multisigShape,
  parseDescriptor,
  taprootQuorum,
  withChecksum,
} from '@nullroute/core'

export class MultisigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MultisigError'
  }
}

export interface CosignerView {
  readonly position: number
  /** As written in the descriptor. A hint, never used to decide anything. */
  readonly fingerprint: string | undefined
  readonly origin: string | undefined
  /** Abbreviated, because a full xpub on a 7 inch screen is unreadable. */
  readonly xpub: string
  readonly isThisDevice: boolean
}

export interface Registration {
  /** The descriptor with a valid checksum, as it should be recorded. */
  readonly descriptor: string
  readonly threshold: number
  readonly total: number
  readonly sorted: boolean
  readonly kind: string
  readonly network: string
  readonly cosigners: readonly CosignerView[]
  /** Where this device's key sits in the quorum. */
  readonly ourPosition: number
  readonly warnings: readonly { readonly kind: string; readonly message: string }[]
}

/** BIP-48 script type 2, the native segwit multisig account. */
const MULTISIG_PURPOSE = 48

/**
 * The account path this device uses for its multisig key.
 *
 * BIP-48 separates multisig accounts from single-signature ones so that the
 * same seed used in a quorum and alone does not reuse keys across them.
 */
export function multisigAccountPath(network: Network, account = 0): string {
  const coin = network.isMainnet ? 0 : 1
  return `m/${String(MULTISIG_PURPOSE)}'/${String(coin)}'/${String(account)}'/2'`
}

/**
 * Read a descriptor, confirm this device is in it, and describe the quorum.
 *
 * Throws rather than returning a "not a member" result. Registration is an
 * agreement, and there is nothing useful to agree to in a quorum that does not
 * contain you.
 */
export function reviewRegistration(
  body: string,
  seed: Secret,
  network: Network,
  account = 0
): Registration {
  let descriptor: Descriptor
  try {
    // The checksum is required. It is the only thing standing between a
    // mistyped character and a valid descriptor for a DIFFERENT wallet, and a
    // descriptor arrives here from outside by definition.
    descriptor = parseDescriptor(body)
  } catch (err) {
    throw new MultisigError((err as Error).message)
  }

  // Taproot and the older script kinds describe a quorum differently, so the
  // shape is read from whichever one this descriptor is. Everything after this
  // point treats them the same.
  const taproot = descriptor.script.kind === 'tr'
  const shape = taproot ? taprootShape(descriptor) : multisigShape(descriptor)

  const ours = deriveAccountXpub(seed, network, multisigAccountPath(network, account))
  const found = findOwnKey(descriptor, ours.xpub)
  if (found === undefined) {
    throw new MultisigError(
      'This device holds no key in that quorum. Registering it would produce a wallet that ' +
        'can receive funds and can never spend them. Check that the coordinator used this ' +
        `device's multisig key: ${abbreviate(ours.xpub)}, at ${ours.path}, ` +
        `master fingerprint ${ours.masterFingerprint}.`
    )
  }

  const cosigners: CosignerView[] = shape.keys.map((key, position) => ({
    position,
    fingerprint: key.origin?.fingerprint,
    origin: key.origin?.path,
    xpub: key.kind === 'extended' ? abbreviate(key.xpub) : `raw key (${key.hex.slice(0, 16)}...)`,
    isThisDevice: position === found.position,
  }))

  const warnings: { kind: string; message: string }[] = []

  if (shape.threshold === 1) {
    warnings.push({
      kind: 'threshold',
      message:
        `This is a 1-of-${String(shape.total)} quorum. Any single cosigner can spend without ` +
        `the others, including without you. That is a shared wallet, not a multisig one.`,
    })
  }
  if (shape.threshold === shape.total && shape.total > 2) {
    warnings.push({
      kind: 'threshold',
      message:
        `This is a ${String(shape.threshold)}-of-${String(shape.total)} quorum, so every ` +
        `cosigner must sign. Losing any one key makes the funds unspendable, with no margin.`,
    })
  }
  if (!shape.sorted) {
    warnings.push({
      kind: 'ordering',
      message:
        'This descriptor uses multi() rather than sortedmulti(), so key order is significant. ' +
        'Every cosigner must register the keys in exactly this order or their addresses will ' +
        'not match yours.',
    })
  }
  if (shape.kind === 'sh') {
    warnings.push({
      kind: 'script',
      message:
        'This is a legacy P2SH multisig. It works, and it costs more in fees than the segwit ' +
        'equivalent for the same quorum.',
    })
  }

  // Derive one address as a smoke test. A descriptor that parses, names this
  // device and then cannot produce an address is one worth failing on now
  // rather than after it has been recorded as the wallet.
  const first = taproot
    ? deriveTaprootAddresses(descriptor, { network, start: 0, count: 1 })
    : deriveMultisigAddresses(descriptor, { network, start: 0, count: 1 })
  if (first.length !== 1) {
    throw new MultisigError('That descriptor produced no addresses.')
  }

  return {
    descriptor: withChecksum(descriptor.body),
    threshold: shape.threshold,
    total: shape.total,
    sorted: shape.sorted,
    kind: shape.kind,
    network: network.id,
    cosigners,
    ourPosition: found.position,
    warnings,
  }
}

/**
 * The quorum inside a tr() script path, in the same shape the older kinds use.
 *
 * A taproot descriptor with no multisig leaf is refused for registration: this
 * screen exists to agree to a quorum, and tr(key) alone is a single-signature
 * wallet that belongs in the ordinary address flow.
 */
function taprootShape(descriptor: Descriptor): {
  kind: string
  threshold: number
  total: number
  sorted: boolean
  keys: readonly import('@nullroute/core').KeyExpression[]
} {
  const quorum = taprootQuorum(descriptor)
  if (quorum === undefined) {
    throw new MultisigError(
      'That taproot descriptor has no multisig leaf, so there is no quorum to register. ' +
        'A tr() descriptor with only a key path is a single-signature wallet.'
    )
  }
  return {
    kind: 'tr',
    threshold: quorum.threshold,
    total: quorum.total,
    sorted: quorum.sorted,
    keys: quorum.keys,
  }
}

/** First and last eight characters. A full xpub is unreadable on this screen. */
function abbreviate(value: string): string {
  if (value.length <= 20) return value
  return `${value.slice(0, 8)}...${value.slice(-8)}`
}
