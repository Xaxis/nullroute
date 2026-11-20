'use client'

import { useEffect, useId, useRef, useState, type SubmitEvent } from 'react'
import { CONTACT_ENDPOINT, CONTACT_TOPICS, REPO_URL } from '../lib/site'

type Field = 'name' | 'email' | 'topic' | 'message'
type State =
  | { kind: 'editing'; field?: Field; error?: string }
  | { kind: 'sending' }
  | { kind: 'sent'; email: string }

const INPUT =
  'mt-1.5 block w-full rounded-[6px] border border-border bg-paper px-3 py-2.5 font-sans text-[1rem] text-ink outline-none transition-colors placeholder:text-muted focus:border-ink aria-[invalid=true]:border-caution-line'

const LABEL = 'block font-sans text-[0.875rem] font-medium text-ink'

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
    const data = new FormData(event.currentTarget)
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
    setState({
      kind: 'editing',
      field,
      error:
        sentence(body) ??
        (res.status === 403
          ? 'This form only sends from nullroute.diy.'
          : 'Something went wrong on the server. Try again in a minute.'),
    })
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
  const bad = state.kind === 'editing' ? state.field : undefined
  const errorId = `${id}-error`
  const described = (f: Field) => (bad === f ? errorId : undefined)

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <label className={LABEL}>
          Name
          <input
            name="name"
            required
            maxLength={120}
            autoComplete="name"
            className={INPUT}
            aria-invalid={bad === 'name'}
            aria-describedby={described('name')}
          />
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
            aria-invalid={bad === 'email'}
            aria-describedby={described('email')}
          />
        </label>
      </div>
      <label className={LABEL}>
        About
        <select
          name="topic"
          required
          defaultValue="question"
          className={INPUT}
          aria-invalid={bad === 'topic'}
          aria-describedby={described('topic')}
        >
          {CONTACT_TOPICS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
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
          aria-invalid={bad === 'message'}
          aria-describedby={described('message')}
        />
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
          <p
            id={errorId}
            className="rounded-[6px] border border-caution-line bg-caution-fill px-3.5 py-2.5 text-[0.9375rem] text-caution"
          >
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
