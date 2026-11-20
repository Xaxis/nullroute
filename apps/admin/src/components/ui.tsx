import type { ComponentProps, ReactNode } from 'react'

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export function PageHeader({
  title,
  lead,
  actions,
}: {
  title: string
  lead?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-[1.75rem] leading-tight font-semibold text-ink">
          {title}
        </h1>
        {lead ? <p className="mt-1.5 max-w-2xl text-[0.9375rem] text-muted">{lead}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  )
}

export function Card({
  title,
  aside,
  children,
  className,
  id,
}: {
  title?: ReactNode
  aside?: ReactNode
  children: ReactNode
  className?: string
  id?: string
}) {
  return (
    <section id={id} className={cn('rounded-xl border border-line bg-surface', className)}>
      {title ? (
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="text-[0.8125rem] font-semibold tracking-wide text-ink uppercase">
            {title}
          </h2>
          {aside ? <div className="text-[0.8125rem] text-muted">{aside}</div> : null}
        </div>
      ) : null}
      <div className="p-5">{children}</div>
    </section>
  )
}

type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'accent'

const TONES: Record<Tone, string> = {
  neutral: 'border-border text-body bg-sunk',
  good: 'border-verify-line text-verify bg-verify-fill',
  warn: 'border-signal text-link bg-sunk',
  bad: 'border-caution-line text-caution bg-caution-fill',
  accent: 'border-signal text-ink bg-surface',
}

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.75rem] leading-5 font-medium whitespace-nowrap',
        TONES[tone]
      )}
    >
      {children}
    </span>
  )
}

const BUTTON = {
  primary: 'bg-ink text-paper hover:opacity-90',
  secondary: 'border border-border bg-surface text-ink hover:bg-sunk',
  danger: 'border border-caution-line text-caution hover:bg-caution-fill',
  ghost: 'text-muted hover:text-ink hover:bg-sunk',
} as const

export function Button({
  variant = 'secondary',
  className,
  ...props
}: ComponentProps<'button'> & { variant?: keyof typeof BUTTON }) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3.5 text-[0.875rem] font-medium transition disabled:opacity-50',
        BUTTON[variant],
        className
      )}
    />
  )
}

export function LinkButton({
  variant = 'secondary',
  className,
  ...props
}: ComponentProps<'a'> & { variant?: keyof typeof BUTTON }) {
  return (
    <a
      {...props}
      className={cn(
        'inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3.5 text-[0.875rem] font-medium transition',
        BUTTON[variant],
        className
      )}
    />
  )
}

const FIELD =
  'w-full rounded-lg border border-border bg-paper px-3 text-[0.875rem] text-ink outline-none transition placeholder:text-muted focus:border-signal'

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1.5 block text-[0.75rem] font-medium tracking-wide text-muted uppercase">
        {label}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-[0.75rem] text-muted">{hint}</span> : null}
    </label>
  )
}

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input {...props} className={cn(FIELD, 'h-9', className)} />
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea {...props} className={cn(FIELD, 'min-h-24 py-2 leading-relaxed', className)} />
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select {...props} className={cn(FIELD, 'h-9 pr-8', className)} />
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-[0.875rem] text-muted">
      {children}
    </p>
  )
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[0.75rem] font-medium tracking-wide text-muted uppercase">{label}</div>
      <div className="mt-1 truncate text-[1.375rem] leading-tight font-semibold text-ink">
        {value}
      </div>
      {sub ? <div className="mt-0.5 truncate text-[0.8125rem] text-muted">{sub}</div> : null}
    </div>
  )
}

/** A date as "20 Nov 2026"; a calendar date string is not moved by time zones. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return ''
  const d = typeof value === 'string' ? new Date(`${value.slice(0, 10)}T12:00:00Z`) : value
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function formatWhen(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  })
}
