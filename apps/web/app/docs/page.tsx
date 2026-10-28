import type { Metadata } from 'next'
import Link from 'next/link'
import { DocsShell } from '../../components/DocsShell'
import { docHref, loadBook } from '../../lib/docbook'
import { OG_IMAGE } from '../../lib/site'

export const metadata: Metadata = {
  title: 'Documentation',
  description:
    'Install, use and check nullroute: the device, its threat model, the verification procedure, the entropy procedure and the signer profile. Rendered from the repository, byte for byte.',
  openGraph: { title: 'Documentation | nullroute', images: [OG_IMAGE] },
}

/**
 * The front door of the docs: the tasks people arrive to do, then the whole
 * set by group. A reader arrives with a task, not a file name.
 */
export default async function DocsHome() {
  const book = await loadBook()
  const tasks = [
    {
      title: 'Try it on your computer',
      body: 'The whole device in a browser, in three commands.',
      href: await docHref('docs/INSTALL.md', 'running-it-on-your-computer'),
    },
    {
      title: 'Get a card for a Pi',
      body: 'Download the card CI built and booted, or build it yourself.',
      href: await docHref('docs/INSTALL.md', 'a-card-from-ci-for-bring-up'),
    },
    {
      title: 'Sign a transaction',
      body: 'What the review screen shows, and what it refuses to sign.',
      href: await docHref('docs/USING.md', 'signing-a-transaction'),
    },
    {
      title: 'Check a device',
      body: 'Five checks you can run without trusting this project.',
      href: await docHref('docs/VERIFICATION.md', 'the-five-things-you-can-check'),
    },
  ]

  return (
    <DocsShell book={book} here="/docs">
      <header className="max-w-[46rem]">
        <p className="eyebrow">Documentation</p>
        <h1 className="mt-2 font-display text-[2.25rem] leading-[1.1] tracking-[-0.015em] text-ink sm:text-[2.75rem]">
          Build it, use it, check it.
        </h1>
        <p className="mt-4 text-[1.0625rem] leading-relaxed text-body">
          Everything about nullroute, from a first run on your laptop to the threat model. Every
          page is rendered from a file in the repository, so what you read here is what ships with
          the code.
        </p>
      </header>

      <section aria-labelledby="tasks" className="mt-10">
        <h2 id="tasks" className="label">
          Start with a task
        </h2>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {tasks.map((task) => (
            <li key={task.href}>
              <Link href={task.href} className="card h-full px-5 py-4">
                <span className="block font-semibold text-ink">{task.title}</span>
                <span className="mt-1 block text-[0.9375rem] leading-snug text-muted">
                  {task.body}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {book.groups.map((group) => (
        <section key={group.name} aria-label={group.name} className="mt-12">
          <h2 className="label">{group.name}</h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {group.chapters.map((chapter) => (
              <li key={chapter.href}>
                <Link href={chapter.href} className="card h-full px-5 py-4">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold text-ink">{chapter.meta.title}</span>
                    <span className="shrink-0 text-[0.75rem] text-muted">
                      {chapter.sections.length} pages
                    </span>
                  </span>
                  <span className="mt-1 block text-[0.9375rem] leading-snug text-muted">
                    {chapter.meta.summary}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </DocsShell>
  )
}
