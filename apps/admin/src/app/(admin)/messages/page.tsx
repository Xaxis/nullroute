import type { Metadata } from 'next'
import Link from 'next/link'
import { Badge, Button, Card, Empty, formatWhen, PageHeader } from '@/components/ui'
import { topicLabel } from '@/server/contact'
import { listMessages, messageCounts } from '@/server/messages'
import { deleteMessageAction, setMessageStatusAction } from '../actions'

export const metadata: Metadata = { title: 'Messages' }

function StatusButton({ id, status, label }: { id: string; status: string; label: string }) {
  return (
    <form action={setMessageStatusAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <Button type="submit" variant="secondary" className="h-8 px-3 text-[0.8125rem]">
        {label}
      </Button>
    </form>
  )
}

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  const view = (await searchParams).view === 'archived' ? 'archived' : 'inbox'
  const [messages, counts] = await Promise.all([listMessages(view), messageCounts()])
  return (
    <>
      <PageHeader
        title="Messages"
        lead="From the contact form on nullroute.diy. Each is stored here first, then emailed to you."
        actions={
          <div className="flex rounded-lg border border-border p-0.5 text-[0.8125rem]">
            <Link
              href="/messages"
              aria-current={view === 'inbox' ? 'page' : undefined}
              className={
                view === 'inbox'
                  ? 'rounded-md bg-sunk px-3 py-1 font-medium text-ink'
                  : 'px-3 py-1 text-muted hover:text-ink'
              }
            >
              Inbox {counts.inbox}
            </Link>
            <Link
              href="/messages?view=archived"
              aria-current={view === 'archived' ? 'page' : undefined}
              className={
                view === 'archived'
                  ? 'rounded-md bg-sunk px-3 py-1 font-medium text-ink'
                  : 'px-3 py-1 text-muted hover:text-ink'
              }
            >
              Archived {counts.archived}
            </Link>
          </div>
        }
      />
      {messages.length === 0 ? (
        <Card>
          <Empty>{view === 'inbox' ? 'Nothing in the inbox.' : 'Nothing archived.'}</Empty>
        </Card>
      ) : (
        <div className="space-y-4">
          {messages.map((m) => (
            <Card key={m.id} id={m.id} className={m.status === 'new' ? 'border-signal' : undefined}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[0.9375rem] font-semibold text-ink">{m.name}</span>
                    <a
                      href={`mailto:${m.email}`}
                      className="text-[0.875rem] text-link hover:text-link-hover"
                    >
                      {m.email}
                    </a>
                  </div>
                  <div className="mt-0.5 text-[0.8125rem] text-muted">
                    {topicLabel(m.topic)}, {formatWhen(m.received_at)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {m.status === 'new' ? <Badge tone="warn">New</Badge> : null}
                  {m.mailed ? null : <Badge tone="bad">Not mailed</Badge>}
                </div>
              </div>
              <p className="mt-4 text-[0.9375rem] leading-relaxed whitespace-pre-wrap text-body">
                {m.body}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
                <a
                  href={`mailto:${m.email}?subject=${encodeURIComponent(`Re: your message to nullroute`)}`}
                  className="inline-flex h-8 items-center rounded-lg bg-ink px-3 text-[0.8125rem] font-medium text-paper hover:opacity-90"
                >
                  Reply
                </a>
                {m.status === 'new' ? (
                  <StatusButton id={m.id} status="read" label="Mark read" />
                ) : null}
                {m.status === 'read' ? (
                  <StatusButton id={m.id} status="new" label="Mark unread" />
                ) : null}
                {m.status !== 'archived' ? (
                  <StatusButton id={m.id} status="archived" label="Archive" />
                ) : (
                  <StatusButton id={m.id} status="read" label="Move to inbox" />
                )}
                <form action={deleteMessageAction} className="ml-auto">
                  <input type="hidden" name="id" value={m.id} />
                  <Button type="submit" variant="ghost" className="h-8 px-3 text-[0.8125rem]">
                    Delete
                  </Button>
                </form>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
