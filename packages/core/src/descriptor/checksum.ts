/**
 * BIP-380 output descriptor checksums.
 *
 * Spec: core.descriptor.checksum
 *
 * A descriptor is how a user moves a wallet between programs, and it is
 * routinely copied by hand, read aloud, or transcribed off a screen. The
 * checksum exists so that a single mistyped character is caught rather than
 * silently producing a valid descriptor for a different wallet, which would
 * send funds somewhere unrecoverable.
 *
 * This is implemented here because `@scure/btc-signer` does not provide it. That
 * was verified rather than assumed: the package contains neither the BIP-380
 * INPUT_CHARSET nor any of the five generator constants, and the ~90 uses of the
 * word "descriptor" in its source name its own internal payment records rather
 * than BIP-380 strings.
 *
 * THE IMPLEMENTATION CONSTRAINT THAT MATTERS: the polymod state is 40 bits
 * wide. JavaScript's Number is exact only to 53 bits, but the intermediate
 * shifts and XORs here exceed what the bitwise operators can represent, because
 * `<<` and `^` coerce to 32-bit integers. A Number-based port does not throw or
 * overflow visibly, it silently returns WRONG checksums. So this uses BigInt
 * throughout, and the vector test is what proves it.
 */

/**
 * The 95 characters a descriptor may contain, ordered as BIP-380 specifies.
 * Position in this string, not the character's code point, drives the checksum.
 */
const INPUT_CHARSET =
  "0123456789()[],'/*abcdefgh@:$%{}" +
  'IJKLMNOPQRSTUVWXYZ&+-.;<=>?!^_|~' +
  'ijklmnopqrstuvwxyzABCDEFGH`#"\\ '

/** The bech32 character set, used for the checksum's own 8 characters. */
const CHECKSUM_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'

/**
 * Generators for the BCH code, from BIP-380.
 *
 * BigInt is mandatory. These are 40-bit values and the polymod below shifts
 * left by 5, which immediately exceeds what JavaScript's bitwise operators can
 * hold; they truncate to 32 bits and produce a wrong answer without any error.
 */
const GENERATORS = [0xf5dee51989n, 0xa9fdca3312n, 0x1bab10e32dn, 0x3706b1677an, 0x644d626ffdn]

export class DescriptorChecksumError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DescriptorChecksumError'
  }
}

/** The BCH polymod step. State is 40 bits, hence BigInt. */
function polymod(checksum: bigint, value: bigint): bigint {
  const top = checksum >> 35n
  let result = ((checksum & 0x7ffffffffn) << 5n) ^ value
  for (let i = 0; i < 5; i += 1) {
    if ((top >> BigInt(i)) & 1n) {
      const generator = GENERATORS[i]
      if (generator !== undefined) result ^= generator
    }
  }
  return result
}

/**
 * Compute the 8-character checksum for a descriptor body.
 *
 * `descriptor` must NOT already carry a `#checksum` suffix.
 */
export function descriptorChecksum(descriptor: string): string {
  let checksum = 1n
  // BIP-380 processes the input in groups of three, feeding the low bits of
  // each character's charset position immediately and the high bits in a batch
  // once the group is full.
  let groupIndex = 0
  let groupValue = 0n

  for (const character of descriptor) {
    const position = INPUT_CHARSET.indexOf(character)
    if (position === -1) {
      throw new DescriptorChecksumError(
        `Character ${JSON.stringify(character)} is not permitted in a descriptor. ` +
          `BIP-380 defines an input character set of 95 characters and this is not one of them.`
      )
    }
    const value = BigInt(position)

    checksum = polymod(checksum, value & 31n)
    groupValue = groupValue * 3n + (value >> 5n)
    groupIndex += 1

    if (groupIndex === 3) {
      checksum = polymod(checksum, groupValue)
      groupIndex = 0
      groupValue = 0n
    }
  }

  if (groupIndex > 0) checksum = polymod(checksum, groupValue)

  // Feed eight zeros to make room for the checksum, then XOR by 1 as specified.
  for (let i = 0; i < 8; i += 1) checksum = polymod(checksum, 0n)
  checksum ^= 1n

  let out = ''
  for (let i = 0; i < 8; i += 1) {
    const index = Number((checksum >> (5n * BigInt(7 - i))) & 31n)
    out += CHECKSUM_CHARSET.charAt(index)
  }
  return out
}

/** Append a checksum, or replace one that is already present. */
export function withChecksum(descriptor: string): string {
  const body = stripChecksum(descriptor)
  return `${body}#${descriptorChecksum(body)}`
}

/** The descriptor without its `#checksum` suffix. */
export function stripChecksum(descriptor: string): string {
  const hash = descriptor.lastIndexOf('#')
  return hash === -1 ? descriptor : descriptor.slice(0, hash)
}

export interface ChecksumVerdict {
  readonly valid: boolean
  readonly body: string
  readonly provided: string | undefined
  readonly expected: string
}

/**
 * Verify a descriptor's checksum.
 *
 * A descriptor arriving without one is reported as invalid rather than accepted
 * with a shrug. The checksum is the only defence against a transcription error,
 * and a wallet that accepts unchecked descriptors has discarded it. Callers that
 * genuinely want to accept an unchecksummed descriptor can inspect `provided`
 * and decide, which makes that a visible decision rather than a default.
 */
export function verifyChecksum(descriptor: string): ChecksumVerdict {
  const hash = descriptor.lastIndexOf('#')
  const body = hash === -1 ? descriptor : descriptor.slice(0, hash)
  const provided = hash === -1 ? undefined : descriptor.slice(hash + 1)
  const expected = descriptorChecksum(body)

  // Length is checked as well as value. BIP-380's own vectors include a nine
  // character and a seven character checksum as distinct failures, and a
  // comparison alone would reject them for the wrong reason, reporting a
  // mismatch where the real fault is a malformed suffix.
  // Indexed rather than spread: the spread operator yields Unicode code points,
  // and the checksum alphabet is single-byte by construction. Iterating by index
  // is what the format actually specifies.
  const wellFormed =
    provided?.length === 8 &&
    Array.from({ length: 8 }, (_, i) => provided.charAt(i)).every((c) =>
      CHECKSUM_CHARSET.includes(c)
    )

  return {
    valid: wellFormed && provided === expected,
    body,
    provided,
    expected,
  }
}
