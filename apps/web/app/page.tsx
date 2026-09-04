import Link from 'next/link'
import { DOCS } from '../lib/docs'
import { readFacts } from '../lib/facts'
import { Hero } from '../components/hero/Hero'
import { Section } from '../components/Section'
import { Terminal } from '../components/Terminal'
import { REPO_URL } from '../lib/site'

/**
 * This is a build record, not a product page, and it makes ONE argument: you
 * can check this yourself, and the check is the first thing on the screen.
 *
 * WHY IT IS THIS SHORT. It was 6,568 pixels, which is seven screens of
 * scrolling on a laptop, and about ten thousand words of it were prose in
 * two-column tables that all looked the same. Four numbered sections, one of
 * which was an eleven row feature list and another a five paragraph legend for
 * a five line transcript. A page that long about a device nobody should use yet
 * is not thorough, it is a wall, and a reader who bounces off it has learned
 * nothing about the one thing worth knowing.
 *
 * The argument needs four beats and it has four: what it is, the check, why not
 * to use it, and where the detail lives. Everything cut is in docs/, which is
 * where a person who wants it will look.
 *
 * WHAT SURVIVED THE CUT AND WHY. The transcript, because it is real output and
 * the entire pitch. The manifest root, because it is the number a reader
 * compares. And the capability list, in short form, because the mechanism
 * behind it is load-bearing: a row appears only when the verifier reports every
 * spec it names as implemented, so this page cannot describe something that is
 * not built. The paragraphs of detail under each row went; the gate did not.
 *
 * Nothing here tries to convert a reader into a user. There is no quickstart,
 * no roadmap promising future value, and the reasons not to use this are on the
 * page rather than in a footnote.
 */

/**
 * What the device can do, and the specs that have to exist for each claim.
 *
 * SHORT PHRASES, NOT PARAGRAPHS. Each of these used to carry sixty words of
 * detail, which is a documentation page rendered on a landing page. The detail
 * is in docs/ and the link is at the bottom.
 *
 * A row appears only when every spec it names is implemented, so this list can
 * be written ahead of the code without ever asserting something untrue.
 * Removing a module removes its row rather than leaving a sentence behind.
 */
const WORKING: readonly { term: string; specs: readonly string[] }[] = [
  {
    term: 'Dice into a seed, checkable by hand',
    specs: ['core.entropy.dice', 'core.bip39.mnemonic', 'core.derive.hd'],
  },
  {
    term: 'Addresses and descriptors other software restores',
    specs: ['core.address.derive', 'core.descriptor.parse', 'core.descriptor.checksum'],
  },
  {
    term: 'Transactions reviewed before they are signed',
    specs: ['core.psbt.review', 'core.psbt.sign'],
  },
  {
    term: 'Multisig across several devices',
    specs: ['core.descriptor.multisig', 'daemon.multisig', 'core.psbt.quorum'],
  },
  { term: 'Several wallets, encrypted at rest', specs: ['daemon.store', 'daemon.store.registry'] },
  {
    term: 'Backups, labels and child seeds',
    specs: ['daemon.store.backup', 'core.labels', 'core.bip85'],
  },
  { term: 'Proving an address, and checking somebody else’s', specs: ['core.message.bip322'] },
  { term: 'Closing itself when you walk away', specs: ['daemon.idle'] },
  { term: 'Data across the gap by camera', specs: ['core.qr.encode', 'core.qr.bbqr'] },
]

/**
 * The reasons not to use this, as lines rather than as an essay.
 *
 * These were four paragraphs in a table, first on the page, before the reader
 * had been told what the thing was. They are still first among the sections,
 * because burying them would be the failure this project is about, and they are
 * now short enough to actually be read.
 */
const REFUSALS: readonly (readonly [string, string])[] = [
  [
    'It is not audited',
    'One person wrote it. No third party has reviewed the cryptography, and the code that holds keys has never been looked at by anyone but its author.',
  ],
  [
    'The OS integrity gap is open',
    'dm-verity and boot attestation are not landed. Until they are, a device whose boot partition was rewritten displays whatever root hash the attacker chose.',
  ],
  [
    'There is no image to flash',
    'The build that would put this on a card does not exist yet. What exists is the contract that build has to satisfy.',
  ],
  [
    'It will not save you from a person',
    'The duress features buy time against somebody unsophisticated. This codebase is public, so anyone who reads it knows exactly what they do.',
  ],
]

