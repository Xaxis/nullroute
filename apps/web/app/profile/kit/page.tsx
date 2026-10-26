import type { Metadata } from 'next'
import { OG_IMAGE } from '../../../lib/site'
import { DocView } from '../../../components/DocView'

export const metadata: Metadata = {
  title: 'Conformance kit',
  description:
    'How to run the signer profile vectors against any signer: the adapter interface, what each result means, where every expected value came from, and how the vectors were generated.',
  openGraph: { title: 'Conformance kit | nullroute', images: [OG_IMAGE] },
}

export default function KitPage() {
  return (
    <DocView
      file="conformance/README.md"
      title="Conformance kit"
      crumbs={[{ href: '/profile', label: 'Profile' }]}
      requirements
    />
  )
}
