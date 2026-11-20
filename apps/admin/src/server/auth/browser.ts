/**
 * What a browser carries through sign-in besides the session, so a stranger can't lock the owner
 * out:
 * - the asker cookie names the browser that asked for a code. The code belongs to it alone, so a
 *   code asked for elsewhere can't replace the owner's, and wrong guesses elsewhere can't spend it.
 * - the device cookie says this browser has signed in as this owner before (HMAC'd with
 *   CODE_SECRET, nothing stored). Its requests are limited on their own, apart from strangers'.
 */
import { hmac, randomToken, safeEqual, sha256 } from '../crypto'
import { env } from '../env'
import { CODE_LIFE_SEC } from './codes'

export const ASKER_COOKIE = '__Host-nullroute_signin'
export const DEVICE_COOKIE = '__Host-nullroute_device'
/** Browsers keep a cookie at most 400 days. */
export const DEVICE_SEC = 400 * 24 * 3600

const TOKEN = /^[A-Za-z0-9_-]{43}$/
const DEVICE = /^(\d{1,12})\.([0-9a-f]{64})$/

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get('cookie')
  if (!header) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return undefined
}

const cookie = (name: string, value: string, maxAge: number) =>
  `${name}=${value}; Path=/; Max-Age=${String(maxAge)}; HttpOnly; Secure; SameSite=Strict`

/** This browser's asker token: the one it has, or a new one for it to keep. */
export function askerToken(req: Request): string {
  const had = readCookie(req, ASKER_COOKIE)
  return had && TOKEN.test(had) ? had : randomToken(32)
}

/** What codes are stored under: never the token itself. */
export function askerOf(req: Request): string | undefined {
  const token = readCookie(req, ASKER_COOKIE)
  return token && TOKEN.test(token) ? sha256(token) : undefined
}

export function askerCookie(token: string): string {
  return cookie(ASKER_COOKIE, token, CODE_LIFE_SEC)
}

export const CLEAR_ASKER = cookie(ASKER_COOKIE, '', 0)

const deviceMac = (email: string, issued: string) =>
  hmac(env().CODE_SECRET, `device:${email}:${issued}`)

/** Set when an owner signs in: this browser has been theirs. */
export function deviceCookie(email: string, now: Date): string {
  const issued = String(Math.floor(now.getTime() / 1000))
  return cookie(DEVICE_COOKIE, `${issued}.${deviceMac(email, issued)}`, DEVICE_SEC)
}

/**
 * A stable key for the browser if it has signed in as `email` within 400 days, else undefined.
 * Its requests are then counted against that key alone.
 */
export function knownDevice(req: Request, email: string, now: Date): string | undefined {
  const m = DEVICE.exec(readCookie(req, DEVICE_COOKIE) ?? '')
  if (!m) return undefined
  const [value, issued, mac] = m as unknown as [string, string, string]
  const age = now.getTime() / 1000 - Number(issued)
  if (age < -300 || age > DEVICE_SEC) return undefined
  if (!safeEqual(mac, deviceMac(email, issued))) return undefined
  return sha256(value).slice(0, 16)
}
