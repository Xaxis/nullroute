/**
 * A hash, rendered so a person can actually compare it against another screen.
 *
 * Spec: ui.components.hash
 *
 * Chunked in groups of four, monospace, with a font stack chosen for
 * unambiguous glyphs. The abbreviated form is first eight and last eight
 * characters, which is what someone will genuinely check; a full 64 characters
 * gets skimmed, and a skimmed hash is worse than an abbreviated one because it
 * feels like it was read.
 *
 * Tapping expands to the full value. The expanded form is also chunked, because
 * comparing 64 unbroken characters is where transposition errors live.
 */

import { type ReactElement } from 'react'

export interface HashProps {
  readonly value: string
  readonly expanded?: boolean
  readonly onToggle?: (() => void) | undefined
  readonly testId?: string
}

/** Groups of four, which is the span most people can hold while glancing away. */
export function chunk(value: string, size = 4): string {
  const groups: string[] = []
  for (let i = 0; i < value.length; i += size) groups.push(value.slice(i, i + size))
  return groups.join(' ')
}

export function abbreviate(value: string): string {
  if (value.length <= 20) return value
  return `${value.slice(0, 8)}...${value.slice(-8)}`
}

export function Hash(props: HashProps): ReactElement {
  const { value, expanded = false, onToggle, testId } = props
  const shown = expanded ? chunk(value) : chunk(value.slice(0, 8)) + ' ... ' + chunk(value.slice(-8))

  if (onToggle === undefined) {
    return (
      <span className="nr-hash nr-mono" data-testid={testId}>
        {shown}
      </span>
    )
  }

  return (
    <button
      type="button"
      className="nr-hash nr-hash--toggle nr-mono"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-label={expanded ? 'Collapse hash' : 'Show the full hash'}
      data-testid={testId}
    >
      {shown}
    </button>
  )
}
