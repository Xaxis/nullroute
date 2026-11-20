import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { money, statusTone } from '@/components/grant-format'
import { GrantFields } from '@/components/GrantFields'
import {
  Badge,
  Button,
  Card,
  Empty,
  Field,
  formatDate,
  formatWhen,
  Input,
  Select,
  Textarea,
} from '@/components/ui'
import {
  DOCUMENT_KINDS,
  daysUntil,
  getGrant,
  LABELS,
  MILESTONE_STATUSES,
  type Milestone,
  REFERENCE_STATUSES,
  type Reference,
} from '@/server/grants'
import { renderMarkdown } from '@/server/markdown'
import {
  deleteGrantAction,
  deleteMilestoneAction,
  deleteReferenceAction,
  deleteTaskAction,
  saveDocumentAction,
  saveMilestoneAction,
  saveReferenceAction,
  saveTaskAction,
  toggleTaskAction,
  updateGrantAction,
} from '../../actions'

interface Props {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const found = await getGrant((await params).id)
  return { title: found ? `${found.grant.funder}: ${found.grant.program}` : 'Grant' }
}

const MILESTONE_TONE = {
  planned: 'neutral',
  in_progress: 'warn',
  done: 'good',
  dropped: 'bad',
} as const
const REFERENCE_TONE = {
  to_ask: 'neutral',
  asked: 'warn',
  agreed: 'accent',
  sent: 'accent',
  received: 'good',
  declined: 'bad',
} as const

function Hidden({ grantId, id }: { grantId: string; id?: string }) {
  return (
    <>
      <input type="hidden" name="grant_id" value={grantId} />
      {id ? <input type="hidden" name="id" value={id} /> : null}
    </>
  )
}

