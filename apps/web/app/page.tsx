import Link from 'next/link'
import { DOCS } from '../lib/docs'
import { Hero } from '../components/hero/Hero'

/**
 * The home page makes exactly one argument: you should not have to trust this
 * project, and here is how you check.
 *
 * It leads with the dice command rather than with a feature list, because the
 * command is the argument. It states the absence of a secure element above the
 * fold rather than in a footnote, because a reader who takes the claims at face
 * value and skips the threat model should still come away knowing the most
 * important limitation.
 */

const PHASES = [
  { n: 1, scope: 'Spec system, entropy, BIP-39/32, daemon skeleton', state: 'in progress' },
  {
    n: 2,
    scope: 'Single-sig signing, descriptors, PSBT review',
    provisioning: 'Tier 0: reproducible, signed image',
    state: 'not started',
  },
  {
    n: 3,
    scope: 'Multisig, cosigner registration, multi-wallet',
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

export default function HomePage() {
  return (
    <div className="mx-auto max-w-5xl px-5">
      <Hero />

      {/* --- The argument ----------------------------------------------- */}
      <section className="py-14 border-b border-ink-800">
        <h2 className="text-sm font-mono uppercase tracking-widest text-ink-500">
          The whole idea
        </h2>

        <div className="mt-6 grid gap-10 lg:grid-cols-[1.1fr_1fr] items-start min-w-0">
          <div className="space-y-4 text-ink-300 leading-relaxed">
            <p>
              Good wallets already exist. The distinguishing feature here is not the wallet.
            </p>
            <p>
              A hardware wallet that generates your seed inside a black box is asking you to
              trust the box. In 2024 a widely used one turned out to ship a random number
              generator that did not behave as documented, and the industry&apos;s answer was to
              promise a better black box.
            </p>
            <p className="text-ink-100">
              That is the wrong answer. You should not have to take anyone&apos;s word for where
              your key came from.
            </p>
            <p>
              So: roll 100 dice. The device shows you the arithmetic. Check it on any laptop with
              a tool that was already there.
            </p>
          </div>

          <div className="rounded-lg border border-ink-800 bg-ink-900 overflow-hidden min-w-0">
            <div className="px-4 py-2 border-b border-ink-800 text-xs font-mono text-ink-500">
              any machine, no nullroute code
            </div>
            <pre className="p-4 text-[0.8125rem] leading-relaxed overflow-x-auto font-mono">
              <code>
                <span className="text-ink-500">$ </span>
                <span className="text-ink-200">printf &apos;%s&apos; &apos;123456...&apos; | sha256sum</span>
                {'\n'}
                <span className="hash text-verify-300">
                  e56403e8522ddeae1b44a1e8148b1ba4
                  {'\n'}d3b4c626ccf20980056eedcc7e0c0f35
                </span>
              </code>
            </pre>
            <div className="px-4 py-3 border-t border-ink-800 text-xs text-ink-400 leading-relaxed">
              If the device shows a different value for the same rolls, it is lying to you, and
              you now know. The full procedure is in{' '}
              <Link href="/docs/entropy" className="text-signal-400 hover:text-signal-300">
                Entropy
              </Link>
              .
            </div>
          </div>
        </div>
      </section>

      {/* --- Honest limits, above the fold rather than in a footnote ----- */}
      <section className="py-14 border-b border-ink-800">
        <h2 className="text-sm font-mono uppercase tracking-widest text-caution-500">
          Before you trust this with anything
        </h2>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-caution-500/30 bg-caution-500/5 p-5">
            <h3 className="text-ink-100 font-medium mb-2">There is no secure element</h3>
            <p className="text-sm text-ink-400 leading-relaxed">
              Keys are encrypted under a key derived from your PIN with Argon2id, and that is the
              entire physical defence. An attacker holding your SD card is limited only by your
              PIN strength. A Coldcard or BitBox02 is genuinely better on this specific axis.
            </p>
          </div>
          <div className="rounded-lg border border-caution-500/30 bg-caution-500/5 p-5">
            <h3 className="text-ink-100 font-medium mb-2">One signer in a quorum</h3>
            <p className="text-sm text-ink-400 leading-relaxed">
              Designed for 2-of-3 or 3-of-5 alongside hardware from other vendors, where nullroute
              is the signer you can fully audit. Sole custody of meaningful funds is a use we have
              not designed for.
            </p>
          </div>
          <div className="rounded-lg border border-caution-500/30 bg-caution-500/5 p-5">
            <h3 className="text-ink-100 font-medium mb-2">Duress features buy time, not safety</h3>
            <p className="text-sm text-ink-400 leading-relaxed">
              This codebase is public, so an adversary who has read it knows hidden profiles are
              possible. If you are under credible physical threat, give them the money.
            </p>
          </div>
        </div>

        <p className="mt-5 text-sm text-ink-500">
          Also out of scope, on purpose: side channel attacks, physical attacks on the SoC, evil
          maid attacks absent secure boot, and a compromised OS image installed before first boot.{' '}
          <Link href="/docs/threat-model" className="text-signal-400 hover:text-signal-300">
            The full list is deliberately long.
          </Link>
        </p>
      </section>

      {/* --- What it does ------------------------------------------------ */}
      <section className="py-14 border-b border-ink-800">
        <h2 className="text-sm font-mono uppercase tracking-widest text-ink-500">What it does</h2>
        <dl className="mt-6 grid gap-x-10 gap-y-7 sm:grid-cols-2">
          <div>
            <dt className="text-ink-100 font-medium">Signs without leaking</dt>
            <dd className="mt-1.5 text-sm text-ink-400 leading-relaxed">
              RFC 6979 deterministic ECDSA and BIP-340 Schnorr with <code className="font-mono text-ink-300">aux_rand</code>{' '}
              fixed to zero. Signatures are byte-identical every time, so there is no free space to
              hide key material in. A randomised signature can leak your key a few bits per
              transaction and nothing on screen looks wrong.
            </dd>
          </div>
          <div>
            <dt className="text-ink-100 font-medium">Verifies change by re-deriving it</dt>
            <dd className="mt-1.5 text-sm text-ink-400 leading-relaxed">
              An output is labelled change only if the address re-derives from a registered
              descriptor at a valid change path. Anything else is shown as a payment, whatever the
              PSBT claims.
            </dd>
          </div>
          <div>
            <dt className="text-ink-100 font-medium">No network, at all</dt>
            <dd className="mt-1.5 text-sm text-ink-400 leading-relaxed">
              Not for updates, not for fee estimation, not for fonts. Enforced by a lint rule with
              its own regression suite, and by a runtime assertion, rather than by convention.
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

      {/* --- Documentation ---------------------------------------------- */}
      <section className="py-14 border-b border-ink-800">
        <h2 className="text-sm font-mono uppercase tracking-widest text-ink-500">
          Documentation
        </h2>
        <p className="mt-3 text-sm text-ink-500">
          Rendered directly from <code className="font-mono">docs/</code> in the repository. The
          page you read here and the file that ships with the code are the same bytes.
        </p>
        <div className="mt-6 space-y-3">
          {DOCS.map((doc) => (
            <Link
              key={doc.slug}
              href={`/docs/${doc.slug}`}
              className="block rounded-lg border border-ink-800 p-5 hover:border-ink-600 hover:bg-ink-900/50 transition-colors group"
            >
              <h3 className="text-ink-100 font-medium group-hover:text-signal-400 transition-colors">
                {doc.title}
              </h3>
              <p className="mt-1.5 text-sm text-ink-400 leading-relaxed">{doc.summary}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* --- Status ------------------------------------------------------ */}
      <section className="py-14">
        <h2 className="text-sm font-mono uppercase tracking-widest text-ink-500">Status</h2>
        <p className="mt-3 text-sm text-ink-400 max-w-2xl leading-relaxed">
          The signer is being built before the wallet, and the verification system was built
          before the signer. Nothing later is pulled forward: the phase ordering and the tier
          boundary are what keep a large feature set from eroding the assurance of the small part
          that holds keys.
        </p>
        <p className="mt-3 text-sm text-ink-400 max-w-2xl leading-relaxed">
          Provisioning the operating system moved earlier. An application verification system
          running on an unverifiable OS is a lock on a door in a paper wall, so a reproducible,
          signed image you can check before flashing lands as soon as there is something worth
          running on hardware. The signed boot chain stays last, because it burns fuses and
          cannot be undone.
        </p>

        <div className="mt-6 rounded-lg border border-ink-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-ink-900 text-ink-300">
                <th className="text-left font-medium px-4 py-2.5 w-20">Phase</th>
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
                        phase.state === 'in progress'
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
      </section>
    </div>
  )
}
