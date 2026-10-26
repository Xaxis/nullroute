import type { Metadata } from 'next'
import Link from 'next/link'
import { readProfile, statusKind } from '../../lib/profile'
import { OG_IMAGE, REPO_URL } from '../../lib/site'
import { ResultsTable, SourcesList } from '../../components/ResultsTable'
import { A, C, Figure, Prose, Section, Source, Transcript } from '../../components/report'

export const metadata: Metadata = {
  title: 'Air-gapped signer profile and conformance kit',
  description:
    'A draft specification for air-gapped Bitcoin signers, with requirements for entropy, pre-signing review, signing, attestation, hardware and transport, and a language-neutral conformance kit any signer can run. No expected value in it was produced by nullroute.',
  openGraph: { title: 'Signer profile and conformance kit | nullroute', images: [OG_IMAGE] },
}

/**
 * The signer profile and its conformance kit.
 *
 * THE PART OF THE PROJECT THAT IS FOR EVERYONE ELSE. The device is one
 * implementation; the profile is a proposal any air-gapped signer could be
 * held to, and the kit is how. So this page is careful in the way a proposal
 * has to be: it says the profile is a draft nobody has adopted, it shows
 * nullroute's own open items before anyone has to look for them, and it
 * leaves the second column of the results empty rather than implying a
 * second implementation exists.
 */

const QUESTIONS: readonly (readonly [string, string])[] = [
  [
    'Where did the seed come from?',
    'A rule for turning dice into a seed that anyone can repeat with coreutils, and the arithmetic for how many rolls are enough.',
  ],
  [
    'What will this signature authorise?',
    'What a signer must show before it signs, what counts as change, and which findings must disable signing until an explicit, single-use override.',
  ],
  [
    'Which software is asking for my passphrase?',
    'A number the user can recompute from source before entering a PIN, and what that number does and does not prove.',
  ],
  [
    'What hardware does the argument assume?',
    'Capabilities rather than models: a display only the signer drives and wide enough for a whole address, a way in that is not a network, and radios absent or with their drivers and firmware removed.',
  ],
]

