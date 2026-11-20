import { requestCode } from '@/server/auth/flow'

/**
 * Every answer takes at least this long. Asking for the owner's code waits on Resend and asking for
 * anyone else's does not, so without a floor the response time would say whose address it is.
 * sonicwater's pattern (src/app/api/auth/code/route.ts).
 */
const FLOOR_MS = 1200

export async function POST(req: Request) {
  const started = Date.now()
  const res = await requestCode(req)
  const wait = FLOOR_MS - (Date.now() - started)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  return res
}
