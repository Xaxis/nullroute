import type { Metadata } from 'next'
import Link from 'next/link'
import { readProfile, statusKind } from '../../lib/profile'
import { docHref, requirementHrefs } from '../../lib/docbook'
import { OG_IMAGE, REPO_URL } from '../../lib/site'
import { ResultsTable, requirementHref } from '../../components/ResultsTable'

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

function Head({ eyebrow, title, children }: { eyebrow: string; title: string; children?: string }) {
  return (
    <div className="max-w-2xl">
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="mt-2 font-display text-[1.75rem] leading-[1.15] tracking-[-0.015em] text-ink sm:text-[2.125rem]">
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
    <div className="mx-auto max-w-7xl px-4 sm:px-6">
      <header className="pt-14 pb-16 sm:pt-20">
        <p className="eyebrow">Signer profile</p>
        <h1 className="mt-3 max-w-[22ch] font-display text-[2.5rem] leading-[1.05] tracking-[-0.02em] text-ink sm:text-[3.5rem]">
          What an air-gapped signer should have to show you.
        </h1>
        <p className="mt-6 max-w-2xl text-[1.125rem] leading-relaxed text-body">
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
            className="px-2 py-3 text-[0.9375rem] font-semibold text-body hover:text-ink transition-colors"
          >
            Argue with it <span aria-hidden="true">&#8599;</span>
          </a>
        </div>

        {/* THE DOCUMENT'S STATE, AT THE TOP, the way a standards body puts it
            on a draft. A reader should not have to reach the change log to
            learn that nobody has adopted this yet. */}
        <dl className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ['State', `Draft ${profile.header.version}`],
            ['Date', profile.header.date],
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
            <div key={k} className="card min-w-0 px-4 py-3">
              <dt className="text-[0.75rem] text-muted">{k}</dt>
              <dd className="mt-1 text-[0.9375rem] font-semibold leading-snug text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      </header>

      <section className="border-t border-line py-16">
        <Head eyebrow="Scope" title="Four questions a user cannot answer today." />
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {QUESTIONS.map(([q, a]) => (
            <li key={q} className="card px-6 py-5">
              <span className="block font-semibold text-ink">{q}</span>
              <span className="mt-2 block text-[0.9375rem] leading-relaxed text-body">{a}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="border-t border-line py-16" id="results">
        <Head eyebrow="The kit" title="Expected values from outside the implementation.">
          None of these came from nullroute: review cases are PSBTs built and judged by Bitcoin
          Core, dice and manifests come from the BIP texts and coreutils, and the QR cases from
          reference encoders. Every file is pinned by a SHA256SUMS that coreutils can check.
        </Head>
        <div className="mt-8">
          <ResultsTable profile={profile} hrefs={hrefs} />
        </div>
        <p className="mt-3 text-[0.8125rem] leading-snug text-muted">
          From this build&rsquo;s <code className="code">make conformance</code>. The second column
          is for your signer, and it stays empty until somebody runs the kit against one.
        </p>
      </section>

      <section className="border-t border-line py-16" id="conformance">
        <Head eyebrow="Coverage" title="Where nullroute meets it, and where it does not yet.">
          nullroute is held to the profile as one implementation among others, not as its reference.
          Most requirements are met; the rest wait on hardware or a manual procedure.
        </Head>
        <div className="mt-8 table-scroll card overflow-hidden">
          <table className="w-full border-collapse text-[0.875rem] leading-snug">
            <thead>
              <tr className="bg-sunk text-left">
                <th scope="col" className="px-4 py-3 font-semibold text-ink">
                  Area
                </th>
                <th scope="col" className="px-4 py-3 font-semibold text-ink text-right">
                  Requirements
                </th>
                <th scope="col" className="px-4 py-3 font-semibold text-ink text-right">
                  Met
                </th>
                <th scope="col" className="px-4 py-3 font-semibold text-ink text-right">
                  With a caveat
                </th>
                <th scope="col" className="px-4 py-3 font-semibold text-ink text-right">
                  Open
                </th>
              </tr>
            </thead>
            <tbody>
              {byArea.map((area) => (
                <tr key={area.prefix} className="border-t border-line">
                  <td className="px-4 py-3">
                    <span className="text-ink">{area.title}</span>{' '}
                    <span className="font-mono text-[0.75rem] text-muted">{area.prefix}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-ink">
                    {area.requirements.length}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-verify">
                    {area.met}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-signal">
                    {area.qualified}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-body">
                    {area.open}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="label mt-10">Not yet met without qualification</h3>
        <ul className="mt-3 grid gap-2 lg:grid-cols-2">
          {openRows.map((row) => (
            <li key={row.id} className="card grid grid-cols-[6rem_minmax(0,1fr)] gap-3 px-4 py-3">
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
        <Head eyebrow="Disagree" title="Positions others may reject.">
          A profile nobody has argued with is not yet worth adopting. These are the positions people
          who build signers and coordinators may reasonably dispute.
        </Head>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {POSITIONS.map(([k, v]) => (
            <li key={k} className="card px-6 py-5">
              <span className="block font-semibold text-ink">{k}</span>
              <span className="mt-2 block text-[0.9375rem] leading-relaxed text-body">{v}</span>
            </li>
          ))}
        </ul>
        <p className="mt-8 max-w-2xl text-body">
          If you build a signer or a coordinator, the most useful thing you can do is run the kit
          against it, or tell us which requirement is wrong.{' '}
          <a href={`${REPO_URL}/issues`} target="_blank" rel="noopener noreferrer" className="link">
            Open an issue
          </a>
          .
        </p>
      </section>
    </div>
  )
}
