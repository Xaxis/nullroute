import Link from 'next/link'
import type { ReactNode } from 'react'
import { readFacts } from '../lib/facts'
import { readEntropyExample } from '../lib/entropy'
import { readLog, readParts, readPhases, type Phase } from '../lib/status'
import { changedTheProfile, countWord, readProfile } from '../lib/profile'
import { docHref } from '../lib/docbook'
import { REPO_URL, START_HREF } from '../lib/site'
import { Shot, ShotOverlays, checkedScreens, type Screen } from '../components/Device'
import { Hash, InlineMd, Transcript } from '../components/report'
import { SigningLoop } from '../components/SigningLoop'
import { Die } from '../components/stage/Die'
import { ExplodedKit } from '../components/stage/ExplodedKit'
import { HeroScene } from '../components/stage/HeroScene'

/**
 * The front page, in the order a newcomer decides: what it is, the one number
 * that makes it checkable, how using it goes, exactly what it does and does
 * not do, what to buy, and where it stands. Everything longer is in the docs.
 *
 * WRITTEN LIKE A DATASHEET, NOT A LANDING PAGE. It used to be six sections of
 * eyebrow, headline, paragraph and a grid of cards, with a slogan in each, and
 * read like every other template. Each section now has the shape of its
 * content: a band for the hash, a diagram for the loop, a table for the
 * specification, a bill of materials for the parts, a rail for the phases.
 *
 * EVERY SPECIFICATION ROW CITES ITS DOCUMENT, through docHref, which stops the
 * build if the anchor is gone. A claim on the front page with no document
 * behind it is the overclaiming `make prose` exists to catch, in a place that
 * check cannot read.
 *
 * THE NUMBERS ARE STILL READ, NOT WRITTEN. The manifest root, the counts, the
 * parts and the phases come from the repository at build time, and the root is
 * quoted whole because check-site-root holds the built page to its tree.
 *
 * HONEST ABOUT STATE IN THE FIRST SCREEN. Pre-release and unaudited is said
 * beside the call to action, where somebody decides whether to trust it.
 */

function screenFor(screens: readonly Screen[], file: string): Screen {
  const screen = screens.find((s) => s.file === file)
  if (screen === undefined) throw new Error(`nullroute.diy: no device screen named ${file}`)
  return screen
}

/**
 * The opening sentence of a changelog entry, whole. The entries run to a
 * paragraph each, and the front page shows only that they happened and when;
 * the roadmap page has them in full.
 */
function Heading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2
      id={id}
      className="font-display text-[1.875rem] leading-[1.1] tracking-[-0.015em] text-ink sm:text-[2.25rem] scroll-mt-20"
    >
      {children}
    </h2>
  )
}

interface Row {
  readonly term: string
  readonly body: ReactNode
  readonly cite: string
  readonly href: string
}

const PHASE_STATE: Record<Phase['kind'], { label: string; bar: string; dot: string }> = {
  complete: { label: 'Complete', bar: 'bg-verify-line', dot: 'bg-verify-line' },
  partial: { label: 'Complete with exceptions', bar: 'bg-signal', dot: 'bg-signal' },
  'not-started': { label: 'Not started', bar: 'bg-border', dot: 'bg-border' },
}

/** What the hero names before anything else: the whole bill of hardware, one item per unbroken run. */
const KIT = ['Raspberry Pi', '7 inch touchscreen', 'USB webcam', 'one die'] as const

/** ", and three of its findings have changed the profile or its vectors", or nothing. */
function kitChanges(profile: ReturnType<typeof readProfile>): string {
  const n = profile.others.reduce(
    (sum, o) => sum + changedTheProfile(profile.findings.get(o.label) ?? []),
    0
  )
  if (n === 0) return ''
  const whose = profile.others.length === 1 ? 'its' : 'their'
  return `, and ${countWord(n)} of ${whose} findings ${n === 1 ? 'has' : 'have'} changed the profile or its vectors`
}

