/** Grants: applications, with their milestones, references, documents and checklist. */
import { randomId } from './crypto'
import { pg } from './db'

export const GRANT_STATUSES = [
  'idea',
  'drafting',
  'submitted',
  'under_review',
  'awarded',
  'declined',
  'withdrawn',
  'completed',
] as const
export type GrantStatus = (typeof GRANT_STATUSES)[number]

export const MILESTONE_STATUSES = ['planned', 'in_progress', 'done', 'dropped'] as const
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number]

export const REFERENCE_STATUSES = [
  'to_ask',
  'asked',
  'agreed',
  'sent',
  'received',
  'declined',
] as const
export type ReferenceStatus = (typeof REFERENCE_STATUSES)[number]

export const DOCUMENT_KINDS = [
  'draft',
  'research',
  'memo',
  'summary',
  'letter',
  'report',
  'other',
] as const
export type DocumentKind = (typeof DOCUMENT_KINDS)[number]

/** How a status reads on the page. */
export const LABELS: Record<string, string> = {
  idea: 'Idea',
  drafting: 'Drafting',
  submitted: 'Submitted',
  under_review: 'Under review',
  awarded: 'Awarded',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
  completed: 'Completed',
  planned: 'Planned',
  in_progress: 'In progress',
  done: 'Done',
  dropped: 'Dropped',
  to_ask: 'To ask',
  asked: 'Asked',
  agreed: 'Agreed',
  sent: 'Sent',
  received: 'Received',
  draft: 'Draft',
  research: 'Research',
  memo: 'Memo',
  summary: 'Summary',
  letter: 'Letter',
  report: 'Report',
  other: 'Other',
}

export interface Grant {
  id: string
  funder: string
  program: string
  title: string
  status: GrantStatus
  window_opens: string | null
  window_closes: string | null
  submitted_on: string | null
  decided_on: string | null
  amount_usd: number | null
  duration_months: number | null
  commitment: string
  url: string
  summary: string
  notes: string
  created_at: Date
  updated_at: Date
}

export interface GrantRow extends Grant {
  milestones_done: number
  milestones_total: number
  references_received: number
  references_total: number
  tasks_done: number
  tasks_total: number
}

export interface Milestone {
  id: string
  grant_id: string
  position: number
  label: string
  title: string
  done_when: string
  status: MilestoneStatus
  due_on: string | null
  evidence_url: string
}

export interface Reference {
  id: string
  grant_id: string
  name: string
  contact: string
  relation: string
  status: ReferenceStatus
  notes: string
}

export interface DocumentMeta {
  id: string
  grant_id: string
  title: string
  kind: DocumentKind
  updated_at: Date
  updated_by: string | null
  length: number
}

export interface GrantDocument extends DocumentMeta {
  body: string
  /** "Funder: program", for the way back to the grant. */
  grant_name: string
}

export interface Task {
  id: string
  grant_id: string
  position: number
  title: string
  detail: string
  done: boolean
}

export async function listGrants(): Promise<GrantRow[]> {
  return pg()<GrantRow[]>`
    select g.*,
      (select count(*) from nullroute.grant_milestones m where m.grant_id = g.id and m.status = 'done') as milestones_done,
      (select count(*) from nullroute.grant_milestones m where m.grant_id = g.id and m.status <> 'dropped') as milestones_total,
      (select count(*) from nullroute.grant_references r where r.grant_id = g.id and r.status = 'received') as references_received,
      (select count(*) from nullroute.grant_references r where r.grant_id = g.id and r.status <> 'declined') as references_total,
      (select count(*) from nullroute.grant_tasks t where t.grant_id = g.id and t.done) as tasks_done,
      (select count(*) from nullroute.grant_tasks t where t.grant_id = g.id) as tasks_total
    from nullroute.grants g
    order by (g.status in ('declined', 'withdrawn', 'completed')), g.window_closes nulls last, g.created_at desc`
}

export async function getGrant(id: string) {
  const [grant] = await pg()<Grant[]>`select * from nullroute.grants where id = ${id}`
  if (!grant) return undefined
  const [milestones, references, documents, tasks] = await Promise.all([
    pg()<Milestone[]>`
      select * from nullroute.grant_milestones where grant_id = ${id} order by position, label`,
    pg()<Reference[]>`
      select * from nullroute.grant_references where grant_id = ${id} order by name`,
    pg()<DocumentMeta[]>`
      select id, grant_id, title, kind, updated_at, updated_by, length(body) as length
      from nullroute.grant_documents where grant_id = ${id} order by kind, title`,
    pg()<
      Task[]
    >`select * from nullroute.grant_tasks where grant_id = ${id} order by position, title`,
  ])
  return { grant, milestones, references, documents, tasks }
}

export async function getDocument(id: string): Promise<GrantDocument | undefined> {
  const [doc] = await pg()<GrantDocument[]>`
    select d.*, length(d.body) as length, g.funder || ': ' || g.program as grant_name
    from nullroute.grant_documents d join nullroute.grants g on g.id = d.grant_id
    where d.id = ${id}`
  return doc
}

export interface GrantInput {
  funder: string
  program: string
  title: string
  status: GrantStatus
  window_opens: string | null
  window_closes: string | null
  submitted_on: string | null
  decided_on: string | null
  amount_usd: number | null
  duration_months: number | null
  commitment: string
  url: string
  summary: string
  notes: string
}

