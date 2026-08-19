import Link from 'next/link'
import { DOCS } from '../lib/docs'
import { readFacts } from '../lib/facts'

/**
 * What the device can do, and the specs that have to exist for each claim.
 *
 * A row appears only when every spec it names is implemented, so this list can
 * describe things that are not built yet without ever asserting them. Removing
 * a module removes its row rather than leaving a sentence behind.
 */
const WORKING: readonly { term: string; specs: readonly string[]; detail: string }[] = [
  {
    term: 'Dice into a seed, checkable by hand',
    specs: ['core.entropy.dice', 'core.bip39.mnemonic', 'core.derive.hd'],
    detail:
      'One hundred rolls, hashed by a rule published with a worked example you reproduce with sha256sum. The device will roll for you if you insist, and says you did not watch those land.',
  },
  {
    term: 'Addresses and descriptors other software understands',
    specs: ['core.address.derive', 'core.descriptor.parse', 'core.descriptor.checksum'],
    detail:
      'All four address types, and canonical BIP-380 descriptors with checksums. A wallet made here restores in Bitcoin Core, which CI proves on every commit against a real regtest node.',
  },
  {
    term: 'Transactions reviewed before they are signed',
    specs: ['core.psbt.review', 'core.psbt.sign'],
    detail:
      'Where the money goes, which outputs are change, the fee three ways, and the sighash. Signatures are deterministic, so anyone with the seed can recompute them and confirm nothing was hidden inside.',
  },
  {
    term: 'Multisig across several devices',
    specs: ['core.descriptor.multisig', 'daemon.multisig', 'core.psbt.quorum'],
    detail:
      'Cosigner registration that refuses a quorum this device holds no key in, coordinator file import, a bundle for the coordinator, and a screen for comparing a quorum\u2019s addresses between devices.',
  },
  {
    term: 'Several wallets, encrypted at rest',
    specs: ['daemon.store', 'daemon.store.registry'],
    detail:
      'Up to eight named wallets on one card, each sealed under its own passphrase with Argon2id and AES-256-GCM, and a picker that refuses to present an unopened wallet\u2019s name as a fact.',
  },
  {
    term: 'Backups, labels and child seeds',
    specs: ['daemon.store.backup', 'core.labels', 'core.bip85'],
    detail:
      'Encrypted backup that is seedless unless you say otherwise, BIP-85 children shown with the path that produced them, and BIP-329 labels that appear beside the outputs on the screen you read before signing. A label decides nothing: change is still decided by re-deriving it.',
  },
  {
    term: 'Proving an address, and checking somebody else\u2019s proof',
    specs: ['core.message.bip322'],
    detail:
      'BIP-322 signing for segwit and taproot, each verified against a digest computed by a different library, plus the older signmessage scheme for legacy addresses. Verification needs no key, so it works with the wallet locked: checking a stranger\u2019s signature should not cost the passphrase to your money.',
  },
  {
    term: 'Closing itself when you walk away',
    specs: ['daemon.idle'],
    detail:
      'Ten minutes with nobody touching the screen and the wallet closes, the seed zeroized, with a minute of warning first. It defends against the device being left and nothing else: somebody standing at it simply touches the screen.',
  },
  {
    term: 'Data across the gap by camera',
    specs: ['core.qr.encode', 'core.qr.bbqr'],
    detail:
      'An in-tree QR encoder and BBQr for payloads too large for one code. Transactions, descriptors, backups and label files all arrive this way.',
  },
]
import { Hero } from '../components/hero/Hero'
import { Row, Rows, Section } from '../components/Section'
import { MARK, Terminal } from '../components/Terminal'

/**
 * This is a build record, not a product page, and it makes ONE argument: you
 * can check this yourself, and the check is the first thing on the screen.
 *
 * It used to be seven numbered sections making seven arguments, which is how a
 * page grows past the point where anyone reads it. Three now. The dice demo
 * moved into the hero, because it is the only object here that is not a claim
 * and it was sitting below several hundred words of caveats. The old Method,
 * What the build checks and The device sections merged into one causal chain
 * that runs from a spec file to a hash on a screen.
 *
 * Nothing here tries to convert a reader into a user. There is no quickstart,
 * no feature grid, no roadmap promising future value, and the reasons not to
 * use this come first rather than sitting in a footnote.
 *
 * A note on what is deliberately absent. An earlier draft opened by citing a
 * hardware wallet vendor's RNG failure. It was vague about which vendor, which
 * year and which failure, and a page whose whole argument is "verify things"
 * has no business leaning on an anecdote its reader cannot check. The argument
 * stands without it: a black box is unverifiable by construction.
 */

