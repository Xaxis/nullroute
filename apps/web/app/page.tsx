import Link from 'next/link'
import { readFacts } from '../lib/facts'
import { readEntropyExample } from '../lib/entropy'
import { readPhases } from '../lib/status'
import { readProfile } from '../lib/profile'
import { REPO_URL } from '../lib/site'
import { readRepoFile } from '../lib/repo'
import { Terminal } from '../components/Terminal'
import { SCREENS, Shot, ShotOverlays, checkedScreens } from '../components/Device'
import { PhaseTable } from '../components/PhaseTable'
import { ResultsTable } from '../components/ResultsTable'
import {
  A,
  C,
  Figure,
  Hash,
  Prose,
  Readout,
  Section,
  Source,
  Transcript,
} from '../components/report'

/**
 * The home page, laid out as a test report: what the subject is, the number a
 * reader checks, one claim checkable in ten seconds, the run that checks the
 * rest, what the device does, the profile any signer can be held to, where the
 * project stands, and how to take part.
 *
 * EVERY SECTION CARRIES AN ARTEFACT, read from the repository at build time.
 * The old page was cut from seven screens of prose to four short sections for
 * a reason worth keeping: a paragraph that does not point at something
 * checkable is a paragraph a reader has to take on trust. This one is longer
 * because it now shows two things the old one left out, the manifest root at
 * the size it deserves and the signer profile, and every addition is a figure
 * with a source line rather than a claim.
 *
 * Nothing here tries to convert a reader into a user. There is one quiet row
 * of links and no buttons, and what the project does not yet do is stated as
 * status with what closes it, not in a footnote.
 */

/**
 * What the device can do, and the specs that have to exist for each claim.
 * A row renders only when the verifier reports every spec it names as
 * implemented, so this list can be written ahead of the code without ever
 * asserting something untrue.
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
    term: 'Multisig across devices from different makers',
    specs: ['core.descriptor.multisig', 'daemon.multisig', 'core.psbt.quorum'],
  },
  { term: 'Several wallets, encrypted at rest', specs: ['daemon.store', 'daemon.store.registry'] },
  {
    term: 'Backups, labels and child seeds',
    specs: ['daemon.store.backup', 'core.labels', 'core.bip85'],
  },
  { term: 'Proving an address, and checking somebody else’s', specs: ['core.message.bip322'] },
  {
    term: 'Data across the gap by camera, in BBQr and UR',
    specs: ['core.qr.encode', 'core.qr.bbqr', 'core.qr.ur'],
  },
  { term: 'Closing itself when you walk away', specs: ['daemon.idle'] },
]

/**
 * Where the project stands, as status with what closes each item. This was
 * once a section called "Do not use this", which read as a verdict rather
 * than a plan. The facts are the same and no less plain.
 */
const STANDING: readonly (readonly [string, string])[] = [
  [
    'Not audited yet',
    'One person wrote it. Before it holds real money, the code that holds keys needs to be read by somebody other than its author.',
  ],
  [
    'Hardware bring-up is next',
    'The card boots under QEMU, opens its dm-verity mapping, refuses a partition with one byte changed, and starts the signing daemon. The next milestone is the same card on a Pi 5 and a Pi 4, each with the 7 inch panel: the first run of the firmware path from power-on to the kernel, and the first time the screens are drawn on the panel itself.',
  ],
  [
    'The boot partition is not covered',
    'dm-verity detects modification of the system partition and does not prevent it. The boot partition holds the root hash and cannot be under the tree that hash describes, so an attacker who rewrites it supplies their own number. A signed boot chain closes that in phase 7, last on purpose, because it burns one-time fuses.',
  ],
  [
    'The browser is the weakest part',
    'The screens are a Chromium kiosk. Trust is kept out of it rather than hardened into it: the daemon holds the keys, and the screens receive only xpubs, addresses, descriptors and transactions.',
  ],
  [
    'It will not save you from a person',
    'Hidden profiles and a wipe PIN are planned for phase 7. When they exist, they buy time against somebody unsophisticated and nothing more: this codebase is public, so anyone who reads it knows exactly what they do.',
  ],
]

/** "25 of 25 vector files match their pinned hash" to 25. */
function count(detail: string, pattern: RegExp): number {
  const value = Number(pattern.exec(detail)?.[1] ?? NaN)
  if (!Number.isFinite(value)) {
    throw new Error(`nullroute.diy: could not read ${String(pattern)} from "${detail}".`)
  }
  return value
}

