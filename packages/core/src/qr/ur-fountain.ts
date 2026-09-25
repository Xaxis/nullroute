/**
 * The fountain code under multipart UR: CRC-32, Xoshiro256**, the alias
 * sampler, and the encoder and decoder that use them.
 *
 * Spec: core.qr.ur
 *
 * Nothing here is cryptography and nothing here is secret. Xoshiro256** is a
 * published deterministic generator that UR uses only to decide which
 * fragments a part past the first loop XORs together, seeded from the part's
 * own number and the message checksum. Both ends compute the same sequence, so
 * it must be bit exact rather than good: one wrong index means a wrong XOR and
 * a checksum failure. SHA-256 comes from @noble/hashes like every other hash in
 * this package.
 *
 * Every step follows Blockchain Commons' reference, bc-ur at
 * 4479fb81b2350ae8bafa042a5572b9c64c2c32ca, and is checked against the vectors
 * copied from its test suite into spec/vectors/ur-bcr.json. Where the C++ does
 * something a tidier implementation would not (a double that can round to
 * exactly 1.0, a sampler that fills its stacks in reverse), this does the same,
 * because tidying it would change which fragments get mixed.
 * research/ur-notes.md has the line citations.
 */

import { sha256 } from '@noble/hashes/sha2.js'

export class UrError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UrError'
  }
}

// --- CRC-32 ----------------------------------------------------------------

/** Reflected CRC-32, polynomial 0xEDB88320 (bc-ur src/crc32.c:19-39). */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (const byte of data) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Four bytes, big endian: how Bytewords appends a checksum. */
export function uint32BE(value: number): Uint8Array {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, value >>> 0, false)
  return out
}

// --- Xoshiro256** ----------------------------------------------------------

const MASK64 = (1n << 64n) - 1n
const TWO_64 = 18446744073709551616 // 2^64, exactly representable

function rotl(x: bigint, k: bigint): bigint {
  return ((x << k) | (x >> (64n - k))) & MASK64
}

/**
 * xoshiro256** 1.0, seeded from SHA-256 of the seed bytes, the digest read as
 * four big-endian 64-bit words (bc-ur src/xoshiro256.cpp:43-78, :102-117).
 * BigInt throughout: a Number would lose the low bits every step depends on.
 */
export class Xoshiro256 {
  readonly #s: bigint[]

  constructor(seed: Uint8Array) {
    const digest = sha256(seed)
    const view = new DataView(digest.buffer, digest.byteOffset, digest.byteLength)
    this.#s = [0, 1, 2, 3].map((i) => view.getBigUint64(i * 8, false))
  }

  static fromString(seed: string): Xoshiro256 {
    return new Xoshiro256(new TextEncoder().encode(seed))
  }

  next(): bigint {
    const s = this.#s as [bigint, bigint, bigint, bigint]
    const result = (rotl((s[1] * 5n) & MASK64, 7n) * 9n) & MASK64
    const t = (s[1] << 17n) & MASK64
    s[2] ^= s[0]
    s[3] ^= s[1]
    s[1] ^= s[2]
    s[0] ^= s[3]
    s[2] ^= t
    s[3] = rotl(s[3], 45n)
    return result
  }

  /**
   * double(next()) / 2^64. Number(bigint) rounds to nearest like the C++ cast,
   * so a value within 2^10 of 2^64 gives exactly 1.0 here as it does there
   * (bc-ur src/xoshiro256.cpp:80-84). Not guarded, on purpose: see the header.
   */
  nextDouble(): number {
    return Number(this.next()) / TWO_64
  }

  /** uint64(nextDouble() * (high - low + 1)) + low, truncating (:86-90). */
  nextInt(low: number, high: number): number {
    return Math.trunc(this.nextDouble() * (high - low + 1)) + low
  }

  /** The top bits of next() by way of a double, not its low byte (:92-100). */
  nextByte(): number {
    return this.nextInt(0, 255) & 0xff
  }

  nextData(count: number): Uint8Array {
    const out = new Uint8Array(count)
    for (let i = 0; i < count; i += 1) out[i] = this.nextByte()
    return out
  }
}

// --- Random sampler (Walker-Vose alias) --------------------------------------

/** bc-ur src/random-sampler.cpp:17-82, including its reversed stack fill. */
export class RandomSampler {
  readonly #prob: number[]
  readonly #alias: number[]

