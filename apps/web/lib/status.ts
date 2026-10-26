import { readRepoFile } from './repo'

/**
 * The phases and their state, read out of the README's status table.
 *
 * ONE TABLE, TWO RENDERINGS. The README is where the phase state is decided
 * and reviewed, and a second copy typed into the site would agree with it
 * until the first phase moved. Parsing it means the site cannot claim a phase
 * the README does not, and a README edit that breaks the table's shape breaks
 * the build rather than the page.
 */

export type PhaseState = 'complete' | 'partial' | 'not-started'

export interface Phase {
  readonly number: number
  readonly scope: string
  /** The README's own words for the state, markdown emphasis removed. */
  readonly state: string
  readonly kind: PhaseState
}

const ROW = /^\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$/

export function readPhases(): readonly Phase[] {
  const readme = readRepoFile('README.md')
  const start = readme.indexOf('\n## Status\n')
  if (start < 0) {
    throw new Error('nullroute.diy: README.md has no "## Status" section to read the phases from.')
  }
  const section = readme.slice(start, readme.indexOf('\n## ', start + 1))
  const phases: Phase[] = []
  for (const line of section.split('\n')) {
    const match = ROW.exec(line)
    if (match === null) continue
    const [, number = '', scope = '', rawState = ''] = match
    const state = rawState.replace(/\*\*/g, '').trim()
    const kind: PhaseState = /^Complete\b/.test(state)
      ? /except|but/.test(state)
        ? 'partial'
        : 'complete'
      : state.startsWith('Not started')
        ? 'not-started'
        : 'partial'
    phases.push({ number: Number(number), scope, state, kind })
  }
  if (phases.length !== 7 || phases.some((p, i) => p.number !== i + 1)) {
    throw new Error(
      `nullroute.diy: expected phases 1 to 7 in README.md's status table, read ${String(phases.length)}.`
    )
  }
  return phases
}

export interface Part {
  readonly part: string
  readonly what: string
  readonly notes: string
}

/**
 * The parts list, read out of the README's "What you need to build one" table
 * for the same reason as the phases: one table, decided in one place.
 */
export function readParts(): { readonly parts: readonly Part[]; readonly cost: string } {
  const readme = readRepoFile('README.md')
  const start = readme.indexOf('\n## What you need to build one\n')
  if (start < 0) throw new Error('nullroute.diy: README.md has no parts section.')
  const section = readme.slice(start, readme.indexOf('\n## ', start + 1))
  const cost = /^Roughly (\$\d+ to \$\d+)\.$/m.exec(section)?.[1]
  const parts: Part[] = []
  for (const line of section.split('\n')) {
    const match = /^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(.+?)\s*\|\s*$/.exec(line)
    if (match === null) continue
    const [, part = '', what = '', notes = ''] = match
    if (part === 'Part' || /^-+$/.test(part)) continue
    parts.push({ part, what, notes })
  }
  if (cost === undefined || parts.length < 5) {
    throw new Error('nullroute.diy: could not read the parts table and its cost from README.md.')
  }
  return { parts, cost }
}

export interface LogEntry {
  readonly date: string
  /** Markdown, as written: bold and code spans only. */
  readonly text: string
}

/**
 * Dated milestones from CHANGELOG.md, newest first, as the file orders them.
 * Read rather than retyped, and from a file rather than `git log`, because CI
 * checks out one commit and a local deploy has the whole history: a page built
 * from the log would differ between the two and fail the CSP check that pins
 * its scripts.
 */
export function readLog(): readonly LogEntry[] {
  const text = readRepoFile('CHANGELOG.md')
  const entries: LogEntry[] = []
  for (const block of text.split('\n- ').slice(1)) {
    const match = /^\*\*(\d{4}-\d{2}-\d{2})\*\*\s+([\s\S]+?)(?:\n\n|\n##|$)/.exec(block)
    if (match === null) continue
    entries.push({ date: match[1] ?? '', text: (match[2] ?? '').replace(/\s*\n\s*/g, ' ').trim() })
  }
  if (entries.length === 0)
    throw new Error('nullroute.diy: read no dated entries from CHANGELOG.md.')
  return entries
}
