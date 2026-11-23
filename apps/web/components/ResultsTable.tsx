import type { ReactNode } from 'react'
import type { KitResult, Profile } from '../lib/profile'

/**
 * The conformance kit's results, one row per vector file.
 *
 * ONE COLUMN PER SIGNER, EACH FROM ITS OWN REPORT. nullroute's is this
 * build's run; every other column is a report in conformance/results/, run by
 * that signer's adapter against the same vectors, and the build refuses one
 * made against any others. A known failure shows as one: for another signer
 * most are questions for the profile, and the findings beside this table say
 * which.
 *
 * NARROW ENOUGH FOR A PHONE WITHOUT SCROLLING. The requirement ids sit under
 * the file name rather than in a column of their own, and below `sm` the other
 * signers' results move there too, as a line each. A table that scrolls
 * sideways puts its links where nobody finds them, which is what the
 * responsive check caught on the first version of this.
 */
/** A requirement's page, or a stopped build: a chip linking nowhere is a citation to nothing. */
export function requirementHref(hrefs: ReadonlyMap<string, string>, id: string): string {
  const href = hrefs.get(id.toLowerCase())
  if (href === undefined) throw new Error(`nullroute.diy: the signer profile has no ${id}`)
  return href
}

/**
 * "5 of 7, 2 known", or "not run" when the adapter ran none of the file. Each
 * part carries its own colour, because they mean different things: a listed
 * finding (known) is a documented difference, amber like a qualified row; only
 * a failure nobody listed is red. A column painted red for a signer that
 * passes four cases of five would read as a verdict the run does not make.
 */
function cell(r: Omit<KitResult, 'file'> | undefined): ReactNode {
  if (r === undefined || r.notRun === r.cases) return <span className="text-muted">not run</span>
  const clean = r.fail === 0 && r.known === 0 && r.notRun === 0
  return (
    <>
      <span className={clean ? 'text-verify' : 'text-ink'}>
        {r.pass} of {r.cases}
      </span>
      {r.known > 0 && <span className="text-signal">, {r.known} known</span>}
      {r.fail > 0 && <span className="text-caution">, {r.fail} FAIL</span>}
    </>
  )
}

function total(results: readonly KitResult[], cases: number): ReactNode {
  return cell({
    pass: results.reduce((n, r) => n + r.pass, 0),
    known: results.reduce((n, r) => n + r.known, 0),
    fail: results.reduce((n, r) => n + r.fail, 0),
    notRun: results.reduce((n, r) => n + r.notRun, 0),
    cases,
  })
}

export function ResultsTable({
  profile,
  hrefs,
}: {
  profile: Profile
  /** Where each requirement is published, by lowercase id. */
  hrefs: ReadonlyMap<string, string>
}) {
  return (
    <div className="max-w-4xl overflow-hidden rounded-[4px] border border-line bg-surface">
      <table className="w-full border-collapse font-sans text-[0.8125rem] leading-snug sm:text-[0.875rem]">
        <thead>
          <tr className="bg-sunk text-left">
            <th scope="col" className="px-3 py-2.5 font-semibold text-ink sm:px-3.5">
              Vector file and requirements
            </th>
            <th scope="col" className="px-3 py-2.5 text-right font-semibold text-ink sm:px-3.5">
              nullroute
            </th>
            {profile.others.map((o) => (
              <th
                key={o.label}
                scope="col"
                className="hidden px-3.5 py-2.5 text-right font-semibold text-ink sm:table-cell"
              >
                {o.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {profile.vectors.map((v) => {
            const r = profile.results.find((x) => x.file === v.file)
            return (
              <tr key={v.file} className="border-t border-line align-top">
                <td className="px-3 py-2.5 sm:px-3.5">
                  <div className="font-mono text-[0.78rem] text-ink break-all">
                    {v.file.replace(/\.json$/, '')}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                    {v.requirements.map((id) => (
                      <a
                        key={id}
                        href={requirementHref(hrefs, id)}
                        className="font-mono text-[0.72rem] text-link hover:text-link-hover"
                      >
                        {id}
                      </a>
                    ))}
                  </div>
                  {profile.others.map((o) => {
                    const theirs = o.results.find((x) => x.file === v.file)
                    return (
                      <div key={o.label} className="mt-1 font-mono text-[0.72rem] sm:hidden">
                        <span className="text-muted">{o.label}</span> <span>{cell(theirs)}</span>
                      </div>
                    )
                  })}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums whitespace-nowrap sm:px-3.5">
                  {cell(r)}
                </td>
                {profile.others.map((o) => {
                  const theirs = o.results.find((x) => x.file === v.file)
                  return (
                    <td
                      key={o.label}
                      className="hidden px-3.5 py-2.5 text-right font-mono tabular-nums whitespace-nowrap sm:table-cell"
                    >
                      {cell(theirs)}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-border bg-sunk">
            <th scope="row" className="px-3 py-2.5 text-left font-semibold text-ink sm:px-3.5">
              {profile.caseCount} cases in {profile.vectors.length} files
            </th>
            <td className="px-3 py-2.5 text-right font-mono tabular-nums font-medium whitespace-nowrap sm:px-3.5">
              {total(profile.results, profile.caseCount)}
            </td>
            {profile.others.map((o) => (
              <td
                key={o.label}
                className="hidden px-3.5 py-2.5 text-right font-mono tabular-nums font-medium whitespace-nowrap sm:table-cell"
              >
                {total(o.results, profile.caseCount)}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
