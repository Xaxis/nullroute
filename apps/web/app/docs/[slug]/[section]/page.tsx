import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Crumbs, DocsShell, PrevNext, SourceNote } from '../../../../components/DocsShell'
import { loadBook } from '../../../../lib/docbook'
import { OG_IMAGE } from '../../../../lib/site'

interface Props {
  params: Promise<{ slug: string; section: string }>
}

export async function generateStaticParams() {
  const book = await loadBook()
  return book.chapters.flatMap((chapter) =>
    chapter.sections.map((section) => ({ slug: chapter.meta.slug, section: section.slug }))
  )
}

async function find(params: Props['params']) {
  const { slug, section } = await params
  const book = await loadBook()
  const chapter = book.chapters.find((c) => c.meta.slug === slug)
  const page = chapter?.sections.find((s) => s.slug === section)
  return { book, chapter, page }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { chapter, page } = await find(params)
  if (chapter === undefined || page === undefined) return { title: 'Not found' }
  const title = `${page.title}: ${chapter.meta.title}`
  return {
    title,
    description: page.summary === '' ? chapter.meta.summary : page.summary,
    openGraph: {
      title: `${title} | nullroute`,
      description: page.summary === '' ? chapter.meta.summary : page.summary,
      url: page.href,
      siteName: 'nullroute',
      type: 'article',
      images: [OG_IMAGE],
    },
  }
}

/**
 * One section of one file. The heading carries the id GitHub gives it, so a
 * link that names the section by fragment still resolves on this page.
 */
export default async function SectionPage({ params }: Props) {
  const { book, chapter, page } = await find(params)
  if (chapter === undefined || page === undefined) notFound()

  return (
    <DocsShell book={book} here={page.href} toc={page.headings}>
      <article className="max-w-[46rem]">
        <Crumbs
          trail={[
            { href: '/docs', label: 'Docs' },
            { href: chapter.href, label: chapter.meta.title },
          ]}
        />
        <h1
          id={page.id}
          className="font-display text-[2rem] leading-[1.12] tracking-[-0.015em] text-ink sm:text-[2.5rem]"
        >
          {page.title}
        </h1>
        {/* Repository content rendered at build time. There is no visitor
            input anywhere in this pipeline and no runtime rendering. */}
        <div className="prose-doc mt-6" dangerouslySetInnerHTML={{ __html: page.html }} />
        <PrevNext book={book} here={page.href} />
        <SourceNote chapter={chapter} />
      </article>
    </DocsShell>
  )
}
