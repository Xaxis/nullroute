/**
 * The gate. Every request passes here first. Overhead's apps/web/src/proxy.ts (see UPSTREAM.md).
 *
 * - Without a live session, pages redirect to /signin and everything else gets a 401. The sign-in
 *   endpoints, the public contact form, the health probe and the cron (which checks its own
 *   secret) pass through.
 * - A server action (a POST with a Next-Action header) must come from this console's own origin,
 *   on top of Next's own check.
 * - Every page gets a strict content security policy with a fresh nonce: only scripts Next itself
 *   renders run, so text from a contact message or a grant document cannot execute.
 */
import { type NextRequest, NextResponse } from 'next/server'
import { COOKIE, findSession } from './server/auth/sessions'
import { sha256 } from './server/crypto'

const PUBLIC: RegExp[] = [
  /^\/signin$/,
  /^\/api\/auth\/(code|verify|signout)$/,
  /^\/api\/contact$/,
  /^\/api\/cron\/maintain$/,
  /^\/api\/health$/,
]

// Live sessions seen recently, so most requests skip the database. Short enough that a revoked
// session dies within half a minute; pages and actions check again on their own.
const recent = new Map<string, number>()
const FRESH_MS = 30_000

async function live(token: string | undefined): Promise<boolean> {
  if (!token) return false
  const key = sha256(token)
  const until = recent.get(key)
  if (until && until > Date.now()) return true
  const found = await findSession(token)
  if (!found) {
    recent.delete(key)
    return false
  }
  if (recent.size > 500) recent.clear()
  recent.set(key, Date.now() + FRESH_MS)
  return true
}

export function contentSecurityPolicy(nonce: string, dev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${dev ? ' ws: wss:' : ''}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ')
}

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin')
  const ours = new Set([req.nextUrl.origin, process.env.PUBLIC_ORIGIN])
  return !!origin && ours.has(origin) && req.headers.get('sec-fetch-site') !== 'cross-site'
}

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl

  if (req.method === 'POST' && req.headers.has('next-action') && !sameOrigin(req)) {
    return NextResponse.json(
      { error: 'cross_site', message: 'This has to come from the nullroute admin itself.' },
      { status: 403 }
    )
  }

  const isPublic = PUBLIC.some((re) => re.test(pathname))
  if (!isPublic && !(await live(req.cookies.get(COOKIE)?.value))) {
    const isPage =
      req.method === 'GET' && !pathname.startsWith('/api/') && !req.headers.has('next-action')
    if (isPage) {
      const url = req.nextUrl.clone()
      url.pathname = '/signin'
      url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`
      return NextResponse.redirect(url)
    }
    return NextResponse.json(
      { error: 'signed_out', message: 'Sign in first.' },
      { status: 401, headers: { 'cache-control': 'no-store' } }
    )
  }

  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64')
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV === 'development')
  const headers = new Headers(req.headers)
  headers.set('x-nonce', nonce)
  headers.set('content-security-policy', csp)
  const res = NextResponse.next({ request: { headers } })
  res.headers.set('content-security-policy', csp)
  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|fonts/|robots.txt).*)'],
}
