import type { Metadata } from 'next'
import Link from 'next/link'
import { readFacts } from '../../lib/facts'
import { readEntropyExample, readMnemonicExample } from '../../lib/entropy'
import { invariantExcerpt } from '../../lib/specs'
import { readRepoFile } from '../../lib/repo'
import { OG_IMAGE } from '../../lib/site'
import { Flow } from '../../components/Flow'
import { MARK } from '../../components/Terminal'
import { A, C, Figure, Hash, Prose, Section, Source, Transcript } from '../../components/report'

export const metadata: Metadata = {
  title: 'Check it yourself',
  description:
    'Six things you can check about nullroute without trusting it: the manifest root, the dice rule, deterministic signatures, the spec system, the card image, and recovery with Bitcoin Core alone. Each with the command and the answer this build gives.',
  openGraph: { title: 'Check it yourself | nullroute', images: [OG_IMAGE] },
}

/**
 * How checking works, one mechanism at a time.
 *
 * WRITTEN FOR SOMEBODY WHO DOES NOT TRUST THIS PROJECT, and should not have
 * to. Each section says what is claimed, draws the mechanism with this build's
 * own values in it, gives the command that checks it with the answer it
 * should print, and says what the check does not prove. The long version of
 * each lives in docs/, and every section links to it.
 */

interface ManifestCase {
  readonly input: { readonly files: readonly { readonly path: string }[] }
  readonly expected: { readonly root: string; readonly rootMustNotBe: readonly string[] }
}

function readLocaleRoots(): ManifestCase {
  const doc = JSON.parse(readRepoFile('spec/vectors/signer-profile/manifest-root.json')) as {
    cases: readonly (ManifestCase & { id: string })[]
  }
  const tree = doc.cases.find((c) => c.id === 'byte-order-tree')
  if (tree === undefined || tree.expected.rootMustNotBe.length < 2) {
    throw new Error(
      'nullroute.diy: manifest-root.json has no byte-order case with two locale roots.'
    )
  }
  return tree
}

const CONTENTS: readonly (readonly [string, string])[] = [
  ['root', 'The number on the lock screen'],
  ['dice', 'Dice into a seed'],
  ['signatures', 'Signatures with no room in them'],
  ['specs', 'Specs the build reads'],
  ['image', 'The card, and a copy with one byte changed'],
  ['leaving', 'Leaving without us'],
]

