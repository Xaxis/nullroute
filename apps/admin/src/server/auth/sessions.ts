/**
 * Browser sessions. The cookie carries 32 random bytes; the database keeps only their SHA-256, so
 * reading the sessions table never yields a working cookie. Admission's sessions.ts, with its
 * drizzle queries written as SQL.
 */
import { randomToken, sha256 } from '../crypto'
import { pg } from '../db'
import { isOwner } from './owners'

export const COOKIE = '__Host-nullroute_session'
export const IDLE_SEC = 7 * 24 * 3600
export const MAX_SEC = 30 * 24 * 3600
/** A session in use is marked seen (and its idle time renewed) at most this often. */
const TOUCH_EVERY_MS = 15 * 60 * 1000

const TOKEN = /^[A-Za-z0-9_-]{43}$/

export interface Session {
  id: string
  email: string
  createdAt: Date
  seenAt: Date
  idleUntil: Date
  endsAt: Date
  userAgent: string | null
  ipPrefix: string | null
}

interface Row {
  id: string
  email: string
  created_at: Date
  seen_at: Date
  idle_until: Date
  ends_at: Date
  user_agent: string | null
  ip_prefix: string | null
}

const fromRow = (r: Row): Session => ({
  id: r.id,
  email: r.email,
  createdAt: r.created_at,
  seenAt: r.seen_at,
  idleUntil: r.idle_until,
  endsAt: r.ends_at,
  userAgent: r.user_agent,
  ipPrefix: r.ip_prefix,
})

export async function createSession(
  email: string,
  meta: { userAgent: string | null; ipPrefix: string }
): Promise<{ token: string; session: Session }> {
  const token = randomToken(32)
  const now = Date.now()
  const [row] = await pg()<Row[]>`
    insert into nullroute.sessions (id, token_hash, email, idle_until, ends_at, user_agent, ip_prefix)
    values (${`s_${randomToken(9)}`}, ${sha256(token)}, ${email},
            ${new Date(now + IDLE_SEC * 1000)}, ${new Date(now + MAX_SEC * 1000)},
            ${meta.userAgent}, ${meta.ipPrefix})
    returning *`
  if (!row) throw new Error('Creating a session returned no row.')
  return { token, session: fromRow(row) }
}

/**
 * The live session behind a cookie token; `touched` when this use renewed it. A session whose email
 * is no longer in OWNER_EMAILS is ended here, so the proxy, every page and every action refuse it
 * at its next request.
 */
export async function findSession(
  token: string | undefined
): Promise<{ session: Session; touched: boolean } | undefined> {
  if (!token || !TOKEN.test(token)) return undefined
  const [row] = await pg()<Row[]>`
    select * from nullroute.sessions
    where token_hash = ${sha256(token)} and idle_until > now() and ends_at > now()
    limit 1`
  if (!row) return undefined
  const s = fromRow(row)
  if (!isOwner(s.email)) {
    await endSession(s.id)
    return undefined
  }
  const now = new Date()
  if (now.getTime() - s.seenAt.getTime() < TOUCH_EVERY_MS) return { session: s, touched: false }
  const idleUntil = new Date(Math.min(now.getTime() + IDLE_SEC * 1000, s.endsAt.getTime()))
  await pg()`update nullroute.sessions set seen_at = ${now}, idle_until = ${idleUntil} where id = ${s.id}`
  return { session: { ...s, seenAt: now, idleUntil }, touched: true }
}

export async function endSessionByToken(token: string | undefined): Promise<void> {
  if (!token || !TOKEN.test(token)) return
  await pg()`delete from nullroute.sessions where token_hash = ${sha256(token)}`
}

export async function endSession(id: string): Promise<void> {
  await pg()`delete from nullroute.sessions where id = ${id}`
}

export async function listSessions(): Promise<Session[]> {
  const rows = await pg()<Row[]>`
    select * from nullroute.sessions where idle_until > now() and ends_at > now()
    order by seen_at desc`
  return rows.map(fromRow)
}

/** Drops ended sessions, used-up codes and stale counters; the daily cron calls it. */
export async function sweep(): Promise<{ sessions: number; codes: number; limits: number }> {
  const sessions = await pg()`
    delete from nullroute.sessions where idle_until < now() or ends_at < now()`
  const codes = await pg()`delete from nullroute.auth_codes where expires_at < now()`
  const limits = await pg()`
    delete from nullroute.rate_limits where reset_at < now() - interval '1 day'`
  return { sessions: sessions.count, codes: codes.count, limits: limits.count }
}

export function cookieFor(token: string, session: Session): string {
  const maxAge = Math.max(
    0,
    Math.floor(
      (Math.min(session.idleUntil.getTime(), session.endsAt.getTime()) - Date.now()) / 1000
    )
  )
  return `${COOKIE}=${token}; Path=/; Max-Age=${String(maxAge)}; HttpOnly; Secure; SameSite=Lax`
}

export const CLEAR_COOKIE = `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
