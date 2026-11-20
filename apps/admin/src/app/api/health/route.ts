import { pg } from '@/server/db'

export const dynamic = 'force-dynamic'

/** Whether the database answers. Says nothing else. */
export async function GET() {
  try {
    await pg()`select 1`
    return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } })
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { 'cache-control': 'no-store' } })
  }
}
