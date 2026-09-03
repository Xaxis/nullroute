#!/usr/bin/env node
/**
 * Two clean builds of the same commit must produce byte-identical output.
 *
 * This is the check the manifest root hash rests on. If the build is not
 * reproducible then a third party cannot arrive at the same number, the root
 * hash on the lock screen is unverifiable, and every claim in
 * docs/VERIFICATION.md collapses.
 *
 * Running it on every commit rather than at release time is deliberate: a
 * reproducibility regression (an embedded timestamp, a filesystem-ordering
 * dependency, an absolute path leaking into output) gets caught at the commit
 * that introduced it, when someone still remembers why they wrote it.
 *
 * Run: node tools/checks/check-reproducible.mjs
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync, rmSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const PACKAGES = ['packages/core', 'packages/verify']

function run(cmd, args) {
  execFileSync(cmd, args, { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' })
}

function walk(dir, found = []) {
  if (!existsSync(dir)) return found
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, found)
    else found.push(full)
  }
  return found
}

/** A map of repo-relative path to content hash, over every package's dist. */
function snapshot() {
  const out = new Map()
  for (const pkg of PACKAGES) {
    for (const file of walk(join(ROOT, pkg, 'dist'))) {
      const rel = relative(ROOT, file).replaceAll('\\', '/')
      out.set(rel, createHash('sha256').update(readFileSync(file)).digest('hex'))
    }
  }
  return out
}

function cleanBuild() {
  for (const pkg of PACKAGES) {
    rmSync(join(ROOT, pkg, 'dist'), { recursive: true, force: true })
  }
  // tsc --build skips work when its incremental state says the output is fresh,
  // so the buildinfo has to go too or the second pass is a no-op and the check
  // passes without having built anything.
  for (const info of walk(join(ROOT, 'packages'))) {
    if (info.endsWith('.tsbuildinfo')) rmSync(info, { force: true })
  }
  rmSync(join(ROOT, 'tsconfig.tsbuildinfo'), { force: true })
  run('npx', ['tsc', '--build', 'tsconfig.build.json'])
}

console.log('check-reproducible: first build')
cleanBuild()
const first = snapshot()

console.log('check-reproducible: second build')
cleanBuild()
const second = snapshot()

const problems = []

for (const [path, hash] of first) {
  const other = second.get(path)
  if (other === undefined) problems.push(`only in the first build: ${path}`)
  else if (other !== hash) problems.push(`differs between builds: ${path}`)
}
for (const path of second.keys()) {
  if (!first.has(path)) problems.push(`only in the second build: ${path}`)
}

if (first.size === 0) {
  console.error('check-reproducible: the build produced no output at all')
  process.exit(1)
}

if (problems.length > 0) {
  console.error(`check-reproducible: ${problems.length} difference(s) across ${first.size} files\n`)
  for (const p of problems.slice(0, 20)) console.error(`  ${p}`)
  console.error(
    '\n  The manifest root hash is only meaningful if a third party can arrive at the\n' +
      '  same number. Something in the build depends on time, on absolute paths, or on\n' +
      '  filesystem ordering. See docs/VERIFICATION.md section 2.'
  )
  process.exit(1)
}

// One number over the whole tree, comparable by eye against a previous run.
const rootHash = createHash('sha256')
for (const path of [...first.keys()].sort()) rootHash.update(`${first.get(path)}  ${path}\n`)

console.log(
  `check-reproducible: ${first.size} files identical across two clean builds\n` +
    `  build digest ${rootHash.digest('hex')}`
)
