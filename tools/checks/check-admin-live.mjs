#!/usr/bin/env node
/**
 * The deployed admin console answers, and refuses, the way it is meant to.
 *
 * A console that deploys and then serves its pages to anyone, or accepts the
 * contact form from any origin, looks exactly like one that works: every
 * request in a browser succeeds. So this asks the questions a stranger would.
 * Signed out, every page redirects and every API answers 401. The sign-in page
 * carries a nonce CSP and cannot be framed. The contact endpoint answers a
 * preflight from nullroute.diy and refuses one from anywhere else. And the
 * health endpoint reaches the database, which is the one failure the rest of
 * the list cannot see.
 *
 * Usage: node tools/checks/check-admin-live.mjs [origin]
 */

const ORIGIN = process.argv[2] ?? 'https://admin.nullroute.diy'
const SITE = 'https://nullroute.diy'

let failed = 0
/** @param {boolean} ok @param {string} what @param {string} [seen] */
function expect(ok, what, seen = '') {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${ok || !seen ? '' : `: ${seen}`}`)
  if (!ok) failed++
}

/** @param {string} path @param {RequestInit} [init] */
function get(path, init = {}) {
  return fetch(`${ORIGIN}${path}`, { redirect: 'manual', ...init })
}

console.log(`admin-live: ${ORIGIN}`)

const health = await get('/api/health')
/** @type {{ ok?: boolean }} */
const body = health.ok ? /** @type {{ ok?: boolean }} */ (await health.json()) : {}
expect(
  health.status === 200 && body.ok === true,
  'health reaches the database',
  String(health.status)
)

const signin = await get('/signin')
const csp = signin.headers.get('content-security-policy') ?? ''
expect(signin.status === 200, 'the sign-in page loads', String(signin.status))
expect(
  /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/.test(csp),
  'its CSP allows only nonce-carrying scripts',
  csp
)
expect(csp.includes("frame-ancestors 'none'"), 'it cannot be framed', csp)
expect(
  (signin.headers.get('strict-transport-security') ?? '').includes('max-age='),
  'HSTS is set',
  signin.headers.get('strict-transport-security') ?? 'missing'
)
expect(
  (signin.headers.get('x-robots-tag') ?? '').includes('noindex'),
  'search engines are told to stay out',
  signin.headers.get('x-robots-tag') ?? 'missing'
)

for (const path of ['/', '/grants', '/messages', '/access']) {
  const res = await get(path)
  const to = res.headers.get('location') ?? ''
  expect(
    res.status === 307 && to.includes('/signin'),
    `signed out, ${path} redirects to sign-in`,
    `${String(res.status)} ${to}`
  )
}
const doc = await get('/api/documents/doc_abcdefabcdef')
expect(doc.status === 401, 'signed out, a document download answers 401', String(doc.status))

const cron = await get('/api/cron/maintain')
expect(
  cron.status === 403,
  'the maintenance job refuses a request without its secret',
  String(cron.status)
)

const preflight = (/** @type {string} */ origin) =>
  get('/api/contact', {
    method: 'OPTIONS',
    headers: {
      origin,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
    },
  })
const ours = await preflight(SITE)
expect(
  ours.status === 204 && ours.headers.get('access-control-allow-origin') === SITE,
  'the contact form accepts a preflight from nullroute.diy',
  `${String(ours.status)} ${ours.headers.get('access-control-allow-origin') ?? 'no allow-origin'}`
)
const theirs = await preflight('https://example.com')
expect(
  theirs.headers.get('access-control-allow-origin') === null,
  'and grants no other origin',
  theirs.headers.get('access-control-allow-origin') ?? ''
)

if (failed > 0) {
  console.log(`\nadmin-live: ${String(failed)} check(s) failed`)
  process.exit(1)
}
console.log('admin-live: all checks passed')
