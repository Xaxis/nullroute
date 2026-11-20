import type { Metadata } from 'next'
import Link from 'next/link'
import { Badge, Card, Empty, formatDate, formatWhen, PageHeader, Stat } from '@/components/ui'
import { daysUntil, LABELS, listGrants } from '@/server/grants'
import { listMessages, messageCounts } from '@/server/messages'
import {
  cardArtifact,
  dnsChecks,
  latestCommit,
  latestRuns,
  manifestRoot,
  openWork,
  REPO,
  type Run,
  siteUp,
} from '@/server/project'

export const metadata: Metadata = { title: 'Overview' }

function runTone(r: Run) {
  if (r.status !== 'completed') return 'warn' as const
  return r.conclusion === 'success' ? ('good' as const) : ('bad' as const)
}

function runText(r: Run) {
  return r.status === 'completed' ? (r.conclusion ?? 'done') : r.status.replace('_', ' ')
}

function Failed({ reason }: { reason: string }) {
  return <p className="text-[0.875rem] text-muted">Not available: {reason}.</p>
}

const ACTIVE = new Set(['idea', 'drafting', 'submitted', 'under_review', 'awarded'])

export default async function Overview() {
  const [commit, runs, artifact, work, root, site, dns, grants, counts, recent] = await Promise.all(
    [
      latestCommit(),
      latestRuns(),
      cardArtifact(),
      openWork(),
      manifestRoot(),
      siteUp(),
      dnsChecks(),
      listGrants(),
      messageCounts(),
      listMessages('inbox'),
    ]
  )
  const active = grants.filter((g) => ACTIVE.has(g.status))
  const next = active
    .filter(
      (g) =>
        g.window_closes &&
        daysUntil(g.window_closes) >= 0 &&
        ['idea', 'drafting'].includes(g.status)
    )
    .sort((a, b) => (a.window_closes ?? '').localeCompare(b.window_closes ?? ''))[0]
  const ci = runs.ok ? runs.value.find((r) => r.name === 'ci') : undefined
  const dnsMissing = dns.filter((d) => !d.ok)

  return (
    <>
      <PageHeader
        title="Overview"
        lead="The project, the grants and the inbox, read live from the repository, the site and the database."
      />

      <div className="mb-6 grid grid-cols-2 gap-5 rounded-xl border border-line bg-surface p-5 md:grid-cols-4">
        <Stat
          label="Next window closes"
          value={next?.window_closes ? `${String(daysUntil(next.window_closes))} days` : 'None'}
          sub={next ? `${next.funder}, ${formatDate(next.window_closes)}` : 'No open application'}
        />
        <Stat
          label="New messages"
          value={counts.new}
          sub={`${String(counts.inbox)} in the inbox`}
        />
        <Stat
          label="CI on main"
          value={ci ? runText(ci) : runs.ok ? 'No run' : 'Unknown'}
          sub={ci ? ci.sha.slice(0, 7) : undefined}
        />
        <Stat
          label="Manifest root"
          value={root.ok ? <span className="font-hash">{root.value.slice(0, 8)}</span> : 'Unknown'}
          sub="sha256 of MANIFEST.lock on main"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="Repository"
          aside={
            <a className="text-link hover:text-link-hover" href={`https://github.com/${REPO}`}>
              {REPO}
            </a>
          }
        >
          {commit.ok ? (
            <div className="mb-4">
              <a href={commit.value.url} className="font-medium text-ink hover:text-link">
                {commit.value.message}
              </a>
              <div className="mt-0.5 text-[0.8125rem] text-muted">
                <span className="font-hash">{commit.value.sha.slice(0, 7)}</span> on main,{' '}
                {formatWhen(commit.value.date)}
              </div>
            </div>
          ) : (
            <Failed reason={commit.reason} />
          )}
          {runs.ok ? (
            <ul className="space-y-1.5">
              {runs.value
                .filter((r) => ['ci', 'card', 'docs', 'release'].includes(r.name))
                .map((r) => (
                  <li
                    key={r.name}
                    className="flex items-center justify-between gap-3 text-[0.875rem]"
                  >
                    <a href={r.url} className="text-body hover:text-ink">
                      {r.name}
                    </a>
                    <span className="flex items-center gap-2">
                      <span className="font-hash text-[0.8125rem] text-muted">
                        {r.sha.slice(0, 7)}
                      </span>
                      <Badge tone={runTone(r)}>{runText(r)}</Badge>
                    </span>
                  </li>
                ))}
            </ul>
          ) : (
            <Failed reason={runs.reason} />
          )}
          <div className="mt-4 grid grid-cols-2 gap-4 border-t border-line pt-4 text-[0.875rem]">
            <div>
              <div className="text-muted">Open pull requests and issues</div>
              <div className="text-ink">
                {work.ok
                  ? `${String(work.value.pulls)} and ${String(work.value.issues)}`
                  : 'Unknown'}
              </div>
            </div>
            <div>
              <div className="text-muted">Bring-up card</div>
              <div className="text-ink">
                {artifact.ok
                  ? artifact.value
                    ? artifact.value.expired
                      ? 'Expired'
                      : `Expires ${formatDate(artifact.value.expires)}`
                    : 'None'
                  : 'Unknown'}
              </div>
            </div>
          </div>
        </Card>

        <Card
          title="Grants"
          aside={
            <Link className="text-link hover:text-link-hover" href="/grants">
              All grants
            </Link>
          }
        >
          {active.length === 0 ? (
            <Empty>No active grant. Add one under Grants.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {active.map((g) => (
                <li key={g.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/grants/${g.id}`} className="font-medium text-ink hover:text-link">
                      {g.funder}: {g.program}
                    </Link>
                    <Badge tone={g.status === 'awarded' ? 'good' : 'accent'}>
                      {LABELS[g.status]}
                    </Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[0.8125rem] text-muted">
                    {g.window_closes ? (
                      <span>Window closes {formatDate(g.window_closes)}</span>
                    ) : null}
                    <span>
                      Checklist {g.tasks_done}/{g.tasks_total}
                    </span>
                    <span>
                      References {g.references_received}/{Math.max(2, g.references_total)}
                    </span>
                    <span>
                      Milestones {g.milestones_done}/{g.milestones_total}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Messages"
          aside={
            <Link className="text-link hover:text-link-hover" href="/messages">
              Inbox
            </Link>
          }
        >
          {recent.length === 0 ? (
            <Empty>No messages yet. The contact form on nullroute.diy delivers here.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {recent.slice(0, 5).map((m) => (
                <li
                  key={m.id}
                  className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  <Link href={`/messages#${m.id}`} className="min-w-0">
                    <div className="truncate text-[0.875rem] font-medium text-ink">{m.name}</div>
                    <div className="truncate text-[0.8125rem] text-muted">{m.body}</div>
                  </Link>
                  {m.status === 'new' ? <Badge tone="warn">New</Badge> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Site, mail and domains"
          aside={
            site.ok ? (
              <Badge tone={site.value === 200 ? 'good' : 'bad'}>nullroute.diy {site.value}</Badge>
            ) : (
              <Badge tone="bad">site unreachable</Badge>
            )
          }
        >
          <ul className="space-y-1.5">
            {dns.map((d) => (
              <li key={d.label} className="flex items-center justify-between gap-3 text-[0.875rem]">
                <span className="text-body">{d.label}</span>
                <Badge tone={d.ok ? 'good' : 'bad'}>{d.ok ? 'In place' : 'Missing'}</Badge>
              </li>
            ))}
          </ul>
          {dnsMissing.length > 0 ? (
            <div className="mt-4 border-t border-line pt-4">
              <p className="mb-3 text-[0.8125rem] text-muted">
                Add the missing records in Namecheap (Advanced DNS) for nullroute.diy. Mail from
                signin@ and contact@nullroute.diy fails until the Resend records are in place, and
                admin.nullroute.diy needs its CNAME.
              </p>
              <ul className="space-y-3">
                {dnsMissing.map((d) => (
                  <li key={d.label} className="text-[0.8125rem]">
                    <div className="flex flex-wrap items-baseline gap-x-2 text-muted">
                      <span className="font-medium text-ink">{d.type}</span>
                      <span>host</span>
                      <span className="font-mono text-ink">{d.host}</span>
                    </div>
                    <div className="mt-1 rounded-md border border-line bg-sunk px-2.5 py-1.5 font-mono break-all text-ink select-all">
                      {d.value}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      </div>
    </>
  )
}
