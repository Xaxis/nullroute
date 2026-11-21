import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { OG_IMAGE, REPO_URL } from '../../lib/site'
import { A, C, Prose, Ruled, Section } from '../../components/report'

export const metadata: Metadata = {
  title: 'About',
  description:
    'Who maintains nullroute, under what licence, how to help, how to report a flaw, and what happens to your funds if the project stops.',
  openGraph: { title: 'About | nullroute', images: [OG_IMAGE] },
}

/**
 * Who, under what terms, and what happens if they stop.
 *
 * The question a careful reader asks of any key-holding software before they
 * ask about features, and the one this project has the plainest answer to:
 * nothing it makes can only be recovered by it.
 */
const HELP: readonly (readonly [string, string])[] = [
  [
    'Run the kit against another signer',
    'Write an adapter for a signer you know and run the profile’s vectors against it. A second implementation is the test of whether the profile can be met as written, and every disagreement is a finding for one side or the other.',
  ],
  [
    'Read the code that holds keys',
    'packages/core and the signing paths in packages/daemon are small on purpose. Read them against their specs and tell us where a spec is wrong, not only where the code is.',
  ],
  [
    'Bring up a board',
    'The card targets a Pi\u00a04 or a Pi\u00a05 with the official 7 inch panel, and boots and verifies itself under QEMU today. Booting it on a board, and recording what the panel, touch, camera and network interfaces actually do, is the next milestone.',
  ],
  [
    'Find an overclaim',
    'This project’s value rests on being honest about its limits. A sentence in the docs or on this site that claims more than the code does is a bug, and reporting it is as useful as reporting one in the code.',
  ],
]

/**
 * What a reader looking for the project's footing wants in one glance. Every
 * value is a link to where it is stated in full, or a fact this page states.
 */
const FACTS: readonly (readonly [string, ReactNode])[] = [
  [
    'Maintainer',
    <A key="m" href="https://github.com/Xaxis" external>
      Xaxis
    </A>,
  ],
  ['Licence', 'MIT'],
  [
    'Source',
    <A key="s" href={REPO_URL} external>
      GitHub
    </A>,
  ],
  ['State', 'Pre-release, unaudited'],
  ['Next', 'Hardware bring-up on a Pi\u00a05 and a Pi\u00a04'],
  [
    'A flaw',
    <A key="f" href="/docs/security">
      Security policy
    </A>,
  ],
  [
    'Anything else',
    <A key="c" href="/contact">
      Contact
    </A>,
  ],
]

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6">
      <header className="pt-14 pb-12 sm:pt-20">
        <h1 className="font-display text-[2.5rem] leading-[1.05] tracking-[-0.02em] text-ink sm:text-[3.5rem]">
          About nullroute
        </h1>
        <p className="mt-5 max-w-[60ch] text-[1.125rem] leading-relaxed text-body">
          nullroute is written in public by one maintainer under the MIT licence. This page says who
          that is, what happens to your funds if the project stops, and where help would make the
          most difference.
        </p>
      </header>

      <div className="grid gap-x-16 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <aside
          aria-label="The project at a glance"
          className="border-t border-line py-10 lg:order-last lg:sticky lg:top-16 lg:self-start lg:py-14"
        >
          <dl className="grid grid-cols-2 gap-x-6 gap-y-5 text-[0.9375rem] lg:grid-cols-1">
            {FACTS.map(([term, value]) => (
              <div key={term} className="min-w-0">
                <dt className="font-mono text-[0.75rem] uppercase tracking-[0.08em] text-muted">
                  {term}
                </dt>
                <dd className="mt-1 text-ink">{value}</dd>
              </div>
            ))}
          </dl>
        </aside>
        <div className="min-w-0">
          <Section title="Who maintains it" id="who">
            <Prose>
              <p>
                nullroute is written and maintained by{' '}
                <A href="https://github.com/Xaxis" external>
                  Xaxis
                </A>
                , in public on{' '}
                <A href={REPO_URL} external>
                  GitHub
                </A>
                , under the MIT licence. One person has written it, and so far only that person has
                reviewed it. That is the main reason to keep real money off it, and the reason an
                outside review is the milestone after hardware bring-up.
              </p>
              <p>
                Contributions follow the rules in <A href="/docs/contributing">CONTRIBUTING.md</A>:
                the spec is written with the code, every invariant names a test that exists, and no
                dependency is added without a written reason, because every package is attack
                surface on a device that holds keys.
              </p>
            </Prose>
          </Section>

          <Section title="If the project stops" id="stops">
            <Prose>
              <p>
                Nothing. A wallet here is a BIP-39 mnemonic and a canonical BIP-380 descriptor, and
                that is a rule rather than a habit: a feature that would make funds recoverable only
                by nullroute is forbidden (INV-INTEROP-1). The recovery drill restores and spends
                single-key wallets in all four script types and 2-of-3 quorums in <C>wsh</C> and
                taproot with Bitcoin Core alone, on every push to <C>main</C>.
              </p>
              <p>
                The signer profile and its vectors stand on their own too. They are JSON, pinned by
                a <C>SHA256SUMS</C> that coreutils checks, and the runner uses nothing but Node
                built-ins. Any signer can be held to them whether or not this device exists.
              </p>
            </Prose>
          </Section>

          <Section title="Where help is worth most" id="help">
            <Ruled items={HELP} />
            <Prose className="mt-8">
              <p>
                Report a flaw privately through the <A href="/docs/security">security policy</A>.
                Code is an issue or a pull request on{' '}
                <A href={REPO_URL} external>
                  GitHub
                </A>
                , and anything else, from a question to a review offer, goes through the{' '}
                <A href="/contact">contact page</A>.
              </p>
            </Prose>
          </Section>

          <Section title="Licence" id="licence">
            <Prose>
              <p>
                The repository is MIT licensed. The official BIP test vectors in it are copies, and
                keep the terms of the BIPs they come from, and the wallet exports in{' '}
                <A href="/docs/interop">spec/interop</A> stay under Sparrow&rsquo;s Apache 2.0, its
                licence beside them. The typefaces on this site are Source Serif 4 and IBM Plex
                under the SIL Open Font Licence and DejaVu Sans Mono under its own free licence,
                self-hosted, with the licence texts beside the files.{' '}
                <Link href="/docs/contributing" className="link">
                  How to contribute
                </Link>
                .
              </p>
            </Prose>
          </Section>
        </div>
      </div>
    </div>
  )
}
