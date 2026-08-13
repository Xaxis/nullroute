import type { Metadata, Viewport } from 'next'
import Link from 'next/link'
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

const NAV = [
  { href: '/docs/threat-model', label: 'Threat model' },
  { href: '/docs/verification', label: 'Verification' },
  { href: '/docs/entropy', label: 'Entropy' },
  { href: '/docs/provisioning', label: 'Provisioning' },
]

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col">
        <header className="border-b border-ink-800 sticky top-0 z-20 bg-ink-950/95 backdrop-blur-sm">
          <div className="mx-auto max-w-5xl px-5 h-14 flex items-center gap-4 sm:gap-6">
            <Link
              href="/"
              className="font-mono text-ink-100 font-semibold tracking-tight shrink-0 hover:text-signal-400 transition-colors"
            >
              nullroute
            </Link>
            <nav className="flex items-center gap-5 text-sm overflow-x-auto min-w-0">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-ink-400 hover:text-ink-100 transition-colors whitespace-nowrap"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <a
              href="https://github.com/Xaxis/nullroute"
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto shrink-0 text-sm text-ink-400 hover:text-ink-100 transition-colors whitespace-nowrap"
            >
              Source
            </a>
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
