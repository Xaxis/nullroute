'use server'

/**
 * Every change the console makes. Each action checks the session again (the proxy is the first
 * lock, this is the second), parses its form with zod, and writes an audit entry.
 */
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { audit } from '@/server/audit'
import { endSession } from '@/server/auth/sessions'
import { requireViewer } from '@/server/auth/viewer'
import {
  createGrant,
  DOCUMENT_KINDS,
  deleteDocument,
  deleteGrant,
  deleteMilestone,
  deleteReference,
  deleteTask,
  GRANT_STATUSES,
  type GrantInput,
  MILESTONE_STATUSES,
  REFERENCE_STATUSES,
  saveDocument,
  saveMilestone,
  saveReference,
  saveTask,
  setTaskDone,
  updateGrant,
} from '@/server/grants'
import { deleteMessage, MESSAGE_STATUSES, setMessageStatus } from '@/server/messages'

const text = (max: number) => z.string().trim().max(max)
const required = (max: number, what: string) =>
  z.string().trim().min(1, `${what} is required.`).max(max)
const date = z
  .string()
  .trim()
  .refine((s) => s === '' || /^\d{4}-\d{2}-\d{2}$/.test(s), 'Dates are YYYY-MM-DD.')
  .transform((s) => (s === '' ? null : s))
const int = z
  .string()
  .trim()
  .refine((s) => s === '' || /^\d{1,9}$/.test(s.replaceAll(',', '')), 'Whole numbers only.')
  .transform((s) => (s === '' ? null : Number(s.replaceAll(',', ''))))
const id = z.string().regex(/^[a-z]{1,3}_[A-Za-z0-9]{6,20}$/)
const optionalId = z
  .string()
  .optional()
  .transform((s) => (s === '' ? null : s))
  .pipe(id.nullable())

function form(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of fd.entries()) if (typeof v === 'string') out[k] = v
  return out
}

function parse<T extends z.ZodType>(schema: T, fd: FormData): z.infer<T> {
  const r = schema.safeParse(form(fd))
  if (!r.success) throw new Error(r.error.issues[0]?.message ?? 'Check the form.')
  return r.data
}

const grantSchema = z.object({
  funder: required(120, 'Funder'),
  program: required(160, 'Program'),
  title: required(200, 'Title'),
  status: z.enum(GRANT_STATUSES),
  window_opens: date,
  window_closes: date,
  submitted_on: date,
  decided_on: date,
  amount_usd: int,
  duration_months: int,
  commitment: text(200),
  url: text(500),
  summary: text(4000),
  notes: text(20_000),
})

export async function createGrantAction(fd: FormData) {
  const v = await requireViewer()
  const input: GrantInput = parse(grantSchema, fd)
  const grantId = await createGrant(input)
  await audit({
    actor: v.email,
    action: 'grant.created',
    detail: { id: grantId, title: input.title },
  })
  revalidatePath('/grants')
  redirect(`/grants/${grantId}`)
}

export async function updateGrantAction(fd: FormData) {
  const v = await requireViewer()
  const grantId = parse(z.object({ id }), fd).id
  const input: GrantInput = parse(grantSchema, fd)
  await updateGrant(grantId, input)
  await audit({
    actor: v.email,
    action: 'grant.updated',
    detail: { id: grantId, status: input.status },
  })
  revalidatePath(`/grants/${grantId}`)
  revalidatePath('/grants')
  revalidatePath('/')
}

export async function deleteGrantAction(fd: FormData) {
  const v = await requireViewer()
  const { id: grantId, confirm } = parse(z.object({ id, confirm: z.string() }), fd)
  if (confirm !== 'delete') throw new Error('Type "delete" to confirm.')
  await deleteGrant(grantId)
  await audit({ actor: v.email, action: 'grant.deleted', detail: { id: grantId } })
  revalidatePath('/grants')
  redirect('/grants')
}

const child = z.object({ grant_id: id, id: optionalId })

export async function saveMilestoneAction(fd: FormData) {
  const v = await requireViewer()
  const { grant_id, id: msId } = parse(child, fd)
  const m = parse(
    z.object({
      position: int.transform((n) => n ?? 0),
      label: text(20),
      title: required(300, 'Title'),
      done_when: text(2000),
      status: z.enum(MILESTONE_STATUSES),
      due_on: date,
      evidence_url: text(500),
    }),
    fd
  )
  await saveMilestone(grant_id, msId, m)
  await audit({
    actor: v.email,
    action: msId ? 'milestone.updated' : 'milestone.added',
    detail: { grant: grant_id, title: m.title, status: m.status },
  })
  revalidatePath(`/grants/${grant_id}`)
}

export async function deleteMilestoneAction(fd: FormData) {
  const v = await requireViewer()
  const { grant_id, id: msId } = parse(z.object({ grant_id: id, id }), fd)
  await deleteMilestone(grant_id, msId)
  await audit({
    actor: v.email,
    action: 'milestone.deleted',
    detail: { grant: grant_id, id: msId },
  })
  revalidatePath(`/grants/${grant_id}`)
}

