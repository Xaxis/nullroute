import { type ReactElement, useCallback, useState } from 'react'

/**
 * A general keyboard, for passphrases and anything else typed freely.
 *
 * Spec: ui.screens.keyboard
 *
 * Separate from the word keyboard because the two have opposite jobs. That one
 * narrows a finger down to a list of 2048 known words. This one must accept any
 * string at all, including one the user will never be able to type again if
 * they get it wrong, and it cannot help them.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. No autocorrect, no capitalisation of the
 * first letter, no suggestions, no history. A passphrase is not prose, and a
 * keyboard that quietly changed a character would produce a different wallet
 * with no error and no way to find out which character it altered. Every
 * transformation here is one the user asked for by tapping shift.
 *
 * The value is hidden by default and revealed on request, because the screen is
 * being used in whatever room the user is in and a passphrase on a lit panel is
 * readable across it. Revealing is a deliberate act, and length is shown either
 * way so a user can at least tell whether a key registered.
 */

export interface TextKeyboardProps {
  readonly value: string
  readonly onChange: (value: string) => void
  /** Optional, so a caller can make the on-screen return key submit. */
  readonly onSubmit?: () => void
  readonly testId?: string
}

const LOWER = ['abcdefghij', 'klmnopqrst', 'uvwxyz'] as const
const UPPER = ['ABCDEFGHIJ', 'KLMNOPQRST', 'UVWXYZ'] as const
const SYMBOLS = ['0123456789', "!@#$%^&*()", "-_=+[]{}|;", ":',.<>/?~`", '"\\'] as const

type Layer = 'lower' | 'upper' | 'symbols'

export function TextKeyboard(props: TextKeyboardProps): ReactElement {
  const { value, onChange, onSubmit, testId } = props

  const [layer, setLayer] = useState<Layer>('lower')
  const [revealed, setRevealed] = useState(false)

  const rows = layer === 'lower' ? LOWER : layer === 'upper' ? UPPER : SYMBOLS

  const press = useCallback(
    (character: string) => {
      onChange(value + character)
      // Shift is one-shot, the way it is on every phone. A sticky shift makes
      // people type several capitals when they meant one, and in a passphrase
      // field they cannot see what happened.
      if (layer === 'upper') setLayer('lower')
    },
    [value, onChange, layer]
  )

  return (
    <div className="nr-kb" data-testid={testId}>
      <div className="nr-pk__value" data-testid="pk-value">
        {value.length === 0 ? (
          <span className="nr-hint">Nothing typed</span>
        ) : revealed ? (
          <span data-testid="pk-plain">{value}</span>
        ) : (
          <span className="nr-pk__dots" data-testid="pk-hidden">
            {'•'.repeat(value.length)}
          </span>
        )}
        <div className="nr-spacer" />
        <span className="nr-hint" data-testid="pk-length">
          {value.length}
        </span>
      </div>

      <div className="nr-kb__keys">
        {rows.map((row) =>
          [...row].map((character) => (
            <button
              key={character}
              type="button"
              className="nr-kb__key"
              onClick={() => {
                press(character)
              }}
              data-testid={`pk-key-${character}`}
            >
              {character}
            </button>
          ))
        )}

        <button
          type="button"
          className="nr-kb__key nr-kb__key--wide"
          aria-pressed={layer === 'upper'}
          onClick={() => {
            setLayer(layer === 'upper' ? 'lower' : 'upper')
          }}
          data-testid="pk-shift"
        >
          Shift
        </button>
        <button
          type="button"
          className="nr-kb__key nr-kb__key--wide"
          aria-pressed={layer === 'symbols'}
          onClick={() => {
            setLayer(layer === 'symbols' ? 'lower' : 'symbols')
          }}
          data-testid="pk-symbols"
        >
          {layer === 'symbols' ? 'abc' : '?123'}
        </button>
        <button
          type="button"
          className="nr-kb__key nr-kb__key--space"
          onClick={() => {
            press(' ')
          }}
          data-testid="pk-space"
        >
          Space
        </button>
        <button
          type="button"
          className="nr-kb__key nr-kb__key--wide"
          disabled={value.length === 0}
          onClick={() => {
            onChange(value.slice(0, -1))
          }}
          data-testid="pk-back"
        >
          Back
        </button>
        <button
          type="button"
          className="nr-kb__key nr-kb__key--wide"
          aria-pressed={revealed}
          onClick={() => {
            setRevealed(!revealed)
          }}
          data-testid="pk-reveal"
        >
          {revealed ? 'Hide' : 'Show'}
        </button>
        {onSubmit !== undefined && (
          <button
            type="button"
            className="nr-kb__key nr-kb__key--wide"
            onClick={onSubmit}
            data-testid="pk-enter"
          >
            Enter
          </button>
        )}
      </div>
    </div>
  )
}
