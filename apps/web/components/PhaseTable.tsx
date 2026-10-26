import type { Phase, PhaseState } from '../lib/status'

/**
 * The phases, as the README states them. The state column quotes the README's
 * own words, so "Complete, except tier 0 signing and publishing" is never
 * rounded up to "Complete" on its way to the site.
 */
const TONE: Record<PhaseState, { className: string; label: string }> = {
  complete: { className: 'bg-verify-line border-verify-line', label: 'Complete' },
  partial: { className: 'bg-signal border-signal', label: 'Complete with exceptions' },
  'not-started': { className: 'bg-transparent border-muted', label: 'Not started' },
}

export function PhaseTable({ phases }: { phases: readonly Phase[] }) {
  return (
    <div className="table-scroll">
      <table className="w-full border-collapse font-sans text-[0.875rem] leading-snug">
        <thead>
          <tr className="bg-sunk text-left">
            <th scope="col" className="px-3.5 py-2.5 font-semibold text-ink w-12">
              Phase
            </th>
            <th scope="col" className="px-3.5 py-2.5 font-semibold text-ink">
              Scope
            </th>
            <th scope="col" className="px-3.5 py-2.5 font-semibold text-ink">
              State
            </th>
          </tr>
        </thead>
        <tbody>
          {phases.map((phase) => {
            const tone = TONE[phase.kind]
            return (
              <tr key={phase.number} className="border-t border-line align-top">
                <td className="px-3.5 py-3 font-mono text-ink tabular-nums">{phase.number}</td>
                <td className="px-3.5 py-3 text-body min-w-[12rem]">{phase.scope}</td>
                <td className="px-3.5 py-3 min-w-[12rem]">
                  <span className="flex gap-2">
                    {/* Drawn, not typed: the subset fonts carry no geometric
                        shapes, so a circle character falls back to whatever
                        the reader's system has. */}
                    <span
                      aria-hidden="true"
                      className={`mt-[0.32em] size-[0.6rem] shrink-0 rounded-full border-[1.5px] ${tone.className}`}
                    />
                    <span className="text-ink">
                      <span className="sr-only">{tone.label}: </span>
                      {phase.state}
                    </span>
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
