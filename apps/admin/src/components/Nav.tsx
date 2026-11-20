'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from './ui'

export interface NavItem {
  href: string
  label: string
  count?: number
}

/** The section links; the current one is marked for sight and for screen readers. */
export function Nav({ items, layout }: { items: NavItem[]; layout: 'side' | 'top' }) {
  const path = usePathname()
  return (
    <nav
      aria-label="Sections"
      className={layout === 'side' ? 'space-y-0.5' : 'flex gap-1 overflow-x-auto'}
    >
      {items.map((item) => {
        const current = item.href === '/' ? path === '/' : path.startsWith(item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={current ? 'page' : undefined}
            className={cn(
              'flex items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-[0.875rem] whitespace-nowrap transition',
              current ? 'bg-sunk font-semibold text-ink' : 'text-body hover:bg-sunk hover:text-ink'
            )}
          >
            {item.label}
            {item.count ? (
              <span className="rounded-full bg-signal px-1.5 text-[0.6875rem] leading-[1.125rem] font-semibold text-paper">
                {item.count}
              </span>
            ) : null}
          </Link>
        )
      })}
    </nav>
  )
}