export async function saveReferenceAction(fd: FormData) {
  const v = await requireViewer()
  const { grant_id, id: refId } = parse(child, fd)
  const r = parse(
    z.object({
      name: required(160, 'Name'),
      contact: text(320),
      relation: text(300),
      status: z.enum(REFERENCE_STATUSES),
      notes: text(4000),
    }),
    fd
  )
  await saveReference(grant_id, refId, r)
  await audit({
    actor: v.email,
    action: refId ? 'reference.updated' : 'reference.added',
    detail: { grant: grant_id, status: r.status },
  })
  revalidatePath(`/grants/${grant_id}`)
}

export async function deleteReferenceAction(fd: FormData) {
  const v = await requireViewer()
  const { grant_id, id: refId } = parse(z.object({ grant_id: id, id }), fd)
  await deleteReference(grant_id, refId)
  await audit({
    actor: v.email,
    action: 'reference.deleted',
    detail: { grant: grant_id, id: refId },
  })
  revalidatePath(`/grants/${grant_id}`)
}

export async function saveDocumentAction(fd: FormData) {
  const v = await requireViewer()
  const { grant_id, id: docId } = parse(child, fd)
  const d = parse(
    z.object({
      title: required(200, 'Title'),
      kind: z.enum(DOCUMENT_KINDS),
      body: z.string().max(500_000),
    }),
    fd
  )
  const saved = await saveDocument(grant_id, docId, d, v.email)
  await audit({
    actor: v.email,
    action: docId ? 'document.updated' : 'document.added',
    detail: { grant: grant_id, id: saved, title: d.title },
  })
  revalidatePath(`/grants/${grant_id}`)
  redirect(`/grants/${grant_id}/documents/${saved}`)
}

export async function deleteDocumentAction(fd: FormData) {
  const v = await requireViewer()
  const { grant_id, id: docId } = parse(z.object({ grant_id: id, id }), fd)
  await deleteDocument(grant_id, docId)
  await audit({
    actor: v.email,
    action: 'document.deleted',
    detail: { grant: grant_id, id: docId },
  })
  revalidatePath(`/grants/${grant_id}`)
  redirect(`/grants/${grant_id}`)
}

export async function saveTaskAction(fd: FormData) {
  const v = await requireViewer()
  const { grant_id, id: taskId } = parse(child, fd)
  const t = parse(
    z.object({
      position: int.transform((n) => n ?? 0),
      title: required(300, 'Title'),
      detail: text(2000),
      done: z
        .string()
        .optional()
        .transform((s) => s === 'on'),
    }),
    fd
  )
  await saveTask(grant_id, taskId, t)
  await audit({
    actor: v.email,
    action: taskId ? 'task.updated' : 'task.added',
    detail: { grant: grant_id, title: t.title },
  })
  revalidatePath(`/grants/${grant_id}`)
}

export async function toggleTaskAction(fd: FormData) {
  const v = await requireViewer()
  const {
    grant_id,
    id: taskId,
    done,
  } = parse(z.object({ grant_id: id, id, done: z.enum(['true', 'false']) }), fd)
  await setTaskDone(grant_id, taskId, done === 'true')
  await audit({
    actor: v.email,
    action: 'task.toggled',
    detail: { grant: grant_id, id: taskId, done },
  })
  revalidatePath(`/grants/${grant_id}`)
}

export async function deleteTaskAction(fd: FormData) {
  const v = await requireViewer()
  const { grant_id, id: taskId } = parse(z.object({ grant_id: id, id }), fd)
  await deleteTask(grant_id, taskId)
  await audit({ actor: v.email, action: 'task.deleted', detail: { grant: grant_id, id: taskId } })
  revalidatePath(`/grants/${grant_id}`)
}

export async function setMessageStatusAction(fd: FormData) {
  const v = await requireViewer()
  const { id: msgId, status } = parse(z.object({ id, status: z.enum(MESSAGE_STATUSES) }), fd)
  await setMessageStatus(msgId, status)
  await audit({ actor: v.email, action: 'message.status', detail: { id: msgId, status } })
  revalidatePath('/messages')
  revalidatePath('/')
}

export async function deleteMessageAction(fd: FormData) {
  const v = await requireViewer()
  const { id: msgId } = parse(z.object({ id }), fd)
  await deleteMessage(msgId)
  await audit({ actor: v.email, action: 'message.deleted', detail: { id: msgId } })
  revalidatePath('/messages')
}

export async function endSessionAction(fd: FormData) {
  const v = await requireViewer()
  const { id: sessionId } = parse(z.object({ id: z.string().regex(/^s_[A-Za-z0-9_-]{12}$/) }), fd)
  await endSession(sessionId)
  await audit({ actor: v.email, action: 'auth.session_ended', detail: { session: sessionId } })
  revalidatePath('/access')
  if (sessionId === v.session.id) redirect('/signin')
}
