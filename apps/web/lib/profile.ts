import { createHash } from 'node:crypto'
import { readdirSync } from 'node:fs'
import { readRepoFile, repoPath } from './repo'

/**
 * The signer profile and its conformance kit, read from the repository.
 *
 * This is the part of the project that is useful to every other signer, so it
 * is the part the site has to be most careful not to embellish. Every count
 * below is computed from the files that define it: requirements from the
 * profile's own text, cases from the vector files, sources from the table in
 * conformance/README.md, and results from the run's own report. Nothing is
 * typed into a page.
 */

const PROFILE = 'spec/signer-profile.md'
const VECTORS = 'spec/vectors/signer-profile'
const KIT_README = 'conformance/README.md'
/** A private-use character, which no table in this repository contains. */
const ESCAPED_PIPE = '\uE000'

export interface ProfileHeader {
  /** "0.1", from "Draft specification, version 0.1, 24 September 2026." */
  readonly version: string
  /**
   * The latest date in the header line and the change log (section 9). The
   * header keeps the first date while the draft is amended under the same
   * version, so without this a reader would take a September date to mean
   * nothing has moved.
   */
  readonly changed: string
}

export interface RequirementArea {
  /** SP-ENT, SP-REV, ... */
  readonly prefix: string
  /** The section heading the requirements sit under, without its number. */
  readonly title: string
  readonly requirements: readonly string[]
}

export interface ConformanceRow {
  readonly id: string
  /** The profile's own words: "Met", "Unverified until bring-up", ... */
  readonly status: string
}

export interface VectorFile {
  readonly file: string
  readonly requirements: readonly string[]
  readonly operations: string
  readonly description: string
  readonly cases: number
  /** Where the expected values came from, from conformance/README.md. */
  readonly sources: string
}

export interface KitResult {
  readonly file: string
  readonly cases: number
  readonly pass: number
  readonly known: number
  readonly fail: number
  readonly notRun: number
}

/**
 * A signer other than nullroute, run against the same vectors by its own
 * adapter, from the report in conformance/results/.
 */
export interface OtherSigner {
  /** "SeedSigner", the first word of the adapter's name. */
  readonly label: string
  /** "SeedSigner 088b144e with embit 0.8.0", as the adapter names itself. */
  readonly name: string
  /** The report's path in the repository, for a link to it. */
  readonly report: string
  readonly results: readonly KitResult[]
}

/**
 * Findings from running another signer, from the table under its heading in
 * conformance/README.md: what it does, the requirement, and what that asks of
 * the profile.
 */
export interface Finding {
  readonly finding: string
  readonly requirement: string
  readonly question: string
}

export interface Profile {
  readonly header: ProfileHeader
  readonly areas: readonly RequirementArea[]
  readonly requirementCount: number
  readonly conformance: readonly ConformanceRow[]
  readonly vectors: readonly VectorFile[]
  readonly caseCount: number
  readonly sha256sums: string
  /** SHA-256 of SHA256SUMS itself, which pins the whole vector set. */
  readonly sha256sumsDigest: string
  readonly results: readonly KitResult[]
  readonly others: readonly OtherSigner[]
  /** By the other signer's label. */
  readonly findings: ReadonlyMap<string, readonly Finding[]>
}

/**
 * The seven areas, in the profile's own words for them. Named here rather
 * than read from the headings, because signing is a subsection of the
 * pre-signing review chapter and a heading-based reader called SP-SIG "Pre-
 * signing review". A prefix this map does not know stops the build, so a new
 * area cannot appear on the site without a name.
 */
