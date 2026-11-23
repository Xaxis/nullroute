import type { ReactNode } from 'react'

/**
 * The parts a test report is made of: numbered figures with a source line,
 * readouts, hashes and transcripts. Every page on the site is built from these
 * so that "this is what we measured, this is where it came from" looks the same
 * wherever it appears.
 */

/**
 * A hash, in groups of four, in the face the device draws hashes in.
 *
 * Groups are elements rather than spaces, so a narrow screen wraps between
 * groups and never inside one, and a copy takes the hash and not the spacing.
 */
export function Hash({ value, className = '' }: { value: string; className?: string }) {
  const groups = value.match(/.{1,4}/g) ?? []
  return (
    <span className={`hash ${className}`}>
      {groups.map((group, i) => (
        <span key={i}>{group}</span>
      ))}
    </span>
  )
}

/** First and last eight, for running text where the whole hash would wrap. */
export function ShortHash({ value }: { value: string }) {
  return (
    <code className="font-hash text-[0.9em] text-ink whitespace-nowrap">
      {value.slice(0, 4)} {value.slice(4, 8)}
      <span className="text-muted"> &hellip; </span>
      {value.slice(-8, -4)} {value.slice(-4)}
    </code>
  )
}

/**
 * A numbered figure: label and title above, the artefact, then where it came
 * from. The source line is the point of the component. A figure without one
 * would be an illustration, and this site does not have those.
 */
export function Figure({
  title,
  source,
  children,
  className = '',
  id,
}: {
  title: ReactNode
  source?: ReactNode
  children: ReactNode
  className?: string
  id?: string
}) {
  return (
    <figure {...(id === undefined ? {} : { id })} className={`m-0 min-w-0 ${className}`}>
      <figcaption className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-sans text-sm font-semibold text-ink">{title}</span>
      </figcaption>
      {children}
      {source !== undefined && <Source>{source}</Source>}
    </figure>
  )
}

/** "Source: ..." under an artefact. */
export function Source({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 font-sans text-[0.8125rem] leading-relaxed text-muted">
      <span className="font-semibold">Source:</span> {children}
    </p>
  )
}

/**
 * A shell transcript: commands and their real output.
 *
 * Commands are selectable in one tap and the prompt is not, so what lands on
 * the clipboard is exactly what to run.
 */
export function Transcript({
  lines,
  label,
  className = '',
}: {
  lines: readonly { cmd?: string; out?: ReactNode }[]
  label: string
  className?: string
}) {
  return (
    <div
      className={`rounded-[4px] border border-line bg-sunk overflow-x-auto ${className}`}
      tabIndex={0}
      role="region"
      aria-label={label}
    >
      <pre className="transcript px-4 py-3.5 sm:px-5 sm:py-4 whitespace-pre-wrap [overflow-wrap:anywhere]">
        {lines.map((line, i) => (
          <span key={i} className="block">
            {line.cmd !== undefined && (
              <>
                <span className="prompt">$ </span>
                <span className="cmd">{line.cmd}</span>
              </>
            )}
            {line.out !== undefined && <span className="block">{line.out}</span>}
          </span>
        ))}
      </pre>
    </div>
  )
}

/**
 * One section of a page: a number and a heading in the left rail on wide
 * screens, above the content on narrow ones.
 */
export function Section({
  title,
  id,
  children,
  className = '',
}: {
  title: ReactNode
  id?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section
      {...(id === undefined ? {} : { id })}
      className={`scroll-mt-20 border-t border-line py-14 sm:py-16 ${className}`}
    >
      <h2 className="max-w-[26ch] font-display text-[1.75rem] leading-[1.15] tracking-[-0.015em] text-ink sm:text-[2.125rem]">
        {title}
      </h2>
      <div className="mt-6">{children}</div>
    </section>
  )
}

/**
 * Named things and what each means, as ruled rows: the site's one way of
 * listing them. It replaced grids of cards, which read as a template and gave
 * a two-word term the same weight as the paragraph explaining it.
 */
export function Ruled({
  items,
  className = '',
}: {
  items: readonly (readonly [string, ReactNode])[]
  className?: string
}) {
  return (
    // The measure of the boxed tables, so a rule stops where its text does
    // rather than running 300px past it. No rule under the last row: every
    // Ruled ends its section, and the next section opens with its own.
    <dl className={`max-w-4xl border-t border-line ${className}`}>
      {items.map(([term, text]) => (
        <div
          key={term}
          className="grid gap-1.5 border-b border-line py-5 last:border-b-0 sm:grid-cols-[14rem_minmax(0,1fr)] sm:gap-8"
        >
          <dt className="font-sans text-[0.9375rem] font-semibold text-ink">{term}</dt>
          <dd className="min-w-0 max-w-[68ch] text-[1rem] leading-relaxed text-body">{text}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Running prose at a readable measure. */
export function Prose({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`max-w-[38rem] space-y-4 ${className}`}>{children}</div>
}

/** Code inside prose. */
export function C({ children }: { children: ReactNode }) {
  return <code className="code">{children}</code>
}

/** A link in running text. */
export function A({
  href,
  children,
  external = false,
}: {
  href: string
  children: ReactNode
  external?: boolean
}) {
  return external ? (
    <a href={href} className="link" target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ) : (
    <a href={href} className="link">
      {children}
    </a>
  )
}

/**
 * Inline markdown from a repository table cell: code spans only. The cells
 * this renders are written for GitHub, where backticks mean code, and showing
 * the backticks would be showing the source instead of the text.
 */
/**
 * A spec id such as INV-BACKUP-3 or SP-ENT-8, which must not break at its
 * hyphens, or a provisioning tier ("Tier 2"), which must not leave its number
 * alone at the start of the next line.
 */
const SPEC_ID = /\b((?:INV|SP)-[A-Z0-9]+(?:-[A-Z0-9]+)*|Tier \d)\b/g

function KeepIds({ text }: { text: string }) {
  const parts = text.split(SPEC_ID)
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="whitespace-nowrap">
        {part}
      </span>
    ) : (
      part
    )
  )
}

export function InlineMd({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g)
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('`') && part.endsWith('`') && part.length > 1 ? (
          // A short span is a name (`prepare-state`, `make verify`), and a
          // name broken at its hyphen reads as two words. A long one is a
          // path or a command and has to wrap on a phone.
          <code key={i} className={part.length <= 26 ? 'code whitespace-nowrap' : 'code'}>
            {part.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>
            <KeepIds text={part} />
          </span>
        )
      )}
    </>
  )
}
