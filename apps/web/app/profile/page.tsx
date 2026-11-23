import { AreaDeck } from '../../components/stage/AreaDeck'
import { PageStage } from '../../components/stage/PageStage'
import type { Metadata } from 'next'
import Link from 'next/link'
import {
  changedTheProfile,
  countWord,
  readProfile,
  statusKind,
  type Finding,
} from '../../lib/profile'
import { docHref, requirementHrefs } from '../../lib/docbook'
import { OG_IMAGE, REPO_URL } from '../../lib/site'
import { ResultsTable, requirementHref } from '../../components/ResultsTable'
import { Ruled } from '../../components/report'

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
 * second implementation exists. The full text and the kit's own documents
 * are chapters of the docs; this page is the case for them.
 */

/** A README table cell: plain text with `code` spans and nothing else. */
function inline(text: string) {
  return text.split('`').map((part, i) =>
    i % 2 === 1 ? (
      <code key={i} className="code">
        {part}
      </code>
    ) : (
      part
    )
  )
}

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
    'Capabilities rather than models: a display only the signer drives, a way in that is not a network, and radios absent or with their drivers and firmware removed.',
  ],
]

const POSITIONS: readonly (readonly [string, string])[] = [
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
]

/** The sentence saying how many of one signer's findings changed the profile. */
function changedBy(findings: readonly Finding[]): string {
  const n = changedTheProfile(findings)
  if (n === 0) return ''
  const word = countWord(n)
  return ` ${word.charAt(0).toUpperCase()}${word.slice(1)} ${n === 1 ? 'has' : 'have'} already changed it or its vectors.`
}

function Head({ title, children }: { title: string; children?: string }) {
  return (
    <div className="max-w-2xl">
      <h2 className="font-display text-[1.75rem] leading-[1.15] tracking-[-0.015em] text-ink sm:text-[2.125rem]">
        {title}
      </h2>
      {children === undefined ? null : (
        <p className="mt-3 text-[1.0625rem] leading-relaxed text-body">{children}</p>
      )}
    </div>
  )
}

