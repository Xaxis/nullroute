import type { Metadata } from 'next'
import Link from 'next/link'
import { OG_IMAGE, REPO_URL } from '../../lib/site'
import { A, C, Prose, Section } from '../../components/report'

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
    'The card targets the Pi 4 with the official 7 inch panel. Booting it on real hardware, and recording what the panel, touch, camera and network interfaces actually do, is the next milestone.',
  ],
  [
    'Find an overclaim',
    'This project’s value rests on being honest about its limits. A sentence in the docs or on this site that claims more than the code does is a bug, and reporting it is as useful as reporting one in the code.',
  ],
]

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6">
      <header className="pt-14 pb-14 sm:pt-20">
        <p className="eyebrow">About</p>
        <h1 className="mt-3 font-display text-[2.5rem] leading-[1.05] tracking-[-0.02em] text-ink sm:text-[3.5rem] max-w-[24ch]">
          One maintainer, an open method, and no lock-in.
        </h1>
      </header>

      <Section kicker="Who" title="Who maintains it." id="who">
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
            Contributions follow the rules in <A href="/docs/contributing">CONTRIBUTING.md</A>: the
            spec is written with the code, every invariant names a test that exists, and no
            dependency is added without a written reason, because every package is attack surface on
            a device that holds keys.
          </p>
        </Prose>
      </Section>

      <Section
        kicker="If it stops"
        title="What happens to your funds if this project stops."
        id="stops"
      >
        <Prose>
          <p>
            Nothing. A wallet here is a BIP-39 mnemonic and a canonical BIP-380 descriptor, and that
            is a rule rather than a habit: a feature that would make funds recoverable only by
            nullroute is forbidden (INV-INTEROP-1). The recovery drill restores and spends
            single-key wallets in all four script types and 2-of-3 quorums in <C>wsh</C> and taproot
            with Bitcoin Core alone, on every push to <C>main</C>.
          </p>
          <p>
            The signer profile and its vectors stand on their own too. They are JSON, pinned by a{' '}
            <C>SHA256SUMS</C> that coreutils checks, and the runner uses nothing but Node built-ins.
            Any signer can be held to them whether or not this device exists.
          </p>
        </Prose>
      </Section>

      <Section kicker="Help" title="Where help is worth most." id="help">
        <dl className="grid gap-px overflow-hidden rounded-[4px] border border-line bg-line sm:grid-cols-2">
          {HELP.map(([k, v]) => (
            <div key={k} className="bg-surface px-5 py-4">
              <dt className="font-display text-[1.25rem] leading-snug text-ink">{k}</dt>
              <dd className="mt-2 text-[1rem] leading-relaxed text-body">{v}</dd>
            </div>
          ))}
        </dl>
        <Prose className="mt-8">
          <p>
            Report a flaw privately through the <A href="/docs/security">security policy</A>.
            Anything else is an issue or a pull request on{' '}
            <A href={REPO_URL} external>
              GitHub
            </A>
            .
          </p>
        </Prose>
      </Section>

      <Section kicker="Licence" title="Free to read, run, change and redistribute." id="licence">
        <Prose>
          <p>
            The repository is MIT licensed. The official BIP test vectors in it are copies, and keep
            the terms of the BIPs they come from, and the wallet exports in{' '}
            <A href="/docs/interop">spec/interop</A> stay under Sparrow&rsquo;s Apache 2.0, its
            licence beside them. The typefaces on this site are Source Serif 4 and IBM Plex under
            the SIL Open Font Licence and DejaVu Sans Mono under its own free licence, self-hosted,
            with the licence texts beside the files.{' '}
            <Link href="/docs/contributing" className="link">
              How to contribute
            </Link>
            .
          </p>
        </Prose>
      </Section>
    </div>
  )
}
