#!/usr/bin/env node
/**
 * The device frontend's Content-Security-Policy, checked rather than assumed.
 *
 * INV-NET-3.
 *
 * docs/THREAT-MODEL.md has claimed "the frontend CSP is `default-src 'none'`
 * with everything else `'self'`" since the threat model was written. That was
 * true of nullroute.diy and false of the device: the only policy in this
 * repository lived in vercel.json, and the threat model is a document about the
 * device, which the website explicitly is not.
 *
 * The claim is now true, and this is what keeps it true. A CSP that exists in a
 * file nobody checks is a CSP that survives exactly until someone needs an
 * inline script in a hurry.
 *
 * WHAT THIS CANNOT TELL YOU. A meta-tag policy is applied by the browser that
 * parses the document. It is not a header, so it cannot restrict the document
 * before parsing, and it cannot set frame-ancestors in a way older engines
 * honour. On this device that gap is narrow: the page is served from loopback
 * by the local forwarder, to a kiosk Chromium that loads exactly this one
 * document. It is stated here because a reader deserves to know which half of
 * the defence they are getting.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const INDEX = fileURLToPath(new URL('../packages/ui/index.html', import.meta.url))

const html = readFileSync(INDEX, 'utf8')

const meta = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i.exec(html)
if (meta === null) {
  console.error('check-device-csp: packages/ui/index.html declares no Content-Security-Policy.')
  console.error('  INV-NET-3 in docs/THREAT-MODEL.md says it does. One of them is lying.')
  process.exit(1)
}

const policy = meta[1] ?? ''
const directives = new Map()
for (const part of policy.split(';')) {
  const tokens = part.trim().split(/\s+/).filter(Boolean)
  const name = tokens.shift()
  if (name !== undefined) directives.set(name, tokens)
}

const problems = []

/**
 * The fallback must deny. Every other directive is then an explicit grant, so a
 * resource type nobody considered is refused instead of inherited.
 */
if ((directives.get('default-src') ?? []).join(' ') !== "'none'") {
  problems.push(
    `default-src must be 'none', found "${(directives.get('default-src') ?? []).join(' ')}"`
  )
}

/**
 * The sources that would let a page fetch code or data from somewhere that is
 * not this device. A single one of these turns an air-gapped signer into a
 * device with an exfiltration path.
 */
const FORBIDDEN = ["'unsafe-inline'", "'unsafe-eval'", 'http:', 'https:', '*', 'data:']
const DATA_ALLOWED = new Set(['img-src'])

for (const [name, sources] of directives) {
  for (const source of sources) {
    if (source === 'data:' && DATA_ALLOWED.has(name)) continue
    if (FORBIDDEN.includes(source)) {
      problems.push(`${name} allows ${source}, which it must not`)
    }
    // Any absolute origin at all. The device has no other origin to reach.
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(source)) {
      problems.push(`${name} names an external origin (${source}). Nothing here may be off-device.`)
    }
  }
}

/**
 * Required, and each for a specific reason rather than for completeness.
 *
 * connect-src is the one that decides whether the page can talk to anything but
 * the daemon. base-uri stops an injected <base> retargeting every relative URL.
 * object-src closes a legacy hole that default-src does not cover on every
 * engine.
 */
for (const required of ['script-src', 'style-src', 'connect-src', 'base-uri', 'object-src']) {
  if (!directives.has(required)) problems.push(`${required} is missing`)
}

/**
 * Directives a meta-delivered policy cannot set.
 *
 * The browser ignores these and says so in the console. Carrying one is not
 * merely useless, it reads as a defence to whoever audits the file next, which
 * is the kind of quiet overclaim this project treats as a bug.
 */
for (const inert of ['frame-ancestors', 'report-uri', 'sandbox']) {
  if (directives.has(inert)) {
    problems.push(`${inert} does nothing in a meta tag and must not be listed as though it does`)
  }
}

if ((directives.get('connect-src') ?? []).some((source) => source !== "'self'")) {
  problems.push("connect-src must be exactly 'self': the daemon over loopback is the only endpoint")
}

/**
 * 'wasm-unsafe-eval' is permitted in script-src and nowhere else.
 *
 * The QR decoder is WebAssembly and will not instantiate without it. The name
 * is alarming and the grant is narrow: it permits wasm compilation and does not
 * re-enable eval or new Function. Allowed here, and asserted to be the ONLY
 * unusual token, so a future 'unsafe-eval' cannot arrive beside it unnoticed.
 */
const SCRIPT_ALLOWED = new Set(["'self'", "'wasm-unsafe-eval'"])
for (const source of directives.get('script-src') ?? []) {
  if (!SCRIPT_ALLOWED.has(source))
    problems.push(`script-src allows ${source}, which is not permitted`)
}

if (problems.length > 0) {
  console.error('check-device-csp: the device frontend policy is not what INV-NET-3 promises.\n')
  for (const problem of problems) console.error(`  ${problem}`)
  process.exit(1)
}

console.log(
  `check-device-csp: device frontend policy is ${String(directives.size)} directives, default-src 'none', no external origin`
)
