import type { Metadata, Viewport } from 'next'
import Link from 'next/link'
import { Mark } from '@/components/Mark'
import { ShortHash } from '@/components/report'
import { readFacts } from '@/lib/facts'
import { NAV, OG_IMAGE, REPO_URL, VISIT_COUNTER } from '@/lib/site'
import '../styles/globals.css'

export const metadata: Metadata = {
  metadataBase: new URL('https://nullroute.diy'),
  title: {
    default: 'nullroute: an air-gapped Bitcoin signer built to be checked',
    template: '%s | nullroute',
  },
  description:
    'An air-gapped Bitcoin signer for the Raspberry Pi, built to be checked rather than trusted. Dice entropy you can reproduce by hand, byte-identical signatures, a machine-checkable specification for every module, and a draft signer profile with a conformance kit any signer can run. Pre-1.0, unaudited, hardware bring-up next.',
  openGraph: {
    title: 'nullroute',
    description: 'An air-gapped Bitcoin signer built to be checked, not trusted.',
    url: 'https://nullroute.diy',
    siteName: 'nullroute',
    type: 'website',
    images: [OG_IMAGE],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'nullroute',
    description: 'An air-gapped Bitcoin signer built to be checked, not trusted.',
    images: [OG_IMAGE],
  },
  robots: { index: true, follow: true },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f4f1' },
    { media: '(prefers-color-scheme: dark)', color: '#08090b' },
  ],
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const facts = readFacts()

  return (
    <html lang="en">
      <head>
        {/* The text face only. The others arrive when the first label or
            transcript needs them, and a page that preloads five fonts is a
            page that waits for five fonts. */}
        <link
          rel="preload"
          href="/fonts/SourceSerif4-Regular.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body className="min-h-screen flex flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded-[3px] focus:bg-ink focus:px-3 focus:py-2 focus:font-sans focus:text-sm focus:text-paper"
        >
          Skip to the content
        </a>

        {/* The header wraps rather than scrolls. A horizontal scroller with no
            visible affordance had the last links off the right edge of a 320px
            screen, reachable only by a swipe nobody knew to try. */}
        <header className="sticky top-0 z-30 border-b border-line bg-paper/92 backdrop-blur-[6px]">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
            <Link
              href="/"
              className="group inline-flex items-center gap-2 font-mono font-medium text-[0.9375rem] text-ink tracking-tight shrink-0"
            >
              <Mark className="size-[1.125rem] shrink-0 text-signal" />
              nullroute
            </Link>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto order-1 shrink-0 font-sans text-sm text-muted hover:text-ink transition-colors"
            >
              Source <span aria-hidden="true">&#8599;</span>
            </a>
            <nav
              aria-label="Site"
              className="order-2 basis-full sm:order-none sm:basis-auto flex flex-wrap items-center gap-x-5 gap-y-1 font-sans text-sm"
            >
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-body hover:text-ink transition-colors"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>

        <main id="main" className="flex-1">
          {children}
        </main>

        {/* A COLOPHON, the way a report ends: what it was built from, who
            stands behind it, and what the page itself does. */}
        <footer className="mt-24 border-t border-line bg-surface">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 py-12 grid gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="min-w-0 space-y-4">
              <span className="inline-flex items-center gap-2 font-mono font-medium text-ink">
                <Mark className="size-4 shrink-0 text-signal" />
                nullroute
              </span>
              <p className="font-sans text-sm leading-relaxed text-body max-w-md">
                Pre-1.0 and unaudited. No releases, no support, no warranty. Keep real money off it
                until hardware bring-up and an outside review are both done.
              </p>
              <p className="font-sans text-sm leading-relaxed text-muted max-w-md">
                This build of the site was made from manifest root{' '}
                <ShortHash value={facts.rootHash} />, after a verification run that{' '}
                {facts.passed ? 'passed' : 'FAILED'}. Every figure on it is read from the repository
                at build time.
              </p>
            </div>
            <div className="min-w-0 grid grid-cols-2 gap-x-8 gap-y-6 font-sans text-sm sm:grid-cols-3">
              <div>
                <div className="label mb-2.5">Read</div>
                <ul className="space-y-1.5">
                  <li>
                    <Link href="/check" className="text-body hover:text-ink">
                      Check it
                    </Link>
                  </li>
                  <li>
                    <Link href="/profile" className="text-body hover:text-ink">
                      Signer profile
                    </Link>
                  </li>
                  <li>
                    <Link href="/docs/threat-model" className="text-body hover:text-ink">
                      Threat model
                    </Link>
                  </li>
                </ul>
              </div>
              <div>
                <div className="label mb-2.5">Project</div>
                <ul className="space-y-1.5">
                  <li>
                    <Link href="/status" className="text-body hover:text-ink">
                      Status
                    </Link>
                  </li>
                  <li>
                    <Link href="/about" className="text-body hover:text-ink">
                      About
                    </Link>
                  </li>
                  <li>
                    <Link href="/docs/security" className="text-body hover:text-ink">
                      Report a flaw
                    </Link>
                  </li>
                </ul>
              </div>
              <div>
                <div className="label mb-2.5">Source</div>
                <ul className="space-y-1.5">
                  <li>
                    <a
                      href={REPO_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-body hover:text-ink"
                    >
                      GitHub <span aria-hidden="true">&#8599;</span>
                    </a>
                  </li>
                  <li>
                    <a
                      href={`${REPO_URL}/blob/main/LICENSE`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-body hover:text-ink"
                    >
                      MIT licence <span aria-hidden="true">&#8599;</span>
                    </a>
                  </li>
                  <li>
                    <Link href="/docs/contributing" className="text-body hover:text-ink">
                      Contributing
                    </Link>
                  </li>
                </ul>
              </div>
            </div>
          </div>
          {/* SAY WHAT THE COUNTER DOES, on every page it runs on. The site
              is the one part of this project that counts anything, and a
              reader of a threat model is owed the boundary between the two
              stated plainly rather than inferred from a policy header. */}
          <div className="border-t border-line">
            <p className="mx-auto max-w-6xl px-4 sm:px-6 py-6 font-sans text-[0.8125rem] leading-relaxed text-muted">
              This website counts visits with our own privacy-friendly analytics. Each page view
              sends the page&rsquo;s address, the referring site, your browser and device type, and
              how long and how far down the page was read. It sets no cookies and stores nothing in
              your browser unless you opt out; your IP address is used only to make a daily
              anonymous count and a rough location, and is never stored. To opt out on this site,
              open any page with <code className="code">?ov_ignore=1</code>, which leaves one flag
              in this browser so it stays off. The device has no analytics: its frontend can reach
              nothing but its own daemon (INV-NET-3). Type is Source Serif 4, IBM Plex and DejaVu
              Sans Mono, served from this domain.
            </p>
          </div>
        </footer>

        {/* The visit counter (see VISIT_COUNTER in lib/site.ts).

            A plain deferred <script>, not next/script. next/script injects
            the tag from client code after hydration, so it would be absent
            from the served HTML: a reader viewing the source would not see
            it, and tools/checks/check-web-isolation.mjs, which reads the
            built HTML, could not hold it to its settings. Here it is in every
            page's bytes, where both can. */}
        <script
          defer
          src={VISIT_COUNTER.src}
          data-site={VISIT_COUNTER.site}
          data-outbound="false"
          data-vitals="0"
        />
      </body>
    </html>
  )
}