export default function ProfilePage() {
  const profile = readProfile()
  const byArea = profile.areas.map((area) => {
    const rows = profile.conformance.filter((row) => row.id.startsWith(`${area.prefix}-`))
    return {
      ...area,
      met: rows.filter((r) => statusKind(r.status) === 'met').length,
      qualified: rows.filter((r) => statusKind(r.status) === 'qualified').length,
      open: rows.filter((r) => statusKind(r.status) === 'open').length,
      rows,
    }
  })
  const openRows = profile.conformance.filter((r) => statusKind(r.status) !== 'met')

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <header className="pt-12 pb-12 sm:pt-16">
        <div className="label">Signer profile</div>
        <h1 className="mt-3 font-display text-[2.5rem] leading-[1.05] tracking-[-0.02em] text-ink sm:text-[3.5rem] max-w-[24ch]">
          What an air-gapped signer should have to show you.
        </h1>
        <Prose className="mt-6 text-[1.1875rem]">
          <p>
            Air-gapped signers agree by convention on things no BIP writes down. The profile writes
            them down as requirements, each naming the check that decides it, and the kit turns the
            testable ones into JSON vectors any signer can run through a small adapter, in any
            language, on any hardware.
          </p>
        </Prose>

        {/* THE DOCUMENT'S STATE, AT THE TOP, the way a standards body puts it
            on a draft. A reader should not have to reach the change log to
            learn that nobody has adopted this yet. */}
        <dl className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-[4px] border border-line bg-line font-sans text-[0.8125rem] lg:grid-cols-3">
          {[
            ['State', `Draft, version ${profile.header.version}`],
            ['Date', profile.header.date],
            ['Adopted by', 'No one yet, nullroute included'],
            [
              'Requirements',
              `${String(profile.requirementCount)} in ${String(profile.areas.length)} areas`,
            ],
            [
              'Vectors',
              `${String(profile.caseCount)} cases in ${String(profile.vectors.length)} files`,
            ],
            ['Discussion', 'Issues on GitHub, for now'],
          ].map(([k, v]) => (
            <div key={k} className="bg-surface px-3.5 py-2.5 min-w-0">
              <dt className="label">{k}</dt>
              <dd className="mt-1 leading-snug text-ink">{v}</dd>
            </div>
          ))}
        </dl>
        <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 font-sans text-[0.9375rem]">
          <li>
            <Link href="/profile/spec" className="link">
              Read the full text
            </Link>
          </li>
          <li>
            <Link href="/profile/kit" className="link">
              Run the kit against a signer
            </Link>
          </li>
          <li>
            <a
              href={`${REPO_URL}/issues`}
              className="link"
              target="_blank"
              rel="noopener noreferrer"
            >
              Argue with it
            </a>
          </li>
        </ul>
      </header>

      <Section
        n="1"
        kicker="Scope"
        title="Four questions a user cannot answer today."
        id="questions"
      >
        <dl className="grid gap-px overflow-hidden rounded-[4px] border border-line bg-line sm:grid-cols-2">
          {QUESTIONS.map(([q, a]) => (
            <div key={q} className="bg-surface px-5 py-4">
              <dt className="font-display text-[1.25rem] leading-snug text-ink">{q}</dt>
              <dd className="mt-2 text-[1rem] leading-relaxed text-body">{a}</dd>
            </div>
          ))}
        </dl>
        <Prose className="mt-8">
          <p>
            No requirement names a board, a panel or a vendor. Each one names its check: a vector
            file, a manual procedure, an invariant in nullroute, or UNTESTABLE with the reason. What
            the profile leaves out on purpose is in its{' '}
            <A href="/profile/spec#8-out-of-scope">out of scope</A> section.
          </p>
        </Prose>
      </Section>

      <Section
        n="2"
        kicker="The kit"
        title="Expected values from outside the implementation."
        id="kit"
      >
        <Prose>
          <p>
            Vectors catch a shared mistake only where the expected value came from somewhere other
            than the code under test. So none of these came from nullroute: review cases are PSBTs
            built and judged by Bitcoin Core on regtest, dice and manifests come from the BIP texts
            and coreutils, and the QR cases from Coinkite&rsquo;s reference BBQr code, a real
            Coldcard scan and SeedSigner&rsquo;s own UR encoder. Every file is pinned by a{' '}
            <C>SHA256SUMS</C> that coreutils can check.
          </p>
        </Prose>
        <Figure
          n="1"
          title="Conformance results, by vector file"
          className="mt-10"
          source={
            <>
              <C>conformance-report.json</C> from <C>make conformance</C> on this build, refused by
              the site if it was produced against a different <C>SHA256SUMS</C>. Where each
              file&rsquo;s values came from is Fig. 2.
            </>
          }
        >
          <ResultsTable profile={profile} />
        </Figure>

        <Figure
          n="2"
          title="Where each file's expected values came from"
          className="mt-12"
          source={
            <>
              the vector table in <A href="/profile/kit">the kit&rsquo;s README</A>, read when this
              site was built. The site refuses to build if a vector file has no row there.
            </>
          }
        >
          <SourcesList profile={profile} />
        </Figure>

        <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Figure
            n="3"
            title="The pins, as committed"
            source={
              <>
                <C>spec/vectors/signer-profile/SHA256SUMS</C>, whose own SHA-256 is{' '}
                <code className="font-hash text-[0.8rem] break-all">
                  {profile.sha256sumsDigest}
                </code>
              </>
            }
          >
            <div
              className="rounded-[4px] border border-line bg-sunk overflow-x-auto"
              tabIndex={0}
              role="region"
              aria-label="SHA256SUMS"
            >
              <pre className="transcript px-4 py-3.5 text-[0.75rem] min-w-max">
                {profile.sha256sums}
              </pre>
            </div>
          </Figure>
          <div className="min-w-0">
            <div className="label">Run it against your signer</div>
            <Prose className="mt-3">
              <p>
                The runner uses Node built-ins only and does every comparison itself. Your signer is
                reached through an adapter module that reports what it did; a signer in another
                language needs a thin bridge, for example a subprocess call.
              </p>
            </Prose>
            <Transcript
              className="mt-5"
              label="Running the conformance kit"
              lines={[
                { cmd: 'cd spec/vectors/signer-profile && sha256sum -c SHA256SUMS && cd -' },
                { cmd: 'node conformance/run.mjs path/to/your-adapter.mjs' },
              ]}
            />
            <Source>
              the kit&rsquo;s README, which lists the adapter interface and what each verdict means.
              A known failure that starts passing fails the run, so the list cannot outlive the fix.
            </Source>
          </div>
        </div>
      </Section>

      <Section
        n="3"
        kicker="Coverage"
        title="Where nullroute meets it, and where it does not yet."
        id="conformance"
      >
        <Prose>
          <p>
            The profile carries a conformance column for nullroute, written as one implementation
            among others rather than as the reference. Most requirements are met; the rest wait on
            hardware or on a manual procedure, and each says which.
          </p>
        </Prose>
        <div className="mt-8 table-scroll">
          <table className="w-full border-collapse font-sans text-[0.875rem] leading-snug">
            <thead>
              <tr className="bg-sunk text-left">
                <th scope="col" className="px-3.5 py-2.5 font-semibold text-ink">
                  Area
                </th>
                <th scope="col" className="px-3.5 py-2.5 font-semibold text-ink text-right">
                  Requirements
                </th>
                <th scope="col" className="px-3.5 py-2.5 font-semibold text-ink text-right">
                  Met
                </th>
                <th scope="col" className="px-3.5 py-2.5 font-semibold text-ink text-right">
                  Met with a caveat
                </th>
                <th scope="col" className="px-3.5 py-2.5 font-semibold text-ink text-right">
                  Open
                </th>
              </tr>
            </thead>
            <tbody>
              {byArea.map((area) => (
                <tr key={area.prefix} className="border-t border-line">
                  <td className="px-3.5 py-2.5">
                    <span className="text-ink">{area.title}</span>{' '}
                    <span className="font-mono text-[0.75rem] text-muted">{area.prefix}</span>
                  </td>
                  <td className="px-3.5 py-2.5 text-right font-mono tabular-nums text-ink">
                    {area.requirements.length}
                  </td>
                  <td className="px-3.5 py-2.5 text-right font-mono tabular-nums text-verify">
                    {area.met}
                  </td>
                  <td className="px-3.5 py-2.5 text-right font-mono tabular-nums text-signal">
                    {area.qualified}
                  </td>
                  <td className="px-3.5 py-2.5 text-right font-mono tabular-nums text-body">
                    {area.open}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Source>
          the nullroute conformance tables in <A href="/profile/spec">the profile</A>, counted when
          this site was built. &ldquo;Met with a caveat&rdquo; is any row whose status qualifies the
          word, such as met in tests and unverified on the panel.
        </Source>

        <div className="mt-10">
          <div className="label">Not yet met without qualification</div>
          <ul className="mt-3 border-t border-line">
            {openRows.map((row) => (
              <li
                key={row.id}
                className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-4 border-b border-line py-2.5 font-sans text-[0.875rem]"
              >
                <a
                  href={`/profile/spec#${row.id.toLowerCase()}`}
                  className="font-mono text-[0.8125rem] text-link hover:text-link-hover"
                >
                  {row.id}
                </a>
                <span className="text-body">{row.status}</span>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Section n="4" kicker="Disagree" title="Positions others may reject." id="positions">
        <Prose>
          <p>
            The profile takes positions that people who build signers and coordinators may
            reasonably dispute, and a profile nobody has argued with is not yet worth adopting.
            Among them:
          </p>
        </Prose>
        <ul className="mt-6 max-w-[40rem] space-y-3 text-[1rem] leading-relaxed">
          {[
            [
              '100 rolls, not 99.',
              'Three signers accept 99, which is 255.911 bits. The profile asks for 100, and the cost is that a 99-roll seed from those devices cannot be reproduced here.',
            ],
            [
              'A segwit v0 input without its previous transaction blocks signing.',
              'Its amount is the coordinator’s word, and BIP-174 describes the attack that exploits it. The block can be lifted for one signature, never stored.',
            ],
            [
              'Schnorr signatures with aux_rand fixed to zero.',
              'BIP-340 notes that fresh randomness there increases protection against fault injection. The profile gives that up so anyone holding the seed can recompute every signature byte for byte.',
            ],
            [
              'Change is only what the signer can re-derive.',
              'Anything the PSBT merely claims is shown as a payment, with the claim reported.',
            ],
          ].map(([k, v]) => (
            <li key={k} className="border-l-2 border-signal pl-4">
              <span className="font-sans font-semibold text-[0.9375rem] text-ink">{k}</span>{' '}
              <span className="text-body">{v}</span>
            </li>
          ))}
        </ul>
        <Prose className="mt-8">
          <p>
            If you build a signer or a coordinator, the most useful thing you can do is run the kit
            against it, or tell us which requirement is wrong.{' '}
            <A href={`${REPO_URL}/issues`} external>
              Open an issue
            </A>
            .
          </p>
        </Prose>
      </Section>
    </div>
  )
}
