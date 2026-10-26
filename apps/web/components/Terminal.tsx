import type { Check, CheckStatus, Facts } from '../lib/facts'

/**
 * `make verify`, as it printed on the run this site was built from.
 *
 * EVERY STATUS IS READ, NONE IS DRAWN. This component once hardcoded `ok` and
 * "verification passed", which is the exact species of decorative lie the
 * project argues against: a terminal that shows a pass whether or not one
 * happened. The marks and the closing line come from verification-report.json,
 * and `not-applicable` stays its own state rather than being folded into
 * `passed`, because a check with nothing to do has not earned the word.
 */
export const MARK: Record<CheckStatus, { glyph: string; className: string }> = {
  passed: { glyph: 'ok', className: 'text-verify' },
  failed: { glyph: 'FAIL', className: 'text-caution' },
  'not-applicable': { glyph: 'n/a', className: 'text-muted' },
}

const GLYPH_WIDTH = 4

export function Terminal({ facts }: { facts: Facts }) {
  // Aligned in a monospace column, the way the CLI aligns it.
  const width = Math.max(...facts.checks.map((c) => c.name.length)) + 4

  return (
    <div
      className="rounded-[4px] border border-line bg-sunk overflow-x-auto"
      tabIndex={0}
      role="region"
      aria-label="Output of make verify"
    >
      <pre className="transcript px-4 py-4 sm:px-5 min-w-max">
        <span className="prompt">$ </span>
        <span className="cmd">make verify</span>
        {'\n\n'}
        <span className="text-ink">nullroute verification</span>
        {'\n\n'}
        {facts.checks.map((check: Check) => {
          const mark = MARK[check.status]
          return (
            <span key={check.name}>
              {'  '}
              <span className={mark.className}>{mark.glyph.padEnd(GLYPH_WIDTH)}</span>
              {'  '}
              <span className="text-ink">{check.name.padEnd(width)}</span>
              {check.detail}
              {'\n'}
            </span>
          )
        })}
        {'\n'}
        {'  '}
        {facts.specs} specs, {facts.invariants} invariants
        {'\n'}
        {'  manifest root  '}
        <span className="text-ink">{facts.rootHash}</span>
        {'\n\n'}
        <span className={facts.passed ? 'text-verify' : 'text-caution'}>
          {facts.passed ? 'verification passed' : 'verification FAILED'}
        </span>
      </pre>
    </div>
  )
}
