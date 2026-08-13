import type { Check, CheckStatus, Facts } from '../lib/facts'

/**
 * The verifier's own output, reconstructed from the report it wrote.
 *
 * Not a picture of a terminal and not a hand-typed transcript. Every figure and
 * every status below is read out of `verification-report.json` at build time.
 *
 * An earlier version of this component did NOT do that. It read the check names
 * and their detail lines from the report and then hardcoded the word `ok` beside
 * each one, hardcoded a green `passed` badge, and hardcoded `verification
 * passed` at the bottom, while its own comment claimed everything came from the
 * report. It was a guaranteed-green badge dressed as evidence, on a page whose
 * entire argument is that a claim you cannot check is worthless. Whoever
 * maintains this next: the status must keep coming from the data, or delete the
 * block rather than let it lie.
 *
 * Three states, not two. `not-applicable` is never rendered as `passed`,
 * because a check with nothing to do has not demonstrated anything and saying
 * otherwise claims assurance this project has not earned. The CLI draws that
 * distinction and so does this.
 */

const MARK: Record<CheckStatus, { glyph: string; className: string }> = {
  passed: { glyph: 'ok', className: 'text-verify-500' },
  failed: { glyph: 'FAIL', className: 'text-caution-500' },
  'not-applicable': { glyph: 'n/a', className: 'text-ink-500' },
}

/** Longest glyph, so the columns line up whatever the statuses turn out to be. */
const GLYPH_WIDTH = 4

export function Terminal({ command, facts }: { command: string; facts: Facts }) {
  // Aligned in a monospace column, the way the CLI aligns it.
  const width = Math.max(...facts.checks.map((c) => c.name.length)) + 4

  return (
    <div className="mt-8 rounded-md border border-ink-800 bg-ink-900/70 overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-ink-800">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="w-2 h-2 rounded-full bg-ink-700" />
          <span className="w-2 h-2 rounded-full bg-ink-700" />
          <span className="w-2 h-2 rounded-full bg-ink-700" />
        </span>
        <span className="font-mono text-xs text-ink-500">{command}</span>
        <span
          className={`ml-auto font-mono text-[0.7rem] uppercase tracking-[0.16em] ${
            facts.passed ? 'text-verify-500' : 'text-caution-500'
          }`}
        >
          {facts.passed ? 'passed' : 'failed'}
        </span>
      </div>

      <div
        className="overflow-x-auto"
        tabIndex={0}
        role="region"
        aria-label={`Output of ${command}`}
      >
        <pre className="px-4 py-4 font-mono text-[0.8125rem] leading-[1.75] text-ink-400 min-w-max">
          <span className="text-ink-200">nullroute verification</span>
          {'\n\n'}
          {facts.checks.map((check: Check) => {
            const mark = MARK[check.status]
            return (
              <span key={check.name}>
                {'  '}
                <span className={mark.className}>{mark.glyph.padEnd(GLYPH_WIDTH)}</span>
                {'  '}
                <span className="text-ink-200">{check.name.padEnd(width)}</span>
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
          <span className="text-verify-300">{facts.rootHash}</span>
          {'\n\n'}
          <span className={facts.passed ? 'text-verify-500' : 'text-caution-500'}>
            {facts.passed ? 'verification passed' : 'verification FAILED'}
          </span>
        </pre>
      </div>
    </div>
  )
}
