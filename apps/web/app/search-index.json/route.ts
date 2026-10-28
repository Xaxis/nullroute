import { loadBook } from '../../lib/docbook'

export const dynamic = 'force-static'

/**
 * The search index, written as a static file at build time.
 *
 * Built from the same book the docs pages are, so search cannot find a page
 * that does not exist or miss one that does. Fetched from this origin only
 * when a reader first opens search, so a page view costs nothing extra.
 */
export interface IndexedPage {
  /** Title */
  readonly t: string
  /** Where it sits: the chapter, or the group for a chapter page. */
  readonly c: string
  /** Path */
  readonly h: string
  /** Subheadings and their anchors, for linking straight to the match. */
  readonly k: readonly (readonly [string, string])[]
  /** The page's text. */
  readonly x: string
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#x27;': "'",
  '&#39;': "'",
}

function plain(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:amp|lt|gt|quot|#x27|#39);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/\s+/g, ' ')
    .trim()
}

/** The pages outside the docs, by what a reader would type to find them. */
const SITE: readonly IndexedPage[] = [
  {
    t: 'Overview',
    c: 'nullroute',
    h: '/',
    k: [['What you need', 'hardware']],
    x: 'An air-gapped Bitcoin signer for the Raspberry Pi: dice entropy, QR transport, review before signing, multisig, a manifest root to compare, hardware parts and cost.',
  },
  {
    t: 'Signer profile',
    c: 'nullroute',
    h: '/profile',
    k: [],
    x: 'A draft standard for air-gapped signers and a conformance kit any signer can run: requirements, test vectors, results, coverage and positions others may reject.',
  },
  {
    t: 'Roadmap',
    c: 'nullroute',
    h: '/status',
    k: [],
    x: 'Phases built and planned, what comes next and what each step proves, the change log, and what the device does not protect against.',
  },
  {
    t: 'About',
    c: 'nullroute',
    h: '/about',
    k: [],
    x: 'Who maintains nullroute, what happens to your funds if the project stops, where help is worth most, and its licence.',
  },
]

export async function GET() {
  const book = await loadBook()
  const pages: IndexedPage[] = [
    ...book.chapters.flatMap((chapter) => [
      {
        t: chapter.meta.title,
        c: chapter.meta.group,
        h: chapter.href,
        k: [],
        x: `${chapter.meta.summary} ${plain(chapter.introHtml)}`.trim(),
      },
      ...chapter.sections.map((section) => ({
        t: section.title,
        c: chapter.meta.title,
        h: section.href,
        k: section.headings.map((h) => [h.text, h.id] as const),
        x: plain(section.html),
      })),
    ]),
    ...SITE,
  ]
  return Response.json({ pages })
}
