import { readRepoFile } from './repo'

/**
 * What the interop fixtures cover, counted from spec/interop/README.md.
 *
 * The README is the record: one row per real file, with where it came from,
 * its hash and what nullroute does with it. The site counts the rows under
 * each heading and the numbered gaps rather than restating either, so a
 * fixture added or a gap closed moves the page without anyone editing it.
 */
export interface InteropGroup {
  readonly title: string
  readonly files: number
}

export function readInterop(): { readonly groups: readonly InteropGroup[]; readonly gaps: number } {
  const text = readRepoFile('spec/interop/README.md')
  const groups: InteropGroup[] = []
  let title: string | undefined
  let files = 0
  const flush = (): void => {
    if (title !== undefined && files > 0) groups.push({ title, files })
  }
  for (const line of text.split('\n')) {
    const heading = /^#{2,3} (.+)$/.exec(line)
    if (heading !== null) {
      flush()
      title = (heading[1] ?? '').trim()
      files = 0
      continue
    }
    // A file row names its path in backticks in the first cell. Sparrow's
    // licence is kept beside its files and is not an export.
    if (/^\| `[^`]+` \|/.test(line) && !line.startsWith('| `sparrow/LICENSE`')) files += 1
  }
  flush()
  const gapsAt = text.indexOf('\n## Gaps\n')
  const gaps = gapsAt < 0 ? 0 : [...text.slice(gapsAt).matchAll(/^\d+\. \*\*/gm)].length
  if (groups.length === 0) {
    throw new Error('nullroute.diy: read no fixture rows from spec/interop/README.md.')
  }
  return { groups, gaps }
}
