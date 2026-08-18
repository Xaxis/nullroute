import type { Metadata, Viewport } from 'next'
import Link from 'next/link'
import { DOCS } from '@/lib/docs'
import '../styles/globals.css'

export const metadata: Metadata = {
  metadataBase: new URL('https://nullroute.diy'),
  title: {
    default: 'nullroute',
    template: '%s | nullroute',
  },
  description:
    'An air-gapped Bitcoin signer built to be checked rather than trusted. Dice entropy you can reproduce by hand, byte-identical signatures, and a machine-checkable specification for every module. You should not use it; read it and build your own.',
  openGraph: {
    title: 'nullroute',
    description: 'An air-gapped Bitcoin signer built to be checked, not trusted.',
    url: 'https://nullroute.diy',
    siteName: 'nullroute',
    type: 'website',
  },
  robots: { index: true, follow: true },
}

export const viewport: Viewport = {
  themeColor: '#0b0c0e',
  width: 'device-width',
  initialScale: 1,
}

/**
 * The header links, derived from the document set rather than listed again.
 *
 * They were listed again, and two documents were published for a week with no
 * link to them from anywhere: the pages built, the sitemap listed them, and the
 * only route in was to type the URL. Deriving it means a new document is in the
 * header the moment it is registered, which is the only version of this that
 * stays true.
 */
const NAV = DOCS.map((doc) => ({ href: `/docs/${doc.slug}`, label: doc.navLabel }))

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col">
        {/* The header wraps rather than scrolls. A horizontal scroller with no
            visible affordance had the last two links off the right edge of a
            320px screen, reachable only by a swipe nobody knew to try, and
            every check passed because the document itself did not scroll. */}
        <header className="border-b border-ink-800 sticky top-0 z-20 bg-ink-950/95 backdrop-blur-sm">
          <div className="mx-auto max-w-5xl px-5 py-3 flex flex-wrap items-center gap-x-5 gap-y-2">
            <Link
              href="/"
              className="font-mono text-ink-100 font-semibold tracking-tight shrink-0 hover:text-signal-400 transition-colors"
            >
              nullroute
            </Link>
            <a
              href="https://github.com/Xaxis/nullroute"
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto order-1 shrink-0 text-sm text-ink-400 hover:text-ink-100 transition-colors"
            >
              Source
            </a>
            <nav className="order-2 basis-full sm:order-none sm:basis-auto flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-ink-400 hover:text-ink-100 transition-colors"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>

        <main className="flex-1">{children}</main>

        <footer className="border-t border-ink-800 mt-24">
          <div className="mx-auto max-w-5xl px-5 py-10">
            <p className="text-sm text-caution-300 max-w-2xl leading-relaxed">
              Pre-1.0, unaudited, and not a product. No releases, no support, no warranty. Do not
              put money on this.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-ink-500">
              <span className="font-mono text-ink-400">nullroute</span>
              <span>MIT licensed</span>
              <a
                href="https://github.com/Xaxis/nullroute"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-ink-200 transition-colors"
              >
                github.com/Xaxis/nullroute
              </a>
            </div>
          </div>
        </footer>
      </body>
    </html>
  )
}
