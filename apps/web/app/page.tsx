import Link from 'next/link'
import { DOCS } from '../lib/docs'
import { Hero } from '../components/hero/Hero'
import { DiceDemo } from '../components/DiceDemo'

/**
 * The home page makes one argument: you should not have to trust this project,
 * and here is how you check.
 *
 * The order is deliberate. The interactive demo comes before the feature list,
 * because the demo IS the feature list's justification and everything else is a
 * claim until the reader has run it themselves. The device screenshots come
 * before the specifications, because someone deciding whether to build one
 * wants to see what they would be looking at.
 *
 * The honest limits sit high on the page rather than in a footnote, so a reader
 * who takes the claims at face value and skips the threat model still comes
 * away knowing the most important one.
 */

const PHASES = [
  {
    n: 1,
    scope: 'Spec system, entropy, BIP-39/32, daemon, lock screen, networks',
    state: 'complete',
  },
  {
    n: 2,
    scope: 'Descriptors, addresses, PSBT review, signing',
    provisioning: 'Tier 0: reproducible, signed image',
    state: 'in progress',
  },
  {
    n: 3,
    scope: 'Multisig, cosigner registration, encrypted store, PIN',
    provisioning: 'Tier 1: dm-verity, boot attestation',
    state: 'not started',
  },
  { n: 4, scope: 'BIP-322 message signing, BIP-85, BIP-329 labels', state: 'not started' },
  { n: 5, scope: 'Wallet layer, optional and lower assurance', state: 'not started' },
  { n: 6, scope: 'Bridge companion, runs on a networked machine', state: 'not started' },
  {
    n: 7,
    scope: 'Miniscript, taproot script paths, SeedXOR, silent payments',
    provisioning: 'Tier 2: signed boot chain (irreversible)',
    state: 'not started',
  },
]

const SCREENS = [
  {
    src: '/device/dice.png',
    title: 'Roll the dice',
    caption:
      'Live entropy accounting, truncated so it never claims more than you have. Warnings appear and never block: a fair die can look suspicious, and the device does not discard your rolls.',
  },
  {
    src: '/device/wallet.png',
    title: 'Your addresses',
    caption:
      'Every script type, receive and change, with the derivation path under each address. No balances, because the device has no network and will not pretend otherwise.',
  },
  {
    src: '/device/verify.png',
    title: 'Is this address mine?',
    caption:
      'Paste an address a coordinator gave you. The device re-derives it from your seed and answers, rather than comparing against a list it was handed.',
  },
  {
    src: '/device/lock.png',
    title: 'Before you unlock',
    caption:
      'The hash of the running code, and a plain statement of what it does not prove. Compare it against what you built. If they differ, do not enter your PIN.',
  },
]

