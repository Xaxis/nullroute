/**
 * Email through Resend: sign-in codes, and contact-form notifications. Admission's mail.ts, with a
 * per-message sender and reply-to added for the contact form. There is no fallback sender: if
 * nullroute.diy cannot send, the request fails loudly rather than mail arriving from somewhere else.
 */
import { env } from '../env'
import { maskEmail } from './people'

export interface Mail {
  to: string
  subject: string
  text: string
  html: string
  /** Idempotency key: a retried send never delivers twice. */
  key: string
  /** Defaults to MAIL_FROM. */
  from?: string
  replyTo?: string
}

export class MailError extends Error {}

/** Sends one message, or writes it to MAIL_DIR on a local run. */
export async function sendMail(mail: Mail): Promise<void> {
  const dir = process.env.MAIL_DIR
  if (dir && process.env.NODE_ENV !== 'production') {
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(dir, { recursive: true })
    await writeFile(
      `${dir}/${String(Date.now())}-${mail.to}.txt`,
      `From: ${mail.from ?? env().MAIL_FROM}\nTo: ${mail.to}\n${mail.replyTo ? `Reply-To: ${mail.replyTo}\n` : ''}Subject: ${mail.subject}\n\n${mail.text}`
    )
    return
  }
  const from = mail.from ?? env().MAIL_FROM
  let res: Response
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env().RESEND_API_KEY}`,
        'content-type': 'application/json',
        'idempotency-key': `${mail.key}:${from}`,
      },
      body: JSON.stringify({
        from,
        to: [mail.to],
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
        // A different reference on every email keeps Gmail from threading them together.
        headers: { 'X-Entity-Ref-ID': mail.key },
      }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch (e) {
    throw new MailError(`Resend could not be reached (${e instanceof Error ? e.name : 'error'})`)
  }
  if (res.ok) return
  let name = ''
  try {
    const body = (await res.json()) as { name?: unknown }
    if (typeof body.name === 'string') name = body.name
  } catch {
    // The status alone says enough.
  }
  throw new MailError(`Resend answered ${String(res.status)} ${name} (to ${maskEmail(mail.to)})`)
}

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** Escapes text for HTML mail. Every character the pattern matches has an entity. */
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c)

const FONT =
  "'IBM Plex Sans',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif"
const MONO = "'DejaVu Sans Mono',ui-monospace,'SFMono-Regular',Menlo,Consolas,monospace"

/** The frame every message shares: the mark, a body, and where it came from. */
export function frame(title: string, body: string, origin: string): string {
  const host = new URL(origin).host
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="color-scheme" content="light dark"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#f5f4f1;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4f1;padding:40px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fbfaf8;border:1px solid #dedbd5;border-radius:12px;">
<tr><td style="padding:26px 32px 4px;font-family:${FONT};color:#14161a;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="width:18px;height:18px;border:2.5px solid #c2620f;border-radius:50%;"></td>
<td style="padding-left:10px;font-family:${MONO};font-size:15px;font-weight:500;">nullroute</td>
</tr></table>
</td></tr>
<tr><td style="padding:18px 32px 8px;font-family:${FONT};color:#14161a;">${body}</td></tr>
<tr><td style="padding:12px 32px 24px;font-family:${FONT};font-size:12px;color:#5c626d;">Sent by <a href="${esc(origin)}" style="color:#8a4409;text-decoration:none;">${esc(host)}</a></td></tr>
</table>
</td></tr>
</table>
</body></html>`
}

export function codeMail(to: string, code: string, origin: string, key: string): Mail {
  const lead = 'Your nullroute admin sign-in code:'
  const after =
    "It works once, for 10 minutes. If you didn't ask for it, ignore this email: nobody gets in without the code."
  const text = `${lead}\n\n    ${code}\n\n${after}\n\n${origin}\n`
  const body = `<p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:#3d424b;">${esc(lead)}</p>
<p style="margin:0 0 22px;"><span style="display:inline-block;padding:14px 22px;background:#efedea;border:1px solid #dedbd5;border-radius:8px;font-family:${MONO};font-size:30px;font-weight:600;letter-spacing:0.2em;color:#14161a;">${esc(code)}</span></p>
<p style="margin:0 0 6px;font-size:13px;line-height:1.55;color:#5c626d;">${esc(after)}</p>`
  return {
    to,
    subject: `${code} is your nullroute admin code`,
    text,
    html: frame(`${code} is your nullroute admin code`, body, origin),
    key,
  }
}
