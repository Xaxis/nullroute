import Link from 'next/link'
import type { ReactNode } from 'react'
import { readFacts } from '../lib/facts'
import { readEntropyExample } from '../lib/entropy'
import { readParts, readPhases } from '../lib/status'
import { readProfile } from '../lib/profile'
import { docHref } from '../lib/docbook'
import { REPO_URL, START_HREF } from '../lib/site'
import { Shot, checkedScreens, type Screen } from '../components/Device'
import { Transcript } from '../components/report'

/**
 * The front page sells the product in the order a newcomer decides: what it
 * is, why it is different, how using it goes, how to check it, what to buy,
 * and where it stands. Everything longer lives in the docs, one click away.
 *
 * THE NUMBERS ARE STILL READ, NOT WRITTEN. The manifest root, the counts, the
 * parts list and the profile figures all come from the repository at build
 * time, and the root is quoted whole because check-site-root holds the built
 * page to the tree it was built from.
 *
 * HONEST ABOUT STATE IN THE FIRST SCREEN. Pre-release and unaudited is said
 * beside the call to action, not in a footer, because that is where somebody
 * decides whether to trust it.
 */

function screenFor(screens: readonly Screen[], file: string): Screen {
  const screen = screens.find((s) => s.file === file)
  if (screen === undefined) throw new Error(`nullroute.diy: no device screen named ${file}`)
  return screen
}

function SectionHead({
  eyebrow,
  title,
  children,
  id,
}: {
  eyebrow: string
  title: string
  children?: ReactNode
  id?: string
}) {
  return (
    <div className="max-w-2xl">
      <p className="eyebrow">{eyebrow}</p>
      <h2
        id={id}
        className="mt-2 font-display text-[1.875rem] leading-[1.12] tracking-[-0.015em] text-ink sm:text-[2.375rem] scroll-mt-20"
      >
        {title}
      </h2>
      {children === undefined ? null : (
        <p className="mt-4 text-[1.0625rem] leading-relaxed text-body">{children}</p>
      )}
    </div>
  )
}

