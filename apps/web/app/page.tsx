import Link from 'next/link'
import { DOCS } from '../lib/docs'
import { readFacts } from '../lib/facts'
import { Hero } from '../components/hero/Hero'
import { DiceDemo } from '../components/DiceDemo'
import { Row, Rows, Section } from '../components/Section'
import { Terminal } from '../components/Terminal'

/**
 * This is a build record, not a product page.
 *
 * Nothing here is trying to convert a reader into a user. There is no
 * quickstart, no feature grid, no roadmap promising future value, and the
 * reasons not to use this come first rather than sitting in a footnote. The
 * reader is treated as a peer who is going to build their own, and the useful
 * thing to give them is the method and the honest limits.
 *
 * The one interactive element earns its place by being falsifiable: the reader
 * hashes their own dice in their own browser and checks the answer against
 * their own terminal. Everything else on the page is a claim, and that is the
 * one thing that is not.
 *
 * A note on what is deliberately absent. An earlier draft opened by citing a
 * hardware wallet vendor's RNG failure. It was vague about which vendor, which
 * year and which failure, and a page whose whole argument is "verify things"
 * has no business leaning on an anecdote its reader cannot check. The argument
 * stands without it: a black box is unverifiable by construction.
 */

/**
 * What each check is actually for. Kept beside the terminal output rather than
 * inside it: the output says what happened, and these say why anyone should
 * care, and merging the two would make the transcript untrustworthy as a
 * transcript.
 */
const CHECK_NOTES: readonly (readonly [string, string])[] = [
  [
    'coverage',
    'Every runtime export must be claimed by some spec. Adding an exported function without specifying it fails the build, so the specification cannot quietly fall behind the code.',
  ],
  [
    'invariants',
    'Each invariant names the tests that hold it up, and the status of those individual tests is asserted. Trusting the exit code would let a skipped test certify an invariant that never ran.',
  ],
  [
    'vectors',
    'Official BIP test vectors, pinned by hash. Without the pin, the natural way to fix a failing test is to edit the vector until it agrees with the bug.',
  ],
  [
    'differential',
    'Addresses, derivations and signatures cross-checked against bitcoinjs-lib. The signature path is genuinely independent, ours through @noble/secp256k1 and theirs through libsecp256k1 compiled to WASM, so agreement there is real evidence. Both stacks do share @noble/hashes, so a defect inside SHA-256 itself would not be caught by this.',
  ],
  [
    'integrity',
    'Sources hashed into a manifest in plain sha256sum format, so a reviewer checks it with coreutils rather than with the tool whose honesty is in question.',
  ],
]

const SCREENS = [
  {
    src: '/device/dice.png',
    title: 'Dice',
    caption: 'Entropy accounting, truncated so it never claims more than you have.',
  },
  {
    src: '/device/wallet.png',
    title: 'Addresses',
    caption: 'Derivation path under every address. No balances: there is no network to ask.',
  },
  {
    src: '/device/verify.png',
    title: 'Address check',
    caption: 'Re-derives from your seed rather than comparing against a list it was handed.',
  },
  {
    src: '/device/lock.png',
    title: 'Lock screen',
    caption: 'The hash of the running code, and what that hash does not prove.',
  },
]

