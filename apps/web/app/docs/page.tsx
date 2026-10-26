import type { Metadata } from 'next'
import Link from 'next/link'
import { DOCS } from '../../lib/docs'
import { OG_IMAGE } from '../../lib/site'
import { Prose } from '../../components/report'

export const metadata: Metadata = {
  title: 'Documentation',
  description:
    'The threat model, how to install and check the device, what each screen does and refuses, the entropy procedure, the security policy and how to contribute. Rendered from the repository, byte for byte.',
  openGraph: { title: 'Documentation | nullroute', images: [OG_IMAGE] },
}

/**
 * Every document, by the question it answers. A reader arrives with a
 * question, not a file name, so the question leads and the title follows.
 */
export default function DocsIndex() {
  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <header className="pt-12 pb-10 sm:pt-16">
        <div className="label">Docs</div>
        <h1 className="mt-3 font-display text-[2.5rem] leading-[1.05] tracking-[-0.02em] text-ink sm:text-[3.5rem]">
          The documents, by the question each answers.
        </h1>
        <Prose className="mt-6 text-[1.1875rem]">
          <p>
            Rendered from the repository at build time, so each page is the same bytes a reviewer
            reads in the source, and each says so with the file&rsquo;s SHA-256 at the foot.
          </p>
        </Prose>
      </header>
      <ul className="border-t border-line">
        {DOCS.map((doc) => (
          <li key={doc.slug} className="border-b border-line">
            <Link
              href={`/docs/${doc.slug}`}
              className="group grid gap-2 py-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:gap-10"
            >
              <div className="min-w-0">
                <div className="font-display text-[1.375rem] leading-snug text-ink group-hover:text-link transition-colors">
                  {doc.question}
                </div>
                <div className="mt-1 font-mono text-[0.75rem] text-muted">{doc.file}</div>
              </div>
              <p className="min-w-0 text-[1rem] leading-relaxed text-body">
                <span className="font-sans font-semibold text-[0.9375rem] text-ink">
                  {doc.title}.
                </span>{' '}
                {doc.summary}
              </p>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-8 font-sans text-[0.9375rem] text-body">
        The signer profile and the conformance kit have their own pages:{' '}
        <Link href="/profile" className="link">
          the profile
        </Link>
        .
      </p>
    </div>
  )
}
