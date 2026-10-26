import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { DOCS, docBySlug } from '../../../lib/docs'
import { OG_IMAGE } from '../../../lib/site'
import { DocView } from '../../../components/DocView'

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
  // Each document carries its own title and summary into the card a link
  // preview draws, instead of every page sharing the home page's.
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
    twitter: {
      card: 'summary_large_image',
      title: `${doc.title} | nullroute`,
      description: doc.summary,
      images: [OG_IMAGE],
    },
  }
}

export default async function DocPage({ params }: Props) {
  const { slug } = await params
  const doc = docBySlug(slug)
  if (doc === undefined) notFound()
  return <DocView file={doc.file} title={doc.title} crumbs={[{ href: '/docs', label: 'Docs' }]} />
}
