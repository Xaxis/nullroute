import { type ButtonHTMLAttributes, type ReactElement } from 'react'

/**
 * A button.
 *
 * `danger` exists so an irreversible action never wears the primary style. The
 * device has several of those (confirming a backup, wiping, signing), and the
 * one thing they must not look like is the obvious next step.
 */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: 'primary' | 'ghost' | 'danger'
  readonly wide?: boolean
  readonly testId?: string
}

export function Button(props: ButtonProps): ReactElement {
  const { variant = 'ghost', wide = false, testId, className, ...rest } = props
  return (
    <button
      type="button"
      className={[
        'nr-button',
        `nr-button--${variant}`,
        wide ? 'nr-button--wide' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-testid={testId}
      {...rest}
    />
  )
}
