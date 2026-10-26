import type { Metadata } from 'next'
import { OG_IMAGE } from '../../../lib/site'
import { DocView } from '../../../components/DocView'

export const metadata: Metadata = {
  title: 'Interop fixtures',
  description:
    'The real exports nullroute is tested against: Coldcard, Specter, Jade, Keystone, Caravan and Electrum files and the BIP-129 vectors as Sparrow keeps them, and Bitcoin Core 31.1 exports, each with its source, hash and what nullroute does with it.',
  openGraph: { title: 'Interop fixtures | nullroute', images: [OG_IMAGE] },
}

export default function InteropPage() {
  return (
    <DocView
      file="spec/interop/README.md"
      title="Interop fixtures"
      crumbs={[{ href: '/device', label: 'Device' }]}
    />
  )
}
