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
    <div className="mx-auto max-w-6xl px-4 sm:px-6 py-24">
      <p className="label text-signal">404</p>
      <h1 className="mt-3 font-display text-[2.5rem] leading-[1.05] tracking-[-0.02em] text-ink sm:text-[3rem]">
        There is nothing at this address.
      </h1>
      <p className="mt-5 max-w-lg text-[1.0625rem] leading-relaxed text-body">
        The page you asked for does not exist. If you followed a link from the documentation, that
        is a broken cross-reference and worth reporting.
      </p>
      <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 font-sans text-[0.9375rem]">
        <li>
          <Link href="/" className="link">
            Back to the start
          </Link>
        </li>
        <li>
          <a
            href="https://github.com/Xaxis/nullroute/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="link"
          >
            Report a broken link
          </a>
        </li>
      </ul>
    </div>
  )
}