const AREA_NAMES: Readonly<Record<string, string>> = {
  'SP-ENT': 'Entropy',
  'SP-REV': 'Pre-signing review',
  'SP-SIG': 'Signing',
  'SP-ATT': 'Attestation',
  'SP-HW': 'Hardware',
  'SP-TX': 'Transport',
  'SP-DEP': 'Dependencies',
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** "23 November 2026" as a sortable number, refusing anything else. */
function dayNumber(date: string): number {
  const [day, month, year] = date.split(' ')
  const m = MONTHS.indexOf(month ?? '')
  if (m < 0 || !/^\d{1,2}$/.test(day ?? '') || !/^\d{4}$/.test(year ?? '')) {
    throw new Error(`nullroute.diy: ${PROFILE} has a date that is not "day Month year": ${date}`)
  }
  return Number(year) * 10000 + (m + 1) * 100 + Number(day)
}

function readHeader(text: string): ProfileHeader {
  const match = /^(Draft specification, version ([\d.]+), (\d{1,2} \w+ \d{4})\.)/m.exec(text)
  if (match === null) {
    throw new Error(`nullroute.diy: ${PROFILE} has no "Draft specification, version ..." line.`)
  }
  const date = match[3] ?? ''
  const log = text.indexOf('\n## 9. Change log\n')
  if (log < 0) throw new Error(`nullroute.diy: ${PROFILE} has no "## 9. Change log" section.`)
  const logged = [...text.slice(log).matchAll(/^\| [\d.]+ \| (\d{1,2} \w+ \d{4}) \|/gm)].map(
    (m) => m[1] ?? ''
  )
  if (logged.length === 0) throw new Error(`nullroute.diy: ${PROFILE}'s change log has no rows.`)
  const changed = [date, ...logged].reduce((a, b) => (dayNumber(b) > dayNumber(a) ? b : a))
  return { version: match[2] ?? '', changed }
}

/** The "Sources" column of the vector table, by file name. */
function readSources(): Map<string, string> {
  const text = readRepoFile(KIT_README)
  const sources = new Map<string, string>()
  for (const line of text.split('\n')) {
    // An escaped pipe inside a cell (`\|`) is text, not a column break, so it
    // is set aside for the split and put back after.
    const match = /^\|\s*`([a-z0-9-]+\.json)`\s*\|\s*\d+\s*\|[^|]*\|\s*(.+?)\s*\|\s*$/.exec(
      line.replaceAll('\\|', ESCAPED_PIPE)
    )
    if (match === null) continue
    sources.set(match[1] ?? '', (match[2] ?? '').replaceAll(ESCAPED_PIPE, '|'))
  }
  return sources
}

interface RawVectorDoc {
  readonly requirements?: unknown
  readonly operations?: unknown
  readonly description?: unknown
  readonly cases?: unknown
}

interface RawResult {
  readonly file?: unknown
  readonly cases?: unknown
  readonly pass?: unknown
  readonly known?: unknown
  readonly fail?: unknown
  readonly notRun?: unknown
}

interface RawReport {
  readonly format?: unknown
  readonly adapter?: unknown
  readonly vectorsSha256sums?: unknown
  readonly only?: unknown
  readonly files?: unknown
  readonly passed?: unknown
}

function readResults(
  sumsDigest: string,
  path = 'conformance-report.json',
  rerun = 'make conformance'
): {
  adapter: string
  results: KitResult[]
} {
  let text: string
  try {
    text = readRepoFile(path)
  } catch {
    throw new Error(
      `nullroute.diy: ${path} is missing. The profile section renders the ` +
        'conformance run per vector file, so the site cannot be built without one. Run ' +
        `\`${rerun}\` first.`
    )
  }
  const report = JSON.parse(text) as RawReport
  if (report.format !== 'signer-profile-conformance-report') {
    throw new Error(`nullroute.diy: ${path} is not a conformance report.`)
  }
  // A RESULT AGAINST OTHER VECTORS IS NOT A RESULT. The report carries the hash
  // of the SHA256SUMS it ran against; if the vectors have moved since, the
  // pass it records was earned against a different test, and quoting it would
  // be exactly the stale claim this site exists to avoid.
  if (report.vectorsSha256sums !== sumsDigest) {
    throw new Error(
      `nullroute.diy: ${path} was produced against a different vector set ` +
        `than the one on disk. Run \`${rerun}\` again.`
    )
  }
  if (report.only !== null) {
    throw new Error(`nullroute.diy: ${path} covers one file only (--only).`)
  }
  if (!Array.isArray(report.files) || typeof report.passed !== 'boolean') {
    throw new Error(`nullroute.diy: ${path} has no files or no outcome.`)
  }
  const results = (report.files as readonly RawResult[]).map((f) => ({
    file: typeof f.file === 'string' ? f.file : '',
    cases: Number(f.cases),
    pass: Number(f.pass),
    known: Number(f.known),
    fail: Number(f.fail),
    notRun: Number(f.notRun),
  }))
  return {
    adapter: typeof report.adapter === 'string' ? report.adapter : '',
    results,
  }
}

const OTHER_RESULTS = 'conformance/results'

/**
 * Every other signer's last run. Each report is held to the same rules as
 * nullroute's: against these vectors exactly, every file, or the build stops.
 * The make target that wrote it is named in the error, since it needs the
 * network and the site build does not run it.
 */
function readOthers(sumsDigest: string): OtherSigner[] {
  return readdirSync(repoPath(OTHER_RESULTS))
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const path = `${OTHER_RESULTS}/${name}`
      const run = readResults(sumsDigest, path, `make conformance-${name.replace(/\.json$/, '')}`)
      const label = run.adapter.split(' ')[0] ?? ''
      if (label === '' || label.toLowerCase() !== name.replace(/\.json$/, '')) {
        throw new Error(`nullroute.diy: ${path} names its adapter "${run.adapter}", not ${name}.`)
      }
      return {
        label,
        name: run.adapter,
        report: path,
        results: run.results,
      }
    })
}

/**
 * The findings table under a signer's heading in conformance/README.md
 * ("### SeedSigner"), so the page and the kit say the same thing.
 */
