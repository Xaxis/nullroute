import Link from 'next/link'
import { DOCS } from '../lib/docs'
import { readFacts } from '../lib/facts'
import { readEntropyExample } from '../lib/entropy'
import { Hero } from '../components/hero/Hero'
import { Section } from '../components/Section'
import { Terminal } from '../components/Terminal'
import { Device } from '../components/Device'
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
 * The argument needs four beats and it has four: what it is, the check, where
 * it stands, and where the detail lives. Everything cut is in docs/, which is
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
 * and what it does not yet do is on the page, stated as status with what closes
 * it, rather than in a footnote.
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
 * Where the project stands: what is built, what is next, and what it does not
 * protect against.
 *
 * THIS WAS A SECTION CALLED "DO NOT USE THIS", and it read as a verdict on the
 * project rather than a status. Hardware bring-up on the Pi is the next
 * milestone, not a reason to walk away, and saying "nothing has run on real
 * hardware" in the voice of a disclaimer told a reader the opposite of the
 * plan. The facts are the same and no less plain: it is unaudited, the first Pi
 * boot is still ahead, and two gaps stay open until later phases. Each is
 * stated as where it is and what closes it.
 *
 * Nothing here claims more than exists. A line moves only when the thing it
 * describes has happened.
 */
const STANDING: readonly (readonly [string, string])[] = [
  [
    'Not audited yet',
    'One person wrote it. Before it holds real money, the code that holds keys needs to be read by somebody other than its author.',
  ],
  [
    'Hardware bring-up is next',
    'The card boots under QEMU, opens its dm-verity mapping, refuses a partition with one byte changed, and starts the signing daemon. The next milestone is the same card on a Pi 4 with the 7 inch panel, which is the first run of the firmware path from power-on to the kernel and the first time the screens are drawn on the panel itself.',
  ],
  [
    'The boot partition is not covered',
    'dm-verity detects modification of the system partition and does not prevent it. The boot partition holds the root hash and cannot be under the tree that hash describes, so an attacker who rewrites it supplies their own number. A signed boot chain closes that in phase 7, last on purpose, because it burns one-time fuses.',
  ],
  [
    'The browser is the weakest part',
    'The screens are a Chromium kiosk, and its own sandbox needs the user namespaces that the directives protecting the daemon take away. So trust is kept out of it rather than hardened into it: the daemon holds the keys, and the screens receive only xpubs, addresses, descriptors and transactions.',
  ],
  [
    'It will not save you from a person',
    'Hidden profiles and a wipe PIN are planned for phase 7. When they exist, they buy time against somebody unsophisticated and nothing more: this codebase is public, so anyone who reads it knows exactly what they do.',
  ],
]

export default function HomePage() {
  const facts = readFacts()
  const entropy = readEntropyExample()
  const working = WORKING.filter((entry) => entry.specs.every((id) => facts.has(id)))

  return (
    <>
      {/* Outside the column, because its backdrop is full bleed and the only
          honest way to draw one is to be full width rather than to escape a
          narrower parent with a viewport unit. See the comment in Hero. */}
      <Hero facts={facts} />

      <div className="mx-auto max-w-5xl px-5">
        {/* --- 01 The device ---------------------------------------------- */}
        <Section index="01" label="What it is" id="what-it-is">
          <p className="text-lg text-ink-200 max-w-2xl leading-relaxed">
            Six screens from the real frontend, at the panel&rsquo;s real 800x480. Rendered by a
            browser from the same gallery the layout and contrast checks measure, so this is the
            device rather than a picture of one.
          </p>
          <Device />
        </Section>

        {/* --- 02 The check ----------------------------------------------- */}
        <Section index="02" label="How you check it">
          <p className="text-lg text-ink-200 max-w-2xl leading-relaxed">
            Every module ships a specification a machine reads. The build fails when the code, the
            specs and the tests stop agreeing, so the specification cannot quietly fall behind the
            thing it describes.
          </p>

          <div className="mt-8">
            <Terminal command="make verify" facts={facts} />
          </div>

          {/* A transcript, not a widget. An interactive dice pad used to sit
              here, and before that in the hero, and in both places it read as
              the product: a web page where you roll dice. The claim it proved
              is the one below, and a command with the answer beside it proves
              it without looking like an app. See lib/entropy.ts. */}
          <div className="mt-12 max-w-3xl">
            <p className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-ink-500">
              Check the smallest claim yourself
            </p>
            <p className="mt-4 text-base text-ink-400 leading-relaxed">
              The device turns dice into a seed by one rule you can repeat without any of this code:
              SHA-256 of the rolls as ASCII digits, with no trailing newline. Here is the public
              example from the entropy document, 100 rolls of{' '}
              <code className="font-mono text-ink-300">123456</code> repeated. Paste it into a
              terminal. On macOS, use <code className="font-mono text-ink-300">shasum -a 256</code>.
            </p>
            <pre className="mt-5 rounded-md border border-ink-800 bg-ink-900/70 p-4 font-mono text-xs leading-relaxed text-ink-300 whitespace-pre-wrap break-all">
              <span className="text-ink-500">$ </span>
              {`printf '%s' '${entropy.rolls}' | sha256sum`}
              {'\n'}
              <span className="text-verify-500">{entropy.digest}</span>
              {'  -'}
            </pre>
            <p className="mt-4 text-sm text-ink-500 leading-relaxed">
              Those 32 bytes are the seed&rsquo;s entropy. If your terminal prints a different
              number, one of us is wrong and it is worth finding out which. Never use this sequence
              for money: it is public.{' '}
              <Link
                href="/docs/entropy"
                className="text-signal-400 hover:text-signal-300 underline underline-offset-4 decoration-ink-700"
              >
                The whole derivation, down to the 24 words
              </Link>
              .
            </p>
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

        {/* --- 03 Where it stands ------------------------------------------ */}
        <Section index="03" label="Where it stands">
          <p className="text-lg text-ink-200 max-w-2xl leading-relaxed">
            What is built, what comes next, and what it does not protect against yet. Keep real
            money off it until the first two are done.
          </p>

          <dl className="mt-8 divide-y divide-ink-850 border-y border-ink-850">
            {STANDING.map(([term, detail]) => (
              <div key={term} className="py-5 sm:grid sm:grid-cols-[15rem_minmax(0,1fr)] sm:gap-8">
                <dt className="text-sm font-medium text-ink-100">{term}</dt>
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

        {/* --- 04 Leave ---------------------------------------------------- */}
        <Section index="04" label="Read it yourself">
          <p className="text-lg text-ink-200 max-w-2xl leading-relaxed">
            The device and the method behind it are both open: specifications a machine can check,
            invariants bound to named tests, and a build that fails when a claim stops being true.
          </p>

          <p className="mt-5 text-base text-ink-400 max-w-2xl leading-relaxed">
            There is no download: you build it, which is the point. It runs on a Mac or a Linux box
            today, and the device is a Pi 4 and the official 7 inch touchscreen, about $100 in
            parts. A wallet here is a BIP-39 mnemonic and a canonical BIP-380 descriptor, so Bitcoin
            Core restores it with none of this code involved. The most valuable thing you can do
            with it is find where it is wrong.
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
