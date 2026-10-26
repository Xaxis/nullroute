import type { ReactNode } from 'react'

/**
 * A mechanism drawn as its steps, left to right on a wide screen and top to
 * bottom on a narrow one.
 *
 * HTML, NOT A PICTURE. Each step holds real values from this build (a file
 * count, a hash, a word list), and text in an image cannot be selected,
 * searched, read by a screen reader or kept in step with the repository. The
 * arrows are the only decoration, and they carry the one thing a diagram adds
 * to the prose: the order.
 */
export function Flow({
  steps,
  label,
}: {
  steps: readonly { title: string; body: ReactNode }[]
  label: string
}) {
  return (
    <ol aria-label={label} className="grid gap-2 lg:grid-flow-col lg:auto-cols-fr lg:gap-0">
      {steps.map((step, i) => (
        <li key={step.title} className="relative min-w-0 lg:flex lg:items-stretch">
          <div className="h-full min-w-0 flex-1 rounded-[4px] border border-line bg-surface px-3.5 py-3">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[0.75rem] text-signal tabular-nums">
                {String(i + 1)}
              </span>
              <span className="font-sans text-[0.875rem] font-semibold text-ink">{step.title}</span>
            </div>
            <div className="mt-1.5 font-sans text-[0.8125rem] leading-relaxed text-body break-words">
              {step.body}
            </div>
          </div>
          {i < steps.length - 1 && (
            <span
              aria-hidden="true"
              className="flex justify-center py-0.5 text-muted lg:items-center lg:px-1.5 lg:py-0"
            >
              <span className="lg:hidden">&darr;</span>
              <span className="hidden lg:inline">&rarr;</span>
            </span>
          )}
        </li>
      ))}
    </ol>
  )
}
