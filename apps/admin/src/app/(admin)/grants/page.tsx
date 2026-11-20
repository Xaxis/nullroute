import type { Metadata } from 'next'
import Link from 'next/link'
import { GrantFields } from '@/components/GrantFields'
import { Badge, Button, Card, Empty, formatDate, PageHeader } from '@/components/ui'
import { money, statusTone } from '@/components/grant-format'
import { daysUntil, LABELS, listGrants } from '@/server/grants'
import { createGrantAction } from '../actions'

export const metadata: Metadata = { title: 'Grants' }

export default async function GrantsPage() {
  const grants = await listGrants()
  return (
    <>
      <PageHeader
        title="Grants"
        lead="Every application: where it stands, what is due, and the documents behind it."
      />
      <Card className="mb-6">
        {grants.length === 0 ? (
          <Empty>No grants yet. Add the first one below.</Empty>
        ) : (
          <div className="-m-5 overflow-x-auto">
            <table className="w-full text-left text-[0.875rem]">
              <thead className="border-b border-line text-[0.75rem] tracking-wide text-muted uppercase">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Application</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Window closes</th>
                  <th className="px-3 py-2.5 font-medium">Amount</th>
                  <th className="px-5 py-2.5 font-medium">Progress</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {grants.map((g) => {
                  const days = g.window_closes ? daysUntil(g.window_closes) : null
                  const open =
                    days !== null && days >= 0 && (g.status === 'idea' || g.status === 'drafting')
                  return (
                    <tr key={g.id} className="align-top">
                      <td className="px-5 py-3">
                        <Link
                          href={`/grants/${g.id}`}
                          className="font-medium text-ink hover:text-link"
                        >
                          {g.funder}: {g.program}
                        </Link>
                        <div className="mt-0.5 max-w-md text-[0.8125rem] text-muted">{g.title}</div>
                      </td>
                      <td className="px-3 py-3">
                        <Badge tone={statusTone(g.status)}>{LABELS[g.status]}</Badge>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {g.window_closes ? (
                          <>
                            <div className="text-ink">{formatDate(g.window_closes)}</div>
                            {open ? (
                              <div
                                className={
                                  days <= 14
                                    ? 'text-[0.8125rem] text-caution'
                                    : 'text-[0.8125rem] text-muted'
                                }
                              >
                                {days === 0 ? 'Today' : `${String(days)} days`}
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-muted">Not set</span>
                        )}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap text-ink">
                        {money(g.amount_usd) || <span className="text-muted">Not set</span>}
                      </td>
                      <td className="px-5 py-3 text-[0.8125rem] whitespace-nowrap text-muted">
                        <div>
                          Checklist {g.tasks_done}/{g.tasks_total}
                        </div>
                        <div>
                          References {g.references_received}/{Math.max(2, g.references_total)}
                        </div>
                        <div>
                          Milestones {g.milestones_done}/{g.milestones_total}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <details className="rounded-xl border border-line bg-surface">
        <summary className="cursor-pointer px-5 py-3.5 text-[0.9375rem] font-medium text-ink">
          New grant
        </summary>
        <form action={createGrantAction} className="border-t border-line p-5">
          <GrantFields />
          <div className="mt-5 flex justify-end">
            <Button type="submit" variant="primary">
              Create grant
            </Button>
          </div>
        </form>
      </details>
    </>
  )
}
