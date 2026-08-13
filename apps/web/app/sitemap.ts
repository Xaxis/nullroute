import type { MetadataRoute } from 'next'
import { DOCS } from '../lib/docs'

export const dynamic = 'force-static'

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: 'https://nullroute.diy/', priority: 1 },
    ...DOCS.map((doc) => ({ url: `https://nullroute.diy/docs/${doc.slug}`, priority: 0.8 })),
  ]
}
