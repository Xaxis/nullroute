import { type ReactElement, useState } from 'react'
import { Screen } from '../components/Screen.js'
import { Button } from '../components/Button.js'

/**
 * The seed, shown once.
 *
 * Spec: ui.screens.seed
 *
 * This is the one screen that displays key material, and the exception is
 * narrow by construction rather than by policy: the daemon refuses to reveal a
 * mnemonic once backup is confirmed, and refuses outright for a seed loaded
 * from storage. So this screen can only ever be reached once per wallet.
 *
 * Confirming the backup is IRREVERSIBLE and is styled as a danger action for
 * that reason. It is the last moment the words exist anywhere but on paper.
 */

export interface SeedScreenProps {
  readonly words: readonly string[]
  readonly fingerprint: string
  readonly onConfirm: () => void
  readonly banner?: ReactElement | null
}

export function SeedScreen(props: SeedScreenProps): ReactElement {
  const { words, fingerprint, onConfirm, banner } = props
  const [acknowledged, setAcknowledged] = useState(false)

  return (
    <Screen
      title="Write these down"
      subtitle={`${String(words.length)} words, in order. This is the only time they are shown.`}
      banner={banner}
      testId="seed-screen"
      actions={
        <>
          <label
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}
          >
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => {
                setAcknowledged(e.target.checked)
              }}
              data-testid="seed-ack"
              style={{ width: '1.125rem', height: '1.125rem' }}
            />
            <span className="nr-hint">I have written all {words.length} words down, in order.</span>
          </label>
          <div className="nr-spacer" />
          {/* Irreversible, so never the primary style and never the default. */}
          <Button
            variant="danger"
            disabled={!acknowledged}
            onClick={onConfirm}
            testId="seed-confirm"
          >
            Done, hide them
          </Button>
        </>
      }
    >
      <div className="nr-words" data-testid="seed-words">
        {words.map((word, i) => (
          <div key={`${String(i)}-${word}`} className="nr-word">
            <span className="nr-word__index">{i + 1}</span>
            <span className="nr-word__text">{word}</span>
          </div>
        ))}
      </div>

      <div className="nr-card nr-card--tight">
        <div className="nr-row">
          <span className="nr-label">Fingerprint</span>
          <span className="nr-value nr-mono" data-testid="seed-fingerprint">
            {fingerprint}
          </span>
        </div>
        <p className="nr-hint">
          Write this down too. If you use a passphrase, a mistyped one produces a valid but
          different and empty wallet with no error, and this number is the only thing that will
          tell you.
        </p>
      </div>

      <div className="nr-banner nr-banner--testnet">
        <strong>Paper only</strong>
        <span>
          Do not photograph this screen, and do not type these words into anything. Anyone with
          these words has your money. There is no reset and no recovery: the device will not show
          them again.
        </span>
      </div>
    </Screen>
  )
}
