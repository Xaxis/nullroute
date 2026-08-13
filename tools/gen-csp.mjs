#!/usr/bin/env node
/**
 * Generate (or check) the Content-Security-Policy for nullroute.space.
 *
 * The policy is strict: `default-src 'none'`, and every directive that is
 * allowed at all is `'self'`. No `'unsafe-inline'` anywhere, including for
 * styles, which is normally the directive people give up on first. It works
 * here because the build emits no inline <style> and no style attributes;
 * tools/check-web-isolation.mjs keeps it that way.
 *
 * Scripts are the one place a hash list is needed. Next's App Router inlines a
 * small RSC payload bootstrap into every page, so `script-src 'self'` alone
 * would block hydration. Those inline blocks are hashed and enumerated instead
 * of waving `'unsafe-inline'` through.
 *
 * That is only viable because the hashes are STABLE, which in turn is only true
 * because next.config.mjs pins `generateBuildId`. Without a pinned build id
 * Next embeds a random id in the payload, every build produces different
 * hashes, and a committed policy would break on the next deploy. Verified by
 * building twice from clean and diffing.
 *
 *   node tools/gen-csp.mjs           update vercel.json
 *   node tools/gen-csp.mjs --check   fail if the committed policy has drifted
 *
 * The --check form runs in CI. A hash list that silently stops matching the
 * build means the deployed site is either running with a broken policy or
 * serving scripts the policy was never reviewed against.
 */

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT = join(ROOT, 'apps/web/out')
const VERCEL_JSON = join(ROOT, 'vercel.json')

const check = process.argv.includes('--check')

if (!existsSync(OUT)) {
  console.error('gen-csp: no build output at apps/web/out. Run "make web-build" first.')
  process.exit(1)
}

function htmlFiles(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) htmlFiles(full, found)
    else if (name.endsWith('.html')) found.push(full)
  }
  return found
}

/** sha256 of every inline script body across every emitted page. */
function inlineScriptHashes() {
  const hashes = new Set()
  for (const file of htmlFiles(OUT)) {
    const html = readFileSync(file, 'utf8')
    for (const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const [, attrs = '', body = ''] = match
      if (/\ssrc\s*=/i.test(attrs)) continue
      if (body.trim().length === 0) continue
      hashes.add(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`)
    }
  }
  return [...hashes].sort()
}

function buildPolicy(hashes) {
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

const SECURITY_HEADERS = (csp) => [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  // The site uses no device APIs at all. Denying them is free and means a
  // future dependency cannot quietly start asking.
  {
    key: 'Permissions-Policy',
    value: 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
]

const hashes = inlineScriptHashes()
const csp = buildPolicy(hashes)

const config = {
  $schema: 'https://openapi.vercel.sh/vercel.json',
  buildCommand: 'npm run build --workspace @nullroute/web',
  installCommand: 'npm ci',
  outputDirectory: 'apps/web/out',
  framework: 'nextjs',
  headers: [{ source: '/(.*)', headers: SECURITY_HEADERS(csp) }],
}

const serialized = `${JSON.stringify(config, null, 2)}\n`

if (check) {
  if (!existsSync(VERCEL_JSON)) {
    console.error('gen-csp: vercel.json is missing. Run "node tools/gen-csp.mjs".')
    process.exit(1)
  }
  const committed = readFileSync(VERCEL_JSON, 'utf8')
  if (committed !== serialized) {
    console.error('gen-csp: vercel.json does not match the current build.\n')
    const committedCsp = /"Content-Security-Policy",\s*\n\s*"value": "([^"]*)"/.exec(committed)
    console.error(`  committed script-src hashes: ${committedCsp ? (/script-src[^;]*/.exec(committedCsp[1]) ?? [''])[0] : '(unparsed)'}\n`)
    console.error(`  built script-src hashes:     script-src 'self' ${hashes.join(' ')}\n`)
    console.error('  Next inlines an RSC bootstrap into every page. If those blocks changed,')
    console.error('  the deployed policy would block them and the site would fail to hydrate.')
    console.error('  Regenerate with: node tools/gen-csp.mjs')
    process.exit(1)
  }
  console.log(`gen-csp: vercel.json matches the build (${hashes.length} inline script hashes)`)
} else {
  writeFileSync(VERCEL_JSON, serialized)
  console.log(`gen-csp: wrote vercel.json with ${hashes.length} inline script hashes`)
  console.log(`  ${csp.slice(0, 100)}...`)
}
