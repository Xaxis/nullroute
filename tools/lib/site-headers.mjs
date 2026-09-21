/**
 * The one definition of the response headers nullroute.diy serves.
 *
 * WHY THIS FILE EXISTS. The policy was written out twice, in tools/gen-csp.mjs
 * and in tools/build-vercel-output.mjs, and only one of them is checked. That
 * is the wrong one:
 *
 *   - gen-csp.mjs writes vercel.json, and `make web-csp` asserts vercel.json
 *     matches the build.
 *   - build-vercel-output.mjs writes .vercel/output/config.json, and
 *     `vercel deploy --prebuilt` serves the headers from THAT file. Nothing
 *     compares it to anything.
 *
 * So the check covered a file the deploy does not read, and the file it does
 * read was produced by a second implementation of the same twelve directives
 * and eight headers. They agreed, which is the only state in which a
 * duplication like this is discovered by reading rather than by an incident.
 *
 * A divergence would be quiet in the worst way. `make web-csp` would pass,
 * `make deploy` would ship a different policy, and the symptom on the site is
 * a page that renders with its scripts blocked or, worse, one that renders
 * with a policy weaker than the one the repository asserts it publishes.
 *
 * Shared rather than cross-checked on purpose: a second check comparing two
 * implementations is one more thing that can be written wrongly. One function
 * cannot disagree with itself.
 */

import { createHash } from 'node:crypto'

/**
 * SHA-256 of every inline script body in the given HTML, as CSP source
 * expressions, sorted.
 *
 * Sorted because the set has to be stable across runs for the committed
 * vercel.json to be comparable at all, and the order HTML files are walked in
 * is a filesystem detail.
 *
 * `src` scripts are skipped: they are covered by 'self'. Empty bodies are
 * skipped because hashing the empty string pins nothing and Next emits them.
 */
export function inlineScriptHashes(htmlDocuments) {
  const hashes = new Set()
  for (const html of htmlDocuments) {
    for (const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const [, attrs = '', body = ''] = match
      if (/\ssrc\s*=/i.test(attrs)) continue
      if (body.trim().length === 0) continue
      hashes.add(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`)
    }
  }
  return [...hashes].sort()
}

/** The Content-Security-Policy, given the inline script hashes to allow. */
export function buildPolicy(hashes) {
  return [
    // Nothing loads unless a directive below says otherwise.
    "default-src 'none'",
    `script-src 'self' ${hashes.join(' ')}`,
    // No 'unsafe-inline'. The build emits no inline styles and CI enforces it.
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    // The site makes no requests, but 'self' keeps Next's client router from
    // tripping the policy if a future page prefetches a route payload.
    "connect-src 'self'",
    "manifest-src 'self'",
    // No <base> rewriting, no form posts anywhere, no embedding in a frame.
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ')
}

/**
 * Every header the site serves, in vercel.json's `[{key, value}]` shape.
 *
 * The deploy output wants an object instead, which `asObject` below produces
 * from this same list, so the two formats cannot drift apart in content.
 */
export function securityHeaders(csp) {
  return [
    { key: 'Content-Security-Policy', value: csp },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
    // The site uses no device APIs at all. Denying them is free and means a
    // future dependency cannot quietly start asking.
    {
      key: 'Permissions-Policy',
      value:
        'accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()',
    },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  ]
}

/** The same headers as a plain object, which is what the deploy output takes. */
export function asObject(headers) {
  return Object.fromEntries(headers.map(({ key, value }) => [key, value]))
}
