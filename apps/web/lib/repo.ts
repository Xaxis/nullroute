import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/**
 * Resolve the repository root, and fail loudly if it cannot be found.
 *
 * docs/ lives at the repository root because the documentation is the product
 * and this site is one renderer of it. The site workspace is two levels down.
 *
 * `process.cwd()` is the only reliable anchor here: `new URL(..., import.meta.url)`
 * is statically analysed by the bundler as an asset reference and does not
 * survive the build. But cwd differs between `next dev`, `next build`, and a CI
 * container, so rather than assuming it is `apps/web`, this walks upward until
 * it finds the marker and throws if it does not.
 *
 * Throwing matters. The failure mode this replaces is a page that renders
 * completely empty with a green build, which is exactly the kind of silent
 * wrongness the rest of this project exists to rule out.
 */
const MARKER = 'docs/THREAT-MODEL.md'

function findRepoRoot(start: string): string {
  let dir = resolve(start)
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(dir, MARKER))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(
    `nullroute.space: could not locate the repository root from ${start}. ` +
      `Looked upward for ${MARKER}. The site renders docs/ from the repo root, ` +
      `so without it every documentation page would build empty.`
  )
}

export const REPO_ROOT = findRepoRoot(process.cwd())

/**
 * Read a repo-relative file. Rejects absolute paths and traversal, so a route
 * parameter can never be turned into an arbitrary file read at build time.
 */
export function readRepoFile(relativePath: string): string {
  if (relativePath.startsWith('/') || relativePath.split('/').includes('..')) {
    throw new Error(`readRepoFile: refusing suspicious path ${relativePath}`)
  }
  return readFileSync(join(REPO_ROOT, relativePath), 'utf8')
}

export function repoPath(relativePath: string): string {
  return join(REPO_ROOT, relativePath)
}
