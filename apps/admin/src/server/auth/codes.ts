/**
 * One-time sign-in codes. Only an HMAC of (email, code) is stored, so a database dump reveals no
 * usable code. A code works once, for 10 minutes, and dies after 5 wrong tries. Each belongs to the
 * address and to the browser that asked for it (`asker`, the SHA-256 of its sign-in cookie): a code
 * asked for elsewhere neither replaces it, nor spends its tries.
 */
import { randomInt } from 'node:crypto'
import { hmac, safeEqual } from '../crypto'
import { pg } from '../db'
import { env } from '../env'

export const CODE_LIFE_SEC = 10 * 60
export const CODE_TRIES = 5

export function sixDigits(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

function mac(email: string, code: string): string {
  return hmac(env().CODE_SECRET, `${email}:${code}`)
}

/** Stores a new code for the address and browser, replacing that browser's earlier one. */
export async function issueCode(email: string, asker: string, code: string): Promise<void> {
  await pg()`
    insert into nullroute.auth_codes (email_key, asker, mac, expires_at, tries)
    values (${email}, ${asker}, ${mac(email, code)},
            now() + make_interval(secs => ${CODE_LIFE_SEC}::int), 0)
    on conflict (email_key, asker) do update
      set mac = excluded.mac, expires_at = excluded.expires_at, tries = 0`
}

export async function dropCode(email: string, asker: string): Promise<void> {
  await pg()`delete from nullroute.auth_codes where email_key = ${email} and asker = ${asker}`
}

export type Checked = { kind: 'ok' } | { kind: 'none' } | { kind: 'wrong'; triesLeft: number }

/** Uses this browser's code for the address if `code` is it; a wrong guess spends a try. Atomic. */
export async function checkCode(email: string, asker: string, code: string): Promise<Checked> {
  const guess = mac(email, code)
  return pg().begin(async (tx) => {
    const mine = tx`email_key = ${email} and asker = ${asker}`
    const [row] = await tx<{ mac: string; expired: boolean; tries: number }[]>`
      select mac, expires_at <= now() as expired, tries
      from nullroute.auth_codes where ${mine} for update`
    if (!row) return { kind: 'none' } as const
    if (row.expired) {
      await tx`delete from nullroute.auth_codes where ${mine}`
      return { kind: 'none' } as const
    }
    if (safeEqual(row.mac, guess)) {
      await tx`delete from nullroute.auth_codes where ${mine}`
      return { kind: 'ok' } as const
    }
    const tries = row.tries + 1
    const left = Math.max(0, CODE_TRIES - tries)
    if (left === 0) await tx`delete from nullroute.auth_codes where ${mine}`
    else await tx`update nullroute.auth_codes set tries = ${tries} where ${mine}`
    return { kind: 'wrong', triesLeft: left } as const
  })
}
