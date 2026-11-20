'use client'

// Admission's apps/admission/src/app/signin/SignInForm.tsx (see UPSTREAM.md), in nullroute's style.

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/components/ui'

type Step = { kind: 'email' } | { kind: 'code'; email: string }

async function post(
  path: string,
  body: unknown
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'same-origin',
  })
  let data: Record<string, unknown> = {}
  try {
    data = (await res.json()) as Record<string, unknown>
  } catch {
    // A body that is not JSON leaves the default message.
  }
  return { ok: res.ok, status: res.status, data }
}

/** The server's own sentence when it sent one, the fallback otherwise. */
function messageOf(data: Record<string, unknown>, fallback: string): string {
  return typeof data.message === 'string' && data.message !== '' ? data.message : fallback
}

const INPUT =
  'mt-1.5 w-full rounded-lg border border-border bg-paper text-ink outline-none transition placeholder:text-muted focus:border-signal'
const PRIMARY =
  'mt-4 flex h-10 w-full items-center justify-center rounded-lg bg-ink text-[0.9375rem] font-medium text-paper transition hover:opacity-90 disabled:opacity-50'

export function SignInForm({ next }: { next: string }) {
  const [step, setStep] = useState<Step>({ kind: 'email' })
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const codeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => {
      setCooldown((c) => c - 1)
    }, 1000)
    return () => {
      clearTimeout(t)
    }
  }, [cooldown])

  useEffect(() => {
    if (step.kind === 'code') codeRef.current?.focus()
  }, [step])

  async function sendCode(address: string) {
    setBusy(true)
    setError(null)
    try {
      const r = await post('/api/auth/code', { email: address })
      if (!r.ok) {
        setError(messageOf(r.data, 'Something went wrong. Try again.'))
        if (typeof r.data.retry_after === 'number') setCooldown(r.data.retry_after)
        return
      }
      setStep({ kind: 'code', email: address.trim().toLowerCase() })
      setCode('')
      setCooldown(30)
    } catch {
      setError("Couldn't reach the server. Check your connection.")
    } finally {
      setBusy(false)
    }
  }

  async function verify(value: string) {
    if (step.kind !== 'code') return
    setBusy(true)
    setError(null)
    try {
      const r = await post('/api/auth/verify', { email: step.email, code: value })
      if (r.ok) {
        window.location.assign(next)
        return
      }
      setError(messageOf(r.data, "That didn't work. Try again."))
      setCode('')
      codeRef.current?.focus()
    } catch {
      setError("Couldn't reach the server. Check your connection.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-7">
      {step.kind === 'email' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!busy && email.trim()) void sendCode(email)
          }}
        >
          <h1 className="font-display text-[1.375rem] font-semibold text-ink">Sign in</h1>
          <p className="mt-1 text-[0.875rem] text-muted">We&apos;ll email you a six-digit code.</p>
          <label
            htmlFor="email"
            className="mt-5 block text-[0.75rem] font-medium tracking-wide text-muted uppercase"
          >
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            autoFocus
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
            }}
            placeholder="you@example.com"
            className={cn(INPUT, 'h-10 px-3 text-[0.9375rem]')}
          />
          <button type="submit" disabled={busy || cooldown > 0} className={PRIMARY}>
            {busy ? 'Sending...' : cooldown > 0 ? `Wait ${String(cooldown)}s` : 'Email me a code'}
          </button>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!busy && code.length === 6) void verify(code)
          }}
        >
          <h1 className="font-display text-[1.375rem] font-semibold text-ink">Check your email</h1>
          <p className="mt-1 text-[0.875rem] text-muted">
            If <span className="font-medium text-ink">{step.email}</span> may sign in, a code is on
            its way. It works once, for 10 minutes.
          </p>
          <label
            htmlFor="code"
            className="mt-5 block text-[0.75rem] font-medium tracking-wide text-muted uppercase"
          >
            Code
          </label>
          <input
            id="code"
            ref={codeRef}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            value={code}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, '').slice(0, 6)
              setCode(v)
              if (v.length === 6 && !busy) void verify(v)
            }}
            placeholder="000000"
            className={cn(
              INPUT,
              'h-12 text-center font-hash text-[1.625rem] tracking-[0.45em]',
              busy && 'opacity-60'
            )}
          />
          <button type="submit" disabled={busy || code.length !== 6} className={PRIMARY}>
            {busy ? 'Checking...' : 'Sign in'}
          </button>
          <div className="mt-4 flex items-center justify-between text-[0.8125rem]">
            <button
              type="button"
              onClick={() => {
                setStep({ kind: 'email' })
                setError(null)
              }}
              className="text-muted hover:text-ink"
            >
              Different email
            </button>
            <button
              type="button"
              disabled={busy || cooldown > 0}
              onClick={() => void sendCode(step.email)}
              className="text-muted hover:text-ink disabled:hover:text-muted"
            >
              {cooldown > 0 ? `Send a new code in ${String(cooldown)}s` : 'Send a new code'}
            </button>
          </div>
        </form>
      )}
      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-caution-line bg-caution-fill px-3 py-2 text-[0.875rem] text-caution"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}
