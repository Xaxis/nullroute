import type { Metadata } from 'next'
import { OG_IMAGE } from '../../../lib/site'
import { DocView } from '../../../components/DocView'

export const metadata: Metadata = {
  title: 'Air-gapped signer profile, full text',
  description:
    'The draft signer profile: requirements for entropy, pre-signing review, signing, attestation, hardware, transport and dependencies, each naming its check. Every requirement id is a link target.',
  openGraph: { title: 'Air-gapped signer profile | nullroute', images: [OG_IMAGE] },
}

export default function ProfileSpecPage() {
  return (
    <DocView
      file="spec/signer-profile.md"
      title="Full text"
      crumbs={[{ href: '/profile', label: 'Profile' }]}
      requirements
    />
  )
}
