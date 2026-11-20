/**
 * The two sign-in steps as plain Request → Response handlers. The answer to "send me a code" is the
 * same whether or not the address may sign in, so the endpoint can't be used to find out who can.
 *
 * Nobody else can lock the owner out. Limits count whoever is asking, never just the address: an
 * address from one network (or, for a browser the owner has signed in on, from that browser), and
 * each network. A code belongs to the browser that asked (browser.ts), so nobody elsewhere can
 * replace it or spend its tries. The ceilings that guard the address itself (codes a day, wrong
 * guesses a day, the 6-digit space against brute force) and the global one count only browsers the
 * owner hasn't signed in on, and a wrong guess counts only when there was a code to guess.
 */

import { audit } from '../audit'
import { randomToken, sha256 } from '../crypto'
import { env } from '../env'
import { askerCookie, askerOf, askerToken, CLEAR_ASKER, deviceCookie, knownDevice } from './browser'
import { checkCode, dropCode, issueCode, sixDigits } from './codes'
import { type Rule, room, take } from './limits'
import { codeMail, MailError, sendMail } from './mail'
import { isOwner } from './owners'
import { browserName, clientIp, ipPrefix, maskEmail, parseCode, parseEmail } from './people'
import { cookieFor, createSession } from './sessions'

const H = 3600

function json(status: number, body: unknown, headers?: HeadersInit): Response {
  const h = new Headers(headers)
  h.set('content-type', 'application/json')
  h.set('cache-control', 'no-store')
  return new Response(JSON.stringify(body), { status, headers: h })
}

function refuse(status: number, code: string, message: string, extra?: Record<string, unknown>) {
  return json(status, { error: code, message, ...extra })
}

/** Same-origin JSON POSTs only: blocks cross-site form posts and other origins outright. */
async function readBody(req: Request): Promise<Record<string, unknown> | Response> {
  const origin = req.headers.get('origin')
  const allowed = new Set([env().PUBLIC_ORIGIN, new URL(req.url).origin])
  if (!origin || !allowed.has(origin) || req.headers.get('sec-fetch-site') === 'cross-site') {
    return refuse(403, 'cross_site', 'This request has to come from the nullroute admin itself.')
  }
  if (!req.headers.get('content-type')?.includes('application/json')) {
    return refuse(415, 'bad_request', 'Send JSON.')
  }
  const text = await req.text()
  if (text.length > 4096) return refuse(413, 'bad_request', 'Too large.')
  try {
    const v: unknown = JSON.parse(text)
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  } catch {
    return refuse(400, 'bad_request', "That isn't JSON.")
  }
}

function slowDown(retryAfterSec: number): Response {
  const minutes = Math.ceil(retryAfterSec / 60)
  return refuse(
    429,
    'slow_down',
    retryAfterSec < 90
      ? `Wait ${String(retryAfterSec)} seconds and try again.`
      : `Too many tries. Wait about ${String(minutes)} minutes.`,
    { retry_after: retryAfterSec }
  )
}

/** What a browser the owner hasn't signed in on may spend on one address: codes, wrong guesses. */
const strangerCodes = (email: string): Rule[] => [
  { name: 'code-email-h', who: email, limit: 5, windowSec: H },
  { name: 'code-email-d', who: email, limit: 10, windowSec: 24 * H },
]
const strangerGuesses = (email: string): Rule[] => [
  { name: 'guess-email-h', who: email, limit: 10, windowSec: H },
  { name: 'guess-email-d', who: email, limit: 20, windowSec: 24 * H },
]

