import { audit } from '@/server/audit'
import { sweep } from '@/server/auth/sessions'
import { safeEqual } from '@/server/crypto'
import { env } from '@/server/env'

export const dynamic = 'force-dynamic'

/** Daily (vercel.json): drops ended sessions, used-up codes and stale rate counters. */
export async function GET(req: Request) {
  const given = req.headers.get('authorization') ?? ''
  if (!safeEqual(given, `Bearer ${env().CRON_SECRET}`)) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  const swept = await sweep()
  await audit({ actor: null, action: 'maintain.swept', detail: swept })
  return Response.json({ ok: true, ...swept }, { headers: { 'cache-control': 'no-store' } })
}
