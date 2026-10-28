import type { Profile } from '../lib/profile'

/**
 * The conformance kit's results, one row per vector file.
 *
 * A RESULTS MATRIX WITH ONE COLUMN FILLED. The empty column is the invitation:
 * the kit is for any signer, and a matrix with only its author's results in it
 * is honest about how far that has got. The nullroute column is read from the
 * run's own report, and a failure or a known failure would show here as one.
 *
 * NARROW ENOUGH FOR A PHONE WITHOUT SCROLLING. The requirement ids sit under
 * the file name rather than in a column of their own, and the empty column
 * waits for a screen wide enough to show it. A table that scrolls sideways
 * puts its links where nobody finds them, which is what the responsive check
 * caught on the first version of this.
 */
/** A requirement's page, or a stopped build: a chip linking nowhere is a citation to nothing. */
export function requirementHref(hrefs: ReadonlyMap<string, string>, id: string): string {
  const href = hrefs.get(id.toLowerCase())
  if (href === undefined) throw new Error(`nullroute.diy: the signer profile has no ${id}`)
  return href
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
    <div className="overflow-hidden rounded-[4px] border border-line bg-surface">
      <table className="w-full border-collapse font-sans text-[0.8125rem] leading-snug sm:text-[0.875rem]">
        <thead>
          <tr className="bg-sunk text-left">
            <th scope="col" className="px-3 py-2.5 font-semibold text-ink sm:px-3.5">
              Vector file and requirements
            </th>
            <th scope="col" className="px-3 py-2.5 text-right font-semibold text-ink sm:px-3.5">
              nullroute
            </th>
            <th
              scope="col"
              className="hidden px-3.5 py-2.5 text-right font-semibold text-muted sm:table-cell"
            >
              Your signer
            </th>
          </tr>
        </thead>
        <tbody>
          {profile.vectors.map((v) => {
            const r = profile.results.find((x) => x.file === v.file)
            const clean = r?.fail === 0 && r.known === 0 && r.notRun === 0
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
                </td>
                <td
                  className={`px-3 py-2.5 text-right font-mono tabular-nums whitespace-nowrap sm:px-3.5 ${
                    clean ? 'text-verify' : 'text-caution'
                  }`}
                >
                  {r === undefined
                    ? 'not run'
                    : `${String(r.pass)} of ${String(r.cases)}${r.known > 0 ? `, ${String(r.known)} known` : ''}${r.fail > 0 ? `, ${String(r.fail)} FAIL` : ''}`}
                </td>
                <td className="hidden px-3.5 py-2.5 text-right font-mono text-muted whitespace-nowrap sm:table-cell">
                  not run
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-border bg-sunk">
            <th scope="row" className="px-3 py-2.5 text-left font-semibold text-ink sm:px-3.5">
              {profile.caseCount} cases in {profile.vectors.length} files
            </th>
            <td
              className={`px-3 py-2.5 text-right font-mono tabular-nums font-medium whitespace-nowrap sm:px-3.5 ${
                profile.passed ? 'text-verify' : 'text-caution'
              }`}
            >
              {profile.results.reduce((n, r) => n + r.pass, 0)} of {profile.caseCount}
            </td>
            <td className="hidden px-3.5 py-2.5 text-right font-mono text-muted whitespace-nowrap sm:table-cell">
              none yet
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
