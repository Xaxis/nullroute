'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NAV } from '@/lib/site'

/**
 * Whether a header item names the page being read. Verify is a chapter of
 * the docs, so it claims its own pages and Docs claims every other one.
 */
function isCurrent(href: string, path: string): boolean {
  const within = (base: string) => path === base || path.startsWith(`${base}/`)
  if (href === '/docs') return within('/docs') && !within('/docs/verification')
  return within(href)
}

/** The header's site links, with the current section marked for sight and for screen readers. */
export function NavLinks() {
  const path = usePathname()
  return NAV.map((item) => (
    <Link
      key={item.href}
      href={item.href}
      aria-current={isCurrent(item.href, path) ? 'page' : undefined}
      className="py-1.5 text-body transition-colors hover:text-ink aria-[current=page]:text-ink aria-[current=page]:underline aria-[current=page]:decoration-signal aria-[current=page]:decoration-2 aria-[current=page]:underline-offset-[7px]"
    >
      {item.label}
    </Link>
  ))
}
