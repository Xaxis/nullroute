import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Badge, Button, Card, Field, formatWhen, Input, Select, Textarea } from '@/components/ui'
import { DOCUMENT_KINDS, getDocument, LABELS } from '@/server/grants'
import { renderMarkdown } from '@/server/markdown'
import { deleteDocumentAction, saveDocumentAction } from '../../../../actions'

interface Props {
  params: Promise<{ id: string; docId: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const doc = await getDocument((await params).docId)
  return { title: doc?.title ?? 'Document' }
}

export default async function DocumentPage({ params }: Props) {
  const { id, docId } = await params
  const doc = await getDocument(docId)
  if (doc?.grant_id !== id) notFound()
  const html = await renderMarkdown(doc.body)

  return (
    <>
      <div className="mb-2 text-[0.8125rem]">
        <Link href="/grants" className="text-muted hover:text-ink">
          Grants
        </Link>
        <span className="px-1.5 text-muted">/</span>
        <Link href={`/grants/${id}`} className="text-muted hover:text-ink">
          {doc.grant_name}
        </Link>
      </div>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-[1.75rem] leading-tight font-semibold text-ink">
              {doc.title}
            </h1>
            <Badge>{LABELS[doc.kind]}</Badge>
          </div>
          <p className="mt-1.5 text-[0.875rem] text-muted">
            Updated {formatWhen(doc.updated_at)}
            {doc.updated_by ? ` by ${doc.updated_by}` : ''}. {doc.length.toLocaleString('en-US')}{' '}
            characters.
          </p>
        </div>
        <a
          href={`/api/documents/${doc.id}`}
          className="inline-flex h-9 items-center rounded-lg border border-border bg-surface px-3.5 text-[0.875rem] font-medium text-ink hover:bg-sunk"
        >
          Download .md
        </a>
      </header>

      <Card className="mb-6">
        <article
          className="prose-doc mx-auto max-w-3xl"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </Card>

      <details className="mb-6 rounded-xl border border-line bg-surface">
        <summary className="cursor-pointer px-5 py-3.5 text-[0.875rem] font-semibold tracking-wide text-ink uppercase">
          Edit
        </summary>
        <form
          action={saveDocumentAction}
          className="grid gap-3 border-t border-line p-5 sm:grid-cols-[minmax(0,1fr)_10rem]"
        >
          <input type="hidden" name="grant_id" value={id} />
          <input type="hidden" name="id" value={doc.id} />
          <Field label="Title">
            <Input name="title" required maxLength={200} defaultValue={doc.title} />
          </Field>
          <Field label="Kind">
            <Select name="kind" defaultValue={doc.kind}>
              {DOCUMENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {LABELS[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Body"
            className="sm:col-span-2"
            hint="Markdown. Raw HTML is dropped when shown."
          >
            <Textarea
              name="body"
              defaultValue={doc.body}
              className="min-h-[32rem] font-mono text-[0.8125rem]"
            />
          </Field>
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" variant="primary">
              Save document
            </Button>
          </div>
        </form>
      </details>

      <form action={deleteDocumentAction} className="flex justify-end">
        <input type="hidden" name="grant_id" value={id} />
        <input type="hidden" name="id" value={doc.id} />
        <Button type="submit" variant="danger">
          Delete document
        </Button>
      </form>
    </>
  )
}