export default function HomePage() {
  const facts = readFacts()
  const working = WORKING.filter((entry) => entry.specs.every((id) => facts.has(id)))

  return (
    <>
      {/* Outside the column, because its backdrop is full bleed and the only
          honest way to draw one is to be full width rather than to escape a
          narrower parent with a viewport unit. See the comment in Hero. */}
      <Hero facts={facts} />

      <div className="mx-auto max-w-5xl px-5">
        {/* --- 01 The check ----------------------------------------------- */}
        <Section index="01" label="How you check it">
          <p className="text-lg text-ink-200 max-w-2xl leading-relaxed">
            Every module ships a specification a machine reads. The build fails when the code, the
            specs and the tests stop agreeing, so the specification cannot quietly fall behind the
            thing it describes.
          </p>

          <div className="mt-8">
            <Terminal command="make verify" facts={facts} />
          </div>

          <p className="mt-8 text-base text-ink-400 max-w-2xl leading-relaxed">
            The last line is the manifest root: every source file hashed, sorted under{' '}
            <code className="font-mono text-ink-300">LC_ALL=C</code>, in a format coreutils produced
            and coreutils can check. The device prints the same string on its lock screen. Build the
            source yourself and compare the two. If they differ, do not enter your PIN.{' '}
            <Link
              href="/docs/verification"
              className="text-signal-400 hover:text-signal-300 underline underline-offset-4 decoration-ink-700"
            >
              How to do that
            </Link>
            .
          </p>

          {working.length > 0 && (
            <div className="mt-10">
              <p className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-ink-500">
                Specified and implemented
              </p>
              <ul className="mt-4 grid gap-x-8 gap-y-2 sm:grid-cols-2">
                {working.map((entry) => (
                  <li key={entry.term} className="text-sm text-ink-300 leading-relaxed">
                    {entry.term}
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-sm text-ink-500 leading-relaxed">
                Each line is present because the verifier reports every spec behind it as
                implemented. Nothing here is typed in by hand.
              </p>
            </div>
          )}
        </Section>

        {/* --- 02 Reasons not to --------------------------------------------- */}
        <Section index="02" label="Do not use this">
          <p className="text-lg text-ink-200 max-w-2xl leading-relaxed">
            Not modesty. Four specific reasons, and any one of them is enough.
          </p>

          <dl className="mt-8 divide-y divide-ink-850 border-y border-ink-850">
            {REFUSALS.map(([term, detail]) => (
              <div key={term} className="py-5 sm:grid sm:grid-cols-[15rem_minmax(0,1fr)] sm:gap-8">
                <dt className="text-sm font-medium text-caution-300">{term}</dt>
                <dd className="mt-1.5 sm:mt-0 text-sm text-ink-400 leading-relaxed">{detail}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-8 text-base text-ink-400 max-w-2xl leading-relaxed">
            The full list, including what this deliberately does not defend against, is in the{' '}
            <Link
              href="/docs/threat-model"
              className="text-signal-400 hover:text-signal-300 underline underline-offset-4 decoration-ink-700"
            >
              threat model
            </Link>
            . It is long on purpose.
          </p>
        </Section>

        {/* --- 03 Leave ------------------------------------------------------ */}
        <Section index="03" label="Read it yourself">
          <p className="text-lg text-ink-200 max-w-2xl leading-relaxed">
            The useful thing here is not the device. It is the method: specifications a machine can
            check, invariants bound to named tests, and a build that fails when a claim stops being
            true. Take that and build your own.
          </p>

          <p className="mt-5 text-base text-ink-400 max-w-2xl leading-relaxed">
            There is no download and the source is the deliverable. It runs on a Mac or a Linux box
            with no hardware at all, and a real one is about $100 in parts. A wallet here is a
            BIP-39 mnemonic and a canonical BIP-380 descriptor, so Bitcoin Core restores it with
            none of this code involved. No releases, no binaries, no support, no warranty. The most
            valuable thing you can do with this is find where it is wrong.
          </p>

          <div className="mt-9 divide-y divide-ink-850 border-y border-ink-850">
            {DOCS.map((doc) => (
              <Link
                key={doc.slug}
                href={`/docs/${doc.slug}`}
                className="group block py-4 sm:grid sm:grid-cols-[15rem_minmax(0,1fr)] sm:gap-8"
              >
                <div className="text-sm font-medium text-ink-100 group-hover:text-signal-400 transition-colors">
                  {doc.title}
                </div>
                <p className="mt-1 sm:mt-0 text-sm text-ink-400">{doc.question}</p>
              </Link>
            ))}
          </div>

          <p className="mt-4 text-sm text-ink-500">
            Rendered from <code className="font-mono text-ink-400">docs/</code> in the repository,
            the same bytes a reviewer reads in the source.
          </p>

          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-9 inline-flex items-center gap-2.5 font-mono text-sm text-ink-200 border-b border-ink-700 pb-1 hover:text-signal-400 hover:border-signal-500 transition-colors"
          >
            github.com/Xaxis/nullroute
            <span aria-hidden="true">&rarr;</span>
          </a>
        </Section>
      </div>
    </>
  )
}