export async function requestCode(req: Request): Promise<Response> {
  const input = await readBody(req)
  if (input instanceof Response) return input
  const email = parseEmail(input.email)
  if (!email) return refuse(400, 'bad_email', "That doesn't look like an email address.")
  const ip = ipPrefix(clientIp(req.headers))
  const device = knownDevice(req, email, new Date())
  // The asker's own budget: this address from this browser the owner signed in on before, or else
  // from this network. Nobody elsewhere can spend it.
  const who = `${email} ${device ? `device:${device}` : ip}`
  const rules: Rule[] = [
    { name: 'code-gap', who, limit: 1, windowSec: 30 },
    { name: 'code-asker-h', who, limit: 5, windowSec: H },
    { name: 'code-asker-d', who, limit: 10, windowSec: 24 * H },
  ]
  if (!device) {
    rules.push(
      { name: 'code-ip-h', who: ip, limit: 20, windowSec: H },
      // Strangers together: what they can make an address's codes cost (mail; and 5 guesses a
      // code), and a global ceiling. Neither reaches a browser the owner has signed in on.
      ...strangerCodes(email),
      { name: 'code-all-h', who: 'all', limit: 600, windowSec: H }
    )
  }
  const taken = await take(rules)
  if (!taken.ok) return slowDown(taken.retryAfterSec)

  // The code will be this browser's alone. Everyone gets the cookie, owner or not.
  const token = askerToken(req)
  const answer = { 'set-cookie': askerCookie(token) }
  if (!isOwner(email)) {
    // No email goes out, and the answer is the one an allowed address gets.
    await audit({
      actor: null,
      action: 'auth.code_refused',
      detail: { email: maskEmail(email), ip },
    })
    return json(200, { sent: true }, answer)
  }
  const code = sixDigits()
  const asker = sha256(token)
  await issueCode(email, asker, code)
  try {
    await sendMail(codeMail(email, code, env().PUBLIC_ORIGIN, randomToken(16)))
  } catch (e) {
    await dropCode(email, asker)
    console.error('mail failed', e instanceof MailError ? e.message : e)
    return refuse(502, 'mail_failed', "The email couldn't be sent. Try again in a minute.")
  }
  await audit({ actor: null, action: 'auth.code_sent', detail: { email: maskEmail(email), ip } })
  return json(200, { sent: true }, answer)
}

export async function verifyCode(req: Request): Promise<Response> {
  const input = await readBody(req)
  if (input instanceof Response) return input
  const email = parseEmail(input.email)
  if (!email) return refuse(400, 'bad_email', "That doesn't look like an email address.")
  const code = parseCode(input.code)
  if (!code) return refuse(400, 'bad_code', 'Codes are six digits.')
  const ip = ipPrefix(clientIp(req.headers))
  const now = new Date()
  const device = knownDevice(req, email, now)
  if (!device) {
    // Every try counts against the network it comes from: its own budget.
    const taken = await take([{ name: 'guess-ip-h', who: ip, limit: 50, windowSec: H }])
    if (!taken.ok) return slowDown(taken.retryAfterSec)
    // The address's ceiling on strangers' wrong guesses (the brute-force bound). Read here, and
    // counted below only when there was a code to guess.
    const left = await room(strangerGuesses(email))
    if (!left.ok) return slowDown(left.retryAfterSec)
  }

  const asker = askerOf(req)
  const checked = asker ? await checkCode(email, asker, code) : ({ kind: 'none' } as const)
  if (checked.kind === 'none') {
    return refuse(
      410,
      'no_code',
      "There's no code waiting for this address. Codes last 10 minutes and work once: send a new one."
    )
  }
  if (checked.kind === 'wrong') {
    if (!device) await take(strangerGuesses(email))
    await audit({
      actor: null,
      action: 'auth.wrong_code',
      detail: { email: maskEmail(email), ip, left: checked.triesLeft },
    })
    if (checked.triesLeft === 0)
      return refuse(410, 'used_up', 'Too many wrong tries for that code. Send a new one.')
    const tries = checked.triesLeft === 1 ? '1 try' : `${String(checked.triesLeft)} tries`
    return refuse(400, 'wrong_code', `That code isn't right. ${tries} left.`, {
      tries_left: checked.triesLeft,
    })
  }
  // Access can be removed between sending the code and using it.
  if (!isOwner(email)) return refuse(410, 'no_code', "There's no code waiting for this address.")

  const { token, session } = await createSession(email, {
    userAgent: browserName(req.headers.get('user-agent')),
    ipPrefix: ip,
  })
  await audit({ actor: email, action: 'auth.signed_in', detail: { ip, session: session.id } })
  return json(200, { ok: true }, [
    ['set-cookie', cookieFor(token, session)],
    // From now on this browser is the owner's own: strangers' limits never reach it.
    ['set-cookie', deviceCookie(email, now)],
    ['set-cookie', CLEAR_ASKER],
  ])
}
