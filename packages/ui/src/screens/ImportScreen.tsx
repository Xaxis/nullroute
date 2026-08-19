import { type ReactElement, useState } from 'react'
import { Screen } from '../components/Screen.js'
import { Button } from '../components/Button.js'
import { WordKeyboard } from '../components/WordKeyboard.js'
import { TextKeyboard } from '../components/TextKeyboard.js'

/**
 * Import an existing mnemonic.
 *
 * Spec: ui.screens.import
 *
 * The passphrase field carries the warning that matters, next to the field
 * rather than in a help page: a wrong passphrase does not error. It derives a
 * valid, different, empty wallet. The fingerprint shown after import is the
 * only signal a user will ever get, so the copy says to check it.
 *
 * Entry is by on-screen keyboard, because the device is a touchscreen and has
 * no other input. The word keyboard is the default and the textarea is behind a
 * disclosure, for a workstation with a real keyboard and for pasting during
 * development. Both write to the same value, so there is one thing to be wrong.
 */

export interface ImportScreenProps {
  readonly onImport: (mnemonic: string, passphrase: string) => Promise<void>
  readonly onCancel: () => void
  /** Where this screen sits in a journey, when it is part of one. */
  readonly steps?: ReactElement | null
  readonly banner?: ReactElement | null
}

/** The word counts BIP-39 defines. Anything else is a typo, not a wallet. */
const VALID_LENGTHS = [12, 15, 18, 21, 24]

export function ImportScreen(props: ImportScreenProps): ReactElement {
  const { onImport, onCancel, steps, banner } = props
  const [words, setWords] = useState<readonly string[]>([])
  const [passphrase, setPassphrase] = useState('')
  const [showPassphrase, setShowPassphrase] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const mnemonic = words.join(' ')
  const plausible = VALID_LENGTHS.includes(words.length)

  // The next valid length to aim at, so the counter says "of 12" rather than
  // leaving a user to remember which counts are legal.
  const target = VALID_LENGTHS.find((n) => n >= words.length) ?? 24

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await onImport(mnemonic, passphrase)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen
      title="Import a mnemonic"
      subtitle="BIP-39, 12 to 24 words."
      banner={banner}
      steps={steps}
      testId="import-screen"
      actions={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <div className="nr-spacer" />
          <Button
            onClick={() => {
              setShowPassphrase(!showPassphrase)
            }}
            testId="import-toggle-passphrase"
          >
            {showPassphrase ? 'Back to words' : 'Passphrase'}
          </Button>
          <Button
            variant="primary"
            disabled={!plausible || busy}
            onClick={() => {
              void submit()
            }}
            testId="import-submit"
          >
            {busy ? 'Checking' : 'Import'}
          </Button>
        </>
      }
    >
      {!showPassphrase && (
        <>
          <WordKeyboard words={words} onChange={setWords} target={target} testId="import-words" />
          <p className="nr-hint">
            Only letters that can still reach a word are active, and a word is entered when it is
            the only one left or when you tap it. The checksum is validated on import: a single
            mistyped word usually fails there, but one that still checksums produces a completely
            different wallet, so check the fingerprint afterwards.
          </p>

          <details className="nr-details">
            <summary className="nr-details__summary" data-testid="import-typed-toggle">
              Type it out instead
            </summary>
            <textarea
              className="nr-input nr-input--area"
              value={mnemonic}
              onChange={(e) => {
                setWords(e.target.value.trim().split(/\s+/u).filter(Boolean))
              }}
              placeholder="abandon abandon abandon ..."
              data-testid="import-mnemonic"
              spellCheck={false}
              autoComplete="off"
            />
          </details>
        </>
      )}

      {showPassphrase && (
        <>
          <span className="nr-field__label">Passphrase, optional</span>
          <TextKeyboard value={passphrase} onChange={setPassphrase} testId="import-passphrase" />
          <p className="nr-hint">
            A wrong passphrase does not produce an error. It produces a different, valid, empty
            wallet. There is no reset: the passphrase is part of the key, not a password guarding
            it.
          </p>
        </>
      )}

      {error !== null && (
        <div className="nr-banner nr-banner--testnet" data-testid="import-error">
          <strong>Refused</strong>
          <span>{error}</span>
        </div>
      )}
    </Screen>
  )
}
