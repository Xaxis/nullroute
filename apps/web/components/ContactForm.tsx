'use client'

import { useEffect, useId, useRef, useState, type SubmitEvent } from 'react'
import { CONTACT_ENDPOINT, CONTACT_TOPICS, REPO_URL } from '../lib/site'

type Field = 'name' | 'email' | 'topic' | 'message'
type Problems = Partial<Record<Field, string>>
type State =
  | { kind: 'editing'; problems?: Problems; error?: string }
  | { kind: 'sending' }
  | { kind: 'sent'; email: string }

// Focus is an orange edge and halo rather than the site's offset outline,
// whose small radius would square off the field's corners while it is focused.
const INPUT =
  'mt-1.5 block w-full rounded-[6px] border border-border bg-paper px-3 py-2.5 font-sans text-[1rem] font-normal text-ink outline-none transition-[border-color,box-shadow] placeholder:text-muted focus:border-signal focus:ring-[3px] focus:ring-signal/25 aria-[invalid=true]:border-caution-line'

const LABEL = 'block font-sans text-[0.875rem] font-medium text-ink'

const ORDER: readonly Field[] = ['name', 'email', 'topic', 'message']

/**
 * What is wrong with each field, in words, checked before anything is sent.
 * The browser's own check showed a bubble that vanished on the next keypress
 * and marked nothing, so the form opts out of it and says this instead.
 */
function check(form: HTMLFormElement): Problems {
  const field = (name: Field) => form.elements.namedItem(name)
  const value = (name: Field) => {
    const el = field(name)
    return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
      ? el.value.trim()
      : ''
  }
  const problems: Problems = {}
  if (value('name') === '') problems.name = 'Enter your name, or what you would like to be called.'
  const email = field('email')
  if (value('email') === '') problems.email = 'Enter the address a reply should go to.'
  else if (email instanceof HTMLInputElement && !email.checkValidity())
    problems.email = 'That address is missing something. It should look like name@example.com.'
  const message = value('message')
  if (message === '') problems.message = 'Write your message.'
  else if (message.length < 10) problems.message = 'A little more, please: at least 10 characters.'
  return problems
}

/** The server's own sentence when it sent one. */
function sentence(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('message' in body)) return undefined
  return typeof body.message === 'string' && body.message !== '' ? body.message : undefined
}

function fieldOf(body: unknown): Field | undefined {
  if (typeof body !== 'object' || body === null || !('field' in body)) return undefined
  const f = body.field
  return f === 'name' || f === 'email' || f === 'topic' || f === 'message' ? f : undefined
}

/**
 * Sends a message to the admin console, which stores it and emails the
 * maintainer. A plain fetch, not a form post: the site's CSP has
 * `form-action 'none'`, and the reply decides what the page says next.
 */
