import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Crumbs, DocsShell, PrevNext, SourceNote } from '../../../components/DocsShell'
import { loadBook } from '../../../lib/docbook'
import { DOCS, docBySlug } from '../../../lib/docs'
import { OG_IMAGE } from '../../../lib/site'

interface Props {
  params: Promise<{ slug: string }>
}

export function generateStaticParams() {
  return DOCS.map((doc) => ({ slug: doc.slug }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const doc = docBySlug(slug)
  if (doc === undefined) return { title: 'Not found' }
  return {
    title: doc.title,
    description: doc.summary,
    openGraph: {
      title: `${doc.title} | nullroute`,
      description: doc.summary,
      url: `/docs/${doc.slug}`,
      siteName: 'nullroute',
      type: 'article',
      images: [OG_IMAGE],
    },
  }
}

/**
 * A chapter's front page: what it covers, anything the file says before its
 * first section, and every section as a card. The contents of one file, laid
 * out so a reader picks the page they came for instead of scrolling to it.
 */
export default async function ChapterPage({ params }: Props) {
  const { slug } = await params
  const book = await loadBook()
  const chapter = book.chapters.find((c) => c.meta.slug === slug)
  if (chapter === undefined) notFound()

  return (
    <DocsShell book={book} here={chapter.href}>
      <article className="max-w-[46rem]">
        <Crumbs trail={[{ href: '/docs', label: 'Docs' }]} />
        <p className="eyebrow">{chapter.meta.group}</p>
        <h1 className="mt-2 font-display text-[2.25rem] leading-[1.1] tracking-[-0.015em] text-ink sm:text-[2.75rem]">
          {chapter.meta.title}
        </h1>
        <p className="mt-4 text-[1.0625rem] leading-relaxed text-body">{chapter.meta.summary}</p>

        {chapter.introHtml.trim() === '' ? null : (
          // Repository content rendered at build time. There is no visitor
          // input anywhere in this pipeline and no runtime rendering.
          <div className="prose-doc mt-8" dangerouslySetInnerHTML={{ __html: chapter.introHtml }} />
        )}

        <h2 className="label mt-10">In this chapter</h2>
        <ol className="mt-3 grid gap-3">
          {chapter.sections.map((section, index) => (
            <li key={section.href}>
              <Link href={section.href} className="card flex gap-4 px-5 py-4">
                <span className="w-6 shrink-0 font-mono text-[0.8125rem] text-muted tabular-nums">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold text-ink leading-snug">{section.title}</span>
                  {section.summary === '' ? null : (
                    <span className="mt-1 block text-[0.9375rem] leading-snug text-muted">
                      {section.summary}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ol>

        <PrevNext book={book} here={chapter.href} />
        <SourceNote chapter={chapter} />
      </article>
    </DocsShell>
  )
}