export default function HomePage() {
  const facts = readFacts()
  const entropy = readEntropyExample()
  const phases = readPhases()
  const profile = readProfile()
  const screens = checkedScreens(facts.has)
  const working = WORKING.filter((entry) => entry.specs.every((id) => facts.has(id)))
  const detail = (name: string) => facts.checks.find((c) => c.name === name)?.detail ?? ''
  const vectorFiles = count(detail('vectors'), /(\d+) of \d+ vector files/)
  const crossChecked = count(detail('differential'), /(\d+) modules cross-checked/)
  const complete = phases.filter((p) => p.kind !== 'not-started').length
  const version = readRepoFile('VERSION').trim()
  const lock = screens.find((s) => s.file === 'lock') ?? SCREENS[0]
  if (lock === undefined) throw new Error('nullroute.diy: no lock screen in the gallery.')

  return (
    <>
      {/* --- The subject -------------------------------------------------- */}
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <section className="pt-10 pb-16 sm:pt-14 sm:pb-20">
          {/* THE REPORT'S HEADER BLOCK. Subject, version, state and what comes
              next, before anything else, the way a test report opens. Status
              in the first screen rather than a footer: a reader deciding
              whether to keep reading is owed it first. */}
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[4px] border border-line bg-line font-sans text-[0.8125rem] sm:grid-cols-4">
            {[
              ['Subject', 'An air-gapped Bitcoin signer for the Raspberry Pi'],
              ['Version', `${version}, pre-release`],
              ['State', `Unaudited. Phases 1 to ${String(complete)} of 7 built; no release yet`],
              ['Next', 'Hardware bring-up on a Pi 5 and a Pi 4'],
            ].map(([k, v]) => (
              <div key={k} className="bg-surface px-3.5 py-2.5 min-w-0">
                <dt className="label">{k}</dt>
                <dd className="mt-1 leading-snug text-ink">{v}</dd>
              </div>
            ))}
          </dl>

          {/* ONE LINE EACH, across the page. In a half-width column the
              first line broke after "Built to be", and a headline that breaks
              inside its own phrase reads as two ideas. */}
          <h1 className="mt-12 font-display text-[2.75rem] leading-[1.02] tracking-[-0.02em] text-ink sm:text-[4rem] lg:mt-16 lg:text-[5.25rem]">
            Built to be checked,
            <span className="block text-muted">not to be trusted.</span>
          </h1>
          <div className="mt-10 grid gap-12 lg:mt-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)] lg:gap-14 lg:items-start">
            <div className="min-w-0">
              <Prose className="text-[1.1875rem] sm:text-[1.3125rem] leading-[1.55]">
                <p className="text-ink">
                  A Raspberry Pi and an 800x480 touchscreen, turned into a Bitcoin signing device
                  with no network of any kind. You roll dice for the seed, carry transactions across
                  the gap by camera, read each one on the device&rsquo;s own screen, and sign
                  offline.
                </p>
                <p>
                  Every module ships a specification the build checks, so the code, the specs and
                  the tests cannot quietly disagree. The source is the product: build it yourself
                  and compare the number the device shows you.
                </p>
              </Prose>
              <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 font-sans text-[0.9375rem]">
                <li>
                  <Link href="/check" className="link">
                    How to check it
                  </Link>
                </li>
                <li>
                  <Link href="/profile" className="link">
                    The signer profile
                  </Link>
                </li>
                <li>
                  <a href={REPO_URL} className="link" target="_blank" rel="noopener noreferrer">
                    Read the source
                  </a>
                </li>
              </ul>
            </div>

            <Figure
              n="1"
              title="The first screen, before any wallet is open"
              id="fig-lock"
              source={
                <>
                  the device frontend at 800x480, rendered by <C>make device-shots</C> from the
                  gallery the layout checks measure. The hashes in it are samples. On a real device
                  the top one is the manifest root of the software it is about to run.
                </>
              }
            >
              <Shot screen={lock} eager link={false} />
            </Figure>
          </div>
        </section>
      </div>

      {/* --- The number --------------------------------------------------- */}
      {/* FULL WIDTH BY BEING A FULL-WIDTH SECTION, not by escaping a column
          with 100vw. 100vw counts the scrollbar and the content box does not,
          and that once made every long page scroll sideways by 8px. */}
      <section
        id="root"
        aria-labelledby="root-heading"
        className="scroll-mt-24 border-y border-line bg-surface"
      >
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-14 sm:py-20">
          <div className="grid gap-8 lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-12">
            <div>
              <div aria-hidden="true" className="font-mono text-sm text-signal">
                &sect;1
              </div>
              <div className="label mt-1.5">The number</div>
            </div>
            <div className="min-w-0">
              <h2
                id="root-heading"
                className="font-display text-[1.875rem] leading-[1.12] tracking-[-0.01em] text-ink sm:text-[2.375rem] max-w-[24ch]"
              >
                One hash for every line of code that ships.
              </h2>
              <div className="mt-8 font-mono text-[0.8125rem] text-muted">
                <span className="select-none">$ </span>
                <span className="text-ink select-all">sha256sum MANIFEST.lock</span>
              </div>
              <Hash
                value={facts.rootHash}
                className="hash-grid mt-3 grid-cols-[repeat(4,auto)] text-[1.375rem] leading-[1.45] text-ink sm:text-[1.625rem] md:grid-cols-[repeat(8,auto)] lg:text-[1.75rem] xl:text-[2.125rem]"
              />
              <Prose className="mt-8">
                <p>
                  The device shows this number on its lock screen before it asks for a PIN. It is
                  the SHA-256 of a plain <C>sha256sum</C> listing of all {facts.files} files that go
                  onto the device, sorted under <C>LC_ALL=C</C>, so you can recompute it with
                  coreutils and none of this project&rsquo;s tools. Build the source, run the same
                  command, and compare. If the two differ, do not enter your PIN.
                </p>
                <p className="text-muted text-[0.9375rem]">
                  What it does not prove: the lock screen is drawn by the software it describes, so
                  it catches an accident or a crude substitution, not an attacker who replaced the
                  code that draws it. Nothing has been released, so there is no published value to
                  compare against yet. <A href="/check#root">How the number is made</A>.
                </p>
              </Prose>
              <Source>
                <C>MANIFEST.lock</C> in this build, checked by the integrity step of{' '}
                <C>make verify</C>.
              </Source>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* --- One claim in ten seconds ----------------------------------- */}
        <Section
          n="§2"
          kicker="Check one claim"
          title="The seed rule, repeated with no code of ours."
          id="dice"
        >
          <Prose>
            <p>
              The device turns dice into a seed by one rule: SHA-256 of the rolls as ASCII digits,
              with no separator and no trailing newline. Here is the public example from the entropy
              document, 100 rolls of <C>123456</C> repeated. Paste it into a terminal; on macOS, use{' '}
              <C>shasum -a 256</C>.
            </p>
          </Prose>
          <Figure
            n="2"
            title="A seed's entropy from 100 dice rolls"
            className="mt-8"
            source={
              <>
                the worked example in <A href="/docs/entropy">docs/ENTROPY.md</A>, recomputed when
                this site was built. The build fails if the two disagree.
              </>
            }
          >
            <Transcript
              label="Computing the entropy of the worked example"
              lines={[
                {
                  cmd: `printf '%s' '${entropy.rolls}' | sha256sum`,
                  out: (
                    <>
                      <span className="text-verify">{entropy.digest}</span>
                      {'  -'}
                    </>
                  ),
                },
              ]}
            />
          </Figure>
          <Prose className="mt-8">
            <p>
              Those 32 bytes are the seed&rsquo;s entropy. If your terminal prints a different
              number, one of us is wrong and it is worth finding out which. 100 rolls, not 99: 99
              rolls of a fair die are 255.911 bits, short of 256, and this project does not round in
              its own favour. Never use this sequence for money; it is public.
            </p>
          </Prose>
        </Section>

        {/* --- The run ----------------------------------------------------- */}
        <Section
          n="§3"
          kicker="Method"
          title="The build refuses to disagree with itself."
          id="verify"
        >
          <Prose>
            <p>
              Every module ships a machine-readable specification. Each spec declares invariants,
              and each invariant names the tests that prove it. <C>make verify</C> runs five checks,
              and the signing daemon refuses to start unless the report says they passed and names
              the manifest on disk.
            </p>
          </Prose>
          <dl className="mt-10 grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3">
            <Readout label="Specs" value={facts.specs} />
            <Readout label="Invariants" value={facts.invariants} />
            <Readout
              label="Tests bound to invariants"
              value={facts.boundTests}
              detail={`of ${String(facts.tests)} in the suite`}
            />
            <Readout
              label="Exports covered by a spec"
              value={facts.covered}
              detail={`of ${String(facts.exports)}; an uncovered one fails the build`}
            />
            <Readout
              label="Pinned vector files"
              value={vectorFiles}
              detail="official BIP vectors and the profile's"
            />
            <Readout
              label="Cross-checked modules"
              value={crossChecked}
              detail="against bitcoinjs-lib"
            />
          </dl>
          <Figure
            n="3"
            title="The verification run this site was built from"
            className="mt-12"
            source={
              <>
                <C>verification-report.json</C>, written by <C>make verify</C>. Every mark is read
                from it; a check with nothing to examine shows <C>n/a</C>, never <C>ok</C>.
              </>
            }
          >
            <Terminal facts={facts} />
          </Figure>
          <dl className="mt-10 grid gap-x-10 gap-y-5 font-sans text-[0.9375rem] sm:grid-cols-2">
            {[
              ['coverage', 'an exported function no spec describes'],
              ['invariants', 'a claim whose test was deleted, renamed or skipped'],
              ['vectors', 'an official test vector edited to match the code'],
              ['differential', 'a disagreement with a second implementation'],
              ['integrity', 'a file that changed without the manifest moving'],
            ].map(([k, v]) => (
              <div key={k} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3">
                <dt className="font-mono text-[0.8125rem] text-ink pt-0.5">{k}</dt>
                <dd className="text-body leading-snug">catches {v}</dd>
              </div>
            ))}
          </dl>
          <Prose className="mt-10">
            <p className="text-muted text-[0.9375rem]">
              What this proves: the code does what its specs say, on the inputs the tests use. What
              it does not: that the specs describe a secure design. That takes a human reviewer, and
              so far only the author has been one.{' '}
              <A href="/docs/verification">What verification does not give you</A>.
            </p>
          </Prose>
        </Section>

        {/* --- The device -------------------------------------------------- */}
        <Section
          n="§4"
          kicker="The device"
          title="Six screens, from the real frontend."
          id="screens"
        >
          <Prose>
            <p>
              Rendered at the panel&rsquo;s 800x480 from the same gallery the layout and contrast
              checks measure, so this is the device rather than a picture of one. Select a screen to
              see it full size.
            </p>
          </Prose>
          <ol className="mt-10 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {screens.map((screen, i) => (
              <li key={screen.file} className="min-w-0">
                <Shot screen={screen} />
                <div className="mt-3 font-sans">
                  <div className="flex items-baseline gap-2">
                    <span className="label text-signal">Fig. 4{String.fromCharCode(97 + i)}</span>
                    <span className="text-[0.9375rem] text-ink">{screen.caption}</span>
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">{screen.detail}</p>
                </div>
              </li>
            ))}
          </ol>

          {working.length > 0 && (
            <div className="mt-14">
              <div className="label">Specified and implemented</div>
              <ul className="mt-4 grid gap-x-10 border-t border-line sm:grid-cols-2">
                {working.map((entry) => (
                  <li
                    key={entry.term}
                    className="border-b border-line py-3 font-sans text-[0.9375rem] leading-snug"
                  >
                    <span className="text-ink">{entry.term}</span>
                    <span className="mt-1 block font-mono text-[0.75rem] text-muted break-words">
                      {entry.specs.join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
              <Source>
                the spec list in <C>verification-report.json</C>. A row appears only when every spec
                under it is implemented; nothing here is typed in by hand.
              </Source>
            </div>
          )}
          <p className="mt-8 font-sans text-[0.9375rem]">
            <Link href="/device" className="link">
              What you build, and what each screen refuses
            </Link>
          </p>
        </Section>

        {/* --- The profile ------------------------------------------------- */}
        <Section
          n="§5"
          kicker="Beyond this device"
          title="A profile any air-gapped signer can be held to."
          id="profile"
        >
          <Prose>
            <p>
              Signers agree by convention on things no BIP writes down: how dice become a seed, what
              a signer must show before it signs, and how you can tell which software is asking for
              your passphrase. The signer profile writes them down as requirements, each naming its
              check, and the conformance kit turns the testable ones into vectors any implementation
              can run, in any language, through a small adapter.
            </p>
          </Prose>

          <dl className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-[4px] border border-line bg-line font-sans text-[0.8125rem] lg:grid-cols-4">
            {[
              ['Document', 'Air-gapped signer profile'],
              [
                'State',
                `Draft ${profile.header.version}, ${profile.header.date}. Adopted by no one yet`,
              ],
              [
                'Requirements',
                `${String(profile.requirementCount)} in ${String(profile.areas.length)} areas`,
              ],
              [
                'Vectors',
                `${String(profile.caseCount)} cases in ${String(profile.vectors.length)} files`,
              ],
            ].map(([k, v]) => (
              <div key={k} className="bg-surface px-3.5 py-2.5 min-w-0">
                <dt className="label">{k}</dt>
                <dd className="mt-1 leading-snug text-ink">{v}</dd>
              </div>
            ))}
          </dl>

          <Figure
            n="5"
            title="Conformance results, by vector file"
            className="mt-10"
            source={
              <>
                <C>conformance-report.json</C> from <C>make conformance</C>, checked against the{' '}
                <C>SHA256SUMS</C> that pins the vectors. No expected value in them was produced by
                nullroute: they come from Bitcoin Core on regtest, the BIP texts, coreutils,
                Coinkite&rsquo;s BBQr code and SeedSigner&rsquo;s UR encoder.
              </>
            }
          >
            <ResultsTable profile={profile} />
          </Figure>

          <Prose className="mt-8">
            <p>
              nullroute is one implementation of the profile and fails parts of it; the profile says
              where. A second signer, on other hardware and in another language, is the test of
              whether it is implementable as written.{' '}
              <Link href="/profile" className="link">
                Read the profile and run the kit
              </Link>
              .
            </p>
          </Prose>
        </Section>

        {/* --- Where it stands --------------------------------------------- */}
        <Section
          n="§6"
          kicker="Status"
          title="What is built, what is next, what it does not cover."
          id="status"
        >
          <Figure
            n="6"
            title="Phases"
            source={
              <>
                the status table in{' '}
                <A href={`${REPO_URL}#status`} external>
                  README.md
                </A>
                , read when this site was built.
              </>
            }
          >
            <PhaseTable phases={phases} />
          </Figure>

          <dl className="mt-12 border-t border-line">
            {STANDING.map(([term, text]) => (
              <div
                key={term}
                className="grid gap-1.5 border-b border-line py-5 sm:grid-cols-[14rem_minmax(0,1fr)] sm:gap-8"
              >
                <dt className="font-sans text-[0.9375rem] font-semibold text-ink">{term}</dt>
                <dd className="text-[1rem] leading-relaxed text-body">{text}</dd>
              </div>
            ))}
          </dl>
          <Prose className="mt-8">
            <p>
              Keep real money off it until the first two are done. The full list, including what
              this deliberately does not defend against, is in the{' '}
              <A href="/docs/threat-model">threat model</A>. It is long on purpose.{' '}
              <Link href="/status" className="link">
                The roadmap
              </Link>
              .
            </p>
          </Prose>
        </Section>

        {/* --- Take part --------------------------------------------------- */}
        <Section n="§7" kicker="Take part" title="Read it, run it, break it." id="run">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <Prose>
                <p>
                  There is no download: you build it, which is the point. It runs on a Mac or a
                  Linux machine today, refuses to start if the code and the specifications disagree,
                  and opens the device in a browser. Pick Signet when it asks, so nothing is real.
                </p>
              </Prose>
              <Transcript
                className="mt-6"
                label="Building and running the device on a laptop"
                lines={[
                  { cmd: 'git clone https://github.com/Xaxis/nullroute.git' },
                  { cmd: 'cd nullroute' },
                  { cmd: 'make install' },
                  { cmd: 'make dev' },
                ]}
              />
            </div>
            <div className="min-w-0">
              <Prose>
                <p>
                  <span className="text-ink font-sans font-semibold text-[0.9375rem]">
                    If the author stops.
                  </span>{' '}
                  A wallet here is a BIP-39 mnemonic and a canonical BIP-380 descriptor. Bitcoin
                  Core restores and spends single-key wallets in all four script types and 2-of-3
                  quorums in <C>wsh</C> and taproot with none of this code involved, and CI runs
                  that drill on every push to <C>main</C>. The profile and its vectors stand on
                  their own.
                </p>
                <p>
                  The most valuable thing you can do with it is find where it is wrong. Report a
                  flaw privately through the <A href="/docs/security">security policy</A>; anything
                  else is an issue or a pull request on{' '}
                  <A href={REPO_URL} external>
                    GitHub
                  </A>
                  .
                </p>
              </Prose>
            </div>
          </div>
        </Section>
      </div>

      <ShotOverlays screens={screens} closeTo="screens" />
    </>
  )
}