/** What each check is for. The legend for the five lines of the transcript. */
const CHECK_NOTES: readonly (readonly [string, string])[] = [
  [
    'coverage',
    'Every runtime export has to be claimed by some spec. Add an exported function without specifying it and the build fails, so the specification cannot quietly fall behind the code.',
  ],
  [
    'invariants',
    'Each invariant names the tests that hold it up, and the status of each of those tests is asserted individually, because trusting the exit code would let a skipped test certify an invariant that never ran.',
  ],
  [
    'vectors',
    'Official BIP test vectors, pinned by hash, so a failing test cannot be repaired by editing the vector until it agrees with the bug.',
  ],
  [
    'differential',
    'Addresses, derivations and ECDSA signatures cross-checked against libsecp256k1 through bitcoinjs-lib. Both stacks share @noble/hashes, so a defect inside SHA-256 itself would survive this.',
  ],
  [
    'integrity',
    'Sources hashed into a manifest in plain sha256sum format, so you check it with coreutils rather than with the tool whose honesty is in question.',
  ],
]

/** The module behind the arithmetic the reader just did in the hero. */
const DICE_TESTS = 'packages/core/test/entropy.dice.test.ts'

export default function HomePage() {
  const facts = readFacts()
  const diceInvariants = facts.invariantsFor(DICE_TESTS)

  return (
    <div className="mx-auto max-w-5xl px-5">
      <Hero facts={facts} />

      {/* --- 01 Reasons not to ------------------------------------------- */}
      <Section index="01" label="Do not use this">
        <p className="text-lg text-ink-200 max-w-2xl leading-relaxed">
          Not false modesty. Here is the specific list.
        </p>

        <div className="mt-8">
          <Rows>
            {/* Derived from whether the store module exists, not asserted. A
                hand-written "there is no encrypted store yet" is true right up
                until it is not, and then it is a lie nobody notices. */}
            {facts.has('daemon.store') ? (
              <Row term="There is no secure element" tone="caution">
                Your passphrase is the entire physical defence. The wallet is sealed with
                AES-256-GCM under a key stretched by Argon2id at 64 MiB, and those parameters sit
                in the file in plain JSON, readable and authenticated, so nobody can quietly turn
                the cost down. That is all of it: no dedicated chip, no tamper mesh. Anyone who
                takes the card copies it first and grinds it at their own pace, so the ten wrong
                attempts that erase the device buy you nothing against them. A Coldcard or a
                BitBox02 is better on this axis and it is not close.
              </Row>
            ) : (
              <Row term="Nothing is encrypted at rest yet" tone="caution">
                There is no secure element, and as of today there is also no encrypted store, so
                there is nowhere for a wallet to persist and nothing defending an SD card that gets
                taken.
              </Row>
            )}

            <Row term="It is unfinished and unaudited" tone="caution">
              Pre-1.0, and nobody outside this project has reviewed the cryptography. The signed
              boot chain and the dm-verity attestation are not built. Read the phase ordering in
              the{' '}
              <Link
                href="/docs/threat-model"
                className="text-signal-400 hover:text-signal-300 underline underline-offset-4 decoration-ink-700"
              >
                threat model
              </Link>{' '}
              before you assume any particular thing works.
            </Row>

            <Row term="Some of the defences are partial" tone="caution">
              The systemd sandbox that would hold the air gap at the kernel level is specified and
              not written, and three of the hardening controls that look applied are inert on this
              hardware. The threat model lists the rest, at length, on purpose.
            </Row>

            <Row term="At most one signer in a quorum">
              It was built for 2-of-3 or 3-of-5 beside hardware from other vendors, where this is
              the one device you can read end to end. Sole custody of meaningful funds is not a use
              it was designed for.
            </Row>
          </Rows>
        </div>
      </Section>

      {/* --- 02 The chain ------------------------------------------------- */}
      <Section index="02" label="How you check it">
        <p className="text-lg text-ink-200 max-w-2xl leading-relaxed">
          Every module ships a{' '}
          <code className="font-mono text-[0.9em] text-ink-100">.spec.yaml</code> beside its source
          naming the invariants it claims and the exact tests holding them up. Five checks run on
          every commit, and any one of them failing fails the build.
        </p>
        <p className="mt-4 text-sm text-ink-500 max-w-2xl leading-relaxed">
          The transcript below is the real output, generated from the report the last run wrote,
          because a hand-drawn terminal full of invented passes would be precisely the kind of
          decoration this project exists to argue against.
        </p>

        <Terminal command="make verify" facts={facts} />

        <div className="mt-9 grid gap-x-10 gap-y-6 sm:grid-cols-2 text-sm">
          {CHECK_NOTES.map(([term, body], i) => (
            <div key={term} className={i === CHECK_NOTES.length - 1 ? 'sm:col-span-2' : undefined}>
              <div className="font-mono text-xs uppercase tracking-[0.14em] text-ink-500">
                {term}
              </div>
              <p className="mt-1.5 text-ink-400 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>

        {/* The second check, from underneath. This is the first place the site
            shows that an invariant binds to named tests rather than saying so. */}
        <p className="mt-12 text-sm text-ink-400 max-w-2xl leading-relaxed">
          Here is the second of those checks from underneath. These rows cover the dice entropy
          module, the code behind the arithmetic you just did at the top of the page, read out of
          the same report.
        </p>

        <div
          className="mt-5 rounded-md border border-ink-800 overflow-x-auto"
          tabIndex={0}
          role="region"
          aria-label="Invariants covering the dice entropy module"
        >
          <table className="w-full text-sm min-w-max">
            <thead>
              <tr className="bg-ink-900 text-ink-300">
                <th className="text-left font-medium px-4 py-2.5">Invariant</th>
                <th className="text-left font-medium px-4 py-2.5">Test</th>
                <th className="text-left font-medium px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {/* Keyed on id and test together: two ids appear twice. */}
              {diceInvariants.map((row) => (
                <tr key={`${row.id}::${row.test}`} className="border-t border-ink-850">
                  <td className="px-4 py-2 font-mono text-ink-300">{row.id}</td>
                  <td className="px-4 py-2 font-mono text-ink-400">{row.test}</td>
                  <td className={`px-4 py-2 font-mono ${MARK[row.status].className}`}>
                    {MARK[row.status].glyph}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-4 text-sm text-ink-500 max-w-2xl leading-relaxed">
          INV-DICE-3 is the one to look at. It asserts that the encoding still produces the digest
          in the worked example published in{' '}
          <Link
            href="/docs/entropy"
            className="text-signal-400 hover:text-signal-300 underline underline-offset-4 decoration-ink-700"
          >
            Entropy
          </Link>
          , which is what makes that document a check rather than a promise.
        </p>

        <div className="mt-12 grid gap-8 sm:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] sm:items-start">
          <p className="text-sm text-ink-400 leading-relaxed">
            The last line of the transcript is the manifest root: every source file hashed, sorted
            under <code className="font-mono text-ink-300">LC_ALL=C</code>, in a format coreutils
            produced and coreutils can check. The device prints the same string on its lock screen.
            Build the source yourself and compare the two. If they differ, do not enter your PIN.{' '}
            <Link
              href="/docs/verification"
              className="text-signal-400 hover:text-signal-300 underline underline-offset-4 decoration-ink-700"
            >
              How to reproduce it
            </Link>
            .
          </p>

          <figure className="min-w-0">
            <div className="rounded-md border border-ink-800 overflow-hidden bg-ink-950">
              {/* A plain img, not next/image. Static export has no optimiser to
                  gain from, and next/image emits style="color:transparent",
                  which would force style-src 'unsafe-inline' site-wide. */}
              <img
                src="/device/lock.png"
                alt="The device lock screen, showing a manifest root hash"
                width={1600}
                height={960}
                loading="lazy"
                decoding="async"
                className="w-full h-auto block"
              />
            </div>
            <figcaption className="mt-3 text-sm text-ink-500 leading-relaxed">
              Lock screen. It prints the manifest root of the code the device is running. This
              screenshot is from an earlier build, so its digits are not the ones above.
            </figcaption>
          </figure>
        </div>
      </Section>

      {/* --- 03 What works ------------------------------------------------- */}
      {/*
        Derived from which specs the verification report says are implemented,
        never hand-written. A list of features typed into a marketing page is
        true on the day it is written and wrong within a month, and this is a
        site whose whole argument is that its claims are machine-checked. It
        would be strange for the page's own claims not to be.

        The page carried no such list at all for a long time, so a visitor could
        read the reasons not to use it and the method for checking it, and leave
        without learning what the thing does.
      */}
      <Section index="03" label="What works today">
        <p className="text-lg text-ink-200 max-w-2xl leading-relaxed">
          Every row below is present because the module behind it has a specification the verifier
          reports as implemented. Nothing here is typed in by hand.
        </p>

        <div className="mt-8">
          <Rows>
            {WORKING.filter((entry) => entry.specs.every((id) => facts.has(id))).map((entry) => (
              <Row key={entry.term} term={entry.term}>
                {entry.detail}
              </Row>
            ))}
          </Rows>
        </div>

        <p className="mt-8 text-base text-ink-400 max-w-2xl leading-relaxed">
          Not here, and needed before this is safe for funds: the dm-verity boot attestation. There
          is no image build yet either, so nothing above ships on a card. What does exist is the
          contract that build has to satisfy, which is the half that had to come first: twelve of
          the sixteen provisioning assertions carry a verifier that executes, including the ones
          that catch a dm-verity salt regenerated per build, which would make the root hash this
          device displays meaningless as a published value. The recovery drill covers all four
          address types against a real Bitcoin Core on every commit, taproot included.
        </p>
      </Section>

      {/* --- 04 Leave ------------------------------------------------------ */}
      <Section index="04" label="Figure it out yourself">
        <p className="text-lg text-ink-200 max-w-2xl leading-relaxed">
          The useful thing here is not the device. It is the method: specifications a machine can
          check, invariants bound to named tests, and a build that fails when a claim stops being
          true. Take that and build your own. You will trust the result more, which is the entire
          point.
        </p>

        <p className="mt-5 text-base text-ink-400 max-w-2xl leading-relaxed">
          There is no download and the source is the deliverable. It runs on a Mac or a Linux box
          with no hardware at all, and a real one is about $100 in parts. Getting it running is not
          documented as a funnel with four copy-paste steps, because someone unwilling to read a{' '}
          <code className="font-mono text-ink-300">Makefile</code> before running software that
          holds keys should not be running this one.
        </p>

        <p className="mt-5 text-base text-ink-400 max-w-2xl leading-relaxed">
          A wallet here is a BIP-39 mnemonic and a canonical BIP-380 descriptor, so Bitcoin Core
          restores it with none of this code involved. No releases, no binaries, no support, no
          warranty, no roadmap anyone owes you. The most valuable thing you can do with this is
          find where it is wrong.
        </p>

        <p className="mt-10 text-sm text-ink-500">
          Rendered from <code className="font-mono text-ink-400">docs/</code> in the repository, the
          same bytes a reviewer reads in the source.
        </p>
        <div className="mt-4 divide-y divide-ink-850 border-y border-ink-850">
          {DOCS.map((doc) => (
            <Link
              key={doc.slug}
              href={`/docs/${doc.slug}`}
              className="group block py-4 sm:grid sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-8"
            >
              <div className="text-sm font-medium text-ink-100 group-hover:text-signal-400 transition-colors">
                {doc.title}
              </div>
              <p className="mt-1 sm:mt-0 text-sm text-ink-400">{doc.question}</p>
            </Link>
          ))}
        </div>

        <a
          href="https://github.com/Xaxis/nullroute"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-9 inline-flex items-center gap-2.5 font-mono text-sm text-ink-200 border-b border-ink-700 pb-1 hover:text-signal-400 hover:border-signal-500 transition-colors"
        >
          github.com/Xaxis/nullroute
          <span aria-hidden="true">&rarr;</span>
        </a>
      </Section>
    </div>
  )
}
