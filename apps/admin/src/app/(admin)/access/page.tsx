import type { Metadata } from 'next'
import { Badge, Button, Card, formatWhen, PageHeader } from '@/components/ui'
import { pg } from '@/server/db'
import { env } from '@/server/env'
import { listSessions } from '@/server/auth/sessions'
import { requireViewer } from '@/server/auth/viewer'
import { endSessionAction } from '../actions'

export const metadata: Metadata = { title: 'Access' }

interface AuditRow {
  id: number
  at: Date
  actor: string | null
  action: string
  detail: Record<string, unknown> | null
}

function describe(detail: Record<string, unknown> | null): string {
  if (!detail) return ''
  return Object.entries(detail)
    .map(([k, v]) => `${k} ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(', ')
}

export default async function AccessPage() {
  const viewer = await requireViewer()
  const [sessions, log] = await Promise.all([
    listSessions(),
    pg()<AuditRow[]>`select * from nullroute.audit_log order by at desc limit 100`,
  ])
  return (
    <>
      <PageHeader
        title="Access"
        lead="Who may sign in, the browsers signed in now, and every change and sign-in attempt."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card title="Who may sign in" aside="OWNER_EMAILS on Vercel">
          <ul className="space-y-1.5 text-[0.9375rem]">
            {env().OWNER_EMAILS.map((e) => (
              <li key={e} className="text-ink">
                {e}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[0.8125rem] text-muted">
            Anyone else who asks gets the same answer and no email. Removing an address ends its
            sessions at their next request.
          </p>
        </Card>
        <Card title="Signed in" aside={String(sessions.length)}>
          <ul className="divide-y divide-line">
            {sessions.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 text-[0.875rem]">
                  <div className="flex items-center gap-2 text-ink">
                    {s.userAgent ?? 'Unknown browser'}
                    {s.id === viewer.session.id ? <Badge tone="good">This browser</Badge> : null}
                  </div>
                  <div className="text-[0.8125rem] text-muted">
                    {s.ipPrefix}, since {formatWhen(s.createdAt)}, seen {formatWhen(s.seenAt)}
                  </div>
                </div>
                <form action={endSessionAction}>
                  <input type="hidden" name="id" value={s.id} />
                  <Button type="submit" variant="secondary" className="h-8 px-3 text-[0.8125rem]">
                    Sign out
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Card title="Audit log" aside="Latest 100" className="mt-6">
        <div className="-m-5 overflow-x-auto">
          <table className="w-full text-left text-[0.8125rem]">
            <thead className="border-b border-line text-[0.75rem] tracking-wide text-muted uppercase">
              <tr>
                <th className="px-5 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Who</th>
                <th className="px-3 py-2 font-medium">What</th>
                <th className="px-5 py-2 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {log.map((row) => (
                <tr key={row.id} className="align-top">
                  <td className="px-5 py-2 whitespace-nowrap text-muted">{formatWhen(row.at)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-body">{row.actor ?? 'anyone'}</td>
                  <td className="px-3 py-2 font-mono whitespace-nowrap text-ink">{row.action}</td>
                  <td className="px-5 py-2 break-all text-muted">{describe(row.detail)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}
