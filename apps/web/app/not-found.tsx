import Link from 'next/link'

/**
 * A custom 404 is mandatory, not cosmetic.
 *
 * Next's built-in not-found page hardcodes inline styles, which forces
 * `style-src 'unsafe-inline'` into the Content-Security-Policy for the whole
 * site. Replacing it is what lets the policy stay strict.
 */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-24">
      <p className="font-mono text-sm text-ink-500">404</p>
      <h1 className="mt-3 text-3xl font-semibold text-ink-100 tracking-tight">
        There is nothing at this address.
      </h1>
      <p className="mt-4 text-ink-400 max-w-lg leading-relaxed">
        The page you asked for does not exist. If you followed a link from the documentation, that
        is a broken cross-reference and worth reporting.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/"
          className="px-4 py-2 rounded border border-transparent bg-signal-500 text-ink-950 font-medium text-sm hover:bg-signal-400 transition-colors"
        >
          Back to the start
        </Link>
        <a
          href="https://github.com/Xaxis/nullroute/issues"
          target="_blank"
          rel="noopener noreferrer"
          className="px-4 py-2 rounded border border-ink-700 text-ink-200 text-sm hover:border-ink-500 transition-colors"
        >
          Report a broken link
        </a>
      </div>
    </div>
  )
}
