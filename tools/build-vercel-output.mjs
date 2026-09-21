#!/usr/bin/env node
/**
 * Emit `.vercel/output` (Build Output API v3) from the static site build.
 *
 * Why this exists rather than letting Vercel build the site:
 *
 * The Content-Security-Policy pins the sha256 of each inline script Next
 * bootstraps a page with. Those bytes are build-specific: Vercel building the
 * same commit on its own Linux runners emits a different RSC payload than a
 * local build does, because the emitted chunk filenames differ. A host-side
 * build therefore serves scripts the committed policy does not cover.
 *
 * The failure mode is the reason this matters. The page renders perfectly, the
 * HTML is correct, a crawler sees everything, and hydration dies with React
 * error #412 in the console. No build check, no type check and no test would
 * notice. It was caught here only by driving a real browser at the deployed
 * site and asserting on console errors, which is now `make web-live-check`.
 *
 * So the site is deployed PREBUILT: build, hash that build, ship those exact
 * bytes. The property that buys is worth stating plainly, and it is the same
 * property the rest of this project is about: what was verified is what is
 * served.
 *
 * This also sidesteps `vercel build`, whose local Node version check rejects the
 * Node 24 that the device toolchain requires, while Vercel's own remote builder
 * accepts it.
 *
 * Run: node tools/build-vercel-output.mjs
 * Then: npx vercel deploy --prebuilt --prod
 */

import {
  cpSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
  existsSync,
} from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
// ONE DEFINITION, shared with tools/gen-csp.mjs, so the policy this deploy
// actually serves and the policy `make web-csp` checks cannot disagree.
import { asObject, buildPolicy, inlineScriptHashes, securityHeaders } from './lib/site-headers.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SITE = join(ROOT, 'apps/web/out')
const OUTPUT = join(ROOT, '.vercel/output')
const STATIC = join(OUTPUT, 'static')

if (!existsSync(SITE)) {
  console.error('build-vercel-output: no site build at apps/web/out. Run "make web-build" first.')
  process.exit(1)
}

function walk(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, found)
    else found.push(full)
  }
  return found
}

// --- 1. Copy the built site verbatim ---------------------------------------
rmSync(OUTPUT, { recursive: true, force: true })
mkdirSync(STATIC, { recursive: true })
cpSync(SITE, STATIC, { recursive: true })

const files = walk(STATIC).map((f) => relative(STATIC, f).replaceAll('\\', '/'))
const htmlFiles = files.filter((f) => f.endsWith('.html'))

// --- 2. Hash the inline scripts in exactly these bytes ----------------------
const scriptHashes = inlineScriptHashes(
  htmlFiles.map((file) => readFileSync(join(STATIC, file), 'utf8'))
)

const csp = buildPolicy(scriptHashes)

const headers = asObject(securityHeaders(csp))

// --- 3. Clean URLs ----------------------------------------------------------
// Without this /docs/threat-model 404s and only /docs/threat-model.html
// resolves, because the Next.js framework preset is what normally strips the
// extension and this is deliberately deployed as plain static files.
const overrides = {}
for (const file of htmlFiles) {
  if (file === 'index.html') continue
  const clean = file.replace(/(?:\/index)?\.html$/, '')
  if (clean.length > 0 && clean !== file) overrides[file] = { path: clean }
}

const config = {
  version: 3,
  routes: [
    // `continue: true` applies the headers and then keeps routing, rather than
    // terminating the match here.
    { src: '/(.*)', headers, continue: true },
    { handle: 'filesystem' },
    // Anything unmatched is a 404, served with the site's own not-found page.
    { src: '/(.*)', status: 404, dest: '/404.html' },
  ],
  overrides,
}

writeFileSync(join(OUTPUT, 'config.json'), `${JSON.stringify(config, null, 2)}\n`)

console.log(`build-vercel-output: ${files.length} files, ${htmlFiles.length} pages`)
console.log(`  ${scriptHashes.length} inline script hashes pinned in the CSP`)
console.log(`  ${Object.keys(overrides).length} clean-URL overrides`)