function readFindings(label: string): Finding[] {
  const text = readRepoFile(KIT_README)
  const start = text.indexOf(`\n### ${label}\n`)
  if (start < 0) throw new Error(`nullroute.diy: ${KIT_README} has no "### ${label}" section.`)
  const rest = text.slice(start + 1)
  const end = rest.search(/\n##+ /)
  const section = end < 0 ? rest : rest.slice(0, end)
  const rows = section
    .split('\n')
    .filter(
      (line) => line.startsWith('| ') && !line.startsWith('| Finding') && !line.startsWith('| ---')
    )
    .map((line) =>
      line
        .replaceAll('\\|', ESCAPED_PIPE)
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim().replaceAll(ESCAPED_PIPE, '|'))
    )
  if (rows.length === 0 || rows.some((r) => r.length !== 3)) {
    throw new Error(
      `nullroute.diy: the findings table under "### ${label}" is missing or malformed.`
    )
  }
  return rows.map(([finding, requirement, question]) => ({
    finding: finding ?? '',
    requirement: requirement ?? '',
    question: question ?? '',
  }))
}

export function readProfile(): Profile {
  const text = readRepoFile(PROFILE)
  const header = readHeader(text)

  const ids = [...text.matchAll(/^\*\*(SP-[A-Z]+-\d+)\.\*\*/gm)].map((m) => m[1] ?? '')
  if (ids.length === 0) throw new Error(`nullroute.diy: read no requirements from ${PROFILE}.`)
  if (new Set(ids).size !== ids.length) {
    throw new Error(`nullroute.diy: ${PROFILE} declares a requirement id twice.`)
  }
  const order = [...new Set(ids.map((id) => id.replace(/-\d+$/, '')))]
  const areas = order.map((prefix) => {
    const title = AREA_NAMES[prefix]
    if (title === undefined) {
      throw new Error(
        `nullroute.diy: ${PROFILE} has requirements under ${prefix}, an area the site has no name for.`
      )
    }
    return { prefix, title, requirements: ids.filter((id) => id.startsWith(`${prefix}-`)) }
  })

  const rows = [...text.matchAll(/^\|\s*(SP-[A-Z]+-\d+)\s*\|\s*([^|]+?)\s*\|/gm)].map((m) => ({
    id: m[1] ?? '',
    status: m[2] ?? '',
  }))
  // A requirement with no row in any conformance table has not been assessed,
  // which is a status in its own right. Counting it as nothing would make an
  // area look fully met by leaving one out.
  const conformance = ids.map((id) => rows.find((r) => r.id === id) ?? { id, status: NOT_ASSESSED })

  const sources = readSources()
  const files = readdirSync(repoPath(VECTORS))
    .filter((name) => name.endsWith('.json'))
    .sort()
  const vectors = files.map((file) => {
    const doc = JSON.parse(readRepoFile(`${VECTORS}/${file}`)) as RawVectorDoc
    const source = sources.get(file)
    // The table is the one place a reader is told where each file's expected
    // values came from. A vector file it does not describe is a claim the
    // site would have to make without a source, so the build refuses.
    if (source === undefined) {
      throw new Error(
        `nullroute.diy: ${KIT_README} has no row for ${file}, so the site cannot say where ` +
          `its expected values came from. Add the row.`
      )
    }
    if (!Array.isArray(doc.cases) || !Array.isArray(doc.requirements)) {
      throw new Error(`nullroute.diy: ${VECTORS}/${file} has no cases or requirements.`)
    }
    return {
      file,
      requirements: doc.requirements.map(String),
      operations: typeof doc.operations === 'string' ? doc.operations : '',
      description: typeof doc.description === 'string' ? doc.description : '',
      cases: doc.cases.length,
      sources: source,
    }
  })

  const sha256sums = readRepoFile(`${VECTORS}/SHA256SUMS`)
  const sumsDigest = createHash('sha256').update(sha256sums).digest('hex')
  const { results } = readResults(sumsDigest)
  const others = readOthers(sumsDigest)
  for (const run of [{ report: 'conformance-report.json', results }, ...others]) {
    for (const v of vectors) {
      const r = run.results.find((x) => x.file === v.file)
      if (r?.cases !== v.cases) {
        throw new Error(`nullroute.diy: ${run.report} does not cover ${v.file} as it is.`)
      }
    }
  }
  const findings = new Map(others.map((o) => [o.label, readFindings(o.label)]))

  return {
    header,
    areas,
    requirementCount: ids.length,
    conformance,
    vectors,
    caseCount: vectors.reduce((n, v) => n + v.cases, 0),
    sha256sums,
    sha256sumsDigest: sumsDigest,
    results,
    others,
    findings,
  }
}

/** The status of a requirement that no conformance table mentions. */
export const NOT_ASSESSED = 'No row in the profile\u2019s conformance tables'

/** How a conformance status reads at a glance: met, met with a caveat, or open. */
export function statusKind(status: string): 'met' | 'qualified' | 'open' {
  if (/^Met$/.test(status) || /^Met, (including|more strictly)/.test(status)) return 'met'
  if (/^Met\b/.test(status)) return 'qualified'
  return 'open'
}
