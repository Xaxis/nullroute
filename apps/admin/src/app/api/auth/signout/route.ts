import { audit } from '@/server/audit'
import { CLEAR_COOKIE, endSessionByToken, findSession } from '@/server/auth/sessions'
import { readSessionCookie } from '@/server/auth/viewer'

export async function POST(req: Request) {
  const token = readSessionCookie(req)
  const found = await findSession(token)
  await endSessionByToken(token)
  if (found) {
    await audit({
      actor: found.session.email,
      action: 'auth.signed_out',
      detail: { session: found.session.id },
    })
  }
  return new Response(null, {
    status: 303,
    headers: { location: '/signin', 'set-cookie': CLEAR_COOKIE },
  })
}