export default function CheckPage() {
  const facts = readFacts()
  const entropy = readEntropyExample()
  const mnemonic = readMnemonicExample()
  const locale = readLocaleRoots()
  const dice1 = invariantExcerpt('packages/core/src/entropy/dice.spec.yaml', 'INV-DICE-1')
  const diceTests = facts
    .invariantsFor('packages/core/test/entropy.dice.test.ts')
    .filter((t) => t.id === 'INV-DICE-1')

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <header className="pt-12 pb-10 sm:pt-16">
        <div className="label">Check it</div>
        <h1 className="mt-3 font-display text-[2.5rem] leading-[1.05] tracking-[-0.02em] text-ink sm:text-[3.5rem] max-w-[24ch]">
          Six things you can check without trusting us.
        </h1>
        <Prose className="mt-6 text-[1.1875rem]">
          <p>
            Each section says what is claimed, draws the mechanism with this build&rsquo;s own
            values in it, gives the command that checks it and the answer it should print, and says
            what the check does not prove. None of them needs this project&rsquo;s tools.
          </p>
        </Prose>
        <nav aria-label="On this page" className="mt-8">
          <ol className="grid gap-x-8 gap-y-1.5 font-sans text-[0.9375rem] sm:grid-cols-2 lg:grid-cols-3">
            {CONTENTS.map(([id, title], i) => (
              <li key={id} className="flex gap-2.5">
                <span className="font-mono text-[0.8125rem] text-signal tabular-nums pt-px">
                  {String(i + 1)}
                </span>
                <a href={`#${id}`} className="link">
                  {title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      </header>

      {/* --- 1. The manifest root ---------------------------------------- */}
      <Section n="1" kicker="Attestation" title="The number on the lock screen." id="root">
        <Prose>
          <p>
            Before it asks for a PIN, the device shows the manifest root: SHA-256 of a plain{' '}
            <C>sha256sum</C> listing of every file that goes onto it, sorted by path bytes. You can
            recompute it from the source with coreutils. If your number and the device&rsquo;s
            differ, the device is not running the code you built.
          </p>
        </Prose>
        <div className="mt-8">
          <Flow
            label="How the manifest root is made"
            steps={[
              {
                title: 'Take the files',
                body: (
                  <>
                    All {facts.files} tracked files under <C>packages/</C>, <C>spec/</C> and{' '}
                    <C>provisioning/</C>, and the root package files.
                  </>
                ),
              },
              {
                title: 'Hash each one',
                body: (
                  <>
                    <C>sha256sum</C> prints one line per file: the hash, two spaces, the path.
                  </>
                ),
              },
              {
                title: 'Sort by bytes',
                body: (
                  <>
                    Under <C>LC_ALL=C</C>, so the order is the same in every language. That list is{' '}
                    <C>MANIFEST.lock</C>.
                  </>
                ),
              },
              {
                title: 'Hash the list',
                body: (
                  <>
                    <C>sha256sum MANIFEST.lock</C> is the root, the number on the lock screen.
                  </>
                ),
              },
            ]}
          />
        </div>
        <Figure
          n="1"
          title="Recomputing the root from a checkout"
          className="mt-10"
          source={
            <>
              the commands in <A href="/docs/verification">docs/VERIFICATION.md</A>, which{' '}
              <C>make manifest-recipe</C> runs on every check so the page cannot drift from the
              tool. On macOS use <C>shasum -a 256</C> in place of <C>sha256sum</C>.
            </>
          }
        >
          <Transcript
            label="Recomputing the manifest root"
            lines={[
              {
                cmd: 'git ls-files -z package.json package-lock.json packages spec provisioning | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum',
                out: `${facts.rootHash}  -`,
              },
              { cmd: 'sha256sum MANIFEST.lock', out: `${facts.rootHash}  MANIFEST.lock` },
            ]}
          />
        </Figure>

        <Figure
          n="2"
          title="The same sixteen files in three orders give three roots"
          className="mt-12"
          source={
            <>
              the <C>byte-order-tree</C> case in{' '}
              <A href="/profile/kit">
                <C>manifest-root.json</C>
              </A>
              , generated with GNU coreutils, glibc and Node&rsquo;s ICU. A signer that produces
              either of the second two fails SP-ATT-2.
            </>
          }
        >
          <div className="rounded-[4px] border border-line bg-surface divide-y divide-line">
            {[
              ['Byte order, LC_ALL=C', locale.expected.root, true],
              ['A locale-aware order', locale.expected.rootMustNotBe[0] ?? '', false],
              ['Another locale-aware order', locale.expected.rootMustNotBe[1] ?? '', false],
            ].map(([label, root, ok]) => (
              <div
                key={String(root)}
                className="grid gap-2 px-4 py-3.5 sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-6"
              >
                <div className="font-sans text-[0.875rem]">
                  <span className={ok === true ? 'text-verify' : 'text-caution'}>
                    {ok === true ? 'expected' : 'must not be'}
                  </span>
                  <span className="block text-muted text-[0.8125rem]">{String(label)}</span>
                </div>
                <Hash
                  value={String(root)}
                  className="hash-grid grid-cols-[repeat(4,auto)] text-[0.9375rem] text-ink sm:grid-cols-[repeat(8,auto)]"
                />
              </div>
            ))}
          </div>
        </Figure>
        <Prose className="mt-8">
          <p>
            The paths include upper and lower case, punctuation either side of <C>/</C>, digits, a
            space and an accented name ({locale.input.files.length} files in all). That is why{' '}
            <C>LC_ALL=C</C> is not optional: without it the number a user compares depends on the
            language their computer is set to.
          </p>
          <p className="text-muted text-[0.9375rem]">
            What it does not prove: the lock screen is drawn by the software it describes. It
            catches an accident or a crude substitution, not an attacker who replaced the code that
            draws it. Nothing has been released, so there is no published root to compare against
            yet.
          </p>
        </Prose>
      </Section>

      {/* --- 2. Dice ----------------------------------------------------- */}
      <Section n="2" kicker="Entropy" title="Dice into a seed, by a rule you can repeat." id="dice">
        <Prose>
          <p>
            The default way to make a seed is dice, and the rule is short enough to check by hand:
            SHA-256 of the rolls as ASCII digits, with no separator and no trailing newline. After
            that it is plain BIP-39, which any offline tool can confirm.
          </p>
        </Prose>
        <div className="mt-8">
          <Flow
            label="How dice become a seed"
            steps={[
              { title: 'Roll 100 times', body: <>Digits 1 to 6. Fewer than 100 is refused.</> },
              {
                title: 'Write them as text',
                body: <>ASCII digits in order, nothing between them, no newline.</>,
              },
              {
                title: 'SHA-256',
                body: (
                  <>
                    32 bytes: the BIP-39 entropy. This is the step people get wrong with <C>echo</C>
                    .
                  </>
                ),
              },
              { title: 'BIP-39 words', body: <>24 words, the last carrying a checksum.</> },
              {
                title: 'BIP-39 seed',
                body: <>PBKDF2 over the words and your passphrase, if any.</>,
              },
            ]}
          />
        </div>
        <Figure
          n="3"
          title="The public worked example, from rolls to seed"
          className="mt-10"
          source={
            <>
              the worked example in <A href="/docs/entropy">docs/ENTROPY.md</A>. The entropy is
              recomputed when this site is built; the words and seed are quoted from the document,
              which the device&rsquo;s own tests check (INV-DICE-3).
            </>
          }
        >
          <Transcript
            label="Checking the worked example"
            lines={[
              { cmd: `printf '%s' '${entropy.rolls}' | wc -c`, out: '100' },
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
          <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="rounded-[4px] border border-line bg-surface px-4 py-3.5">
              <div className="label">24 words</div>
              <ol className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[0.8125rem] sm:grid-cols-4">
                {mnemonic.words.map((word, i) => (
                  <li key={i} className="flex gap-2 min-w-0">
                    <span className="w-5 shrink-0 text-right text-muted tabular-nums">{i + 1}</span>
                    <span className="text-ink">{word}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="rounded-[4px] border border-line bg-surface px-4 py-3.5 min-w-0">
              <div className="label">Seed, empty passphrase</div>
              <Hash value={mnemonic.seed} className="mt-2.5 text-[0.875rem] text-ink" />
            </div>
          </div>
        </Figure>
        <Prose className="mt-8">
          <p>
            <span className="font-sans font-semibold text-[0.9375rem] text-caution">
              Never use this seed.
            </span>{' '}
            It is public, and anything sent to it can be taken by anyone. It exists so you can
            confirm your copy of the device computes what it claims to.
          </p>
          <p>
            Why 100 rolls and not 99: 99 rolls of a fair die carry 255.911 bits, short of 256 by
            0.089. Coldcard, SeedSigner and Krux accept 99; this device does not round in its own
            favour, and the signer profile sets out the arithmetic for others to dispute.{' '}
            <A href="/docs/entropy">The whole derivation</A>.
          </p>
        </Prose>
      </Section>

      {/* --- 3. Signatures ----------------------------------------------- */}
      <Section n="3" kicker="Signing" title="Signatures with no room in them." id="signatures">
        <Prose>
          <p>
            A signing device that randomises its signatures can leak your private key through
            nothing but valid transactions: grind the nonce until chosen bits of each signature
            encode part of the key. Every signature verifies, and nothing on the device looks wrong.
          </p>
          <p>
            nullroute leaves no free space to hide anything in. ECDSA nonces come from RFC 6979, and
            Schnorr signatures use BIP-340 with <C>aux_rand</C> fixed to 32 zero bytes. Given the
            seed and the PSBT, the signature bytes are fully determined, so anybody with the seed
            and an independent implementation can sign the same PSBT and compare.
          </p>
        </Prose>
        <dl className="mt-8 grid gap-px overflow-hidden rounded-[4px] border border-line bg-line font-sans text-[0.875rem] sm:grid-cols-3">
          {[
            [
              'One PSBT, a hundred times',
              'The suite signs the same PSBT 100 times and requires byte-identical output.',
            ],
            [
              'A second implementation',
              'Derivation, addresses and signatures are cross-checked against bitcoinjs-lib.',
            ],
            [
              'The BIP’s own signer',
              'Both signer steps of the BIP-174 walk-through are reproduced byte for byte.',
            ],
          ].map(([k, v]) => (
            <div key={k} className="bg-surface px-4 py-3.5">
              <dt className="font-semibold text-ink">{k}</dt>
              <dd className="mt-1 text-body leading-snug">{v}</dd>
            </div>
          ))}
        </dl>
        <Prose className="mt-8">
          <p className="text-muted text-[0.9375rem]">
            The trade, stated: BIP-340 allows a random <C>aux_rand</C> because it defends against
            some fault-injection attacks. Fixing it to zero gives that up in exchange for signatures
            anyone can reproduce. None of these tests is a substitute for checking a signature you
            actually care about.{' '}
            <A href="/docs/verification#4-reproducing-a-signature">Reproducing a signature</A>.
          </p>
        </Prose>
      </Section>

      {/* --- 4. Specs ---------------------------------------------------- */}
      <Section
        n="4"
        kicker="Method"
        title="Specs the build reads, not documents it ignores."
        id="specs"
      >
        <Prose>
          <p>
            Every module ships a <C>*.spec.yaml</C> beside its code. A spec declares invariants, and
            each invariant names the tests that prove it. The build fails if a test named by an
            invariant is missing, skipped or failing, if an exported function is in no spec, or if a
            pinned test vector has changed.
          </p>
        </Prose>
        <div className="mt-8">
          <Flow
            label="How a claim becomes a check"
            steps={[
              {
                title: 'A spec',
                body: <>{facts.specs} of them, one per module, beside the code.</>,
              },
              {
                title: 'An invariant',
                body: <>{facts.invariants} claims, each naming its tests.</>,
              },
              {
                title: 'Its tests',
                body: (
                  <>
                    {facts.boundTests} tests bound to invariants, out of {facts.tests} in the suite.
                  </>
                ),
              },
              { title: 'make verify', body: <>Five checks, one report, one root.</> },
              {
                title: 'The daemon',
                body: <>Refuses to start without a passing report that names this manifest.</>,
              },
            ]}
          />
        </div>
        <Figure
          n="4"
          title="One invariant, as the build reads it"
          className="mt-10"
          source={
            <>
              <C>packages/core/src/entropy/dice.spec.yaml</C>, copied verbatim. Test results from
              this build&rsquo;s <C>verification-report.json</C>.
            </>
          }
        >
          <div className="rounded-[4px] border border-line bg-sunk overflow-x-auto">
            <pre className="transcript px-4 py-4 sm:px-5 text-ink">{dice1}</pre>
          </div>
          <ul className="mt-3 space-y-1 font-mono text-[0.8125rem]">
            {diceTests.map((t) => (
              <li key={t.test} className="flex gap-3">
                <span className={`${MARK[t.status].className} w-9 shrink-0`}>
                  {MARK[t.status].glyph}
                </span>
                <span className="text-body break-all">{t.test}</span>
              </li>
            ))}
          </ul>
        </Figure>
        <Prose className="mt-8">
          <p className="text-muted text-[0.9375rem]">
            What it does not prove: that the specs describe a secure design. A spec can be wrong and
            its tests can agree with it. That takes a human reviewer, and so far only the author has
            been one.
          </p>
        </Prose>
      </Section>

      {/* --- 5. Image ---------------------------------------------------- */}
      <Section
        n="5"
        kicker="Provisioning"
        title="The card, and a copy with one byte changed."
        id="image"
      >
        <Prose>
          <p>
            The card image puts the system partition under dm-verity: a hash tree over every block,
            whose root the kernel checks reads against. The lock screen shows that root too, read
            from the live device-mapper table rather than from the card.
          </p>
          <p>
            <C>make image-boot-test</C> boots the card under QEMU, opens the mapping, reads every
            block and starts the signing daemon. Then it changes one byte inside the system
            partition of a copy and boots that, and requires it to fail. A device that cannot tell
            those two apart has an integrity check for decoration.
          </p>
        </Prose>
        <Transcript
          className="mt-8"
          label="Building and boot-testing the card image"
          lines={[
            {
              cmd: 'make image',
              out: <span className="text-muted"># a flashable card and its checksums</span>,
            },
            {
              cmd: 'make image-boot-test',
              out: (
                <span className="text-muted">
                  # boot it, then boot a copy with one byte changed
                </span>
              ),
            },
            {
              cmd: 'make image-repro',
              out: <span className="text-muted"># build it twice and compare</span>,
            },
          ]}
        />
        <Source>
          the README&rsquo;s build commands. Debian packages come from snapshot.debian.org at one
          pinned moment, so a later build of the same commit sees the same archive.
        </Source>
        <Prose className="mt-8">
          <p className="text-muted text-[0.9375rem]">
            What it does not prove: dm-verity detects modification of the system partition and does
            not prevent it. The boot partition holds the root hash and cannot sit under the tree
            that hash describes, so an attacker who rewrites it supplies their own number. Only a
            signed boot chain closes that, in phase 7. The firmware path from power-on to the kernel
            has not run on a Pi yet; QEMU starts at the kernel.{' '}
            <A href="/docs/verification">Checking and building a device</A>.
          </p>
        </Prose>
      </Section>

      {/* --- 6. Leaving -------------------------------------------------- */}
      <Section n="6" kicker="No lock-in" title="Leaving without us." id="leaving">
        <Prose>
          <p>
            Every wallet here is a BIP-39 mnemonic and a canonical BIP-380 descriptor. The recovery
            drill restores and spends single-key wallets in all four script types and 2-of-3 quorums
            in <C>wsh</C> and taproot with Bitcoin Core alone, on regtest. nullroute contributes
            signatures and nothing else; Core derives the addresses, builds the spend, finalises and
            broadcasts it.
          </p>
          <p>
            CI runs the drill on every push to <C>main</C>, against a Core release downloaded from
            bitcoincore.org and checked against a pinned SHA-256. If the drill ever fails, funds
            made here would depend on this project continuing to exist, which is worse than any bug.
          </p>
        </Prose>
        <Transcript
          className="mt-8"
          label="Running the recovery drill"
          lines={[
            {
              cmd: 'make test-recovery-drill',
              out: <span className="text-muted"># needs a regtest bitcoind</span>,
            },
          ]}
        />
        <p className="mt-8 font-sans text-[0.9375rem]">
          <Link href="/docs/verification#5-recovering-without-nullroute" className="link">
            Recovering without nullroute, step by step
          </Link>
        </p>
      </Section>
    </div>
  )
}
