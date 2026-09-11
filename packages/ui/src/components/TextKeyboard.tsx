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
  /**
   * Whether what is typed is a secret.
   *
   * DEFAULTS TO TRUE, because the first caller was the passphrase gate and a
   * passphrase on a lit panel is readable across whatever room the device is
   * in. Revealing it is then a deliberate act.
   *
   * FALSE IS NOT A CONVENIENCE. The screen that checks somebody else's proof
   * uses this keyboard for three values that are not secrets at all: an
   * address, a signature, and the message they signed. Masking them put a row
   * of bullets under a label reading "exactly what they signed, character for
   * character", on the screen whose whole method is comparing characters, and
   * under a failure message that tells the user to do exactly that. The
   * instruction and the display contradicted each other and the display won.
   *
   * When this is false there is nothing to hide, so the Show key goes with it.
   */
  readonly secret?: boolean
  /**
   * What the readout says before anything is typed.
   *
   * Defaults to "Nothing typed", which is right when a label above already
   * says which field this is. When it does not, the readout is the only thing
   * that can, and a separate label costs 24px on a screen whose keyboard needs
   * 190 of a 287px body.
   */
  readonly placeholder?: string
  readonly testId?: string
}

/**
 * Rows as arrays of characters rather than strings to be split.
 *
 * Splitting a string by code unit mishandles anything outside the basic plane,
 * and a keyboard is the last place to be casually wrong about characters. These
 * are all ASCII, so nothing would break today, but writing them out means the
 * question never arises and a future row of accented or non-Latin keys cannot
 * introduce the bug silently.
 */
const LOWER: readonly (readonly string[])[] = [
  ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],
  ['k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't'],
  ['u', 'v', 'w', 'x', 'y', 'z'],
]
const UPPER: readonly (readonly string[])[] = [
  ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'],
  ['K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T'],
  ['U', 'V', 'W', 'X', 'Y', 'Z'],
]
/**
 * The symbols, on TWO PAGES, and the reason is a row of pixels.
 *
 * THE DEFECT THIS FIXES. All 42 were one layer. At 14 columns that is exactly
 * three rows of symbols, which leaves the wide keys a fourth, so the symbol
 * layer was 194px where the letter layer is 144. Five screens did not have the
 * extra 50: measured against an action bar at 407, the bottom row of the symbol
 * keys sat at 455 on the unlock gate, on both passphrase panels, and at 444 on
 * the two that confirm an erase. The unlock gate is the first screen anybody
 * touches on a provisioned device, and a passphrase with a digit in it is the
 * path that screen's own strength estimate rewards.
 *
 * NOT FIXED BY REMOVING SYMBOLS, and this is the important half. A character
 * dropped from this keyboard is a character nobody can type, and somebody whose
 * passphrase contains it can never open their wallet again. There is no
 * recovery from that and no way for them to find out why. Every one of the 42
 * is still here, in at most one more tap than before.
 *
 * 21 and 21, so both pages are two rows of keys and the wide row lands in the
 * same place on each. A page that was one row shorter would move Space and Back
 * up as somebody switched pages, which is the rule `.nr-kb__keys` already
 * states about letters that relocate under a finger.
 *
 * SPLIT BY WHAT PEOPLE TYPE, not down the middle of the old list. The first
 * page is the digits and the punctuation that appears in a sentence, because
 * the advice on the passphrase screen is to use one and a wallet on this device
 * is called something like "Cold storage, three of five". Splitting it in list
 * order put the comma and the apostrophe behind a page turn and left ^ and &
 * on the first page, which is backwards. The second page is the rest, all of it
 * still one tap from the first.
 */
const SYMBOLS_ONE: readonly (readonly string[])[] = [
  ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'],
  ['.', ',', "'", '"', '!', '?', '-', ':', ';', '_'],
  ['@'],
]
const SYMBOLS_TWO: readonly (readonly string[])[] = [
  ['#', '$', '%', '^', '&', '*', '(', ')', '=', '+'],
  ['[', ']', '{', '}', '|', '<', '>', '/', '~', '`'],
  ['\\'],
]

type Layer = 'lower' | 'upper' | 'symbols' | 'symbols2'

export function TextKeyboard(props: TextKeyboardProps): ReactElement {
  const { value, onChange, onSubmit, secret = true, placeholder = 'Nothing typed', testId } = props

  const [layer, setLayer] = useState<Layer>('lower')
  const [revealed, setRevealed] = useState(false)

  const rows =
    layer === 'lower'
      ? LOWER
      : layer === 'upper'
        ? UPPER
        : layer === 'symbols'
          ? SYMBOLS_ONE
          : SYMBOLS_TWO
  const onSymbols = layer === 'symbols' || layer === 'symbols2'

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
          <span className="nr-hint">{placeholder}</span>
        ) : !secret || revealed ? (
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
          row.map((character) => (
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

        {/* THE WIDE KEYS ALWAYS START A ROW OF THEIR OWN.

            `grid-column: 1 / span 2` rather than `span 2`, so auto-placement
            cannot tuck the first of them into whatever cells the layer above
            happened to leave. Letting them flow moves every key after it two
            columns between the letter layer and the symbol layer: measured on
            the unlock gate, Space went from x=127 to x=20 and Show landed
            exactly where Back had been, so reaching for Back by memory after
            tapping ?123 reveals the passphrase instead of deleting a
            character. See `.nr-kb__key--row`. */}
        {/* ONE KEY AT COLUMN 1, AND IT IS THE ONLY ONE THAT CHANGES.

            The wide row has fourteen columns to spend and, on a screen whose
            caller wants a return key, exactly fourteen to spend: Shift, the
            layer key, Space at four, Back, Show and Return. Adding a second
            symbol page had to come out of that budget or the row wrapped and
            the keyboard grew by 50px, which is the whole defect this is fixing.

            It comes out of Shift, which is the one key on a symbol layer with
            nothing to do that is not already one tap away: from here, abc then
            Shift. NO CHARACTER BECOMES UNTYPEABLE, which is the only line that
            matters on this component. Every other key stays in the same cells
            on every layer, so nothing relocates under a finger. */}
        {onSymbols ? (
          <button
            type="button"
            className="nr-kb__key nr-kb__key--wide nr-kb__key--row"
            aria-pressed={layer === 'symbols2'}
            onClick={() => {
              setLayer(layer === 'symbols' ? 'symbols2' : 'symbols')
            }}
            data-testid="pk-symbols-more"
          >
            {layer === 'symbols' ? '=\\{}' : '!@#$'}
          </button>
        ) : (
          <button
            type="button"
            className="nr-kb__key nr-kb__key--wide nr-kb__key--row"
            aria-pressed={layer === 'upper'}
            onClick={() => {
              setLayer(layer === 'upper' ? 'lower' : 'upper')
            }}
            data-testid="pk-shift"
          >
            Shift
          </button>
        )}
        <button
          type="button"
          className="nr-kb__key nr-kb__key--wide"
          aria-pressed={onSymbols}
          onClick={() => {
            setLayer(onSymbols ? 'lower' : 'symbols')
          }}
          data-testid="pk-symbols"
        >
          {onSymbols ? 'abc' : '?123'}
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
        {/* Only when there is something to hide. A Show key over a plainly
            visible address is a control that does nothing, and this keyboard
            has no room for one. */}
        {secret && (
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
        )}
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
