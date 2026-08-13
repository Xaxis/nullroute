/**
 * Check 2: every declared invariant binds to a test that exists and passed.
 *
 * THE RULE THAT MATTERS: this module asserts the status of each individual
 * test. It does NOT infer success from vitest's exit code or from the report's
 * top-level `success` flag.
 *
 * The reason is a hole that is trivially easy to fall into. Change one `it(...)`
 * to `it.skip(...)` while debugging and vitest still exits 0, still reports
 * `success: true`, and still reports `numFailedTests: 0`. A verify CLI that
 * checked the exit code would certify an invariant that never executed. Since
 * the whole spec system rests on invariant-to-test binding, that single line
 * would quietly hollow out the entire guarantee.
 *
 * So: whitelist `passed`. The status union also contains failed, skipped,
 * pending, todo, and disabled, and every one of those means the invariant is
 * unproven.
 */

import { readFileSync } from 'node:fs'
import { relative, isAbsolute } from 'node:path'

/** The subset of vitest's JSON reporter output we depend on. */
interface AssertionResult {
  readonly ancestorTitles: string[]
  readonly title: string
  readonly fullName: string
  readonly status: string
}

interface FileResult {
  /** Absolute path as vitest emits it. */
  readonly name: string
  readonly assertionResults: AssertionResult[]
}

interface VitestReport {
  readonly testResults: FileResult[]
  readonly numTotalTests: number
}

/**
 * The statuses vitest reports, plus the two resolution failures verify adds.
 *
 * Enumerated rather than widened to `string` so that a new vitest status cannot
 * slip through unnoticed: only `passed` is ever treated as proving an invariant,
 * and everything else has to be named here to be reported.
 */
export type BindingStatus =
  | 'passed'
  | 'failed'
  | 'skipped'
  | 'pending'
  | 'todo'
  | 'disabled'
  | 'missing'
  | 'ambiguous'
  | 'unknown'

const VITEST_STATUSES = new Set<BindingStatus>([
  'passed',
  'failed',
  'skipped',
  'pending',
  'todo',
  'disabled',
])

function asBindingStatus(raw: string): BindingStatus {
  return VITEST_STATUSES.has(raw as BindingStatus) ? (raw as BindingStatus) : 'unknown'
}

export interface TestBinding {
  readonly invariantId: string
  readonly selector: string
  readonly status: BindingStatus
  /** The raw status string, kept when it is one vitest added since this was written. */
  readonly rawStatus?: string
  readonly ok: boolean
  readonly detail?: string
}

export interface BindingResult {
  readonly bindings: readonly TestBinding[]
  readonly ok: boolean
  readonly totalTests: number
}

export class TestReportError extends Error {}

export function loadReport(path: string): VitestReport {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    throw new TestReportError(
      `verify: no test report at ${path}. Run the suite first:\n` +
        `  npx vitest run --reporter=json --outputFile=${path}`
    )
  }
  const parsed: unknown = JSON.parse(raw)
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    !Array.isArray((parsed as VitestReport).testResults)
  ) {
    throw new TestReportError(`verify: ${path} is not a vitest JSON report`)
  }
  return parsed as VitestReport
}

/**
 * Strip reporter metadata that is not part of a test's identity.
 *
 * `@fast-check/vitest` appends `(with seed=NNNN)` to the title of every
 * property test. The seed is test-run configuration, not part of what the test
 * is called, so a spec must not have to name it: otherwise changing the seed to
 * hunt for counterexamples (`FAST_CHECK_SEED=$RANDOM`) would break every spec
 * that binds to a property test.
 *
 * Matching therefore happens on the title the author wrote. Exact-match
 * uniqueness is preserved, just against the normalised form.
 */
function normalizeTitle(title: string): string {
  return title.replace(/ \(with seed=-?\d+\)$/, '')
}

/**
 * A selector is `<path>.test.ts::<segment>[ > <segment>]*`.
 *
 * The segment list is matched as a SUFFIX of `[...ancestorTitles, title]`, so
 * the terse form `::length` works while `::core.entropy.combiner > length`
 * remains available to disambiguate.
 *
 * Resolution must be UNIQUE. Zero matches and more than one match are both hard
 * failures. That is not pedantry: two tests with the same title in one file
 * produce two entries with identical fullName, and if one passed and one failed,
 * a first-match lookup would report the invariant as proven. Requiring
 * uniqueness closes that.
 */
export function resolveBinding(
  root: string,
  report: VitestReport,
  invariantId: string,
  selector: string
): TestBinding {
  const separator = selector.indexOf('::')
  if (separator === -1) {
    return {
      invariantId,
      selector,
      status: 'missing',
      ok: false,
      detail: 'selector must be <path>::<test name>',
    }
  }

  const wantFile = selector.slice(0, separator)
  const wantPath = selector
    .slice(separator + 2)
    .split('>')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  const file = report.testResults.find((f) => {
    // vitest emits absolute paths; relativize so selectors and the report's
    // root hash reproduce across machines.
    const rel = (isAbsolute(f.name) ? relative(root, f.name) : f.name).replaceAll('\\', '/')
    return rel === wantFile
  })

  if (file === undefined) {
    return {
      invariantId,
      selector,
      status: 'missing',
      ok: false,
      detail: `no test file ${wantFile} in the report`,
    }
  }

  const matches = file.assertionResults.filter((a) => {
    const full = [...a.ancestorTitles, normalizeTitle(a.title)]
    if (wantPath.length > full.length) return false
    const tail = full.slice(full.length - wantPath.length)
    return tail.every((seg, i) => seg === wantPath[i])
  })

  if (matches.length === 0) {
    return {
      invariantId,
      selector,
      status: 'missing',
      ok: false,
      detail: `no test in ${wantFile} matches "${wantPath.join(' > ')}"`,
    }
  }

  if (matches.length > 1) {
    return {
      invariantId,
      selector,
      status: 'ambiguous',
      ok: false,
      detail:
        `"${wantPath.join(' > ')}" matches ${String(matches.length)} tests in ${wantFile}. ` +
        `Qualify the selector with more ancestor titles: a duplicate title could let a ` +
        `passing test stand in for a failing one.`,
    }
  }

  const only = matches[0]
  if (only === undefined) {
    return { invariantId, selector, status: 'missing', ok: false }
  }

  // The whitelist. Anything that is not literally "passed" leaves the
  // invariant unproven, including "skipped" and "todo", which do not fail the
  // suite and would otherwise sail through.
  const passed = only.status === 'passed'
  const status = asBindingStatus(only.status)
  return {
    invariantId,
    selector,
    status,
    ...(status === 'unknown' ? { rawStatus: only.status } : {}),
    ok: passed,
    ...(passed
      ? {}
      : {
          detail: `test status is "${only.status}", not "passed". The invariant is not proven.`,
        }),
  }
}

export function checkBindings(
  root: string,
  report: VitestReport,
  invariants: readonly { id: string; tests: readonly string[] }[]
): BindingResult {
  const bindings = invariants.flatMap((inv) =>
    inv.tests.map((selector) => resolveBinding(root, report, inv.id, selector))
  )
  return {
    bindings,
    ok: bindings.every((b) => b.ok),
    totalTests: report.numTotalTests,
  }
}
