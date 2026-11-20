/**
 * Who is looking. Every page and server action goes through `requireViewer`, every API route
 * through `apiViewer`; the proxy (src/proxy.ts) already turned away requests without a live
 * session, so these are the second lock on the same door.
 */
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { readCookie } from './browser'
import { COOKIE, findSession, type Session } from './sessions'

export interface Viewer {
  email: string
  session: Session
}

async function fromToken(token: string | undefined): Promise<Viewer | undefined> {
  const found = await findSession(token)
  // findSession ends the session of anyone taken out of OWNER_EMAILS.
  if (!found) return undefined
  return { email: found.session.email, session: found.session }
}

export const getViewer = cache(async (): Promise<Viewer | undefined> => {
  const jar = await cookies()
  return fromToken(jar.get(COOKIE)?.value)
})

export async function requireViewer(): Promise<Viewer> {
  const v = await getViewer()
  if (!v) redirect('/signin')
  return v
}

export function readSessionCookie(req: Request): string | undefined {
  return readCookie(req, COOKIE)
}

/** For route handlers: the viewer, or a 401 response to return as-is. */
export async function apiViewer(req: Request): Promise<Viewer | Response> {
  const v = await fromToken(readSessionCookie(req))
  if (v) return v
  return new Response(JSON.stringify({ error: 'signed_out', message: 'Sign in first.' }), {
    status: 401,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}
