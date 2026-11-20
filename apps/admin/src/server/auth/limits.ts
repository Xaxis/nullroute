/**
 * Fixed-window rate limits in Postgres: one atomic upsert per rule. Windows are coarse but cheap,
 * and they hold across every function instance.
 */
import { pg } from '../db'

export interface Rule {
  /** Names the limit, e.g. "code-email-h". */
  name: string
  /** Who is limited: an email key, an IP prefix, "all". */
  who: string
  limit: number
  windowSec: number
}

export type Taken = { ok: true } | { ok: false; rule: string; retryAfterSec: number }

/** Counts one hit against every rule; refuses at the first rule over its limit. */
export async function take(rules: Rule[]): Promise<Taken> {
  const sql = pg()
  for (const r of rules) {
    const bucket = `${r.name}:${r.who}`
    const [row] = await sql<{ count: number; reset_at: Date }[]>`
      insert into nullroute.rate_limits (bucket, count, reset_at)
      values (${bucket}, 1, now() + make_interval(secs => ${r.windowSec}::int))
      on conflict (bucket) do update set
        count = case when rate_limits.reset_at <= now() then 1 else rate_limits.count + 1 end,
        reset_at = case when rate_limits.reset_at <= now()
          then now() + make_interval(secs => ${r.windowSec}::int) else rate_limits.reset_at end
      returning count, reset_at`
    if (row && row.count > r.limit) {
      return {
        ok: false,
        rule: r.name,
        retryAfterSec: Math.max(1, Math.ceil((row.reset_at.getTime() - Date.now()) / 1000)),
      }
    }
  }
  return { ok: true }
}

/**
 * Whether every rule still has room, counting nothing: for limits counted only after the fact
 * (a wrong guess is known only once the code is checked). Refuses a rule already at its limit.
 */
export async function room(rules: Rule[]): Promise<Taken> {
  const sql = pg()
  for (const r of rules) {
    const [row] = await sql<{ count: number; reset_at: Date }[]>`
      select count, reset_at from nullroute.rate_limits
      where bucket = ${`${r.name}:${r.who}`} and reset_at > now()`
    if (row && row.count >= r.limit) {
      return {
        ok: false,
        rule: r.name,
        retryAfterSec: Math.max(1, Math.ceil((row.reset_at.getTime() - Date.now()) / 1000)),
      }
    }
  }
  return { ok: true }
}

/** Drops expired counters; called from the daily maintenance cron. */
export async function sweepLimits(): Promise<number> {
  const rows =
    await pg()`delete from nullroute.rate_limits where reset_at < now() - interval '1 day'`
  return rows.count
}
