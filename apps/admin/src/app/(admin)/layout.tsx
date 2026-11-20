import type { ReactNode } from 'react'
import { Shell } from '@/components/Shell'
import { requireViewer } from '@/server/auth/viewer'
import { messageCounts } from '@/server/messages'

export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const viewer = await requireViewer()
  const counts = await messageCounts()
  return (
    <Shell
      email={viewer.email}
      items={[
        { href: '/', label: 'Overview' },
        { href: '/grants', label: 'Grants' },
        { href: '/messages', label: 'Messages', count: counts.new },
        { href: '/access', label: 'Access' },
      ]}
    >
      {children}
    </Shell>
  )
}
