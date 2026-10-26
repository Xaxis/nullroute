import { createHash } from 'node:crypto'
import Link from 'next/link'
import { extractHeadings, renderMarkdown } from '../lib/markdown'
import { PUBLISHED } from '../lib/docs'
import { readRepoFile } from '../lib/repo'
import { repoBlobUrl } from '../lib/site'

/**
 * A repository document, rendered. Used for docs/, the security policy, the
 * signer profile and the conformance kit's README, so every long document on
 * the site has the same contents list and the same statement of where it came
 * from.
 *
 * THE PAGE STATES ITS SOURCE AND ITS HASH. "Rendered from docs/X.md" invited a
 * reader to check that the page and the file agree; the SHA-256 of the file's
 * bytes lets them do it with one command, which is the project's whole
 * argument applied to its own documentation.
 */
export async function DocView({
  file,
  title,
  crumbs,
  requirements = false,
}: {
  file: string
  title: string
  crumbs: readonly { href: string; label: string }[]
  requirements?: boolean
}) {
  const source = readRepoFile(file)
  const digest = createHash('sha256').update(source, 'utf8').digest('hex')
  const html = await renderMarkdown(source, file, PUBLISHED, { requirements })
  const headings = extractHeadings(source)

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-8 pb-10">
      <nav
        aria-label="Breadcrumb"
        className="mb-8 flex flex-wrap items-center gap-x-2 font-sans text-sm text-muted"
      >
        {crumbs.map((crumb) => (
          <span key={crumb.href} className="inline-flex items-center gap-2">
            <Link href={crumb.href} className="hover:text-ink transition-colors">
              {crumb.label}
            </Link>
            <span aria-hidden="true">/</span>
          </span>
        ))}
        <span className="text-body">{title}</span>
      </nav>

      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_15rem] lg:items-start">
        <article className="min-w-0 max-w-[44rem]">
          {/* The contents, for the screens the sidebar is hidden on. A
              <details> rather than a script: it collapses natively, works with
              JavaScript off, and adds nothing to the hashes the CSP pins. */}
          {headings.length > 1 && (
            <details className="lg:hidden mb-8 border-y border-line py-3">
              <summary className="cursor-pointer label">On this page</summary>
              <ul className="mt-3 space-y-2 border-l border-line font-sans">
                {headings.map((heading) => (
                  <li key={heading.id} className={heading.depth === 3 ? 'ml-3' : ''}>
                    <a
                      href={`#${heading.id}`}
                      className={`block pl-3 -ml-px border-l border-transparent hover:border-signal leading-snug ${
                        heading.depth === 3 ? 'text-[0.8125rem] text-muted' : 'text-sm text-body'
                      }`}
                    >
                      {heading.text}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {/* Repository content rendered at build time. There is no visitor
              input anywhere in this pipeline and no runtime rendering. */}
          <div className="prose-doc" dangerouslySetInnerHTML={{ __html: html }} />

          <div className="mt-14 border-t border-line pt-5 font-sans text-[0.8125rem] leading-relaxed text-muted">
            <span className="font-semibold">Source:</span>{' '}
            <a
              href={repoBlobUrl(file)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-link underline decoration-1 underline-offset-[3px] hover:text-link-hover"
            >
              {file}
            </a>
            , the same bytes that ship with the code. SHA-256 of the file:
            <code className="mt-1 block font-hash text-[0.8125rem] text-ink break-all">
              {digest}
            </code>
          </div>
        </article>

        {headings.length > 1 && (
          <nav
            aria-label="On this page"
            className="hidden lg:block sticky top-24 font-sans text-sm"
          >
            <div className="label mb-3">On this page</div>
            {/* Bounded and scrollable: a long document's contents is taller
                than a laptop screen, and a sticky column that runs off the
                bottom hides the sections nobody can otherwise find. */}
            <ul className="space-y-1.5 border-l border-line max-h-[calc(100vh-9rem)] overflow-y-auto pr-2">
              {headings.map((heading) => (
                <li key={heading.id} className={heading.depth === 3 ? 'ml-3' : ''}>
                  <a
                    href={`#${heading.id}`}
                    className={`block pl-3 -ml-px border-l border-transparent hover:border-signal transition-colors leading-snug ${
                      heading.depth === 3
                        ? 'text-[0.8125rem] text-muted hover:text-ink'
                        : 'text-body hover:text-ink'
                    }`}
                  >
                    {heading.text}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
    </div>
  )
}