export default async function ProfilePage() {
  const profile = readProfile()
  const hrefs = await requirementHrefs()
  const fullText = await docHref('spec/signer-profile.md')
  const kit = await docHref('conformance/README.md')
  const byArea = profile.areas.map((area) => {
    const rows = profile.conformance.filter((row) => row.id.startsWith(`${area.prefix}-`))
    return {
      ...area,
      met: rows.filter((r) => statusKind(r.status) === 'met').length,
      qualified: rows.filter((r) => statusKind(r.status) === 'qualified').length,
      open: rows.filter((r) => statusKind(r.status) === 'open').length,
    }
  })
  const openRows = profile.conformance.filter((r) => statusKind(r.status) !== 'met')

  return (
    <>
      <PageStage title="The signer profile" scene={<AreaDeck areas={profile.areas} />}>
        <p className="mt-6 max-w-2xl text-[1.125rem] leading-relaxed text-body">
          What an air-gapped signer should have to show you, and what it should refuse to do.
          Air-gapped signers agree by convention on things no BIP writes down. The profile writes
          them down as requirements, each naming the check that decides it, and the conformance kit
          turns the testable ones into JSON vectors any signer can run.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href={fullText} className="btn btn-primary">
            Read the profile
          </Link>
          <Link href={kit} className="btn btn-secondary">
            Run the kit
          </Link>
          <a
            href={`${REPO_URL}/issues`}
            target="_blank"
            rel="noopener noreferrer"
            className="py-3 sm:px-2 text-[0.9375rem] font-semibold text-body hover:text-ink transition-colors"
          >
            Argue with it <span aria-hidden="true">&#8599;</span>
          </a>
        </div>
      </PageStage>
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="pb-16">
          {/* THE DOCUMENT'S STATE, AT THE TOP, the way a standards body puts it
            on a draft. A reader should not have to reach the change log to
            learn that nobody has adopted this yet. */}
          <dl className="mt-12 reveal-rows grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ['State', `Draft ${profile.header.version}`],
              ['Last changed', profile.header.changed],
              [
                'Requirements',
                `${String(profile.requirementCount)} in ${String(profile.areas.length)} areas`,
              ],
              [
                'Test cases',
                `${String(profile.caseCount)} in ${String(profile.vectors.length)} files`,
              ],
              ['Adopted by', 'No one yet'],
              ['Discussion', 'GitHub issues'],
            ].map(([k, v]) => (
              <div key={k} className="min-w-0 border-t border-ink pt-3">
                <dt className="font-mono text-[0.75rem] uppercase tracking-[0.08em] text-muted">
                  {k}
                </dt>
                <dd className="mt-1 text-[0.9375rem] font-semibold leading-snug text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <section className="border-t border-line py-16">
          <Head title="Four questions a user cannot answer today" />
          <Ruled items={QUESTIONS} className="mt-8" />
        </section>

        <section className="border-t border-line py-16" id="results">
          <Head title="Expected values from outside the implementation">
            None of these came from nullroute: review cases are PSBTs built and judged by Bitcoin
            Core, signatures are computed by Core&rsquo;s own test framework and wallet, dice and
            manifests come from the BIP texts and coreutils, and the QR cases from reference
            encoders. Every file is pinned by a SHA256SUMS that coreutils can check.
          </Head>
          <div className="mt-8">
            <ResultsTable profile={profile} hrefs={hrefs} />
          </div>
          <p className="mt-3 max-w-4xl text-[0.8125rem] leading-snug text-muted">
            nullroute from this build&rsquo;s <code className="code">make conformance</code>.{' '}
            {profile.others.map((o) => (
              <span key={o.label}>
                {o.label} from{' '}
                <code className="code">make conformance-{o.label.toLowerCase()}</code>: {o.name},
                its own code, with every known failure listed beside the line of its code that
                decides it.{' '}
              </span>
            ))}
            A column for your signer is one adapter away.
          </p>
        </section>

        {profile.others.map((o) => (
          <section key={o.label} className="border-t border-line py-16" id={o.label.toLowerCase()}>
            <Head title={`What running ${o.label} found`}>
              {`${o.name}, run against the same vectors. Some findings are gaps in ${o.label}, and some are questions the profile has to answer, which is what a draft is for.${changedBy(profile.findings.get(o.label) ?? [])}`}
            </Head>
            <dl className="mt-8 max-w-4xl border-t border-line">
              {(profile.findings.get(o.label) ?? []).map((f) => (
                <div
                  key={f.finding}
                  className="grid gap-1.5 border-b border-line py-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:gap-8"
                >
                  <dt className="min-w-0">
                    <span className="block text-[0.9375rem] font-semibold leading-snug text-ink">
                      {inline(f.finding)}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-x-2">
                      {f.requirement.split(', ').map((id) => (
                        <a
                          key={id}
                          href={requirementHref(hrefs, id)}
                          className="font-mono text-[0.72rem] text-link hover:text-link-hover"
                        >
                          {id}
                        </a>
                      ))}
                    </span>
                  </dt>
                  <dd className="min-w-0 text-[0.9375rem] leading-relaxed text-body">
                    {inline(f.question)}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 max-w-4xl text-[0.8125rem] leading-snug text-muted">
              Each case, with the line of {o.label}&rsquo;s code that decides it, is in{' '}
              <a
                href={`${REPO_URL}/blob/main/conformance/known-failures/${o.label.toLowerCase()}.json`}
                className="text-link hover:text-link-hover"
              >
                <code className="code">known-failures/{o.label.toLowerCase()}.json</code>
              </a>
              .
            </p>
          </section>
        ))}

        <section className="border-t border-line py-16" id="conformance">
          <Head title="Where nullroute meets it, and where it does not yet">
            nullroute is held to the profile as one implementation among others, not as its
            reference. Most requirements are met; the rest wait on hardware or a manual procedure.
          </Head>
          <div className="mt-8 max-w-4xl table-scroll card overflow-hidden">
            <table className="w-full border-collapse text-[0.875rem] leading-snug max-sm:text-[0.8125rem]">
              <thead>
                <tr className="bg-sunk text-left">
                  <th scope="col" className="px-4 py-3 max-sm:px-2 font-semibold text-ink">
                    Area
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 max-sm:px-2 font-semibold text-ink text-right"
                  >
                    <span className="sm:hidden">Total</span>
                    <span className="max-sm:hidden">Requirements</span>
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 max-sm:px-2 font-semibold text-ink text-right"
                  >
                    Met
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 max-sm:px-2 font-semibold text-ink text-right"
                  >
                    <span className="sm:hidden">Caveat</span>
                    <span className="max-sm:hidden">With a caveat</span>
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-3 max-sm:px-2 font-semibold text-ink text-right"
                  >
                    Open
                  </th>
                </tr>
              </thead>
              <tbody>
                {byArea.map((area) => (
                  <tr key={area.prefix} className="border-t border-line">
                    <td className="px-4 py-3 max-sm:px-2">
                      <span className="text-ink">{area.title}</span>{' '}
                      <span className="font-mono text-[0.75rem] text-muted max-sm:block">
                        {area.prefix}
                      </span>
                    </td>
                    <td className="px-4 py-3 max-sm:px-2 text-right font-mono tabular-nums text-ink">
                      {area.requirements.length}
                    </td>
                    {/* Colour only a count that has something in it: a green or
                        amber zero reads as a result. */}
                    <td
                      className={`px-4 py-3 max-sm:px-2 text-right font-mono tabular-nums ${area.met === 0 ? 'text-muted' : 'text-verify'}`}
                    >
                      {area.met}
                    </td>
                    <td
                      className={`px-4 py-3 max-sm:px-2 text-right font-mono tabular-nums ${area.qualified === 0 ? 'text-muted' : 'text-signal'}`}
                    >
                      {area.qualified}
                    </td>
                    <td className="px-4 py-3 max-sm:px-2 text-right font-mono tabular-nums text-body">
                      {area.open}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="mt-12 font-display text-[1.375rem] leading-snug text-ink">
            {openRows.length} requirements this device does not yet fully meet
          </h3>
          <ul className="mt-4 max-w-4xl border-t border-line">
            {openRows.map((row) => (
              <li
                key={row.id}
                className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-4 border-b border-line py-2.5 last:border-b-0"
              >
                <a
                  href={requirementHref(hrefs, row.id)}
                  className="font-mono text-[0.8125rem] text-link hover:text-link-hover"
                >
                  {row.id}
                </a>
                <span className="text-[0.875rem] leading-snug text-body">{row.status}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="border-t border-line py-16" id="positions">
          <Head title="Positions others may reject">
            A profile nobody has argued with is not yet worth adopting. These are the positions
            people who build signers and coordinators may reasonably dispute.
          </Head>
          <Ruled items={POSITIONS} className="mt-8" />
          <p className="mt-8 max-w-2xl text-body">
            If you build a signer or a coordinator, the most useful thing you can do is run the kit
            against it, or tell us which requirement is wrong.{' '}
            <a
              href={`${REPO_URL}/issues`}
              target="_blank"
              rel="noopener noreferrer"
              className="link"
            >
              Open an issue
            </a>
            .
          </p>
        </section>
      </div>
    </>
  )
}
