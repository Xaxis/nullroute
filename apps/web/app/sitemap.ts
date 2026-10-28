import type { MetadataRoute } from 'next'
import { loadBook } from '../lib/docbook'

export const dynamic = 'force-static'

const PAGES: readonly (readonly [string, number])[] = [
  ['/', 1],
  ['/docs', 0.9],
  ['/profile', 0.9],
  ['/status', 0.8],
  ['/about', 0.6],
]

/** Every page the site builds: the product pages, then every docs page. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const book = await loadBook()
  return [
    ...PAGES.map(([path, priority]) => ({ url: `https://nullroute.diy${path}`, priority })),
    ...book.pages.map((page) => ({
      url: `https://nullroute.diy${page.href}`,
      priority: page.href === page.chapter.href ? 0.8 : 0.7,
    })),
  ]
}
