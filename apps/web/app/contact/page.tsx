import type { Metadata } from 'next'
import { ContactForm } from '../../components/ContactForm'
import { OG_IMAGE, REPO_URL } from '../../lib/site'

export const metadata: Metadata = {
  title: 'Contact',
  description:
    'Write to the maintainer of nullroute: questions, feedback, review, funding and press. Security flaws go through the security policy instead.',
  openGraph: { title: 'Contact | nullroute', images: [OG_IMAGE] },
}

/**
 * The one page on this site that sends something the reader typed.
 *
 * So it says, beside the form, exactly what is kept and where, in the same
 * plain terms as the footer's note on the visit counter. And it sends security
 * reports somewhere else: a flaw in a signer belongs in the private channel the
 * security policy describes, not in an inbox shared with press enquiries.
 */
export default function ContactPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6">
      <header className="pt-14 pb-10 sm:pt-20">
        <p className="eyebrow">Contact</p>
        <h1 className="mt-3 font-display text-[2.5rem] leading-[1.05] tracking-[-0.02em] text-ink sm:text-[3.5rem] max-w-[24ch]">
          Write to the maintainer.
        </h1>
        <p className="mt-5 max-w-[60ch] text-[1.125rem] leading-relaxed text-body">
          Questions about the device or the signer profile, feedback on the docs, an offer to review
          or contribute, funding, and press.
        </p>
      </header>

      <div className="grid gap-12 pb-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-16">
        <section aria-label="Message" className="min-w-0">
          <ContactForm />
        </section>

        <aside className="space-y-8 text-[0.9375rem] leading-relaxed text-body">
          <div>
            <h2 className="font-display text-[1.25rem] leading-snug text-ink">A security flaw?</h2>
            <p className="mt-2">
              Not here. Report it privately through the{' '}
              <a className="link" href="/docs/security">
                security policy
              </a>
              , which says how to reach the maintainer and what happens next.
            </p>
          </div>
          <div>
            <h2 className="font-display text-[1.25rem] leading-snug text-ink">A bug or an idea?</h2>
            <p className="mt-2">
              Open an issue on{' '}
              <a className="link" href={`${REPO_URL}/issues`}>
                GitHub
              </a>
              , where anyone can follow it and the fix will point back to it.
            </p>
          </div>
          <div>
            <h2 className="font-display text-[1.25rem] leading-snug text-ink">
              What this form keeps
            </h2>
            <p className="mt-2">
              Your name, email address, topic and message, and the network the message came from
              (the first three parts of an IPv4 address or the first three groups of an IPv6 one),
              never the full address. They are held by the maintainer&rsquo;s own console, hosted on
              Vercel with its database on Supabase in the United States, and emailed to the
              maintainer. Nothing is shared or used for anything else. Ask, and the message is
              deleted.
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}