export default async function Home() {
  const facts = readFacts()
  const phases = readPhases()
  // The latest entries as they are, not a selection: picking the flattering
  // ones would make this a claim about momentum rather than a record of it.
  // The one exclusion is scope. This section is where the device stands, and
  // an entry that names nullroute.diy is about this website or its console;
  // those stay on the roadmap page with everything else.
  const recent = readLog()
    .filter((entry) => !entry.site)
    .slice(0, 4)
  const profile = readProfile()
  const { parts, cost } = readParts()
  const screens = checkedScreens(facts.has)
  // Recomputed from docs/ENTROPY.md at build time: the build stops if the
  // document's worked example and its digest disagree.
  const dice = readEntropyExample()
  // The last phase with any work in it. Phase 2 is complete apart from
  // release signing, which is why this is not a count of complete phases.
  const built = Math.max(...phases.filter((p) => p.kind !== 'not-started').map((p) => p.number))

  const steps = [
    { title: 'Roll a die a hundred times', screen: screenFor(screens, 'dice') },
    { title: 'Write the 24 words down, once', screen: screenFor(screens, 'seed') },
    { title: 'Read the transaction, then sign', screen: screenFor(screens, 'review') },
  ]

  const spec: readonly Row[] = [
    {
      term: 'Network',
      body: 'The image carries no Wi-Fi or Bluetooth driver, firmware or supplicant, and no SSH or DHCP client. The radio chip is still on the board, so anyone who can rewrite the card can put them back.',
      cite: 'VERIFICATION.md',
      href: await docHref('docs/VERIFICATION.md', 'hardware'),
    },
    {
      term: 'Transport',
      body: 'QR codes, both ways: a USB webcam reads them and the screen shows them. A transaction too big for one code goes as animated BBQr or UR, which Sparrow, Nunchuk, Coldcard, SeedSigner, Jade and Keystone read.',
      cite: 'USING.md',
      href: await docHref('docs/USING.md', 'codes-too-large-for-one-frame'),
    },
    {
      term: 'Seed',
      body: 'SHA-256 of a hundred d6 rolls, as ASCII digits with no trailing newline, so printf and sha256sum reproduce it anywhere. The device can choose instead, and says first that its choice cannot be checked by hand.',
      cite: 'ENTROPY.md',
      href: await docHref('docs/ENTROPY.md', 'mode-a-dice-only'),
    },
    {
      term: 'Review',
      body: 'Every output and which of them are change, the fee three ways, and a quorum’s signatures so far, all on the device’s own screen. A blocking warning disables Sign; going past it takes a tick for that one signature.',
      cite: 'USING.md',
      href: await docHref('docs/USING.md', 'signing-a-transaction'),
    },
    {
      term: 'Signatures',
      body: (
        <>
          Deterministic: RFC 6979 for ECDSA, BIP-340 with <code className="code">aux_rand</code>{' '}
          fixed to 32 zero bytes for Schnorr. Anyone with the seed can recompute the identical bytes
          and confirm nothing was hidden in them, and for the kit&rsquo;s six test transactions
          Bitcoin Core&rsquo;s own code writes the same signatures.
        </>
      ),
      cite: 'VERIFICATION.md',
      href: await docHref('docs/VERIFICATION.md', '4-reproducing-a-signature'),
    },
    {
      term: 'Multisig',
      body: (
        <>
          Builds native segwit quorums, <code className="code">wsh(sortedmulti)</code>, and signs
          taproot quorums a coordinator registers. Each device re-derives its own key and refuses a
          quorum it is not part of.
        </>
      ),
      cite: 'USING.md',
      href: await docHref('docs/USING.md', 'multisig'),
    },
    {
      term: 'Also',
      body: 'BIP-322 message signing, and checking someone else’s proof with the wallet locked. BIP-85 child seeds. BIP-329 labels.',
      cite: 'USING.md',
      href: await docHref('docs/USING.md', 'proving-an-address-and-checking-a-proof'),
    },
    {
      term: 'Storage',
      body: 'No secure element. The seed is encrypted on the card with AES-256-GCM, under a key stretched from your passphrase by Argon2id at 64 MiB and three passes. Someone who copies the card is held back by your passphrase and nothing else.',
      cite: 'THREAT-MODEL.md',
      href: await docHref('docs/THREAT-MODEL.md', 'out-of-scope'),
    },
    {
      term: 'Integrity',
      body: 'Before the PIN, the lock screen shows the manifest root of the application and the dm-verity root of the system partition, read from the live kernel table. dm-verity detects modification of that partition; without a signed boot chain it does not prevent it.',
      cite: 'USING.md',
      href: await docHref('docs/USING.md', 'the-lock-screen'),
    },
    {
      term: 'Recovery',
      body: 'Your words and a standard BIP-380 descriptor recover every wallet in other software, with no nullroute code in the path. The docs walk through it against Bitcoin Core.',
      cite: 'VERIFICATION.md',
      href: await docHref('docs/VERIFICATION.md', '5-recovering-without-nullroute'),
    },
    {
      term: 'Cryptography',
      body: (
        <>
          Every primitive comes from Paul Miller&rsquo;s <code className="code">@noble</code> and{' '}
          <code className="code">@scure</code> libraries. None is written here, and no signature is
          ever randomised.
        </>
      ),
      cite: 'CONTRIBUTING.md',
      href: await docHref('CONTRIBUTING.md', 'the-pinned-stack'),
    },
    {
      term: 'Checked by',
      body: `${String(facts.specs)} module specifications and ${String(facts.invariants)} invariants, each bound to tests, and ${String(facts.tests)} tests in the suite. CI runs all of it on every push.`,
      cite: 'VERIFICATION.md',
      href: await docHref('docs/VERIFICATION.md', '3-the-verification-report'),
    },
  ]

  return (
    <>
      {/* --- What it is ------------------------------------------------- */}
      <section className="stage on-plate">
        <div className="relative mx-auto grid max-w-7xl gap-4 px-4 pt-12 pb-4 sm:px-6 sm:pt-16 lg:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)] lg:items-center lg:gap-2 lg:pt-20 lg:pb-12">
          <div className="arrive relative z-10 min-w-0">
            <p className="font-mono text-[0.8125rem] text-muted">
              {KIT.map((part, i) => (
                <span key={part}>
                  <span className="whitespace-nowrap">
                    {part}
                    {i < KIT.length - 1 && <span aria-hidden="true">&nbsp;&middot;</span>}
                  </span>{' '}
                </span>
              ))}
            </p>
            <h1 className="mt-5 font-display text-[2.625rem] leading-[1.02] tracking-[-0.03em] text-ink sm:text-[3.75rem] lg:text-[4.375rem]">
              An air-gapped Bitcoin signer you build from a Raspberry&nbsp;Pi.
            </h1>
            <p className="mt-6 max-w-xl text-[1.0625rem] leading-relaxed text-body sm:text-[1.1875rem]">
              Your seed comes from a hundred rolls of a die, by arithmetic you can redo on any
              computer. Transactions cross by QR code. Before the device asks for a PIN, it shows
              one hash covering every file it runs, so you can check it against the source.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
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
                className="py-3 sm:px-2 text-[0.9375rem] font-semibold text-body hover:text-ink transition-colors"
              >
                Source on GitHub <span aria-hidden="true">&#8599;</span>
              </a>
            </div>
            <p className="mt-8 flex items-start gap-2.5 text-[0.875rem] leading-snug text-muted">
              <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-signal" />
              Pre-release and unaudited. Hardware bring-up on a Pi&nbsp;5 and a Pi&nbsp;4 is next.
            </p>
          </div>
          <figure className="mx-auto w-full min-w-0 max-w-xl lg:-mr-12 lg:max-w-none">
            <HeroScene />
            <figcaption className="mt-3 pb-8 font-mono text-[0.6875rem] leading-relaxed text-muted lg:pl-[14%]">
              The lock screen, rendered by the device&rsquo;s own frontend at
              800&thinsp;&times;&thinsp;480, showing this build&rsquo;s manifest root. The dm-verity
              root is a sample: a card&rsquo;s comes from its image build.
            </figcaption>
          </figure>
        </div>
      </section>

      {/* --- The number ------------------------------------------------- */}
      <section className="on-plate border-b border-plate-line" aria-labelledby="root">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 pt-14 pb-20 sm:pt-16 sm:pb-24">
          <h2 id="root" className="font-mono text-[0.8125rem] text-muted">
            Manifest root of this build &middot; SHA-256 over {facts.files} files
          </h2>
          <Hash
            value={facts.rootHash}
            className="hash-grid hash-flap hash-board reveal mt-7 grid-cols-4 text-ink leading-[1.15] text-[clamp(1.0625rem,6.4vw,1.75rem)] sm:grid-cols-8 sm:text-[clamp(1.25rem,2.9vw,2.5rem)]"
          />
          {/* Side by side only where the transcript's column holds the whole
              79-character sha256sum line; narrower, it wrapped MANIFEST.lock
              onto a line of its own and stopped looking like the output. */}
          <div className="mt-12 grid gap-10 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] xl:gap-14">
            <div className="min-w-0 max-w-xl">
              <p className="text-[1.0625rem] leading-relaxed text-body">
                The device shows this number on its lock screen before it asks for anything. It is
                the SHA-256 of a plain <code className="code">sha256sum</code> listing of every file
                the device runs, so standard tools recompute it and our own tools are not needed.
                Build the source, run one command, and compare. If the two differ, do not type your
                PIN.
              </p>
              <p className="mt-4 text-[0.875rem] leading-relaxed text-muted">
                Nothing has been released yet, so this is the root of the code as it stands, read
                from the repository when this page was built. Signed releases are planned, not
                built.
              </p>
              <p className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-[0.9375rem] font-semibold">
                <Link
                  href={await docHref('docs/VERIFICATION.md', 'the-five-things-you-can-check')}
                  className="link"
                >
                  The five checks you can run
                </Link>
                <Link href={await docHref('docs/THREAT-MODEL.md')} className="link">
                  The threat model
                </Link>
              </p>
            </div>
            <div className="min-w-0">
              <Transcript
                label="Recomputing this build's manifest root"
                lines={[
                  { cmd: 'git clone https://github.com/Xaxis/nullroute && cd nullroute' },
                  /* First the files against the listing, then the listing's
                     hash: the hash alone says nothing about the source. The
                     order docs/VERIFICATION.md gives. */
                  {
                    cmd: 'sha256sum -c MANIFEST.lock',
                    out: (
                      <span className="text-muted">
                        {`package-lock.json: OK\npackage.json: OK\n\u2026 and ${String(facts.files - 2)} more, each OK`}
                      </span>
                    ),
                  },
                  {
                    cmd: 'sha256sum MANIFEST.lock',
                    out: <span className="text-ink">{`${facts.rootHash}  MANIFEST.lock`}</span>,
                  },
                ]}
              />
            </div>
          </div>
        </div>
      </section>

      {/* --- How you use it --------------------------------------------- */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 py-20 sm:py-24">
        <div className="reveal max-w-2xl">
          <Heading id="use">How you use it</Heading>
          <p className="mt-4 text-[1.0625rem] leading-relaxed text-body">
            Your wallet software stays on your everyday computer and never sees a key. The device
            holds the keys and never sees a network. Every transaction crosses between them as a QR
            code you can watch.
          </p>
        </div>
        <div className="reveal mt-12">
          <SigningLoop />
        </div>
        {/* THE DEVICE AT ITS OWN SIZE. Three across, each panel rendered at
            under half size, and the captions cited text nobody could read. On
            a wide screen the steps are a list beside one panel at its real
            800 pixels, chosen with radio inputs rather than a script (see
            .steps in globals.css); on a phone they stack, and each opens full
            size. */}
        <div id="steps" className="steps reveal mt-16">
          {steps.map((step, index) => (
            <input
              key={step.screen.file}
              type="radio"
              name="step"
              id={`step-${String(index)}`}
              className="steps__radio"
              defaultChecked={index === 0}
              aria-label={step.title}
            />
          ))}
          <ol className="steps__list">
            {steps.map((step, index) => (
              <li key={step.title} className={`steps__item steps__item--${String(index)}`}>
                <label htmlFor={`step-${String(index)}`} className="steps__tab">
                  <span className="steps__title">
                    <span className="steps__num">{String(index + 1).padStart(2, '0')}</span>
                    {step.title}
                  </span>
                  <span className="steps__detail">{step.screen.detail}</span>
                </label>
                <div className="steps__panel">
                  <Shot screen={step.screen} />
                </div>
              </li>
            ))}
          </ol>
        </div>
        <p className="mt-10 text-[0.9375rem] font-semibold">
          <Link href={await docHref('docs/USING.md')} className="link">
            Every screen, and what each one refuses
          </Link>
        </p>
        {/* The one step whose arithmetic you can redo, done here. It sat under
            the first step alone, which left that column twice the length of
            the other two and the die resting on the next step's heading. */}
        <div className="reveal mt-16 grid gap-6 border-t border-line pt-10 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,2fr)] lg:gap-16">
          <div className="flex min-w-0 items-start gap-5">
            <Die className="die--rule mt-1 ml-2 shrink-0" />
            <div className="min-w-0">
              <h3 className="text-[1.0625rem] font-semibold text-ink">The seed rule, by hand</h3>
              <p className="mt-2 text-[0.9375rem] leading-relaxed text-body">
                The entropy is the SHA-256 of the rolls as ASCII digits, with no trailing newline,
                so any computer repeats it.
              </p>
            </div>
          </div>
          <div className="min-w-0">
            <Transcript
              label="The seed rule, repeated with coreutils"
              lines={[
                {
                  cmd: `printf '%s' '${dice.rolls}' | sha256sum`,
                  out: <span className="text-ink break-all">{`${dice.digest}  -`}</span>,
                },
              ]}
            />
            <p className="mt-2 text-[0.8125rem] leading-snug text-muted">
              The public example rolls from the entropy document, recomputed when this page was
              built. Never use them for money.
            </p>
          </div>
        </div>
        <ShotOverlays screens={steps.map((step) => step.screen)} closeTo="steps" />
      </section>

      {/* --- Specification ---------------------------------------------- */}
      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-20 sm:py-24 grid gap-10 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,2fr)] lg:gap-16">
          <div className="reveal min-w-0 lg:sticky lg:top-24 lg:self-start">
            <Heading id="specification">Specification</Heading>
            <p className="mt-4 text-[1rem] leading-relaxed text-body">
              What it does, what it refuses, and where it is weak. Each line names the document that
              says it in full.
            </p>
            <p className="mt-6 text-[0.9375rem] font-semibold">
              <Link href={await docHref('docs/THREAT-MODEL.md')} className="link">
                What it does not protect against
              </Link>
            </p>
          </div>
          <dl className="min-w-0 border-t border-line">
            {spec.map((row) => (
              <div
                key={row.term}
                className="reveal grid gap-x-8 gap-y-1 border-b border-line py-5 sm:grid-cols-[8.5rem_minmax(0,1fr)]"
              >
                <dt className="font-semibold text-ink text-[0.9375rem]">{row.term}</dt>
                <dd className="min-w-0 text-[0.9375rem] leading-relaxed text-body">
                  {row.body}{' '}
                  <Link
                    href={row.href}
                    className="whitespace-nowrap font-mono text-[0.75rem] text-muted underline decoration-border underline-offset-2 hover:text-link hover:decoration-current"
                  >
                    {row.cite}
                  </Link>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* --- Parts ------------------------------------------------------ */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 py-20 sm:py-24 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-x-16 lg:gap-y-8">
        <div className="reveal min-w-0 lg:col-start-2">
          <Heading id="hardware">Parts, roughly {cost}</Heading>
          <p className="mt-4 text-[1rem] leading-relaxed text-body">
            Off the shelf, with nothing exotic and nothing to solder. Flash the image to the card,
            check it, and assemble. The same card also carries a smaller build, a Zero&nbsp;2&nbsp;W
            behind a 4 inch panel, in bring-up with the rest.
          </p>
          <p className="mt-6 text-[0.9375rem] font-semibold">
            <Link href={START_HREF} className="link">
              How to build one
            </Link>
          </p>
        </div>
        <figure className="min-w-0 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:self-center">
          <ExplodedKit />
          <figcaption className="sr-only">
            The parts laid out: the screen above the board, the SD card, the webcam and a die.
          </figcaption>
        </figure>
        <div className="min-w-0 overflow-x-auto lg:col-start-2">
          <table className="w-full border-collapse text-left text-[0.9375rem]">
            <thead>
              <tr className="border-b border-ink">
                <th
                  scope="col"
                  className="py-2.5 pr-6 font-mono text-[0.75rem] font-normal uppercase tracking-[0.08em] text-muted"
                >
                  Part
                </th>
                <th
                  scope="col"
                  className="py-2.5 font-mono text-[0.75rem] font-normal uppercase tracking-[0.08em] text-muted"
                >
                  What to get
                </th>
              </tr>
            </thead>
            <tbody className="reveal-rows">
              {parts.map((part) => (
                <tr key={`${part.part}-${part.what}`} className="border-b border-line">
                  <th
                    scope="row"
                    className="py-3.5 pr-6 align-top font-normal text-muted whitespace-nowrap"
                  >
                    {part.part}
                  </th>
                  <td className="py-3.5 align-top font-semibold text-ink">{part.what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* --- The profile ------------------------------------------------ */}
      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-14 grid gap-8 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,2fr)] lg:gap-16 lg:items-center">
          <Heading id="profile">For every signer</Heading>
          <div className="min-w-0 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-2xl text-[1rem] leading-relaxed text-body">
              The draft signer profile says what any air-gapped signer should show you and refuse to
              do: {profile.requirementCount} requirements and {profile.caseCount} portable test
              cases whose expected values come from Bitcoin Core and the BIP texts, never from
              nullroute.
              {profile.others.length === 0
                ? ' The kit runs against any signer through an adapter.'
                : ` The kit already runs against ${profile.others.map((o) => `${o.label}\u2019s`).join(' and ')} own code${kitChanges(profile)}.`}
            </p>
            <div className="flex shrink-0 flex-wrap gap-3">
              <Link href="/profile" className="btn btn-secondary">
                Read the profile
              </Link>
              <Link href={await docHref('conformance/README.md')} className="btn btn-secondary">
                Run the kit
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* --- Where it stands -------------------------------------------- */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 py-20 sm:py-24">
        <div className="reveal max-w-2xl">
          <Heading id="status">Where it stands</Heading>
          <p className="mt-4 text-[1.0625rem] leading-relaxed text-body">
            Phases 1 to {built} of {phases.length} are built, apart from signing and publishing a
            release. Hardware bring-up is next. One person has written it and nobody else has
            reviewed it yet, so keep real money off it until bring-up and an outside review are both
            done.
          </p>
        </div>
        <ol className="phases reveal-rows mt-12 grid gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-7 lg:gap-y-0">
          {phases.map((phase) => {
            const state = PHASE_STATE[phase.kind]
            return (
              <li
                key={phase.number}
                className="min-w-0 lg:row-span-3 lg:grid lg:grid-rows-subgrid lg:content-start"
              >
                <span
                  aria-hidden="true"
                  className={`phase__bar block h-1 rounded-full ${state.bar}`}
                />
                <p className="mt-3 font-mono text-[0.75rem] leading-snug text-muted">
                  <span className="block text-ink">Phase {phase.number}</span>
                  <span className="block">{state.label}</span>
                </p>
                <p className="mt-2 text-[0.875rem] leading-snug text-body">{phase.scope}</p>
              </li>
            )
          })}
        </ol>
        <div className="mt-16 grid gap-6 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,2fr)] lg:gap-16">
          <h3 className="text-[1.0625rem] font-semibold text-ink lg:pt-3.5">Recently landed</h3>
          <ol className="reveal-rows min-w-0 border-t border-line">
            {recent.map((entry, i) => (
              <li
                key={`${entry.date}-${String(i)}`}
                className="grid gap-1 border-b border-line py-3.5 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-6"
              >
                <span className="pt-0.5 font-mono text-[0.8125rem] text-muted tabular-nums">
                  {entry.date}
                </span>
                <span className="min-w-0 max-w-[72ch] text-[0.9375rem] leading-relaxed text-body">
                  <InlineMd text={entry.headline} />
                </span>
              </li>
            ))}
          </ol>
        </div>
        <p className="mt-12 flex flex-wrap gap-x-6 gap-y-2 text-[0.9375rem] font-semibold">
          <Link href="/status#log" className="link">
            Everything that has landed
          </Link>
          <Link href="/status" className="link">
            The roadmap
          </Link>
          <Link href="/about" className="link">
            Who maintains it
          </Link>
          <a
            href={`${REPO_URL}/tree/main/packages/core`}
            target="_blank"
            rel="noopener noreferrer"
            className="link"
          >
            Read the code that holds keys <span aria-hidden="true">&#8599;</span>
          </a>
        </p>
      </section>
    </>
  )
}
