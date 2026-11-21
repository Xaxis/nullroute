import type { Metadata } from 'next'
import Link from 'next/link'
import { REPO_URL, START_HREF } from '../lib/site'

export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false },
}

const PLACES: readonly (readonly [string, string, string])[] = [
  ['/', 'Overview', 'What the device is, the manifest root of this build, and what it costs.'],
  [START_HREF, 'Get started', 'The parts, the image and the first boot.'],
  [
    '/docs',
    'Documentation',
    'Every chapter, from the threat model to recovering without nullroute.',
  ],
  ['/status', 'Status and roadmap', 'What is built, what comes next, and the changelog.'],
]

/**
 * A custom 404 is mandatory, not cosmetic.
 *
 * Next's built-in not-found page hardcodes inline styles, which forces
 * `style-src 'unsafe-inline'` into the Content-Security-Policy for the whole
 * site. Replacing it is what lets the policy stay strict. Vercel serves this
 * file for every unmatched address (tools/build-vercel-output.mjs), and
 * check-web-live asks for one to prove it.
 */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-16 pb-24 sm:px-6 sm:pt-24">
      <h1 className="font-display text-[2.25rem] leading-[1.08] tracking-[-0.02em] text-ink sm:text-[3rem]">
        Page not found
      </h1>
      <p className="mt-5 max-w-[34rem] text-[1.0625rem] leading-relaxed text-body">
        Nothing on this site has that address. Pages that moved send you on, so this one either
        never existed or the link to it is wrong. A broken link inside the documentation is a bug
        worth{' '}
        <a href={`${REPO_URL}/issues`} target="_blank" rel="noopener noreferrer" className="link">
          reporting
        </a>
        .
      </p>
      <ul className="mt-12 max-w-3xl border-t border-line">
        {PLACES.map(([href, label, text]) => (
          <li key={href} className="border-b border-line">
            <Link
              href={href}
              className="group grid gap-1 py-4 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-8"
            >
              <span className="font-sans text-[0.9375rem] font-semibold text-ink group-hover:text-link">
                {label}
              </span>
              <span className="text-[0.9375rem] leading-relaxed text-body">{text}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-6 font-sans text-[0.875rem] text-muted">
        Looking for something in the documentation? The search at the top of the page covers every
        chapter.
      </p>
    </div>
  )
}