export function ContactForm() {
  const id = useId()
  const [state, setState] = useState<State>({ kind: 'editing' })
  // When the page became usable. A send faster than a person could type is
  // treated as a bot by the server, which answers it as if it had been sent.
  const shownAt = useRef<number | undefined>(undefined)
  useEffect(() => {
    shownAt.current = performance.now()
  }, [])

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const problems = check(form)
    const first = ORDER.find((f) => problems[f] !== undefined)
    if (first !== undefined) {
      setState({ kind: 'editing', problems })
      const el = form.elements.namedItem(first)
      if (el instanceof HTMLElement) el.focus()
      return
    }
    const data = new FormData(form)
    const text = (k: string) => {
      const v = data.get(k)
      return typeof v === 'string' ? v : ''
    }
    const email = text('email').trim()
    setState({ kind: 'sending' })
    let res: Response
    try {
      res = await fetch(CONTACT_ENDPOINT, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: text('name'),
          email,
          topic: text('topic'),
          message: text('message'),
          website: text('website'),
          elapsed: Math.round(performance.now() - (shownAt.current ?? performance.now())),
        }),
      })
    } catch {
      setState({
        kind: 'editing',
        error: 'The message could not reach the server. Check your connection and try again.',
      })
      return
    }
    let body: unknown = undefined
    try {
      body = await res.json()
    } catch {
      // A reply without a JSON body falls through to the generic sentence below.
    }
    if (res.ok) {
      setState({ kind: 'sent', email })
      return
    }
    const field = res.status === 400 ? fieldOf(body) : undefined
    const said =
      sentence(body) ??
      (res.status === 403
        ? 'This form only sends from nullroute.diy.'
        : 'Something went wrong on the server. Try again in a minute.')
    // A refusal that names a field is shown under that field; anything else
    // is about the send, and goes beside the button.
    setState(
      field === undefined
        ? { kind: 'editing', error: said }
        : { kind: 'editing', problems: { [field]: said } }
    )
  }

  if (state.kind === 'sent') {
    return (
      <div
        role="status"
        className="rounded-[8px] border border-verify-line bg-verify-fill px-5 py-5"
      >
        <p className="font-display text-[1.375rem] leading-snug text-ink">Sent. Thank you.</p>
        <p className="mt-2 text-[1rem] leading-relaxed text-body">
          Any reply goes to <span className="font-medium text-ink">{state.email}</span>.
        </p>
        <button
          type="button"
          className="btn btn-secondary btn-sm mt-4"
          onClick={() => {
            shownAt.current = performance.now()
            setState({ kind: 'editing' })
          }}
        >
          Write another
        </button>
      </div>
    )
  }

  const sending = state.kind === 'sending'
  const error = state.kind === 'editing' ? state.error : undefined
  const problems: Problems = state.kind === 'editing' ? (state.problems ?? {}) : {}
  const errorId = (f: Field) => `${id}-${f}-error`
  const invalid = (f: Field) => ({
    'aria-invalid': problems[f] !== undefined,
    'aria-describedby': problems[f] === undefined ? undefined : errorId(f),
  })
  const problem = (f: Field) =>
    problems[f] === undefined ? null : (
      <span id={errorId(f)} className="mt-1.5 block text-[0.875rem] font-normal text-caution">
        {problems[f]}
      </span>
    )

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      onInput={(e) => {
        // A field's complaint goes as soon as it is edited, not at the next send.
        const t = e.target
        if (!(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) return
        const name = t.name as Field
        setState((s) => {
          if (s.kind !== 'editing' || s.problems?.[name] === undefined) return s
          const rest: Problems = Object.fromEntries(
            Object.entries(s.problems).filter(([field]) => field !== name)
          )
          return { ...s, problems: rest }
        })
      }}
      noValidate
      className="space-y-5"
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <label className={LABEL}>
          Name
          <input
            name="name"
            required
            maxLength={120}
            autoComplete="name"
            className={INPUT}
            {...invalid('name')}
          />
          {problem('name')}
        </label>
        <label className={LABEL}>
          Email
          <input
            name="email"
            type="email"
            required
            maxLength={320}
            autoComplete="email"
            inputMode="email"
            className={INPUT}
            {...invalid('email')}
          />
          {problem('email')}
        </label>
      </div>
      <label className={LABEL}>
        About
        <select
          name="topic"
          required
          defaultValue="question"
          className={INPUT}
          {...invalid('topic')}
        >
          {CONTACT_TOPICS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {problem('topic')}
      </label>
      <label className={LABEL}>
        Message
        <textarea
          name="message"
          required
          minLength={10}
          maxLength={5000}
          rows={7}
          className={`${INPUT} min-h-40 resize-y leading-relaxed`}
          {...invalid('message')}
        />
        {problem('message')}
      </label>
      {/* Left empty by people, who never see it. Off-screen rather than
          display:none, because some bots skip fields that are not rendered. */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div aria-live="polite">
        {error ? (
          <p className="rounded-[6px] border border-caution-line bg-caution-fill px-3.5 py-2.5 text-[0.9375rem] text-caution">
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <button type="submit" className="btn btn-primary" disabled={sending}>
          {sending ? 'Sending...' : 'Send message'}
        </button>
        <p className="text-[0.875rem] text-muted">
          Bugs and feature requests are better as{' '}
          <a className="link" href={`${REPO_URL}/issues`}>
            GitHub issues
          </a>
          .
        </p>
      </div>
      <noscript>
        <p className="text-[0.9375rem] text-caution">
          This form needs JavaScript to send. Without it, open an issue on GitHub instead.
        </p>
      </noscript>
    </form>
  )
}
