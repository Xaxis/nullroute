import type { ReactNode } from 'react'
import Link from 'next/link'
import type { Book, Chapter, Heading } from '../lib/docbook'
import { CopyCode } from './CopyCode'
import { repoBlobUrl } from '../lib/site'

/**
 * The frame every docs page sits in: the whole set on the left, the page in
 * the middle, the page's own headings on the right.
 *
 * NO SCRIPT. The phone menu is a <details>, which opens natively, works with
 * JavaScript off and adds nothing to the hashes the CSP pins. The current
 * chapter is expanded in the sidebar and the others are one line each, so the
 * map of ninety pages stays the height of a screen.
 */
export function DocsShell({
  book,
  here,
  toc = [],
  children,
}: {
  book: Book
  /** The path of the page being shown, to mark it and expand its chapter. */
  here: string
  toc?: readonly Heading[]
  children: ReactNode
}) {
  const shown = toc.filter((h) => h.depth === 3)
  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6">
      <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-12 xl:grid-cols-[15rem_minmax(0,1fr)_12.5rem]">
        <aside className="hidden lg:block sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto overflow-x-hidden py-10 pl-3 pr-3 -ml-3">
          <DocsNav book={book} here={here} />
        </aside>

        <div className="min-w-0 py-8 lg:py-10">
          <details className="lg:hidden mb-8 card px-4 py-3">
            <summary className="cursor-pointer font-sans text-sm font-semibold text-ink">
              Browse the docs
            </summary>
            <div className="mt-4">
              <DocsNav book={book} here={here} />
            </div>
          </details>
          {children}
          <CopyCode />
        </div>

        {shown.length > 1 ? (
          <aside className="hidden xl:block sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto py-10">
            <div className="label mb-3">On this page</div>
            <ul className="space-y-2 border-l border-line font-sans text-[0.8125rem]">
              {shown.map((heading) => (
                <li key={heading.id}>
                  <a
                    href={`#${heading.id}`}
                    className="block -ml-px border-l border-transparent pl-3 leading-snug text-muted hover:border-signal hover:text-ink transition-colors"
                  >
                    {heading.text}
                  </a>
                </li>
              ))}
            </ul>
          </aside>
        ) : null}
      </div>
    </div>
  )
}

function DocsNav({ book, here }: { book: Book; here: string }) {
  const current = book.chapters.find((c) => here === c.href || here.startsWith(`${c.href}/`))
  return (
    <nav aria-label="Documentation" className="font-sans text-[0.875rem]">
      <Link
        href="/docs"
        aria-current={here === '/docs' ? 'page' : undefined}
        className={`block rounded-md px-2.5 py-1.5 -mx-2.5 ${
          here === '/docs' ? 'bg-sunk text-ink font-semibold' : 'text-body hover:text-ink'
        }`}
      >
        Overview
      </Link>
      {book.groups.map((group) => (
        <div key={group.name} className="mt-6">
          <div className="label mb-2">{group.name}</div>
          <ul className="space-y-0.5">
            {group.chapters.map((chapter) => (
              <li key={chapter.href}>
                <Link
                  href={chapter.href}
                  aria-current={here === chapter.href ? 'page' : undefined}
                  className={`block rounded-md px-2.5 py-1.5 -mx-2.5 leading-snug ${
                    here === chapter.href
                      ? 'bg-sunk text-ink font-semibold'
                      : chapter === current
                        ? 'text-ink font-semibold'
                        : 'text-body hover:text-ink'
                  }`}
                >
                  {chapter.meta.title}
                </Link>
                {chapter === current ? (
                  <ul className="mt-1 mb-2 ml-1 space-y-0.5 border-l border-line">
                    {chapter.sections.map((section) => (
                      <li key={section.href}>
                        <Link
                          href={section.href}
                          aria-current={here === section.href ? 'page' : undefined}
                          className={`block -ml-px border-l py-1 pl-3 text-[0.8125rem] leading-snug ${
                            here === section.href
                              ? 'border-signal text-ink font-semibold'
                              : 'border-transparent text-muted hover:text-ink hover:border-border'
                          }`}
                        >
                          {section.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

export function Crumbs({ trail }: { trail: readonly { href: string; label: string }[] }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="mb-5 flex flex-wrap items-center gap-x-2 font-sans text-[0.8125rem] text-muted"
    >
      {trail.map((crumb, index) => (
        <span key={crumb.href} className="inline-flex items-center gap-2">
          {index > 0 ? <span aria-hidden="true">/</span> : null}
          <Link href={crumb.href} className="hover:text-ink transition-colors">
            {crumb.label}
          </Link>
        </span>
      ))}
    </nav>
  )
}

/** The previous and next page in reading order, across chapters. */
export function PrevNext({ book, here }: { book: Book; here: string }) {
  const index = book.pages.findIndex((p) => p.href === here)
  const prev = index > 0 ? book.pages[index - 1] : undefined
  const next = index >= 0 ? book.pages[index + 1] : undefined
  if (prev === undefined && next === undefined) return null
  return (
    <nav aria-label="Pages" className="mt-14 grid gap-3 sm:grid-cols-2">
      {prev !== undefined ? (
        <Link href={prev.href} className="card px-5 py-4">
          <span className="block font-sans text-[0.75rem] text-muted">Previous</span>
          <span className="mt-1 block font-sans font-semibold text-ink leading-snug">
            {prev.title}
          </span>
        </Link>
      ) : (
        <span />
      )}
      {next !== undefined ? (
        <Link href={next.href} className="card px-5 py-4 sm:text-right">
          <span className="block font-sans text-[0.75rem] text-muted">Next</span>
          <span className="mt-1 block font-sans font-semibold text-ink leading-snug">
            {next.title}
          </span>
        </Link>
      ) : null}
    </nav>
  )
}

/** Which file a page was cut from, and that file's hash. */
export function SourceNote({ chapter }: { chapter: Chapter }) {
  return (
    <p className="mt-10 border-t border-line pt-5 font-sans text-[0.75rem] leading-relaxed text-muted">
      Rendered from{' '}
      <a
        href={repoBlobUrl(chapter.meta.file)}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-link hover:text-link-hover underline decoration-1 underline-offset-[3px]"
      >
        {chapter.meta.file}
      </a>
      , the same bytes that ship with the code. SHA-256{' '}
      <code className="font-hash text-ink break-all">{chapter.digest}</code>
    </p>
  )
}