export async function createGrant(input: GrantInput): Promise<string> {
  const id = `g_${randomId(12)}`
  await pg()`
    insert into nullroute.grants (id, funder, program, title, status, window_opens, window_closes,
      submitted_on, decided_on, amount_usd, duration_months, commitment, url, summary, notes)
    values (${id}, ${input.funder}, ${input.program}, ${input.title}, ${input.status},
      ${input.window_opens}, ${input.window_closes}, ${input.submitted_on}, ${input.decided_on},
      ${input.amount_usd}, ${input.duration_months}, ${input.commitment}, ${input.url},
      ${input.summary}, ${input.notes})`
  return id
}

export async function updateGrant(id: string, input: GrantInput): Promise<void> {
  await pg()`
    update nullroute.grants set funder = ${input.funder}, program = ${input.program},
      title = ${input.title}, status = ${input.status}, window_opens = ${input.window_opens},
      window_closes = ${input.window_closes}, submitted_on = ${input.submitted_on},
      decided_on = ${input.decided_on}, amount_usd = ${input.amount_usd},
      duration_months = ${input.duration_months}, commitment = ${input.commitment},
      url = ${input.url}, summary = ${input.summary}, notes = ${input.notes}, updated_at = now()
    where id = ${id}`
}

export async function deleteGrant(id: string): Promise<void> {
  await pg()`delete from nullroute.grants where id = ${id}`
}

const touch = (grantId: string) =>
  pg()`update nullroute.grants set updated_at = now() where id = ${grantId}`

export async function saveMilestone(
  grantId: string,
  id: string | null,
  m: Omit<Milestone, 'id' | 'grant_id'>
): Promise<void> {
  if (id) {
    await pg()`
      update nullroute.grant_milestones set position = ${m.position}, label = ${m.label},
        title = ${m.title}, done_when = ${m.done_when}, status = ${m.status}, due_on = ${m.due_on},
        evidence_url = ${m.evidence_url}, updated_at = now()
      where id = ${id} and grant_id = ${grantId}`
  } else {
    await pg()`
      insert into nullroute.grant_milestones (id, grant_id, position, label, title, done_when, status, due_on, evidence_url)
      values (${`ms_${randomId(12)}`}, ${grantId}, ${m.position}, ${m.label}, ${m.title},
        ${m.done_when}, ${m.status}, ${m.due_on}, ${m.evidence_url})`
  }
  await touch(grantId)
}

export async function deleteMilestone(grantId: string, id: string): Promise<void> {
  await pg()`delete from nullroute.grant_milestones where id = ${id} and grant_id = ${grantId}`
  await touch(grantId)
}

export async function saveReference(
  grantId: string,
  id: string | null,
  r: Omit<Reference, 'id' | 'grant_id'>
): Promise<void> {
  if (id) {
    await pg()`
      update nullroute.grant_references set name = ${r.name}, contact = ${r.contact},
        relation = ${r.relation}, status = ${r.status}, notes = ${r.notes}, updated_at = now()
      where id = ${id} and grant_id = ${grantId}`
  } else {
    await pg()`
      insert into nullroute.grant_references (id, grant_id, name, contact, relation, status, notes)
      values (${`rf_${randomId(12)}`}, ${grantId}, ${r.name}, ${r.contact}, ${r.relation}, ${r.status}, ${r.notes})`
  }
  await touch(grantId)
}

export async function deleteReference(grantId: string, id: string): Promise<void> {
  await pg()`delete from nullroute.grant_references where id = ${id} and grant_id = ${grantId}`
  await touch(grantId)
}

export async function saveDocument(
  grantId: string,
  id: string | null,
  d: { title: string; kind: DocumentKind; body: string },
  by: string
): Promise<string> {
  const docId = id ?? `doc_${randomId(12)}`
  if (id) {
    await pg()`
      update nullroute.grant_documents set title = ${d.title}, kind = ${d.kind}, body = ${d.body},
        updated_at = now(), updated_by = ${by}
      where id = ${id} and grant_id = ${grantId}`
  } else {
    await pg()`
      insert into nullroute.grant_documents (id, grant_id, title, kind, body, updated_by)
      values (${docId}, ${grantId}, ${d.title}, ${d.kind}, ${d.body}, ${by})`
  }
  await touch(grantId)
  return docId
}

export async function deleteDocument(grantId: string, id: string): Promise<void> {
  await pg()`delete from nullroute.grant_documents where id = ${id} and grant_id = ${grantId}`
  await touch(grantId)
}

export async function saveTask(
  grantId: string,
  id: string | null,
  t: { position: number; title: string; detail: string; done: boolean }
): Promise<void> {
  if (id) {
    await pg()`
      update nullroute.grant_tasks set position = ${t.position}, title = ${t.title},
        detail = ${t.detail}, done = ${t.done}
      where id = ${id} and grant_id = ${grantId}`
  } else {
    await pg()`
      insert into nullroute.grant_tasks (id, grant_id, position, title, detail, done)
      values (${`t_${randomId(12)}`}, ${grantId}, ${t.position}, ${t.title}, ${t.detail}, ${t.done})`
  }
  await touch(grantId)
}

export async function setTaskDone(grantId: string, id: string, done: boolean): Promise<void> {
  await pg()`update nullroute.grant_tasks set done = ${done} where id = ${id} and grant_id = ${grantId}`
  await touch(grantId)
}

export async function deleteTask(grantId: string, id: string): Promise<void> {
  await pg()`delete from nullroute.grant_tasks where id = ${id} and grant_id = ${grantId}`
  await touch(grantId)
}

/** Whole days from today (UTC) to a calendar date; negative once it has passed. */
export function daysUntil(date: string, today = new Date()): number {
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) throw new Error(`Not a calendar date: ${date}`)
  const [, y, m, d] = match.map(Number) as [number, number, number, number]
  return Math.round((Date.UTC(y, m - 1, d) - start) / 86_400_000)
}