export default async function Home() {
  const facts = readFacts()
  const phases = readPhases()
  const profile = readProfile()
  const { parts, cost } = readParts()
  const screens = checkedScreens(facts.has)
  // Recomputed from docs/ENTROPY.md at build time: the build stops if the
  // document's worked example and its digest disagree.
  const dice = readEntropyExample()
  // The last phase with any work in it. Phase 2 is complete apart from
  // release signing, which is why this is not a count of complete phases.
  const built = Math.max(...phases.filter((p) => p.kind !== 'not-started').map((p) => p.number))

  const features = [
    {
      title: 'No network, at all',
      body: 'No Wi-Fi, Bluetooth, cellular or NFC driver is on the card. Transactions cross the gap as QR codes you can see.',
      href: await docHref('docs/THREAT-MODEL.md', 'what-the-air-gap-does-and-does-not-do'),
    },
    {
      title: 'Dice you can check',
      body: 'Your seed is the SHA-256 of your dice rolls. Reproduce it on any computer with one command.',
      href: await docHref('docs/ENTROPY.md', 'mode-a-dice-only'),
    },
    {
      title: 'Read before you sign',
      body: 'Every output, the fee and the change on the device’s own screen. A suspicious transaction is held until you override it.',
      href: await docHref('docs/USING.md', 'signing-a-transaction'),
    },
    {
      title: 'Multisig across devices',
      body: 'Run several devices as one quorum. Each re-derives its own key and refuses a quorum it is not part of.',
      href: await docHref('docs/USING.md', 'multisig'),
    },
    {
      title: 'One number to compare',
      body: 'The lock screen shows the hash of every file that ships. Build from source and compare it before you type a PIN.',
      href: await docHref('docs/VERIFICATION.md', '1-the-manifest-and-the-root-hash'),
    },
    {
      title: 'An open standard',
      body: 'A draft signer profile and conformance kit that any air-gapped signer, not only this one, can be tested against.',
      href: '/profile',
    },
  ]

  const steps = [
    {
      title: 'Roll the dice',
      body: 'A hundred rolls of an ordinary die become your seed, by arithmetic you can repeat on any computer.',
      screen: screenFor(screens, 'dice'),
    },
    {
      title: 'Write the words once',
      body: 'The 24 words are shown once. On paper they are your backup, and they restore in other wallets too.',
      screen: screenFor(screens, 'seed'),
    },
    {
      title: 'Review, then sign',
      body: 'Scan your wallet’s QR code with a USB webcam. The device lays out what it would sign, refuses what it should not, and hands back a signed QR code.',
      screen: screenFor(screens, 'review'),
    },
  ]

  const stats = [
    { value: facts.specs, label: 'module specifications' },
    { value: facts.invariants, label: 'invariants, each bound to tests' },
    { value: facts.tests, label: 'tests in the suite' },
    { value: facts.files, label: 'files under one hash' },
  ]

  return (
    <>
      {/* --- Hero ------------------------------------------------------- */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 pt-14 pb-20 sm:pt-20 lg:pt-24">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-center">
          <div className="min-w-0">
            <p className="eyebrow">Open source air-gapped Bitcoin signer</p>
            <h1 className="mt-3 font-display text-[2.75rem] leading-[1.02] tracking-[-0.025em] text-ink sm:text-[3.75rem] lg:text-[4.25rem]">
              Built to be checked, not to be trusted.
            </h1>
            <p className="mt-6 max-w-xl text-[1.125rem] leading-relaxed text-body sm:text-[1.1875rem]">
              nullroute turns a Raspberry Pi and the official 7 inch touchscreen into a Bitcoin
              signing device with no network of any kind. Roll dice for your seed, move transactions
              by QR code, and read every one on the device before it signs.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href={START_HREF} className="btn btn-primary">
                Get started
              </Link>
              <Link href="/docs" className="btn btn-secondary">
                Read the docs
              </Link>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="px-2 py-3 text-[0.9375rem] font-semibold text-body hover:text-ink transition-colors"
              >
                View on GitHub <span aria-hidden="true">&#8599;</span>
              </a>
            </div>
            <p className="mt-6 inline-flex items-center gap-2 text-[0.875rem] text-muted">
              <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-signal" />
              Pre-release and unaudited. Hardware bring-up on a Pi 5 and a Pi 4 is next.
            </p>
          </div>
          <figure className="min-w-0">
            <Shot screen={screenFor(screens, 'lock')} eager link={false} />
            <figcaption className="mt-3 text-[0.8125rem] leading-snug text-muted">
              The first screen: the hash of the software it is about to run, shown before it asks
              for anything. Rendered from the device frontend at 800x480.
            </figcaption>
          </figure>
        </div>
      </section>

      {/* --- Features --------------------------------------------------- */}
      <section className="border-t border-line bg-surface">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-20">
          <SectionHead eyebrow="Why nullroute" title="Every claim is one you can check.">
            Most hardware wallets ask you to trust a chip and a company. nullroute is built from
            parts you can buy, code you can read, and a seed you can recompute by hand.
          </SectionHead>
          <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <li key={feature.title}>
                <Link href={feature.href} className="card h-full px-6 py-5 bg-paper">
                  <span className="block font-semibold text-ink text-[1.0625rem]">
                    {feature.title}
                  </span>
                  <span className="mt-2 block text-[0.9375rem] leading-relaxed text-body">
                    {feature.body}
                  </span>
                  <span className="mt-3 block text-[0.875rem] font-semibold text-link">
                    Learn more <span aria-hidden="true">&rarr;</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* --- How it works ----------------------------------------------- */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 py-20">
        <SectionHead eyebrow="How it works" title="From dice to a signature.">
          Your wallet software on a networked computer prepares transactions. The device holds the
          keys, shows you what you are signing, and has no network to reach.
        </SectionHead>
        <ol className="mt-12 grid gap-8 lg:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step.title} className="min-w-0">
              <Shot screen={step.screen} link={false} />
              <div className="mt-5 flex items-baseline gap-3">
                <span className="font-mono text-[0.8125rem] text-signal">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <h3 className="font-semibold text-ink text-[1.125rem]">{step.title}</h3>
              </div>
              <p className="mt-2 text-[0.9375rem] leading-relaxed text-body">{step.body}</p>
            </li>
          ))}
        </ol>
        <p className="mt-10">
          <Link href={await docHref('docs/USING.md')} className="link font-semibold">
            Every screen, and what each one refuses
          </Link>
        </p>
      </section>

      {/* --- Verify ----------------------------------------------------- */}
      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-20 grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start">
          <div className="min-w-0">
            <SectionHead
              eyebrow="Don’t trust, verify"
              title="One hash for every line of code that ships."
            >
              Before it asks for a PIN, the device shows the SHA-256 of a plain listing of all{' '}
              {facts.files} files it runs. Build the source, run one command with standard tools,
              and compare. If the two differ, do not enter your PIN.
            </SectionHead>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href={await docHref('docs/VERIFICATION.md', 'the-five-things-you-can-check')}
                className="btn btn-primary"
              >
                Five checks you can run
              </Link>
              <Link href={await docHref('docs/THREAT-MODEL.md')} className="btn btn-secondary">
                Read the threat model
              </Link>
            </div>
          </div>
          <div className="min-w-0">
            <Transcript
              label="Recomputing this build's manifest root"
              lines={[
                { cmd: 'git clone https://github.com/Xaxis/nullroute && cd nullroute' },
                {
                  cmd: 'sha256sum MANIFEST.lock',
                  out: (
                    <span className="text-ink break-all">{`${facts.rootHash}  MANIFEST.lock`}</span>
                  ),
                },
              ]}
            />
            <p className="mt-3 text-[0.8125rem] leading-snug text-muted">
              This build&rsquo;s root, read from the repository when this site was built. Nothing
              has been released yet, so there is no published value to compare against.
            </p>
            <Transcript
              className="mt-6"
              label="The seed rule, repeated with coreutils"
              lines={[
                {
                  cmd: `printf '%s' '${dice.rolls}' | sha256sum`,
                  out: <span className="text-ink break-all">{`${dice.digest}  -`}</span>,
                },
              ]}
            />
            <p className="mt-3 text-[0.8125rem] leading-snug text-muted">
              The seed rule with no code of ours: a hundred public example rolls from the entropy
              document, recomputed when this site was built. Never use these rolls for money.
            </p>
            <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-4">
              {stats.map((stat) => (
                <div key={stat.label} className="min-w-0">
                  <dt className="sr-only">{stat.label}</dt>
                  <dd>
                    <span className="block font-display text-[2rem] leading-none text-ink tabular-nums">
                      {stat.value}
                    </span>
                    <span className="mt-2 block text-[0.8125rem] leading-snug text-muted">
                      {stat.label}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>

      {/* --- Hardware --------------------------------------------------- */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 py-20">
        <SectionHead
          id="hardware"
          eyebrow="What you need"
          title={`Off-the-shelf parts, roughly ${cost}.`}
        >
          No secure element and nothing exotic. The device needs a 64-bit Raspberry Pi, the 800x480
          touchscreen it is laid out for, a webcam and an SD card.
        </SectionHead>
        <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {parts.map((part) => (
            <li key={`${part.part}-${part.what}`} className="card px-5 py-4">
              <span className="block text-[0.8125rem] text-muted">{part.part}</span>
              <span className="mt-1 block font-semibold text-ink">{part.what}</span>
            </li>
          ))}
        </ul>
        <p className="mt-8">
          <Link href={START_HREF} className="link font-semibold">
            How to build one
          </Link>
        </p>
      </section>

      {/* --- The standard ----------------------------------------------- */}
      <section className="border-t border-line bg-surface">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-20 grid gap-10 lg:grid-cols-2 lg:items-center">
          <SectionHead eyebrow="For every signer" title="Not just a device: an open standard.">
            The signer profile says what any air-gapped signer must show you and refuse to do:{' '}
            {profile.requirementCount} requirements, with {profile.caseCount} portable test cases in
            a conformance kit that runs against any signer through an adapter.
          </SectionHead>
          <div className="flex flex-wrap gap-3 lg:justify-end">
            <Link href="/profile" className="btn btn-primary">
              See the profile
            </Link>
            <Link href={await docHref('conformance/README.md')} className="btn btn-secondary">
              Run the kit
            </Link>
          </div>
        </div>
      </section>

      {/* --- Status ----------------------------------------------------- */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 py-20">
        <SectionHead eyebrow="Where it stands" title="Honest about what is not done.">
          Phases 1 to {built} of {phases.length} are built, apart from signing and publishing a
          release, and hardware bring-up is next. It has not been audited, so keep real money off it
          until bring-up and an outside review are both done.
        </SectionHead>
        <ol className="mt-10 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {phases.map((phase) => (
            <li key={phase.number} className="card px-5 py-4">
              <span className="flex items-center gap-2 text-[0.8125rem] text-muted">
                <span
                  aria-hidden="true"
                  className={`size-2 shrink-0 rounded-full ${
                    phase.kind === 'complete'
                      ? 'bg-verify-line'
                      : phase.kind === 'partial'
                        ? 'bg-signal'
                        : 'bg-border'
                  }`}
                />
                Phase {phase.number},{' '}
                {phase.kind === 'complete'
                  ? 'built'
                  : phase.kind === 'partial'
                    ? 'partly built'
                    : 'not started'}
              </span>
              <span className="mt-1.5 block text-[0.9375rem] font-semibold leading-snug text-ink">
                {phase.scope}
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-8">
          <Link href="/status" className="link font-semibold">
            The roadmap
          </Link>
        </p>
      </section>

      {/* --- Close ------------------------------------------------------ */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="card px-6 py-12 sm:px-12 text-center">
          <h2 className="font-display text-[1.875rem] leading-[1.15] tracking-[-0.015em] text-ink sm:text-[2.25rem]">
            Build one, or start by reading the code.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-body">
            MIT licensed, built in the open, and written to be read by people who do not trust its
            author.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href={START_HREF} className="btn btn-primary">
              Get started
            </Link>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary"
            >
              View on GitHub <span aria-hidden="true">&#8599;</span>
            </a>
          </div>
        </div>
      </section>
    </>
  )
}