export default function HomePage() {
  return (
    <div className="mx-auto max-w-5xl px-5">
      <Hero />

      {/* --- The argument, executable ------------------------------------ */}
      <section className="py-14 border-b border-ink-800">
        <h2 className="text-sm font-mono uppercase tracking-widest text-ink-500">
          Do not take our word for it
        </h2>
        <p className="mt-3 text-lg text-ink-300 max-w-2xl leading-relaxed">
          A hardware wallet that generates your seed inside a black box is asking you to trust the
          box. In 2024 a widely used one turned out to ship a random number generator that did not
          behave as documented, and the industry answered by promising a better black box.
        </p>
        <p className="mt-3 text-lg text-ink-100 max-w-2xl leading-relaxed">
          Here is the alternative. Roll some dice below, then run the command it gives you in a
          terminal.
        </p>

        <div className="mt-7">
          <DiceDemo />
        </div>

        <p className="mt-5 text-sm text-ink-500 max-w-2xl leading-relaxed">
          That is the whole idea. If a device shows you a different value for the same rolls, it is
          lying to you and you can tell. No special tooling, no trust in us. The full procedure,
          including why the answer is 100 rolls and not 99, is in{' '}
          <Link href="/docs/entropy" className="text-signal-400 hover:text-signal-300">
            Entropy
          </Link>
          .
        </p>
      </section>

      {/* --- What it looks like ------------------------------------------- */}
      <section className="py-14 border-b border-ink-800">
        <h2 className="text-sm font-mono uppercase tracking-widest text-ink-500">The device</h2>
        <p className="mt-3 text-sm text-ink-400 max-w-2xl leading-relaxed">
          A 7 inch touchscreen on a Raspberry Pi. These are screenshots of the running software,
          not mockups.
        </p>

        <div className="mt-7 grid gap-8 sm:grid-cols-2">
          {SCREENS.map((screen) => (
            <figure key={screen.src} className="min-w-0">
              <div className="rounded-lg border border-ink-800 overflow-hidden bg-ink-950">
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
              <figcaption className="mt-3">
                <span className="text-ink-100 font-medium text-sm">{screen.title}</span>
                <p className="mt-1 text-sm text-ink-400 leading-relaxed">{screen.caption}</p>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* --- Honest limits ----------------------------------------------- */}
      <section className="py-14 border-b border-ink-800">
        <h2 className="text-sm font-mono uppercase tracking-widest text-caution-500">
          Before you trust this with anything
        </h2>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-caution-500/30 bg-caution-500/5 p-5">
            <h3 className="text-ink-100 font-medium mb-2">There is no secure element</h3>
            <p className="text-sm text-ink-400 leading-relaxed">
              Keys are encrypted under a key derived from your PIN, and that is the entire physical
              defence. Someone holding your SD card is limited only by your PIN strength. A
              Coldcard or BitBox02 is genuinely better on this specific axis.
            </p>
          </div>
          <div className="rounded-lg border border-caution-500/30 bg-caution-500/5 p-5">
            <h3 className="text-ink-100 font-medium mb-2">One signer in a quorum</h3>
            <p className="text-sm text-ink-400 leading-relaxed">
              Designed for 2-of-3 or 3-of-5 alongside hardware from other vendors, where nullroute
              is the one you can fully audit. Sole custody of meaningful funds is a use we have not
              designed for.
            </p>
          </div>
          <div className="rounded-lg border border-caution-500/30 bg-caution-500/5 p-5">
            <h3 className="text-ink-100 font-medium mb-2">Not finished</h3>
            <p className="text-sm text-ink-400 leading-relaxed">
              Pre-1.0 and unaudited. There is no encrypted store and no PIN gate yet, so there is
              nowhere to persist a wallet. Do not put money on this.
            </p>
          </div>
        </div>
      </section>

      {/* --- What it does ------------------------------------------------ */}
      <section className="py-14 border-b border-ink-800">
        <h2 className="text-sm font-mono uppercase tracking-widest text-ink-500">What it does</h2>
        <dl className="mt-6 grid gap-x-10 gap-y-7 sm:grid-cols-2">
          <div>
            <dt className="text-ink-100 font-medium">Signs without leaking</dt>
            <dd className="mt-1.5 text-sm text-ink-400 leading-relaxed">
              RFC 6979 deterministic ECDSA and BIP-340 Schnorr with{' '}
              <code className="font-mono text-ink-300">aux_rand</code> fixed to zero. Signatures are
              byte-identical every time, so there is no free space to hide key material in. A
              randomised signature can leak your key a few bits per transaction and nothing on
              screen looks wrong.
            </dd>
          </div>
          <div>
            <dt className="text-ink-100 font-medium">Verifies change by re-deriving it</dt>
            <dd className="mt-1.5 text-sm text-ink-400 leading-relaxed">
              An output is labelled change only if the address re-derives from a registered
              descriptor at a valid change path. Anything else is shown as a payment, whatever the
              transaction claims.
            </dd>
          </div>
          <div>
            <dt className="text-ink-100 font-medium">No network, at all</dt>
            <dd className="mt-1.5 text-sm text-ink-400 leading-relaxed">
              Not for updates, not for fee estimation, not for fonts. Enforced by a lint rule with
              its own regression suite, a runtime assertion, and a kernel-level restriction on the
              daemon, rather than by convention.
            </dd>
          </div>
          <div>
            <dt className="text-ink-100 font-medium">No lock-in, proved in CI</dt>
            <dd className="mt-1.5 text-sm text-ink-400 leading-relaxed">
              Every wallet is recoverable from the BIP-39 mnemonic plus a standard descriptor,
              using Bitcoin Core and no nullroute code. There is a test that does exactly that
              against regtest, and it is the most important test in the suite.
            </dd>
          </div>
        </dl>
      </section>

      {/* --- Run it ------------------------------------------------------ */}
      <section className="py-14 border-b border-ink-800">
        <h2 className="text-sm font-mono uppercase tracking-widest text-ink-500">
          Run it yourself
        </h2>
        <p className="mt-3 text-sm text-ink-400 max-w-2xl leading-relaxed">
          You do not need a Raspberry Pi to look at this. The whole device runs on a Mac or Linux
          machine, and the lock screen will show the hash of the code you just built.
        </p>

        <div className="mt-6 rounded-lg border border-ink-800 bg-ink-900 overflow-hidden">
          <div className="px-4 py-2 border-b border-ink-800 text-xs font-mono text-ink-500">
            requires Node 24
          </div>
          <pre className="p-4 text-[0.8125rem] leading-relaxed overflow-x-auto font-mono text-ink-200">
            <code>{`git clone git@github.com:Xaxis/nullroute.git
cd nullroute
make install
make dev          # the device, at 127.0.0.1:5180`}</code>
          </pre>
        </div>

        <p className="mt-4 text-sm text-ink-500 max-w-2xl leading-relaxed">
          Hardware for a real one runs about $100 to $120: a Raspberry Pi, a small touchscreen, an
          SD card and one die. The{' '}
          <a
            href="https://github.com/Xaxis/nullroute#what-you-need"
            target="_blank"
            rel="noopener noreferrer"
            className="text-signal-400 hover:text-signal-300"
          >
            bill of materials
          </a>{' '}
          is in the README.
        </p>
      </section>

      {/* --- Documentation ---------------------------------------------- */}
      <section className="py-14 border-b border-ink-800">
        <h2 className="text-sm font-mono uppercase tracking-widest text-ink-500">Documentation</h2>
        <p className="mt-3 text-sm text-ink-500">
          Rendered directly from <code className="font-mono">docs/</code> in the repository. The
          page you read here and the file that ships with the code are the same bytes.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {DOCS.map((doc) => (
            <Link
              key={doc.slug}
              href={`/docs/${doc.slug}`}
              className="block rounded-lg border border-ink-800 p-5 hover:border-ink-600 hover:bg-ink-900/50 transition-colors group"
            >
              <h3 className="text-ink-100 font-medium group-hover:text-signal-400 transition-colors">
                {doc.title}
              </h3>
              <p className="mt-1 text-sm text-signal-400/80">{doc.question}</p>
              <p className="mt-1.5 text-sm text-ink-400 leading-relaxed">{doc.summary}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* --- Status ------------------------------------------------------ */}
      <section className="py-14">
        <h2 className="text-sm font-mono uppercase tracking-widest text-ink-500">Status</h2>
        <p className="mt-3 text-sm text-ink-400 max-w-2xl leading-relaxed">
          The signer is being built before the wallet, and the verification system was built before
          the signer. Nothing later is pulled forward: that ordering, and the irreversible work
          staying last, is what keeps a large feature list from eroding the small part that holds
          keys.
        </p>

        <div className="mt-6 rounded-lg border border-ink-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-ink-900 text-ink-300">
                  <th className="text-left font-medium px-4 py-2.5 w-16">Phase</th>
                  <th className="text-left font-medium px-4 py-2.5">Scope</th>
                  <th className="text-left font-medium px-4 py-2.5 w-32">State</th>
                </tr>
              </thead>
              <tbody>
                {PHASES.map((phase) => (
                  <tr key={phase.n} className="border-t border-ink-850">
                    <td className="px-4 py-2.5 font-mono text-ink-400">{phase.n}</td>
                    <td className="px-4 py-2.5 text-ink-300">
                      {phase.scope}
                      {phase.provisioning !== undefined && (
                        <span className="block mt-1 text-xs text-signal-400/80">
                          {phase.provisioning}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={
                          phase.state === 'complete'
                            ? 'text-verify-300 font-medium'
                            : phase.state === 'in progress'
                              ? 'text-signal-400 font-medium'
                              : 'text-ink-600'
                        }
                      >
                        {phase.state}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  )
}