function MilestoneForm({ grantId, m, next }: { grantId: string; m?: Milestone; next: number }) {
  return (
    <form
      action={saveMilestoneAction}
      className="grid gap-3 sm:grid-cols-[5rem_minmax(0,1fr)_9rem]"
    >
      <Hidden grantId={grantId} id={m?.id} />
      <Field label="Label">
        <Input name="label" maxLength={20} defaultValue={m?.label ?? `M${String(next)}`} />
      </Field>
      <Field label="Title">
        <Input name="title" required maxLength={300} defaultValue={m?.title ?? ''} />
      </Field>
      <Field label="Status">
        <Select name="status" defaultValue={m?.status ?? 'planned'}>
          {MILESTONE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {LABELS[s]}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="Done when"
        className="sm:col-span-3"
        hint="What anyone can check publicly once it is done."
      >
        <Textarea
          name="done_when"
          maxLength={2000}
          defaultValue={m?.done_when ?? ''}
          className="min-h-16"
        />
      </Field>
      <Field label="Due">
        <Input name="due_on" type="date" defaultValue={m?.due_on ?? ''} />
      </Field>
      <Field label="Evidence link">
        <Input
          name="evidence_url"
          type="url"
          maxLength={500}
          defaultValue={m?.evidence_url ?? ''}
          placeholder="https://"
        />
      </Field>
      <Field label="Order">
        <Input
          name="position"
          inputMode="numeric"
          pattern="[0-9]*"
          defaultValue={m?.position ?? next}
        />
      </Field>
      <div className="flex justify-end sm:col-span-3">
        <Button type="submit" variant="primary">
          {m ? 'Save milestone' : 'Add milestone'}
        </Button>
      </div>
    </form>
  )
}

function ReferenceForm({ grantId, r }: { grantId: string; r?: Reference }) {
  return (
    <form action={saveReferenceAction} className="grid gap-3 sm:grid-cols-2">
      <Hidden grantId={grantId} id={r?.id} />
      <Field label="Name">
        <Input name="name" required maxLength={160} defaultValue={r?.name ?? ''} />
      </Field>
      <Field label="Contact">
        <Input
          name="contact"
          maxLength={320}
          defaultValue={r?.contact ?? ''}
          placeholder="Email or npub"
        />
      </Field>
      <Field label="Relation" hint="What they know of the work.">
        <Input name="relation" maxLength={300} defaultValue={r?.relation ?? ''} />
      </Field>
      <Field label="Status">
        <Select name="status" defaultValue={r?.status ?? 'to_ask'}>
          {REFERENCE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {LABELS[s]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Notes" className="sm:col-span-2">
        <Textarea
          name="notes"
          maxLength={4000}
          defaultValue={r?.notes ?? ''}
          className="min-h-16"
        />
      </Field>
      <div className="flex justify-end sm:col-span-2">
        <Button type="submit" variant="primary">
          {r ? 'Save reference' : 'Add reference'}
        </Button>
      </div>
    </form>
  )
}

function DeleteButton({
  action,
  grantId,
  id,
  label,
}: {
  action: (fd: FormData) => Promise<void>
  grantId: string
  id: string
  label: string
}) {
  return (
    <form action={action}>
      <Hidden grantId={grantId} id={id} />
      <Button
        type="submit"
        variant="ghost"
        className="h-7 px-2 text-[0.8125rem]"
        aria-label={label}
      >
        Remove
      </Button>
    </form>
  )
}

export default async function GrantPage({ params }: Props) {
  const found = await getGrant((await params).id)
  if (!found) notFound()
  const { grant: g, milestones, references, documents, tasks } = found
  const notes = g.notes ? await renderMarkdown(g.notes) : ''
  const days = g.window_closes ? daysUntil(g.window_closes) : null
  const received = references.filter((r) => r.status === 'received').length
  const nextMilestone = milestones.length + 1

  return (
    <>
      <div className="mb-2 text-[0.8125rem]">
        <Link href="/grants" className="text-muted hover:text-ink">
          Grants
        </Link>
      </div>
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-[1.75rem] leading-tight font-semibold text-ink">
              {g.funder}: {g.program}
            </h1>
            <Badge tone={statusTone(g.status)}>{LABELS[g.status]}</Badge>
          </div>
          <p className="mt-1.5 max-w-3xl text-[0.9375rem] text-muted">{g.title}</p>
        </div>
        {g.url ? (
          <a href={g.url} className="text-[0.875rem] text-link hover:text-link-hover">
            Funder&apos;s page
          </a>
        ) : null}
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          {g.summary ? (
            <Card title="Summary">
              <p className="text-[0.9375rem] leading-relaxed whitespace-pre-wrap text-body">
                {g.summary}
              </p>
            </Card>
          ) : null}

          <Card
            title="Before you submit"
            aside={`${String(tasks.filter((t) => t.done).length)} of ${String(tasks.length)} done`}
          >
            {tasks.length === 0 ? (
              <Empty>No checklist yet.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {tasks.map((t) => (
                  <li key={t.id} className="flex items-start gap-3 py-2.5 first:pt-0">
                    <form action={toggleTaskAction}>
                      <Hidden grantId={g.id} id={t.id} />
                      <input type="hidden" name="done" value={t.done ? 'false' : 'true'} />
                      <button
                        type="submit"
                        aria-label={
                          t.done ? `Mark "${t.title}" not done` : `Mark "${t.title}" done`
                        }
                        className={
                          t.done
                            ? 'mt-0.5 grid size-5 place-items-center rounded border border-verify-line bg-verify-fill text-[0.75rem] text-verify'
                            : 'mt-0.5 size-5 rounded border border-border bg-paper hover:border-signal'
                        }
                      >
                        {t.done ? (
                          <svg viewBox="0 0 12 12" aria-hidden="true" className="size-3">
                            <path
                              d="M2.5 6.5 5 9l4.5-6"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.75"
                            />
                          </svg>
                        ) : null}
                      </button>
                    </form>
                    <div className="min-w-0 flex-1">
                      <div
                        className={
                          t.done
                            ? 'text-[0.9375rem] text-muted line-through'
                            : 'text-[0.9375rem] text-ink'
                        }
                      >
                        {t.title}
                      </div>
                      {t.detail ? (
                        <div className="text-[0.8125rem] text-muted">{t.detail}</div>
                      ) : null}
                    </div>
                    <DeleteButton
                      action={deleteTaskAction}
                      grantId={g.id}
                      id={t.id}
                      label={`Remove "${t.title}"`}
                    />
                  </li>
                ))}
              </ul>
            )}
            <details className="mt-4 border-t border-line pt-4">
              <summary className="cursor-pointer text-[0.875rem] font-medium text-ink">
                Add an item
              </summary>
              <form
                action={saveTaskAction}
                className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_6rem]"
              >
                <Hidden grantId={g.id} />
                <Field label="Item">
                  <Input name="title" required maxLength={300} />
                </Field>
                <Field label="Order">
                  <Input
                    name="position"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    defaultValue={tasks.length + 1}
                  />
                </Field>
                <Field label="Detail" className="sm:col-span-2">
                  <Input name="detail" maxLength={2000} />
                </Field>
                <div className="flex justify-end sm:col-span-2">
                  <Button type="submit" variant="primary">
                    Add item
                  </Button>
                </div>
              </form>
            </details>
          </Card>

          <Card
            title="Milestones"
            aside={`${String(milestones.filter((m) => m.status === 'done').length)} of ${String(milestones.length)} done`}
          >
            {milestones.length === 0 ? (
              <Empty>No milestones yet.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {milestones.map((m) => (
                  <li key={m.id} className="py-3 first:pt-0">
                    <details>
                      <summary className="flex cursor-pointer list-none items-start gap-3">
                        <span className="w-9 shrink-0 font-mono text-[0.8125rem] text-muted">
                          {m.label}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[0.9375rem] font-medium text-ink">
                            {m.title}
                          </span>
                          {m.done_when ? (
                            <span className="mt-0.5 block text-[0.8125rem] text-muted">
                              {m.done_when}
                            </span>
                          ) : null}
                          {m.evidence_url ? (
                            <a
                              href={m.evidence_url}
                              className="mt-0.5 block text-[0.8125rem] text-link hover:text-link-hover"
                            >
                              Evidence
                            </a>
                          ) : null}
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-1">
                          <Badge tone={MILESTONE_TONE[m.status]}>{LABELS[m.status]}</Badge>
                          {m.due_on ? (
                            <span className="text-[0.75rem] text-muted">
                              Due {formatDate(m.due_on)}
                            </span>
                          ) : null}
                        </span>
                      </summary>
                      <div className="mt-4 rounded-lg border border-line bg-paper p-4">
                        <MilestoneForm grantId={g.id} m={m} next={nextMilestone} />
                        <div className="mt-2 flex justify-end">
                          <DeleteButton
                            action={deleteMilestoneAction}
                            grantId={g.id}
                            id={m.id}
                            label={`Remove ${m.label}`}
                          />
                        </div>
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            )}
            <details className="mt-4 border-t border-line pt-4">
              <summary className="cursor-pointer text-[0.875rem] font-medium text-ink">
                Add a milestone
              </summary>
              <div className="mt-3">
                <MilestoneForm grantId={g.id} next={nextMilestone} />
              </div>
            </details>
          </Card>

          <Card title="Documents" aside={String(documents.length)}>
            {documents.length === 0 ? (
              <Empty>No documents yet.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {documents.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-center justify-between gap-3 py-2.5 first:pt-0"
                  >
                    <Link href={`/grants/${g.id}/documents/${d.id}`} className="min-w-0">
                      <span className="block truncate text-[0.9375rem] font-medium text-ink hover:text-link">
                        {d.title}
                      </span>
                      <span className="block text-[0.8125rem] text-muted">
                        {Math.max(1, Math.round(d.length / 1000))}k characters, updated{' '}
                        {formatWhen(d.updated_at)}
                      </span>
                    </Link>
                    <Badge>{LABELS[d.kind]}</Badge>
                  </li>
                ))}
              </ul>
            )}
            <details className="mt-4 border-t border-line pt-4">
              <summary className="cursor-pointer text-[0.875rem] font-medium text-ink">
                Add a document
              </summary>
              <form
                action={saveDocumentAction}
                className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]"
              >
                <Hidden grantId={g.id} />
                <Field label="Title">
                  <Input name="title" required maxLength={200} />
                </Field>
                <Field label="Kind">
                  <Select name="kind" defaultValue="draft">
                    {DOCUMENT_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {LABELS[k]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Body" className="sm:col-span-2" hint="Markdown.">
                  <Textarea name="body" className="min-h-48 font-mono text-[0.8125rem]" />
                </Field>
                <div className="flex justify-end sm:col-span-2">
                  <Button type="submit" variant="primary">
                    Add document
                  </Button>
                </div>
              </form>
            </details>
          </Card>

          {notes ? (
            <Card title="Notes">
              <div className="prose-doc" dangerouslySetInnerHTML={{ __html: notes }} />
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          <Card title="Key facts">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[0.875rem]">
              <dt className="text-muted">Window</dt>
              <dd className="text-ink">
                {g.window_opens || g.window_closes
                  ? `${formatDate(g.window_opens) || 'Open'} to ${formatDate(g.window_closes) || 'open'}`
                  : 'Not set'}
              </dd>
              {days !== null && days >= 0 && (g.status === 'idea' || g.status === 'drafting') ? (
                <>
                  <dt className="text-muted">Closes in</dt>
                  <dd className={days <= 14 ? 'text-caution' : 'text-ink'}>
                    {days === 0 ? 'Today' : `${String(days)} days`}
                  </dd>
                </>
              ) : null}
              <dt className="text-muted">Amount</dt>
              <dd className="text-ink">{money(g.amount_usd) || 'Not set'}</dd>
              <dt className="text-muted">Duration</dt>
              <dd className="text-ink">
                {g.duration_months ? `${String(g.duration_months)} months` : 'Not set'}
              </dd>
              <dt className="text-muted">Commitment</dt>
              <dd className="text-ink">{g.commitment || 'Not set'}</dd>
              <dt className="text-muted">Submitted</dt>
              <dd className="text-ink">{formatDate(g.submitted_on) || 'Not yet'}</dd>
              <dt className="text-muted">Decided</dt>
              <dd className="text-ink">{formatDate(g.decided_on) || 'Not yet'}</dd>
              <dt className="text-muted">References</dt>
              <dd className={received >= 2 ? 'text-verify' : 'text-ink'}>
                {received} of 2 received
              </dd>
            </dl>
          </Card>

          <Card title="References" aside={`${String(received)} received`}>
            {references.length === 0 ? (
              <Empty>Nobody yet. Evaluation starts only once two written references arrive.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {references.map((r) => (
                  <li key={r.id} className="py-3 first:pt-0">
                    <details>
                      <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block text-[0.9375rem] font-medium text-ink">
                            {r.name}
                          </span>
                          {r.relation ? (
                            <span className="block text-[0.8125rem] text-muted">{r.relation}</span>
                          ) : null}
                        </span>
                        <Badge tone={REFERENCE_TONE[r.status]}>{LABELS[r.status]}</Badge>
                      </summary>
                      <div className="mt-3 rounded-lg border border-line bg-paper p-4">
                        <ReferenceForm grantId={g.id} r={r} />
                        <div className="mt-2 flex justify-end">
                          <DeleteButton
                            action={deleteReferenceAction}
                            grantId={g.id}
                            id={r.id}
                            label={`Remove ${r.name}`}
                          />
                        </div>
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            )}
            <details className="mt-4 border-t border-line pt-4">
              <summary className="cursor-pointer text-[0.875rem] font-medium text-ink">
                Add a reference
              </summary>
              <div className="mt-3">
                <ReferenceForm grantId={g.id} />
              </div>
            </details>
          </Card>

          <details className="rounded-xl border border-line bg-surface">
            <summary className="cursor-pointer px-5 py-3.5 text-[0.875rem] font-semibold tracking-wide text-ink uppercase">
              Edit details
            </summary>
            <form action={updateGrantAction} className="border-t border-line p-5">
              <input type="hidden" name="id" value={g.id} />
              <GrantFields grant={g} />
              <div className="mt-5 flex justify-end">
                <Button type="submit" variant="primary">
                  Save details
                </Button>
              </div>
            </form>
          </details>

          <details className="rounded-xl border border-caution-line">
            <summary className="cursor-pointer px-5 py-3.5 text-[0.875rem] font-medium text-caution">
              Delete this grant
            </summary>
            <form action={deleteGrantAction} className="space-y-3 border-t border-caution-line p-5">
              <input type="hidden" name="id" value={g.id} />
              <p className="text-[0.8125rem] text-caution">
                Removes the grant with its milestones, references, documents and checklist. This
                cannot be undone.
              </p>
              <Field label='Type "delete" to confirm'>
                <Input name="confirm" required pattern="delete" autoComplete="off" />
              </Field>
              <Button type="submit" variant="danger">
                Delete grant
              </Button>
            </form>
          </details>
        </div>
      </div>
    </>
  )
}
