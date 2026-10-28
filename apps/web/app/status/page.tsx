import type { Metadata } from 'next'
import Link from 'next/link'
import { readLog, readPhases } from '../../lib/status'
import { readProfile, statusKind } from '../../lib/profile'
import { OG_IMAGE, REPO_URL } from '../../lib/site'
import { PhaseTable } from '../../components/PhaseTable'
import { A, Figure, InlineMd, Prose, Section, Source } from '../../components/report'

/** The log entries shown here. The file has all of them, a link away. */
const RECENT = 12

export const metadata: Metadata = {
  title: 'Status and roadmap',
  description:
    'Where nullroute stands: phases 1 to 4 of 7 built, hardware bring-up on a Pi 5 and a Pi 4 next, then an outside review and a first signed release. What each milestone proves, and what the device does not protect against.',
  openGraph: { title: 'Status and roadmap | nullroute', images: [OG_IMAGE] },
}

/**
 * The plan, as status.
 *
 * A LINE MOVES ONLY WHEN THE THING IT DESCRIBES HAS HAPPENED. The phases are
 * the README's own table, and the milestones say what each one proves and
 * what changes when it lands, so a reader can hold the project to them. There
 * are no dates: a date nobody is accountable to is a guess dressed as a plan.
 */

const NEXT: readonly { title: string; proves: string; changes: string }[] = [
  {
    title: 'Hardware bring-up on a Pi 5 and a Pi 4',
    proves:
      'The firmware path from power-on to the kernel, the panel and its touch controller, the webcam streaming to the kiosk, the layout on the real panel, and the Argon2id cost on the board. Each is recorded with evidence rather than a claim.',
    changes:
      'The profile rows that say "unverified until bring-up" or "unverified on the panel" move, one at a time, as their evidence is committed. Photographs of the real device replace the panel renders.',
  },
  {
    title: 'An outside review of the code that holds keys',
    proves:
      'That somebody other than the author has read the entropy, derivation, review and signing paths and the specs they are held to. The spec system proves the code matches its specs; only a reviewer can say the specs are right.',
    changes:
      'The word "unaudited" comes off this site when the review and its fixes are published.',
  },
  {
    title: 'A first tagged release',
    proves:
      'That a card image can be published with its SHA256SUMS, a signature and a manifest root, so a lock screen has a published number to be compared against. The build already pins its Debian packages to one archive snapshot, so a later build of the same tag sees the same inputs.',
    changes: 'The lock screen stops being comparable only against your own build.',
  },
  {
    title: 'The signer profile through public review',
    proves:
      'Whether people who build signers and coordinators accept the positions the profile takes, and whether a second implementation can meet it as written.',
    changes: 'The profile leaves version 0.1 with a record of each decision and who argued it.',
  },
]

const NOT_COVERED: readonly (readonly [string, string])[] = [
  [
    'No secure element',
    'Someone holding the SD card is limited by your passphrase and Argon2id at 64 MiB and three passes, and nothing else. Use it as one key in a multisig quorum with devices from other makers, never as sole custody.',
  ],
  [
    'The boot partition is not covered',
    'dm-verity detects modification of the system partition and does not prevent it. An attacker who rewrites the boot partition supplies their own root hash. A signed boot chain closes that in phase 7, last on purpose, because it burns one-time fuses.',
  ],
  [
    'The browser is the weakest part',
    'The screens run in a Chromium kiosk, so trust is kept out of them: the daemon holds the keys, and the screens see only public data and transactions.',
  ],
  [
    'Side channels and physical attack',
    'Power, electromagnetic and timing attacks against the Pi, and sophisticated attacks on the card or the chip, are out of scope and stated so.',
  ],
  [
    'A person who knows the code',
    'Hidden profiles and a wipe PIN are planned for phase 7. When they exist they buy time against somebody unsophisticated and nothing more, because this codebase is public.',
  ],
]

