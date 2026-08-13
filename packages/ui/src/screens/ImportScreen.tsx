import { type ReactElement, useState } from 'react'
import { Screen } from '../components/Screen.js'
import { Button } from '../components/Button.js'

/**
 * Import an existing mnemonic.
 *
 * Spec: ui.screens.import
 *
 * The passphrase field carries the warning that matters, next to the field
 * rather than in a help page: a wrong passphrase does not error. It derives a
 * valid, different, empty wallet. The fingerprint shown after import is the
 * only signal a user will ever get, so the copy says to check it.
 */

export interface ImportScreenProps {
  readonly onImport: (mnemonic: string, passphrase: string) => Promise<void>
  readonly onCancel: () => void
  readonly banner?: ReactElement | null
}

export function ImportScreen(props: ImportScreenProps): ReactElement {
  const { onImport, onCancel, banner } = props
  const [mnemonic, setMnemonic] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const words = mnemonic.trim().split(/\s+/u).filter(Boolean).length
  const plausible = [12, 15, 18, 21, 24].includes(words)

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await onImport(mnemonic.trim(), passphrase)
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
      testId="import-screen"
      actions={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <div className="nr-spacer" />
          <span className="nr-hint">{words} words</span>
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
      <div className="nr-field">
        <span className="nr-field__label">Mnemonic</span>
        <textarea
          className="nr-input nr-input--area"
          value={mnemonic}
          onChange={(e) => {
            setMnemonic(e.target.value)
          }}
          placeholder="abandon abandon abandon ..."
          data-testid="import-mnemonic"
          spellCheck={false}
          autoComplete="off"
        />
        <p className="nr-hint">
          The checksum is validated. A single mistyped word usually fails here, but a mistyped word
          that still checksums produces a completely different wallet, so check the fingerprint
          afterwards.
        </p>
      </div>

      <div className="nr-field">
        <span className="nr-field__label">Passphrase, optional</span>
        <input
          className="nr-input"
          type="password"
          value={passphrase}
          onChange={(e) => {
            setPassphrase(e.target.value)
          }}
          data-testid="import-passphrase"
          autoComplete="off"
        />
        <p className="nr-hint">
          A wrong passphrase does not produce an error. It produces a different, valid, empty
          wallet. There is no reset: the passphrase is part of the key, not a password guarding it.
        </p>
      </div>

      {error !== null && (
        <div className="nr-banner nr-banner--testnet" data-testid="import-error">
          <strong>Refused</strong>
          <span>{error}</span>
        </div>
      )}
    </Screen>
  )
}
