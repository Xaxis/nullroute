import { type ReactElement, useState } from 'react'
import { Screen } from '../components/Screen.js'
import { Button } from '../components/Button.js'
import { WALLET_COLOUR_NAMES } from './ManageWalletScreen.js'

/**
 * Naming this physical device.
 *
 * Spec: ui.screens.device-name
 *
 * THE QUESTION THIS ANSWERS is "which of my devices am I holding", and until
 * now nothing on the device could. Three nullroute boxes holding one 2-of-3
 * hold the same wallet, so they show the same wallet name, the same colour and
 * the same fingerprint. The cosigner position tells them apart and only inside
 * a quorum: a device with no registrations is anonymous, and a device in two
 * quorums has two positions.
 *
 * IT IS NOT A PROFILE, and the difference matters. A profile that owned several
 * wallets and opened them together would trade away the property that each
 * wallet is sealed independently under its own passphrase, so that one mistake
 * costs one seed rather than several. This holds a name and a colour, no keys
 * and no authority, and it is the smallest thing that answers the question.
 *
 * IT IS NOT VERIFIED. It lives in a plain file beside the wallets so it can be
 * read before any passphrase, which is exactly the moment the question is
 * asked. Anyone holding the card can edit it, so the screen says so and nothing
 * on the device decides anything from it.
 */

export interface DeviceNameScreenProps {
  /** What it is called now, if it has been named. */
  readonly current?: { readonly name: string; readonly colour: string } | undefined
  readonly onSave: (name: string, colour: string) => Promise<void>
  readonly onBack: () => void
  readonly onHome?: (() => void) | undefined
  readonly device?: { readonly name: string; readonly colour: string } | undefined
  readonly banner?: ReactElement | null
}

export function DeviceNameScreen(props: DeviceNameScreenProps): ReactElement {
  const { current, onSave, onBack, onHome, device, banner } = props

  const [name, setName] = useState(current?.name ?? '')
  const [colour, setColour] = useState(current?.colour ?? 'slate')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <Screen
      title="Name this device"
      subtitle={
        current === undefined
          ? 'So you can tell it from the others.'
          : `Currently called ${current.name}.`
      }
      banner={banner}
      onHome={onHome}
      device={device}
      testId="device-name"
      actions={
        <>
          <Button onClick={onBack} testId="device-name-back">
            Back
          </Button>
          <div className="nr-spacer" />
          <Button
            variant="primary"
            disabled={name.trim().length === 0 || busy}
            onClick={() => {
              void (async () => {
                setBusy(true)
                setError(null)
                try {
                  await onSave(name, colour)
                } catch (err) {
                  setError((err as Error).message)
                } finally {
                  setBusy(false)
                }
              })()
            }}
            testId="device-name-save"
          >
            {busy ? 'Saving' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="nr-field">
        <span className="nr-field__label">What to call it</span>
        <input
          className="nr-input"
          value={name}
          maxLength={48}
          spellCheck={false}
          placeholder="The one in the attic"
          onChange={(e) => {
            setName(e.target.value)
          }}
          data-testid="device-name-input"
        />
      </div>

      <div className="nr-swatches" data-testid="device-name-colours">
        {WALLET_COLOUR_NAMES.map((option) => (
          <button
            key={option}
            type="button"
            className="nr-swatch"
            data-colour={option}
            aria-pressed={colour === option}
            aria-label={option}
            onClick={() => {
              setColour(option)
            }}
            data-testid={`device-colour-${option}`}
          />
        ))}
      </div>

      {/* Said here rather than only in a document. The name appears in the
          header of every screen, including the one where a transaction is
          authorised, and somebody who read it there should know what it is
          worth. */}
      <p className="nr-note" data-testid="device-name-unverified">
        This name is not verified and never will be. It sits in a plain file beside your wallets so
        the device can show it before you type a passphrase, which is when you want it, and that
        means anyone holding the card can change it. Nothing on this device decides anything from
        it. A device that let an editable name influence signing would have turned a convenience
        into an attack.
      </p>

      <p className="nr-hint">
        Useful when you hold more than one. Every device in a quorum holds the same wallet, so they
        all show the same wallet name and the same colour: this is the only thing that tells the
        objects apart before one is unlocked.
      </p>

      {error !== null && (
        <div className="nr-banner nr-banner--danger" data-testid="device-name-error">
          <strong>Not saved</strong>
          <span>{error}</span>
        </div>
      )}
    </Screen>
  )
}
