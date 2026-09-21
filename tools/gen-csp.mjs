#!/usr/bin/env node
/**
 * Generate (or check) the Content-Security-Policy for nullroute.diy.
 *
 * IMPORTANT: this only holds because the site is deployed PREBUILT. The hashes
 * below are computed from a specific build's bytes, and Vercel building the same
 * commit on its own Linux runners produces a different RSC payload (the emitted
 * chunk filenames differ), so a host-side build would serve scripts the
 * committed policy does not cover. The symptom is nasty: the page renders
 * perfectly and hydration dies with React error #412, which no build check and
 * no crawler would notice.
 *
 * So `make deploy` builds, hashes that build, and ships those exact bytes. The
 * property this buys is worth stating plainly: what was hashed is what is
 * served.
 *
 * The policy is strict: `default-src 'none'`, and every directive that is
 * allowed at all is `'self'`. No `'unsafe-inline'` anywhere, including for
 * styles, which is normally the directive people give up on first. It works
 * here because the build emits no inline <style> and no style attributes;
 * tools/checks/check-web-isolation.mjs keeps it that way.
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
 * THE HASHES ARE STABLE ACROSS BUILDS AND NOT ACROSS COMMITS, and the
 * difference matters to anybody wondering why this failed. The home page
 * renders the real `make verify` transcript, read out of
 * verification-report.json at build time, and the last line of that transcript
 * is the manifest root. The root is a hash of every file in packages/ and
 * spec/, so it moves on any device commit, so one of the inline blocks moves
 * with it. Nothing in apps/web has to have been touched.
 *
 * That coupling is deliberate and it is the point of the page: the site quotes
 * the number the device prints on its lock screen rather than describing it.
 * The cost is that vercel.json is downstream of the device source, and
 * regenerating it is part of preparing a release rather than part of working on
 * the website. `make deploy` runs `web-check` first, so a stale policy blocks
 * the deploy instead of shipping a site that will not hydrate.
 *
 *   node tools/gen-csp.mjs           update vercel.json
 *   node tools/gen-csp.mjs --check   fail if the committed policy has drifted
 *
 * The --check form runs in CI. A hash list that silently stops matching the
 * build means the deployed site is either running with a broken policy or
 * serving scripts the policy was never reviewed against.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
// ONE DEFINITION, shared with tools/build-vercel-output.mjs. See that file.
import { buildPolicy, inlineScriptHashes, securityHeaders } from './lib/site-headers.mjs'

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

const hashes = inlineScriptHashes(htmlFiles(OUT).map((file) => readFileSync(file, 'utf8')))
const csp = buildPolicy(hashes)

const config = {
  $schema: 'https://openapi.vercel.sh/vercel.json',
  buildCommand: 'npm run build --workspace @nullroute/web',
  installCommand: 'npm ci',
  outputDirectory: 'apps/web/out',
  // Deliberately null, not "nextjs". The Next.js framework preset expects a
  // .next directory with routes-manifest.json and fails the deploy without one.
  // This site is `output: 'export'`, so the build produces a plain folder of
  // files and there is no server runtime to configure. Treating it as static is
  // both what it is and what we want: the deployed artifact cannot do anything
  // the source does not show.
  framework: null,
  // Without this, /docs/threat-model 404s and only /docs/threat-model.html
  // resolves, because the Next.js preset's routing is what normally strips the
  // extension and we are deliberately not using it.
  cleanUrls: true,
  trailingSlash: false,
  headers: [{ source: '/(.*)', headers: securityHeaders(csp) }],
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
    console.error(
      `  committed script-src hashes: ${committedCsp ? (/script-src[^;]*/.exec(committedCsp[1]) ?? [''])[0] : '(unparsed)'}\n`
    )
    console.error(`  built script-src hashes:     script-src 'self' ${hashes.join(' ')}\n`)
    console.error('  Next inlines an RSC bootstrap into every page. If those blocks changed,')
    console.error('  the deployed policy would block them and the site would fail to hydrate.')
    console.error('')
    console.error('  THE USUAL CAUSE IS A CHANGE TO THE DEVICE, NOT TO THE WEBSITE. The home')
    console.error('  page renders the real verification transcript, read out of')
    console.error('  verification-report.json at build time, and its last line is the manifest')
    console.error('  root. That root is a hash of every file git tracks under packages/, spec/')
    console.error('  and provisioning/, so any device commit at all moves one of the hashes')
    console.error('  above. Nothing about apps/web has to have changed.')
    console.error('')
    console.error('  A DOCS EDIT DOES IT TOO, and that one is easy to miss because the root')
    console.error('  hash does not move, so check-site-root stays green. The site renders')
    console.error("  docs/*.md, and changing a sentence in one rewrites that page's inline")
    console.error('  payload. docs/ is neither the device nor apps/web, which is exactly why')
    console.error('  it does not come to mind when this fails.')
    console.error('')
    console.error('  SO DOES ADDING A TEST. The transcript on the home page quotes the')
    console.error('  suite\'s own counts, so "1037 tests in the suite" becomes 1057 and the')
    console.error('  block moves. A test under packages/ is in MANIFEST.lock and rebuilds')
    console.error('  the report; one under test/ was not, until REPORT_INPUTS in the')
    console.error('  Makefile started listing it.')
    console.error('')
    console.error('  The transcript itself moves too, and it is rewritten by `make verify`.')
    console.error('  So regenerate in that order, or the report you build against is the')
    console.error('  previous one and this fails again for a different reason:')
    console.error('')
    console.error('    make verify && make web-build && node tools/gen-csp.mjs')
    process.exit(1)
  }
  console.log(`gen-csp: vercel.json matches the build (${hashes.length} inline script hashes)`)
} else {
  writeFileSync(VERCEL_JSON, serialized)
  console.log(`gen-csp: wrote vercel.json with ${hashes.length} inline script hashes`)
  console.log(`  ${csp.slice(0, 100)}...`)
}
