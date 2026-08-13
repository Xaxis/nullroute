/**
 * Multi-source entropy combiner.
 *
 * Spec: core.entropy.combiner
 *
 * Combines N independent entropy sources into a single 256-bit seed such that
 * the output retains full entropy if ANY single input source has full entropy.
 * That property is the entire reason mixed-source mode is offered: a user who
 * does not fully trust the Pi's hardware RNG can add dice, and a broken or
 * adversarially chosen `/dev/hwrng` cannot weaken the result.
 *
 * The construction is HKDF (RFC 5869) with a domain-separated salt:
 *
 *   ikm  = concat over sources, in canonical order, of:
 *            len(source_id)   as one byte
 *            source_id        as ASCII
 *            len(material)    as two bytes, big endian
 *            material
 *   seed = HKDF-Expand(HKDF-Extract("nullroute/entropy/v1", ikm), "seed", 32)
 *
 * The length prefixes are load-bearing, not decoration. Without them two
 * different source sets can concatenate to the same byte string, and the
 * combiner would map distinct inputs to the same seed. Concretely: sources
 * (id "a", bytes "bc") and (id "ab", bytes "c") both flatten to "abc". With
 * length prefixes they cannot collide.
 *
 * This does NOT detect a low-entropy source, and cannot. Detection is the
 * caller's job, which is why the daemon health-gates the machine sources before
 * they ever reach here. See docs/ENTROPY.md.
 */

import { expand, extract } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { Secret } from '../util/secret.js'

/** Domain separation. Bump the version if the construction ever changes. */
const HKDF_SALT = 'nullroute/entropy/v1'
const HKDF_INFO = 'seed'

export const SEED_LENGTH = 32
export const MIN_SOURCES = 1
export const MAX_SOURCES = 8
export const MIN_SOURCE_BYTES = 16
export const MAX_SOURCE_BYTES = 64
/** One length byte caps the id, and the cap keeps the encoding unambiguous. */
export const MAX_SOURCE_ID_BYTES = 255

/**
 * A single entropy input.
 *
 * `id` identifies the origin ("dice", "urandom", "hwrng") and is mixed into the
 * derivation, so the same bytes arriving from a different source produce a
 * different seed. It also fixes the canonical ordering.
 */
export interface EntropySource {
  readonly id: string
  readonly material: Secret
}

export class EntropyCombinerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EntropyCombinerError'
  }
}

function validate(sources: readonly EntropySource[]): void {
  if (sources.length < MIN_SOURCES) {
    throw new EntropyCombinerError('At least one entropy source is required.')
  }
  if (sources.length > MAX_SOURCES) {
    throw new EntropyCombinerError(
      `At most ${String(MAX_SOURCES)} entropy sources are allowed, got ${String(sources.length)}.`
    )
  }

  const seen = new Set<string>()
  for (const source of sources) {
    if (source.id.length === 0) {
      throw new EntropyCombinerError('Every entropy source needs a non-empty id.')
    }
    const idBytes = utf8ToBytes(source.id)
    if (idBytes.length > MAX_SOURCE_ID_BYTES) {
      throw new EntropyCombinerError(
        `Source id "${source.id}" encodes to ${String(idBytes.length)} bytes, over the ${String(MAX_SOURCE_ID_BYTES)} byte limit.`
      )
    }
    // Duplicate ids would make the canonical ordering ambiguous, so two runs
    // over the same set could produce different seeds.
    if (seen.has(source.id)) {
      throw new EntropyCombinerError(
        `Duplicate entropy source id "${source.id}". Source ids must be unique so ordering is deterministic.`
      )
    }
    seen.add(source.id)

    const length = source.material.length
    if (length < MIN_SOURCE_BYTES || length > MAX_SOURCE_BYTES) {
      throw new EntropyCombinerError(
        `Entropy source "${source.id}" is ${String(length)} bytes, outside the allowed ` +
          `${String(MIN_SOURCE_BYTES)} to ${String(MAX_SOURCE_BYTES)}.`
      )
    }
  }
}

/**
 * Canonical, unambiguous encoding of one source.
 *
 * Layout: [idLen: u8][id][materialLen: u16 be][material]
 */
function encodeSource(source: EntropySource): Uint8Array {
  const id = utf8ToBytes(source.id)
  const material = source.material.bytes

  const out = new Uint8Array(1 + id.length + 2 + material.length)
  let offset = 0
  out[offset] = id.length
  offset += 1
  out.set(id, offset)
  offset += id.length
  out[offset] = (material.length >>> 8) & 0xff
  out[offset + 1] = material.length & 0xff
  offset += 2
  out.set(material, offset)
  return out
}

/**
 * Combine entropy sources into a 32-byte seed.
 *
 * Deterministic: the same sources in any input order produce the same seed,
 * because sources are sorted by id before encoding. The caller owns the input
 * secrets and is responsible for disposing them; this function disposes only
 * the intermediates it creates.
 */
export function combineEntropy(sources: readonly EntropySource[]): Secret {
  validate(sources)

  // Canonical ordering by source id, so collection order cannot change the
  // result. Sorted by UTF-8 bytes rather than by JS string comparison, which is
  // UTF-16 code-unit ordering and differs for astral-plane characters.
  const ordered = [...sources].sort((a, b) => {
    const ab = utf8ToBytes(a.id)
    const bb = utf8ToBytes(b.id)
    const shared = Math.min(ab.length, bb.length)
    for (let i = 0; i < shared; i += 1) {
      const diff = (ab[i] ?? 0) - (bb[i] ?? 0)
      if (diff !== 0) return diff
    }
    return ab.length - bb.length
  })

  const encoded = ordered.map(encodeSource)
  const ikm = concatBytes(...encoded)

  try {
    const prk = extract(sha256, ikm, utf8ToBytes(HKDF_SALT))
    try {
      const seed = expand(sha256, prk, utf8ToBytes(HKDF_INFO), SEED_LENGTH)
      return Secret.fromBytes(seed, 'combined-seed')
    } finally {
      // The pseudorandom key is as sensitive as the seed it produces.
      prk.fill(0)
    }
  } finally {
    // The input keying material holds every source's bytes verbatim.
    ikm.fill(0)
    for (const chunk of encoded) chunk.fill(0)
  }
}
