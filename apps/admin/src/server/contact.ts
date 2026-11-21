/**
 * The public contact form on nullroute.diy posts here, cross-origin, from a static page.
 *
 * - Only the site's own origins (SITE_ORIGINS) may post, and only JSON, so a form on another site
 *   cannot submit on a visitor's behalf.
 * - A hidden field and a minimum time on the page turn away the simplest bots, and they get the
 *   same answer a person does, so they learn nothing (Overlook's waitlist pattern).
 * - Every message is stored before it is mailed. A mail outage loses nothing; the admin's Messages
 *   page shows whether the notification went out.
 */
import { z } from 'zod'
import { BASE_PATH } from '@/base-path'
import { audit } from './audit'
import { type Rule, take } from './auth/limits'
import { esc, frame, MailError, sendMail } from './auth/mail'
import { clientIp, ipPrefix, maskEmail, parseEmail } from './auth/people'
import { randomId, randomToken } from './crypto'
import { pg } from './db'
import { env } from './env'

export const TOPICS = {
  question: 'A question',
  feedback: 'Feedback on the device or the docs',
  review: 'Reviewing or contributing',
  funding: 'Funding or grants',
  press: 'Press',
  other: 'Something else',
} as const

export type Topic = keyof typeof TOPICS

/** A stored topic's label. A topic retired from the form since still shows, as itself. */
export function topicLabel(topic: string): string {
  return Object.hasOwn(TOPICS, topic) ? TOPICS[topic as Topic] : topic
}

/** Less than this on the page, from load to send, is not a person typing. */
export const MIN_ELAPSED_MS = 2500

const schema = z.object({
  name: z.string().trim().min(1, 'Add your name.').max(120, 'Keep the name under 120 characters.'),
  email: z.string().trim().max(320),
  topic: z.enum(Object.keys(TOPICS) as [Topic, ...Topic[]], { message: 'Pick a topic.' }),
  message: z
    .string()
    .trim()
    .min(10, 'Write at least a sentence.')
    .max(5000, 'Keep it under 5000 characters.'),
  website: z.string().optional(),
  elapsed: z.number().optional(),
})

export interface Contact {
  name: string
  email: string
  topic: Topic
  message: string
}

export type Parsed =
  | { kind: 'ok'; contact: Contact }
  | { kind: 'bot' }
  | { kind: 'invalid'; field: string; message: string }

/** Validates a submission. Pure, so the rules are tested without a database or a network. */
export function parseContact(input: unknown): Parsed {
  const r = schema.safeParse(input)
  if (!r.success) {
    const issue = r.error.issues[0]
    return {
      kind: 'invalid',
      field: String(issue?.path[0] ?? 'form'),
      message: issue?.message ?? 'Check the form.',
    }
  }
  const v = r.data
  if ((v.website ?? '') !== '' || (v.elapsed ?? 0) < MIN_ELAPSED_MS) return { kind: 'bot' }
  const email = parseEmail(v.email)
  if (!email)
    return { kind: 'invalid', field: 'email', message: "That doesn't look like an email address." }
  return { kind: 'ok', contact: { name: v.name, email, topic: v.topic, message: v.message } }
}

function allowedOrigin(req: Request): string | undefined {
  const origin = req.headers.get('origin')
  return origin && env().SITE_ORIGINS.includes(origin) ? origin : undefined
}

function cors(origin: string): Record<string, string> {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '600',
    vary: 'Origin',
  }
}

function json(status: number, body: unknown, origin?: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...(origin ? cors(origin) : {}),
    },
  })
}

export function contactPreflight(req: Request): Response {
  const origin = allowedOrigin(req)
  if (!origin) return new Response(null, { status: 403 })
  return new Response(null, { status: 204, headers: cors(origin) })
}

const H = 3600

export async function submitContact(req: Request): Promise<Response> {
  const origin = allowedOrigin(req)
  if (!origin) return json(403, { error: 'cross_site', message: 'Send this from nullroute.diy.' })
  if (!req.headers.get('content-type')?.includes('application/json')) {
    return json(415, { error: 'bad_request', message: 'Send JSON.' }, origin)
  }
  const text = await req.text()
  if (text.length > 16_384) return json(413, { error: 'too_large', message: 'Too long.' }, origin)
  let input: unknown
  try {
    input = JSON.parse(text)
  } catch {
    return json(400, { error: 'bad_request', message: "That isn't JSON." }, origin)
  }

  const ip = ipPrefix(clientIp(req.headers))
  const rules: Rule[] = [
    { name: 'contact-ip-h', who: ip, limit: 5, windowSec: H },
    { name: 'contact-ip-d', who: ip, limit: 15, windowSec: 24 * H },
    { name: 'contact-all-d', who: 'all', limit: 200, windowSec: 24 * H },
  ]
  const taken = await take(rules)
  if (!taken.ok) {
    return json(
      429,
      {
        error: 'slow_down',
        message: 'Too many messages from here. Try again later.',
        retry_after: taken.retryAfterSec,
      },
      origin
    )
  }

  const parsed = parseContact(input)
  if (parsed.kind === 'invalid') {
    return json(400, { error: 'invalid', field: parsed.field, message: parsed.message }, origin)
  }
  // A bot gets the answer a person gets, and nothing is stored or sent.
  if (parsed.kind === 'bot') return json(200, { ok: true }, origin)

  const c = parsed.contact
  const id = `m_${randomId(14)}`
  await pg()`
    insert into nullroute.messages (id, name, email, topic, body, ip_prefix)
    values (${id}, ${c.name}, ${c.email}, ${c.topic}, ${c.message}, ${ip})`
  await audit({
    actor: null,
    action: 'contact.received',
    detail: { id, topic: c.topic, email: maskEmail(c.email) },
  })

  try {
    await sendMail(contactMail(id, c))
    await pg()`update nullroute.messages set mailed = true where id = ${id}`
  } catch (e) {
    // Stored already, so the message is safe; the admin shows it as not mailed.
    console.error('contact mail failed', e instanceof MailError ? e.message : e)
  }
  return json(200, { ok: true }, origin)
}

export function contactMail(id: string, c: Contact) {
  const origin = env().PUBLIC_ORIGIN
  const label = TOPICS[c.topic]
  const link = `${origin}${BASE_PATH}/messages#${id}`
  const text = `${label}, from ${c.name} <${c.email}>\n\n${c.message}\n\nReply to this email to answer them. In the admin: ${link}\n`
  const body = `<p style="margin:0 0 6px;font-size:13px;color:#5c626d;">${esc(label)}</p>
<p style="margin:0 0 16px;font-size:15px;color:#14161a;"><strong>${esc(c.name)}</strong> &lt;${esc(c.email)}&gt;</p>
<div style="margin:0 0 18px;padding:14px 16px;background:#efedea;border:1px solid #dedbd5;border-radius:8px;font-size:14px;line-height:1.6;color:#3d424b;white-space:pre-wrap;">${esc(c.message)}</div>
<p style="margin:0;font-size:13px;color:#5c626d;">Reply to this email to answer them, or <a href="${esc(link)}" style="color:#8a4409;">open it in the admin</a>.</p>`
  return {
    to: env().CONTACT_TO,
    from: env().CONTACT_FROM,
    replyTo: c.email,
    subject: `[nullroute.diy] ${label}: ${c.name}`,
    text,
    html: frame(`${label}: ${c.name}`, body, origin),
    key: `contact-${id}-${randomToken(6)}`,
  }
}
