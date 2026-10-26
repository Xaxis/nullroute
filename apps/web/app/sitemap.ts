import type { MetadataRoute } from 'next'
import { DOCS } from '../lib/docs'

export const dynamic = 'force-static'

const PAGES: readonly (readonly [string, number])[] = [
  ['/', 1],
  ['/check', 0.9],
  ['/profile', 0.9],
  ['/profile/spec', 0.8],
  ['/profile/kit', 0.8],
  ['/device', 0.8],
  ['/device/interop', 0.7],
  ['/status', 0.8],
  ['/about', 0.6],
  ['/docs', 0.7],
]

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    ...PAGES.map(([path, priority]) => ({ url: `https://nullroute.diy${path}`, priority })),
    ...DOCS.map((doc) => ({ url: `https://nullroute.diy/docs/${doc.slug}`, priority: 0.8 })),
  ]
}