export default function StatusPage() {
  const phases = readPhases()
  const log = readLog()
  const profile = readProfile()
  const open = profile.conformance.filter((r) => statusKind(r.status) !== 'met').length

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6">
      <header className="pt-14 pb-14 sm:pt-20">
        <p className="eyebrow">Roadmap</p>
        <h1 className="mt-3 font-display text-[2.5rem] leading-[1.05] tracking-[-0.02em] text-ink sm:text-[3.5rem] max-w-[24ch]">
          Built in phases, and held to them.
        </h1>
        <Prose className="mt-6 text-[1.125rem]">
          <p>
            The signer is phases 1 to 4. The wallet layer, phase 5, is a lower assurance tier, and
            the companion, phase 6, runs on a networked machine and never on the device. Neither
            starts until the signer has run on the board and been reviewed. Keep real money off it
            until then.
          </p>
        </Prose>
      </header>

      <Section kicker="Phases" title="What is built." id="phases">
        <Figure
          n="1"
          title="Phases, as the README states them"
          source={
            <>
              the status table in{' '}
              <A href={`${REPO_URL}#status`} external>
                README.md
              </A>
              , read when this site was built. The state column is quoted, not summarised.
            </>
          }
        >
          <PhaseTable phases={phases} />
        </Figure>
        <Prose className="mt-8">
          <p>
            The order is the point. The tier boundary in the threat model and the phase order are
            what keep a large feature set from eroding the assurance of the small part that holds
            keys. The wallet layer is specified so that it can propose a transaction and never sign
            one, and so that removing it leaves a working signer with no other change. The direction
            of that dependency is already a lint rule with its own tests, before a line of the
            wallet exists.
          </p>
        </Prose>
      </Section>

      <Section kicker="Next" title="What comes next, and what each step proves." id="next">
        <ol className="space-y-px overflow-hidden rounded-[4px] border border-line bg-line">
          {NEXT.map((step, i) => (
            <li
              key={step.title}
              className="grid gap-4 bg-surface px-5 py-5 md:grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,1fr)] md:gap-6"
            >
              <span className="font-mono text-sm text-signal tabular-nums">{String(i + 1)}</span>
              <div className="min-w-0">
                <h3 className="font-display text-[1.25rem] leading-snug text-ink">{step.title}</h3>
                <p className="mt-2 text-[1rem] leading-relaxed text-body">{step.proves}</p>
              </div>
              <div className="min-w-0">
                <div className="label">When it lands</div>
                <p className="mt-1.5 font-sans text-[0.9375rem] leading-relaxed text-body">
                  {step.changes}
                </p>
              </div>
            </li>
          ))}
        </ol>
        <Prose className="mt-8">
          <p>
            {open} of the profile&rsquo;s {profile.conformance.length} conformance rows for this
            device are not yet met without qualification, most of them waiting on the board.{' '}
            <Link href="/profile#conformance" className="link">
              Which ones, and why
            </Link>
            .
          </p>
        </Prose>
      </Section>

      <Section kicker="Log" title="What has landed, and when." id="log">
        <ol className="border-t border-line">
          {log.slice(0, RECENT).map((entry, i) => (
            <li
              key={`${entry.date}-${String(i)}`}
              className="grid gap-1 border-b border-line py-3.5 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-6"
            >
              <span className="font-mono text-[0.8125rem] text-muted tabular-nums pt-0.5">
                {entry.date}
              </span>
              <span className="text-[1rem] leading-relaxed text-body">
                <InlineMd text={entry.text} />
              </span>
            </li>
          ))}
        </ol>
        <Source>
          <A href={`${REPO_URL}/blob/main/CHANGELOG.md`} external>
            CHANGELOG.md
          </A>
          , read when this site was built, has the {String(log.length)} entries in full; these are
          the latest {String(RECENT)}. The whole history is the repository&rsquo;s commit log.
        </Source>
      </Section>

      <Section kicker="Limits" title="What it does not protect against." id="limits">
        <dl className="border-t border-line">
          {NOT_COVERED.map(([term, text]) => (
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
            The full list is in the <A href="/docs/threat-model">threat model</A>, and it is long on
            purpose. If a limit there is understated, that is worth reporting: overclaiming in the
            threat model is itself a security bug here.
          </p>
        </Prose>
      </Section>
    </div>
  )
}
