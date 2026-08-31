import { type ReactElement, type ReactNode } from 'react'

/**
 * A selectable option with room for an honest description.
 *
 * Every choice on this device has a security consequence, and the description
 * is where that gets said. A radio button with a two-word label would make the
 * weakest option look equivalent to the strongest.
 */
export interface ChoiceProps {
  readonly title: string
  readonly description: string
  readonly selected: boolean
  readonly onSelect: () => void
  /**
   * A short label beside the title.
   *
   * `note` is the one to reach for by default. `ok` is the green this device
   * uses for a passing verification and `warn` is the amber it uses for money
   * leaving, and both mean something here: spending either on a procedural
   * remark is how a colour stops being read.
   */
  readonly tag?: { readonly text: string; readonly tone: 'ok' | 'warn' | 'note' }
  readonly testId?: string
  readonly children?: ReactNode
}

export function Choice(props: ChoiceProps): ReactElement {
  const { title, description, selected, onSelect, tag, testId, children } = props
  return (
    <button
      type="button"
      className="nr-choice"
      aria-pressed={selected}
      onClick={onSelect}
      data-testid={testId}
    >
      <span className="nr-choice__title">
        {title}
        {tag !== undefined && <span className={`nr-tag nr-tag--${tag.tone}`}>{tag.text}</span>}
      </span>
      <span className="nr-choice__desc">{description}</span>
      {children}
    </button>
  )
}