  constructor(probs: readonly number[]) {
    if (probs.some((p) => !(p > 0))) throw new UrError('sampler weights must be positive')
    const n = probs.length
    let sum = 0
    for (const p of probs) sum += p
    const P = probs.map((p) => (p * n) / sum)

    const small: number[] = []
    const large: number[] = []
    for (let i = n - 1; i >= 0; i -= 1) {
      if ((P[i] ?? 0) < 1) small.push(i)
      else large.push(i)
    }

    const prob = new Array<number>(n).fill(0)
    const alias = new Array<number>(n).fill(0)
    while (small.length > 0 && large.length > 0) {
      const a = small.pop() ?? 0
      const g = large.pop() ?? 0
      prob[a] = P[a] ?? 0
      alias[a] = g
      P[g] = (P[g] ?? 0) + (P[a] ?? 0) - 1
      if ((P[g] ?? 0) < 1) small.push(g)
      else large.push(g)
    }
    for (const g of large) prob[g] = 1
    for (const a of small) prob[a] = 1

    this.#prob = prob
    this.#alias = alias
  }

  next(rng: Xoshiro256): number {
    const r1 = rng.nextDouble()
    const r2 = rng.nextDouble()
    const i = Math.trunc(this.#prob.length * r1)
    return r2 < (this.#prob[i] ?? 0) ? i : (this.#alias[i] ?? 0)
  }
}

// --- Fragment selection ----------------------------------------------------

/**
 * The largest transfer a decoder will start on. A PSBT is refused above
 * 1,000,000 bytes (packages/core/src/psbt/parse.ts), and its CBOR head adds at
 * most five, so a longer message cannot become a PSBT. And 10,000 parts covers
 * that size at 100-byte fragments, already a quarter hour of animation.
 * Without these, one frame claiming four billion parts made chooseFragments
 * build a four billion entry array (INV-UR-6).
 */
export const MAX_MESSAGE_LEN = 1_000_005
export const MAX_SEQ_LEN = 10_000

/**
 * The degree sampler depends only on seqLen, and a decoder asks for the same
 * seqLen on every mixed part, so the last one is kept. The C++ rebuilds it each
 * call and the Swift reference once per message; both give the same draws,
 * because construction is deterministic.
 */
let degreeSampler: { readonly seqLen: number; readonly sampler: RandomSampler } | undefined

/** Draws the degree first: two nextDouble calls (bc-ur src/fountain-utils.cpp:16-23). */
export function chooseDegree(seqLen: number, rng: Xoshiro256): number {
  if (degreeSampler?.seqLen !== seqLen) {
    const weights: number[] = []
    for (let i = 1; i <= seqLen; i += 1) weights.push(1 / i)
    degreeSampler = { seqLen, sampler: new RandomSampler(weights) }
  }
  return degreeSampler.sampler.next(rng) + 1
}

/**
 * Remove a random remaining item, append it, `count` times (all by default)
 * (fountain-utils.hpp:25-35). Stopping early draws exactly what the full
 * shuffle draws up to that point, so the first `count` items are the same; the
 * multipart paper's Swift reference stops early the same way.
 */
export function shuffled<T>(items: readonly T[], rng: Xoshiro256, count = items.length): T[] {
  const remaining = [...items]
  const result: T[] = []
  while (remaining.length > 0 && result.length < count) {
    const index = rng.nextInt(0, remaining.length - 1)
    const [item] = remaining.splice(index, 1)
    result.push(item as T)
  }
  return result
}

/**
 * Which fragments a part carries (bc-ur src/fountain-utils.cpp:26-40).
 *
 * Parts up to seqLen carry one fragment each, in order, so the first loop alone
 * is enough to decode. Past that, the part's number and the message checksum
 * seed the generator, which draws a degree and a shuffle.
 */
export function chooseFragments(seqNum: number, seqLen: number, checksum: number): number[] {
  if (seqNum <= seqLen) return [seqNum - 1]
  const seed = new Uint8Array(8)
  const view = new DataView(seed.buffer)
  view.setUint32(0, seqNum >>> 0, false)
  view.setUint32(4, checksum >>> 0, false)
  const rng = new Xoshiro256(seed)
  const degree = chooseDegree(seqLen, rng)
  const indexes = Array.from({ length: seqLen }, (_, i) => i)
  return shuffled(indexes, rng, degree)
}

// --- Encoder ---------------------------------------------------------------

/**
 * The first fragment length, trying one fragment, then two, and so on, that
 * fits under the maximum (bc-ur src/fountain-encoder.cpp:20-34).
 */
export function findNominalFragmentLength(
  messageLen: number,
  minFragmentLen: number,
  maxFragmentLen: number
): number {
  if (messageLen < 1 || minFragmentLen < 1 || maxFragmentLen < minFragmentLen) {
    throw new UrError('fragment lengths are out of range')
  }
  const maxCount = Math.floor(messageLen / minFragmentLen)
  let fragmentLen = 0
  for (let count = 1; count <= maxCount; count += 1) {
    fragmentLen = Math.ceil(messageLen / count)
    if (fragmentLen <= maxFragmentLen) break
  }
  if (fragmentLen === 0) throw new UrError('no fragment length fits')
  return fragmentLen
}

/** Cut into equal fragments, the last one zero padded (fountain-encoder.cpp:36-51). */
export function partitionMessage(message: Uint8Array, fragmentLen: number): Uint8Array[] {
  const fragments: Uint8Array[] = []
  for (let offset = 0; offset < message.length; offset += fragmentLen) {
    const fragment = new Uint8Array(fragmentLen)
    fragment.set(message.subarray(offset, offset + fragmentLen))
    fragments.push(fragment)
  }
  return fragments
}

function xorInto(target: Uint8Array, source: Uint8Array): void {
  for (let i = 0; i < target.length; i += 1) target[i] = (target[i] ?? 0) ^ (source[i] ?? 0)
}

export interface FountainPart {
  readonly seqNum: number
  readonly seqLen: number
  readonly messageLen: number
  readonly checksum: number
  readonly data: Uint8Array
}

export class FountainEncoder {
  readonly messageLen: number
  readonly checksum: number
  readonly fragmentLen: number
  readonly #fragments: Uint8Array[]
  #seqNum: number

  constructor(message: Uint8Array, maxFragmentLen: number, firstSeqNum = 0, minFragmentLen = 10) {
    if (message.length === 0) throw new UrError('a UR carries at least one byte')
    this.messageLen = message.length
    this.checksum = crc32(message)
    this.fragmentLen = findNominalFragmentLength(message.length, minFragmentLen, maxFragmentLen)
    this.#fragments = partitionMessage(message, this.fragmentLen)
    this.#seqNum = firstSeqNum >>> 0
  }

  get seqLen(): number {
    return this.#fragments.length
  }

  nextPart(): FountainPart {
    this.#seqNum = (this.#seqNum + 1) >>> 0
    const data = new Uint8Array(this.fragmentLen)
    for (const index of chooseFragments(this.#seqNum, this.seqLen, this.checksum)) {
      xorInto(data, this.#fragments[index] ?? new Uint8Array(0))
    }
    return {
      seqNum: this.#seqNum,
      seqLen: this.seqLen,
      messageLen: this.messageLen,
      checksum: this.checksum,
      data,
    }
  }
}

// --- Decoder ---------------------------------------------------------------

interface HeldPart {
  readonly indexes: ReadonlySet<number>
  readonly data: Uint8Array
}

const keyOf = (indexes: ReadonlySet<number>): string => [...indexes].sort((a, b) => a - b).join(',')

function isStrictSubset(small: ReadonlySet<number>, big: ReadonlySet<number>): boolean {
  if (small.size >= big.size) return false
  for (const i of small) if (!big.has(i)) return false
  return true
}

/**
 * The receiving half (bc-ur src/fountain-decoder.cpp).
 *
 * One departure from the reference, made for this device: a part whose
 * sequence length, message length, checksum or fragment length differs from
 * the first part is REFUSED with an error rather than dropped. The reference
 * drops it quietly, which is right for a phone that keeps scanning; here the
 * screen tells the user two transfers were in view and starts over, as it does
 * for BBQr (SP-TX-5). A message whose checksum does not match is refused too,
 * never returned.
 */
export class FountainDecoder {
  #expected:
    | {
        readonly seqLen: number
        readonly messageLen: number
        readonly checksum: number
        readonly fragmentLen: number
      }
    | undefined
  readonly #simple = new Map<number, Uint8Array>()
  readonly #mixed = new Map<string, HeldPart>()
  readonly #seen = new Set<number>()
  #result: Uint8Array | undefined

  get complete(): boolean {
    return this.#result !== undefined
  }

  get result(): Uint8Array | undefined {
    return this.#result
  }

  /** How many of the message's fragments are known outright. */
  get fragmentsKnown(): number {
    return this.#simple.size
  }

  get seqLen(): number | undefined {
    return this.#expected?.seqLen
  }

  /** Returns true when the part added something. */
  receive(part: FountainPart): boolean {
    if (this.#result !== undefined) return false
    if (part.seqLen < 1 || part.messageLen < 1 || part.data.length < 1) {
      throw new UrError('That UR part is empty.')
    }
    if (this.#expected === undefined) {
      // Checked before anything is sized from them (INV-UR-6).
      if (part.messageLen > MAX_MESSAGE_LEN || part.seqLen > MAX_SEQ_LEN) {
        throw new UrError('That UR transfer is too large for anything this device reads.')
      }
      // Exactly what every encoder produces: equal fragments, the last padded.
      if (part.seqLen !== Math.ceil(part.messageLen / part.data.length)) {
        throw new UrError('That UR part has lengths that do not add up. Start again.')
      }
      this.#expected = {
        seqLen: part.seqLen,
        messageLen: part.messageLen,
        checksum: part.checksum,
        fragmentLen: part.data.length,
      }
    } else if (
      part.seqLen !== this.#expected.seqLen ||
      part.messageLen !== this.#expected.messageLen ||
      part.checksum !== this.#expected.checksum ||
      part.data.length !== this.#expected.fragmentLen
    ) {
      throw new UrError(
        'That QR code belongs to a different transfer. Start again with one sequence in view.'
      )
    }
    if (this.#seen.has(part.seqNum)) return false
    this.#seen.add(part.seqNum)

    const indexes = new Set(chooseFragments(part.seqNum, part.seqLen, part.checksum))
    const queue: HeldPart[] = [{ indexes, data: Uint8Array.from(part.data) }]
    // Through the getter: #processSimple sets the result, which narrowing on
    // the field would not see, and the loop has to stop when it does.
    while (queue.length > 0 && !this.complete) {
      const next = queue.shift()
      if (next === undefined) break
      if (next.indexes.size === 1) this.#processSimple(next, queue)
      else this.#processMixed(next, queue)
    }
    return true
  }

  #reduce(a: HeldPart, b: HeldPart): HeldPart {
    if (!isStrictSubset(b.indexes, a.indexes)) return a
    const indexes = new Set([...a.indexes].filter((i) => !b.indexes.has(i)))
    const data = Uint8Array.from(a.data)
    xorInto(data, b.data)
    return { indexes, data }
  }

  #processSimple(part: HeldPart, queue: HeldPart[]): void {
    const [index] = [...part.indexes]
    if (index === undefined || this.#simple.has(index)) return
    this.#simple.set(index, part.data)

    const expected = this.#expected
    if (expected === undefined) return
    if (this.#simple.size === expected.seqLen) {
      const joined = new Uint8Array(expected.seqLen * expected.fragmentLen)
      for (let i = 0; i < expected.seqLen; i += 1) {
        joined.set(this.#simple.get(i) ?? new Uint8Array(0), i * expected.fragmentLen)
      }
      const message = joined.slice(0, expected.messageLen)
      if (crc32(message) !== expected.checksum) {
        throw new UrError(
          'The UR frames joined into a message whose checksum is wrong. Start again.'
        )
      }
      this.#result = message
      return
    }

    for (const [key, mixed] of [...this.#mixed]) {
      const reduced = this.#reduce(mixed, part)
      if (reduced === mixed) continue
      this.#mixed.delete(key)
      if (reduced.indexes.size === 1) queue.push(reduced)
      else this.#mixed.set(keyOf(reduced.indexes), reduced)
    }
  }

  #processMixed(part: HeldPart, queue: HeldPart[]): void {
    if (this.#mixed.has(keyOf(part.indexes))) return
    let reduced = part
    for (const [index, data] of this.#simple) {
      reduced = this.#reduce(reduced, { indexes: new Set([index]), data })
    }
    for (const mixed of this.#mixed.values()) reduced = this.#reduce(reduced, mixed)
    if (reduced.indexes.size === 1) {
      queue.push(reduced)
      return
    }
    for (const [key, mixed] of [...this.#mixed]) {
      const next = this.#reduce(mixed, reduced)
      if (next === mixed) continue
      this.#mixed.delete(key)
      if (next.indexes.size === 1) queue.push(next)
      else this.#mixed.set(keyOf(next.indexes), next)
    }
    this.#mixed.set(keyOf(reduced.indexes), reduced)
  }
}
