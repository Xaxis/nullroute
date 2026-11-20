/** Hashes, MACs and random tokens. No cryptography is written here: all of it is node:crypto. */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/** Random base62, for row ids. */
export function randomId(length: number): string {
  const out: string[] = []
  while (out.length < length) {
    for (const b of randomBytes(length * 2)) {
      // 248 = 4 x 62: rejecting the rest keeps every character equally likely.
      if (b < 248 && out.length < length) out.push(ALPHABET.charAt(b % 62))
    }
  }
  return out.join('')
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function hmac(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex')
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}
