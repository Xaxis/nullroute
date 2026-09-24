/**
 * What the verifier's checks add up to, for the two screens that report it.
 *
 * Spec: ui.screens.lock, INV-UI-53 and INV-UI-70
 *
 * A PASS IS `passed` AND NOTHING ELSE. `not-applicable` used to count as one,
 * so a device where two of three checks had nothing to check said "All 3 checks
 * passed", and a device reporting no checks at all said "All 0 checks passed"
 * with Open a wallet enabled. A check that did not run is not a failure, which
 * is why it does not block, and it is not a pass either, which is why it is
 * named rather than counted.
 *
 * A verdict with nothing passed is a failure. Zero checks means the verifier
 * said nothing, and every check being not applicable means it verified nothing,
 * and "Verified" would be a claim about neither.
 */

export interface CheckView {
  readonly name: string
  readonly status: string
  readonly detail: string
}

export interface Verdict {
  readonly verified: boolean
  readonly passed: readonly CheckView[]
  /** Checks that had nothing to check here. Neither a pass nor a failure. */
  readonly notApplicable: readonly CheckView[]
  /** Everything else, including any status this file does not recognise. */
  readonly failing: readonly CheckView[]
  /** Why it is not verified, one entry per reason, or empty when it is. */
  readonly reasons: readonly string[]
}

export function judge(checks: readonly CheckView[]): Verdict {
  const passed = checks.filter((check) => check.status === 'passed')
  const notApplicable = checks.filter((check) => check.status === 'not-applicable')
  const failing = checks.filter(
    (check) => check.status !== 'passed' && check.status !== 'not-applicable'
  )

  const reasons = failing.map((check) =>
    // An unrecognised status is named, because "integrity failed" and "nobody
    // here knows what integrity said" are different problems and the second
    // one is worse.
    check.status === 'failed' ? check.name : `${check.name} (status: ${check.status})`
  )
  if (failing.length === 0 && passed.length === 0) {
    reasons.push(checks.length === 0 ? 'no checks were reported' : 'no check had anything to check')
  }

  return { verified: reasons.length === 0, passed, notApplicable, failing, reasons }
}

/** The sentence under "Verified": what passed, and what was not applicable. */
export function passSentence(verdict: Verdict): string {
  const count = verdict.passed.length
  const passed =
    verdict.notApplicable.length === 0
      ? `All ${String(count)} ${count === 1 ? 'check' : 'checks'} passed against this build.`
      : `${String(count)} ${count === 1 ? 'check' : 'checks'} passed against this build.`
  if (verdict.notApplicable.length === 0) return passed
  const names = verdict.notApplicable.map((check) => check.name).join(', ')
  return `${passed} Not applicable here: ${names}.`
}