export default function HomePage() {
  const facts = readFacts()

  return (
    <div className="mx-auto max-w-5xl px-5">
      <Hero facts={facts} />

      {/* --- 01 Reasons not to ------------------------------------------- */}
      <Section index="01" label="Do not use this">
        <p className="text-xl text-ink-200 max-w-2xl leading-relaxed">
          Not false modesty. Here is the specific list.
        </p>

        <div className="mt-8">
          <Rows>
            {/* Derived from whether the store module exists, not asserted.
                A hand-written "there is no encrypted store yet" is true right
                up until it isn't, and then it is a lie nobody notices. */}
            {facts.has('daemon.store') ? (
              <Row term="There is no secure element" tone="caution">
                The wallet is encrypted at rest with Argon2id and AES-256-GCM, and a passphrase is
                the entire physical defence. There is no dedicated chip holding the key and no
                tamper mesh, so someone with your SD card is limited only by how long your
                passphrase takes to guess. A Coldcard or a BitBox02 is genuinely better on this
                axis and it is not close.
              </Row>
            ) : (
              <Row term="Nothing is encrypted at rest yet" tone="caution">
                There is no secure element, and as of today there is also no encrypted store, so
                there is nowhere for a wallet to persist and nothing defending an SD card that gets
                taken.
              </Row>
            )}
            <Row term="It is unfinished and unaudited" tone="caution">
              Pre-1.0, and no one outside this project has reviewed the cryptography. The signed
              boot chain and the dm-verity attestation are not built, and neither is the automated
              recovery drill. Read the phase ordering in the threat model before assuming any
              particular thing works.
            </Row>
            <Row term="Nobody is on the other end" tone="caution">
              No releases, no binaries, no support, no warranty, no roadmap anyone owes you. If it
              loses your money that is entirely your problem, and the licence says so in capital
              letters.
            </Row>
            <Row term="At most one signer in a quorum">
              The shape this was designed for is 2-of-3 or 3-of-5 alongside hardware from other
              vendors, where this is the one device you can read end to end. Sole custody of
              meaningful funds is not a use it was designed for.
            </Row>
          </Rows>
        </div>

        <p className="mt-8 text-base text-ink-300 max-w-2xl leading-relaxed">
          The useful thing here is not the device. It is the method: specifications a machine can
          check, invariants bound to named tests, and a build that fails when a claim stops being
          true. Take that and build your own. You will trust the result more, which is the entire
          point.
        </p>
      </Section>

      {/* --- 02 The executable argument ---------------------------------- */}
      <Section index="02" label="Check the arithmetic">
        <p className="text-xl text-ink-200 max-w-2xl leading-relaxed">
          A device that generates your seed inside a black box is asking you to trust the box. You
          cannot check it, and a correct one and a backdoored one look identical from outside.
        </p>
        <p className="mt-4 text-base text-ink-400 max-w-2xl leading-relaxed">
          The alternative is arithmetic you can redo. Roll some dice below, then run the command it
          gives you in a terminal.
        </p>

        <div className="mt-8">
          <DiceDemo />
        </div>

        <p className="mt-6 text-sm text-ink-500 max-w-2xl leading-relaxed">
          That is the whole idea. A device showing a different value for the same rolls is lying and
          you can tell, with no special tooling and no trust in anyone. The full procedure, the byte
          encoding, and why the answer is 100 rolls rather than 99, are in{' '}
          <Link
            href="/docs/entropy"
            className="text-signal-400 hover:text-signal-300 underline underline-offset-4 decoration-ink-700"
          >
            Entropy
          </Link>
          .
        </p>
      </Section>

      {/* --- 03 Method ---------------------------------------------------- */}
      <Section index="03" label="Method">
        <Rows>
          <Row term="Signatures are byte-identical">
            RFC 6979 deterministic ECDSA and BIP-340 Schnorr with{' '}
            <code className="font-mono text-ink-300">aux_rand</code> fixed to zero. A signer free to
            pick its nonce can grind it until the signature encodes bits of your key, and every
            signature still verifies. Determinism removes the space that would hide in. The ECDSA
            path is checked byte for byte against libsecp256k1 through bitcoinjs-lib, because
            self-consistency is exactly what a backdoored nonce also has. The Schnorr path is not
            cross-checked against a second implementation yet.
          </Row>
          <Row term="Change is re-derived, never asserted">
            An output is labelled change only when its address re-derives from a registered
            descriptor at a valid change path. Anything else is shown as a payment regardless of
            what the transaction claims about it.
          </Row>
          <Row term="No network, and not by convention">
            Not for updates, not for fee estimation, not for fonts. Enforced by a lint rule with its
            own regression suite and a runtime assertion that the daemon is listening on a Unix
            socket and nothing else, because a rule that only exists in a style guide is not a
            control. A systemd sandbox is specified to back this at the kernel level, and that unit
            is not written yet.
          </Row>
          {facts.has('daemon.multisig') && (
            <Row term="A quorum you are actually in">
              Registering a multisig descriptor checks that this device holds one of its keys, by
              re-deriving that key and comparing the key material. The fingerprint written beside a
              key is four unauthenticated bytes chosen by whoever wrote the descriptor, so it is
              shown and never believed. A quorum this device is not part of is refused outright,
              because it would receive funds forever and never be able to spend them. sortedmulti
              keys are ordered per BIP-67 at every index, not once, and the addresses are
              cross-checked against bitcoinjs-lib.
            </Row>
          )}

          {facts.has('daemon.store') && (
            <Row term="At rest, the card is the whole exposure">
              The seed is sealed with AES-256-GCM under a key stretched from your passphrase by
              Argon2id at 64 MiB, so each guess costs an attacker real work rather than a hash.
              The parameters are written into the file in plain JSON, readable with{' '}
              <code className="font-mono text-ink-300">cat</code>, and authenticated, so nobody can
              quietly turn the cost down. Ten wrong attempts at the device erases it. That counter
              stops someone guessing at the screen and nothing more: anyone who takes the card can
              copy it first and guess forever, which is why the passphrase is the real protection.
            </Row>
          )}

          <Row term="Recoverable without any of this code">
            Wallets are a BIP-39 mnemonic plus a canonical BIP-380 descriptor with a checksum, so
            Bitcoin Core can restore one with no nullroute code involved. Verification has the
            procedure to do it by hand against your own node. The automated drill that would run
            it against regtest on every commit is not built yet: the CI job is present but
            disabled, which is why this says the format permits recovery rather than that recovery
            is continuously tested.
          </Row>
        </Rows>
      </Section>

      {/* --- 04 What gets checked ---------------------------------------- */}
      <Section index="04" label="What the build checks">
        <p className="text-xl text-ink-200 max-w-2xl leading-relaxed">
          Every module ships a <code className="font-mono text-[0.9em] text-ink-100">.spec.yaml</code>{' '}
          beside its source naming the invariants it claims and the exact tests holding them up.
        </p>
        <p className="mt-4 text-base text-ink-400 max-w-2xl leading-relaxed">
          Five checks run on every commit and any one of them failing fails the build. This is the
          real output, generated from the report the last run wrote, because a hand-drawn terminal
          full of invented passes would be precisely the kind of decoration this project exists to
          argue against.
        </p>

        <Terminal command="make verify" facts={facts} />

        <div className="mt-9 grid gap-x-10 gap-y-6 sm:grid-cols-2 text-sm">
          {CHECK_NOTES.map(([term, body], i) => (
            // An odd count leaves a hole in a two-column grid. The last one
            // spans rather than sitting next to an empty cell.
            <div key={term} className={i === CHECK_NOTES.length - 1 ? 'sm:col-span-2' : undefined}>
              <div className="font-mono text-xs uppercase tracking-[0.14em] text-ink-500">
                {term}
              </div>
              <p className="mt-1.5 text-ink-400 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>

        <p className="mt-9 text-sm text-ink-500 max-w-2xl leading-relaxed">
          The lock screen prints that manifest root. If it differs from what you get by building the
          source yourself, do not enter your PIN.{' '}
          <Link
            href="/docs/verification"
            className="text-signal-400 hover:text-signal-300 underline underline-offset-4 decoration-ink-700"
          >
            How to reproduce it
          </Link>
          .
        </p>
      </Section>

      {/* --- 05 The device ------------------------------------------------ */}
      <Section index="05" label="The device">
        <p className="text-base text-ink-400 max-w-2xl leading-relaxed">
          A 7 inch touchscreen on a Raspberry Pi, around $100 in parts. Screenshots of the running
          software, not mockups.
        </p>

        <div className="mt-8 grid gap-7 sm:grid-cols-2">
          {SCREENS.map((screen) => (
            <figure key={screen.src} className="min-w-0">
              <div className="rounded-md border border-ink-800 overflow-hidden bg-ink-950">
                {/* A plain img, not next/image. Static export has no optimiser
                    to gain from, and next/image emits style="color:transparent",
                    which would force style-src 'unsafe-inline' site-wide. */}
                <img
                  src={screen.src}
                  alt={screen.title}
                  width={1600}
                  height={960}
                  loading="lazy"
                  decoding="async"
                  className="w-full h-auto block"
                />
              </div>
              <figcaption className="mt-3 text-sm">
                <span className="font-mono text-xs uppercase tracking-[0.16em] text-ink-500">
                  {screen.title}
                </span>
                <p className="mt-1.5 text-ink-400 leading-relaxed">{screen.caption}</p>
              </figcaption>
            </figure>
          ))}
        </div>
      </Section>

      {/* --- 06 Documents ------------------------------------------------- */}
      <Section index="06" label="Documents">
        <p className="text-base text-ink-400 max-w-2xl leading-relaxed">
          Rendered from <code className="font-mono text-ink-300">docs/</code> in the repository. The
          page here and the file that ships with the code are the same bytes, so the published
          version cannot drift from the one a reviewer reads.
        </p>

        <div className="mt-8 divide-y divide-ink-850 border-y border-ink-850">
          {DOCS.map((doc) => (
            <Link
              key={doc.slug}
              href={`/docs/${doc.slug}`}
              className="group block py-6 sm:grid sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-8"
            >
              <div className="text-sm font-medium text-ink-100 group-hover:text-signal-400 transition-colors">
                {doc.title}
              </div>
              <div className="mt-1.5 sm:mt-0 min-w-0">
                <p className="text-sm text-ink-300">{doc.question}</p>
                <p className="mt-1 text-sm text-ink-500 leading-relaxed">{doc.summary}</p>
              </div>
            </Link>
          ))}
        </div>
      </Section>

      {/* --- 07 Figure it out --------------------------------------------- */}
      <Section index="07" label="Figure it out yourself">
        <p className="text-xl text-ink-200 max-w-2xl leading-relaxed">
          There is no download. The source is the deliverable.
        </p>
        <p className="mt-4 text-base text-ink-400 max-w-2xl leading-relaxed">
          It runs on a Mac or a Linux box without any hardware, and the lock screen will show the
          hash of whatever you just built. Getting it running is not documented as a funnel with
          four copy-paste steps, because someone who is not willing to read a{' '}
          <code className="font-mono text-ink-300">Makefile</code> before running software that
          holds keys should not be running this one. Everything needed is in the repository.
        </p>
        <p className="mt-6 text-sm text-ink-500 max-w-2xl leading-relaxed">
          The most valuable thing you can do with it is find where it is wrong.
        </p>

        <a
          href="https://github.com/Xaxis/nullroute"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-8 inline-flex items-center gap-2.5 font-mono text-sm text-ink-200 border-b border-ink-700 pb-1 hover:text-signal-400 hover:border-signal-500 transition-colors"
        >
          github.com/Xaxis/nullroute
          <span aria-hidden="true">&rarr;</span>
        </a>
      </Section>
    </div>
  )
}
