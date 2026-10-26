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
  n,
  title,
  source,
  children,
  className = '',
  id,
}: {
  n: string
  title: ReactNode
  source?: ReactNode
  children: ReactNode
  className?: string
  id?: string
}) {
  return (
    <figure {...(id === undefined ? {} : { id })} className={`m-0 min-w-0 ${className}`}>
      <figcaption className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="label text-signal">Fig. {n}</span>
        <span className="font-sans text-sm text-ink">{title}</span>
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

/** A small label over a large value, the way the device's lock screen reads. */
export function Readout({
  label,
  value,
  detail,
}: {
  label: string
  value: ReactNode
  detail?: ReactNode
}) {
  return (
    <div className="min-w-0 border-t border-line pt-3">
      <dt className="label">{label}</dt>
      <dd className="mt-1.5 font-display text-[1.75rem] leading-none text-ink tabular-nums sm:text-[2rem]">
        {value}
      </dd>
      {detail !== undefined && (
        <dd className="mt-2 font-sans text-[0.8125rem] leading-snug text-muted">{detail}</dd>
      )}
    </div>
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
  n,
  title,
  kicker,
  id,
  children,
  className = '',
}: {
  n: string
  title: ReactNode
  kicker?: ReactNode
  id?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section
      {...(id === undefined ? {} : { id })}
      className={`scroll-mt-24 border-t border-line py-14 sm:py-20 ${className}`}
    >
      <div className="grid gap-6 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-12">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <div aria-hidden="true" className="font-mono text-sm text-signal tabular-nums">
            {n}
          </div>
          {kicker !== undefined && <div className="label mt-1.5">{kicker}</div>}
        </div>
        <div className="min-w-0">
          <h2 className="font-display text-[1.875rem] leading-[1.12] tracking-[-0.01em] text-ink sm:text-[2.375rem] max-w-[24ch]">
            {title}
          </h2>
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </section>
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
export function InlineMd({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g)
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('`') && part.endsWith('`') && part.length > 1 ? (
          <code key={i} className="code">
            {part.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  )
}
