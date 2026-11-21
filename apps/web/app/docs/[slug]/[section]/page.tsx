import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Crumbs, DocsShell, PrevNext, SourceNote } from '../../../../components/DocsShell'
import { loadBook } from '../../../../lib/docbook'
import { OG_IMAGE } from '../../../../lib/site'
import { SCREENS, Shot, ShotOverlays, type Screen } from '../../../../components/Device'

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
 * The sections that describe a screen show it, under the heading, so the page
 * about the lock screen is not the one page about it with no picture of it.
 * Keyed by chapter and section slug; a name that is not a screen stops the build.
 */
const SECTION_SCREENS: Readonly<Record<string, readonly string[]>> = {
  'using/the-lock-screen': ['lock'],
  'using/making-a-wallet': ['dice', 'seed'],
  'using/receiving': ['receive'],
  'using/signing-a-transaction': ['review'],
}

function screensFor(chapter: string, section: string): readonly Screen[] {
  return (SECTION_SCREENS[`${chapter}/${section}`] ?? []).map((file) => {
    const screen = SCREENS.find((s) => s.file === file)
    if (screen === undefined) throw new Error(`docs: no device screen named ${file}`)
    return screen
  })
}

/**
 * One section of one file. The heading carries the id GitHub gives it, so a
 * link that names the section by fragment still resolves on this page.
 */
export default async function SectionPage({ params }: Props) {
  const { book, chapter, page } = await find(params)
  if (chapter === undefined || page === undefined) notFound()
  const screens = screensFor(chapter.meta.slug, page.slug)

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
        {screens.length === 0 ? null : (
          <figure id="screens" className="mt-6">
            <div className={screens.length > 1 ? 'grid gap-3 sm:grid-cols-2' : ''}>
              {screens.map((screen) => (
                <Shot key={screen.file} screen={screen} />
              ))}
            </div>
            <figcaption className="mt-3 font-sans text-[0.8125rem] leading-relaxed text-muted">
              {screens.map((screen) => screen.caption).join('; ')}. Rendered from the device
              frontend at the panel&rsquo;s 800 by 480 and opened full size from here. The hashes
              and amounts in them are samples.
            </figcaption>
          </figure>
        )}
        {/* Repository content rendered at build time. There is no visitor
            input anywhere in this pipeline and no runtime rendering. */}
        <div className="prose-doc mt-6" dangerouslySetInnerHTML={{ __html: page.html }} />
        <ShotOverlays screens={screens} closeTo="screens" />
        <PrevNext book={book} here={page.href} />
        <SourceNote chapter={chapter} />
      </article>
    </DocsShell>
  )
}
