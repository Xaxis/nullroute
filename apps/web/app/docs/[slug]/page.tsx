import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DOCS, docBySlug, readDoc } from '../../../lib/docs'
import { renderMarkdown, extractHeadings } from '../../../lib/markdown'

/**
 * Note the `Promise` around params. In Next 16 route params are async, and the
 * old synchronous shape still COMPILES and still BUILDS: it just renders empty.
 * A silent blank page is a worse failure than a type error, so this shape is
 * deliberate rather than incidental.
 */
interface Props { params: Promise<{ slug: string }> }

export function generateStaticParams() {
  return DOCS.map((doc) => ({ slug: doc.slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const doc = docBySlug(slug)
  if (doc === undefined) return { title: 'Not found' }
  return { title: doc.title, description: doc.summary }
}

export default async function DocPage({ params }: Props) {
  const { slug } = await params
  const doc = docBySlug(slug)
  if (doc === undefined) notFound()

  const source = readDoc(doc)
  const html = await renderMarkdown(source)
  const headings = extractHeadings(source).filter((h) => h.depth === 2)

  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <div className="grid gap-10 lg:grid-cols-[1fr_15rem] items-start">
        <article className="prose-doc min-w-0">
          <div className="mb-6 flex items-center gap-2 text-sm text-ink-500">
            <Link href="/" className="hover:text-ink-300 transition-colors">
              nullroute
            </Link>
            <span>/</span>
            <span className="text-ink-400">{doc.title}</span>
          </div>

          {/* The same contents, for the screens the sidebar is hidden on.
              A <details> rather than a script: it collapses natively, it works
              with JavaScript off, and it adds nothing to the inline script
              hashes the CSP pins.

              These documents got longer when seven of them became four, and a
              phone with no way to see the shape of a forty thousand character
              reference is a phone showing an infinite scroll. */}
          {headings.length > 1 && (
            <details className="lg:hidden mb-8 border-y border-ink-850 py-3">
              <summary className="cursor-pointer font-mono text-xs uppercase tracking-widest text-ink-500">
                On this page
              </summary>
              <ul className="mt-3 space-y-2 border-l border-ink-800">
                {headings.map((heading) => (
                  <li key={heading.id}>
                    <a
                      href={`#${heading.id}`}
                      className="block pl-3 -ml-px border-l border-transparent text-sm text-ink-400 leading-snug"
                    >
                      {heading.text}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {/* The markdown is repository content rendered at build time. There is
              no user input anywhere in this pipeline and no runtime rendering. */}
          <div dangerouslySetInnerHTML={{ __html: html }} />

          <div className="mt-14 pt-6 border-t border-ink-800 text-sm text-ink-500">
            Rendered from{' '}
            <a
              href={`https://github.com/Xaxis/nullroute/blob/main/${doc.file}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-signal-400 hover:text-signal-300"
            >
              {doc.file}
            </a>
            . The page and the file that ships with the code are the same bytes.
          </div>
        </article>

        {/* Table of contents. Hidden below lg rather than collapsed into an
            accordion: these documents are long, and a half-working nav is worse
            than an honest absence. */}
        {headings.length > 1 && (
          <nav className="hidden lg:block sticky top-20 text-sm">
            <div className="font-mono text-xs uppercase tracking-widest text-ink-600 mb-3">
              On this page
            </div>
            <ul className="space-y-2 border-l border-ink-800">
              {headings.map((heading) => (
                <li key={heading.id}>
                  <a
                    href={`#${heading.id}`}
                    className="block pl-3 -ml-px border-l border-transparent text-ink-500 hover:text-ink-200 hover:border-signal-500 transition-colors leading-snug"
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
