import type { MetadataRoute } from 'next'
import { DOCS } from '../lib/docs'

export const dynamic = 'force-static'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: 'https://nullroute.space/', priority: 1 },
    ...DOCS.map((doc) => ({ url: `https://nullroute.space/docs/${doc.slug}`, priority: 0.8 })),
  ]
}
