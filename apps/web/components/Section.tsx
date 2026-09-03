/**
 * The page's structural unit.
 *
 * Every section is a numbered plate: an index and a label in the left gutter,
 * the content in a wide right column, a hairline above. That is the layout of a
 * specification sheet, and it is the right one here because the site is a
 * record of a thing that was built rather than an offer to sell it. Stacked
 * bordered cards read as feature tiles no matter what words go in them.
 *
 * The gutter collapses above the content below `md`. A 7rem column of empty
 * space on a phone is worse than no gutter at all.
 */

export function Section({
  index,
  label,
  children,
}: {
  index: string
  label: string
  children: React.ReactNode
}) {
  return (
    <section className="border-t border-ink-800 py-14 md:py-20 grid gap-4 md:gap-12 md:grid-cols-[9rem_minmax(0,1fr)]">
      <div className="flex items-baseline gap-3 md:block md:sticky md:top-24 md:self-start md:text-right">
        {/* Ornamental, and hidden from screen readers rather than left to be
            announced as a bare number ahead of the heading it decorates. It is
            also outside the h2, so it is not part of the accessible name. */}
        <div aria-hidden="true" className="font-mono text-[0.7rem] text-signal-500 tabular-nums">
          {index}
        </div>
        <h2 className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-ink-400 md:mt-2 md:leading-[1.6]">
          {label}
        </h2>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}

/**
 * A labelled row of hairline-separated facts. Used where the old design had a
 * grid of bordered cards, which made four ordinary sentences look like a
 * pricing table.
 */
export function Rows({ children }: { children: React.ReactNode }) {
  return <div className="divide-y divide-ink-850 border-y border-ink-850">{children}</div>
}

export function Row({
  term,
  children,
  tone = 'default',
}: {
  term: string
  children: React.ReactNode
  tone?: 'default' | 'caution'
}) {
  return (
    <div className="py-5 grid gap-1.5 sm:gap-8 sm:grid-cols-[13rem_minmax(0,1fr)] sm:py-6">
      <div
        className={`text-sm font-medium ${tone === 'caution' ? 'text-caution-300' : 'text-ink-100'}`}
      >
        {term}
      </div>
      <p className="text-sm text-ink-400 leading-relaxed">{children}</p>
    </div>
  )
}
