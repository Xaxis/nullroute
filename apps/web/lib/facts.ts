import { readRepoFile } from './repo'

/**
 * The numbers on the home page, read from the real verification report at build
 * time rather than typed into the markup.
 *
 * A site that hand-writes "85 invariants" is asserting something it did not
 * check, and it will be wrong within a week. Reading the report means the
 * figures are either current or the build fails, which is the same standard the
 * rest of the project holds itself to. It would be strange to claim everything
 * here is machine-checked on a page whose own claims were not.
 */

/**
 * The three states a check can be in.
 *
 * `not-applicable` is a distinct state on purpose and must never be folded into
 * `passed`. The verifier's own CLI is emphatic about this: a check with nothing
 * to do has not earned the word "passed", and reporting it that way would claim
 * assurance the project does not have. The site inherits that rule, because the
 * site is where the claim actually reaches someone.
 */
export type CheckStatus = 'passed' | 'failed' | 'not-applicable'

interface VerificationReport {
  readonly rootHash: string
  readonly specCount: number
  readonly invariantCount: number
  readonly passed: boolean
  readonly checks: readonly {
    readonly name: string
    readonly detail: string
    readonly status: CheckStatus
  }[]
  readonly coverage: { readonly runtimeExports: number; readonly covered: number }
  readonly invariants: readonly unknown[]
  readonly specs: readonly { readonly id: string; readonly status: string }[]
}

export interface Check {
  readonly name: string
  readonly detail: string
  readonly status: CheckStatus
}

export interface Facts {
  readonly rootHash: string
  readonly specs: number
  readonly invariants: number
  /** Tests in the whole suite, not just the ones bound to an invariant. */
  readonly tests: number
  readonly boundTests: number
  /** Runtime exports the specs claim. Distinct from `exports`: see readFacts. */
  readonly covered: number
  readonly exports: number
  readonly files: number
  /** Whether the run as a whole passed. Rendered, not assumed. */
  readonly passed: boolean
  /**
   * The five checks, in the order the CLI prints them. The home page renders
   * these as terminal output, which is only worth doing because they are the
   * real results: a hand-drawn terminal showing invented passes would be the
   * exact species of decorative lie this project is arguing against.
   */
  readonly checks: readonly Check[]
  /**
   * Which modules exist, by spec id.
   *
   * This is how the page avoids lying about what is built. Sentences like
   * "there is no encrypted store yet" are true until the moment they are not,
   * and a hand-written one goes stale silently on the day the feature lands.
   * Asking the report which specs exist means the claim is checked against the
   * repository on every build, the same way the counts are.
   */
  readonly has: (specId: string) => boolean
}

/** Pull an integer out of a check's human-readable detail line. */
function digit(detail: string, pattern: RegExp): number {
  const match = pattern.exec(detail)
  const value = Number(match?.[1] ?? NaN)
  if (!Number.isFinite(value)) {
    throw new Error(
      `nullroute.diy: could not read a figure matching ${String(pattern)} out of "${detail}". ` +
        `The verify CLI changed its output and the home page would render a wrong number.`
    )
  }
  return value
}

const VALID_STATUS: readonly string[] = ['passed', 'failed', 'not-applicable']

export function readFacts(): Facts {
  // The report is generated, not committed, so a clean checkout does not have
  // one until `make verify` has run. Say that, rather than letting a reader of
  // the build log work backwards from ENOENT on a path they have never heard of.
  let text: string
  try {
    text = readRepoFile('verification-report.json')
  } catch {
    throw new Error(
      'nullroute.diy: verification-report.json is missing. The home page renders ' +
        'the real figures from the last verification run, so the site cannot be ' +
        'built without one. Run `make verify` first (the `web-build` target does ' +
        'this for you).'
    )
  }

  // Not parsed as `any`. A shape mismatch should surface here, at build time,
  // rather than as `undefined` rendered into a paragraph about rigour.
  const raw: unknown = JSON.parse(text)
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('nullroute.diy: verification-report.json is not an object.')
  }
  const report = raw as VerificationReport

  if (typeof report.passed !== 'boolean') {
    throw new Error(
      'nullroute.diy: verification report has no boolean `passed`. The page renders ' +
        'the outcome rather than assuming it, so there is nothing safe to show without it.'
    )
  }

  const detail = (name: string): string => {
    const check = report.checks.find((c) => c.name === name)
    if (check === undefined) {
      throw new Error(`nullroute.diy: verification report has no "${name}" check.`)
    }
    return check.detail
  }

  const invariants = detail('invariants')

  // `Array.isArray` on a typed field widens the elements to `any`, so the
  // entries are read back out as `unknown` and checked. This is build-time data
  // from our own tool, but a field that silently became `any` is how a typo in
  // a spec id would turn into a capability claim that is quietly always false.
  const rawSpecs: unknown = report.specs
  if (!Array.isArray(rawSpecs)) {
    throw new Error(
      'nullroute.diy: the verification report has no `specs` array. The home page derives ' +
        'what the device can do from which specs exist, so it cannot be rendered without it.'
    )
  }
  const implemented = new Set<string>()
  for (const entry of rawSpecs as readonly unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue
    const { id, status } = entry as { id?: unknown; status?: unknown }
    if (status === 'implemented' && typeof id === 'string') implemented.add(id)
  }
  if (implemented.size === 0) {
    throw new Error(
      'nullroute.diy: the verification report lists no implemented specs. Every capability ' +
        'claim on the home page would render as "not built", which is certainly wrong.'
    )
  }

  return {
    rootHash: report.rootHash,
    specs: report.specCount,
    invariants: report.invariantCount,
    boundTests: digit(invariants, /bound to (\d+) tests/),
    tests: digit(invariants, /(\d+) tests in the suite/),
    // Two different numbers. Rendering `exports` on both sides of a ratio, as
    // an earlier version did, produces a figure that reads as a measurement and
    // is arithmetically incapable of being anything but perfect.
    covered: report.coverage.covered,
    exports: report.coverage.runtimeExports,
    files: digit(detail('integrity'), /(\d+) files/),
    passed: report.passed,
    has: (specId: string) => implemented.has(specId),
    checks: report.checks.map((c) => {
      // An unrecognised status must not quietly render as anything. The whole
      // point of carrying this field is that the page stops being able to show
      // a green run that did not happen.
      if (!VALID_STATUS.includes(c.status)) {
        throw new Error(
          `nullroute.diy: check "${c.name}" has unknown status "${c.status}". ` +
            `Expected one of ${VALID_STATUS.join(', ')}.`
        )
      }
      return { name: c.name, detail: c.detail, status: c.status }
    }),
  }
}
