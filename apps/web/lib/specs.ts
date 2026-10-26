import { readRepoFile } from './repo'

/**
 * One invariant, copied verbatim out of the spec file that declares it.
 *
 * VERBATIM, because the point of showing it is that this is what the build
 * reads. A paraphrase would be a description of a spec rather than a spec, and
 * the reader could not tell whether the two agree.
 */
export function invariantExcerpt(specFile: string, id: string): string {
  const lines = readRepoFile(specFile).split('\n')
  const start = lines.findIndex((line) => line === `  - id: ${id}`)
  if (start < 0) throw new Error(`nullroute.diy: ${specFile} declares no ${id}.`)
  let end = start + 1
  while (end < lines.length && !/^ {2}- id: |^\S/.test(lines[end] ?? '')) end += 1
  while (end > start && (lines[end - 1] ?? '').trim() === '') end -= 1
  return lines.slice(start, end).join('\n')
}
