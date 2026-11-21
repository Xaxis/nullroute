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

/*
 * Below sm each row stacks, scope over state beside the phase number. As three
 * columns at 390px the state, the column that matters, ran off the right edge
 * inside a scroller nothing announced.
 */
export function PhaseTable({ phases }: { phases: readonly Phase[] }) {
  return (
    <div className="table-scroll">
      <table className="w-full border-collapse font-sans text-[0.875rem] leading-snug max-sm:block">
        <thead className="max-sm:hidden">
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
        <tbody className="max-sm:block">
          {phases.map((phase) => {
            const tone = TONE[phase.kind]
            return (
              <tr
                key={phase.number}
                className="border-t border-line align-top first:border-t-0 sm:first:border-t max-sm:grid max-sm:grid-cols-[2.75rem_minmax(0,1fr)] max-sm:py-3"
              >
                <td className="px-3.5 py-3 font-mono text-ink tabular-nums max-sm:row-span-2 max-sm:py-0">
                  <span className="sr-only sm:hidden">Phase </span>
                  {phase.number}
                </td>
                <td className="px-3.5 py-3 text-body sm:min-w-[12rem] max-sm:py-0 max-sm:pl-0">
                  {phase.scope}
                </td>
                <td className="px-3.5 py-3 sm:min-w-[12rem] max-sm:pb-0 max-sm:pt-1.5 max-sm:pl-0">
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
