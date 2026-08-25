import { type ReactElement, type ReactNode, useState } from 'react'
import { Screen } from '../components/Screen.js'
import { Button } from '../components/Button.js'
import { Choice } from '../components/Choice.js'
import { TextKeyboard } from '../components/TextKeyboard.js'

/**
 * Renaming, recolouring and erasing the open wallet.
 *
 * Spec: ui.screens.manage
 *
 * TWO ACTIONS THAT LOOK ADJACENT AND ARE NOT. Renaming is cosmetic and
 * reversible. Erasing removes the only copy of a seed this device holds, and if
 * the mnemonic was not written down it removes the money.
 *
 * So they do not share a button row, they do not share a confirmation, and the
 * erase path asks for the wallet's name to be typed out rather than offering a
 * second tap. A dialog that can be dismissed by tapping where the previous
 * screen's primary button was is a dialog that gets dismissed by muscle memory,
 * and on a 7-inch panel that muscle memory is the whole interaction.
 *
 * WHY RENAME NEEDS THE PASSPHRASE. The name lives inside the ciphertext, so
 * changing it means resealing. INV-MW-5 is the reason this is safe to offer at
 * all: a wrong passphrase here does NOT count against the attempt budget,
 * because a device that erased a wallet after ten failed attempts at choosing a
 * different colour would be an unusually cruel piece of software.
 */

/** The colours the registry accepts. Kept in step with WALLET_COLOURS. */
export const WALLET_COLOUR_NAMES = [
  'slate',
  'amber',
  'teal',
  'violet',
  'rose',
  'lime',
  'cyan',
  'orange',
] as const

export type WalletColourName = (typeof WALLET_COLOUR_NAMES)[number]

export interface ManageWalletScreenProps {
  /**
   * The navigation menu, when leaving this screen is free.
   *
   * The only signal this device gives for that. It replaced a Home button in
   * the same corner meaning the same thing, which is how that corner came to
   * have three states and no rule.
   */
  readonly nav?: ReactNode
  /** The open wallet. Authenticated: it came out of the ciphertext. */
  readonly wallet: { readonly label: string; readonly colour: string }
  /**
   * Whether the name shown was actually sealed with the wallet.
   *
   * False for a wallet migrated from a v1 store, which sealed no name. Renaming
   * such a wallet is how it acquires a confirmed one, and the screen says so
   * rather than presenting the placeholder as a name somebody chose.
   */
  readonly labelVerified?: boolean
  readonly onRename: (label: string, colour: string, passphrase: string) => Promise<void>
  /**
   * Change the passphrase the wallet is sealed under.
   *
   * On a device with no secure element the passphrase is the entire physical
   * defence, and until this existed there was no way to change one: somebody
   * who thought theirs had been observed had to erase the wallet and restore
   * from the mnemonic, which means typing twenty four words on a touchscreen
   * and loses every registration and cosigner name sealed with it.
   */
  readonly onChangePassphrase?:
    ((oldPassphrase: string, newPassphrase: string) => Promise<void>) | undefined
  readonly onDestroy: () => Promise<void>
  readonly onBack: () => void
  /** Who this device is and which wallet it has open. See `Identity`. */
  readonly identity?: ReactNode
  readonly banner?: ReactElement | null
}

type Mode = 'menu' | 'rename' | 'passphrase' | 'destroy'

export function ManageWalletScreen(props: ManageWalletScreenProps): ReactElement {
  const {
    wallet,
    labelVerified = true,
    onRename,
    onChangePassphrase,
    onDestroy,
    onBack,

    identity,
    banner,
    nav,
  } = props

  const [mode, setMode] = useState<Mode>('menu')
  const [label, setLabel] = useState(labelVerified ? wallet.label : '')
  const [colour, setColour] = useState<string>(wallet.colour)
  const [passphrase, setPassphrase] = useState('')
  const [typed, setTyped] = useState('')
  const [nextPassphrase, setNextPassphrase] = useState('')
  const [confirmPassphrase, setConfirmPassphrase] = useState('')
  const [changed, setChanged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (err) {
      setError((err as Error).message)
      // Cleared on failure, so a retry starts from nothing rather than from a
      // passphrase the user has already seen refused.
      setPassphrase('')
    } finally {
      setBusy(false)
    }
  }

  // --- Changing the passphrase ----------------------------------------------
  if (mode === 'passphrase') {
    const matches = nextPassphrase.length > 0 && nextPassphrase === confirmPassphrase
    const same = nextPassphrase.length > 0 && nextPassphrase === passphrase
    return (
      <Screen
        title="Change the passphrase"
        subtitle="What unlocks the file, not what derives addresses."
        banner={banner}
        nav={nav}
        identity={identity}
        testId="manage-passphrase"
        actions={
          <>
            <Button
              onClick={() => {
                setMode('menu')
                setPassphrase('')
                setNextPassphrase('')
                setConfirmPassphrase('')
                setError(null)
              }}
              testId="manage-passphrase-back"
            >
              Back
            </Button>
            <div className="nr-spacer" />
            <Button
              variant="primary"
              disabled={
                passphrase.length === 0 ||
                !matches ||
                same ||
                busy ||
                onChangePassphrase === undefined
              }
              onClick={() =>
                void run(async () => {
                  if (onChangePassphrase === undefined) return
                  await onChangePassphrase(passphrase, nextPassphrase)
                  setChanged(true)
                  setMode('menu')
                  setPassphrase('')
                  setNextPassphrase('')
                  setConfirmPassphrase('')
                })
              }
              testId="manage-passphrase-submit"
            >
              {busy ? 'Changing' : 'Change it'}
            </Button>
          </>
        }
      >
        {/* FIRST, above the fields, because the single most dangerous thing a
            user can believe on this screen is that they are changing the
            passphrase that derives their keys. They are not, that one cannot
            be changed, and somebody who thought otherwise would conclude their
            money had moved. */}
        <div className="nr-banner nr-banner--testnet" data-testid="manage-passphrase-scope">
          <strong>This does not change your addresses</strong>
          <span>
            It changes what unlocks the file on this card. The seed inside is untouched, so every
            address, every xpub and every descriptor stays exactly what it was, and your mnemonic
            still recovers them. A BIP-39 passphrase is a different thing: that one feeds the seed
            itself, and nothing on this device can change it.
          </span>
        </div>

        <div className="nr-field">
          <span className="nr-field__label">The passphrase it has now</span>
          <input
            className="nr-input"
            type="password"
            value={passphrase}
            spellCheck={false}
            onChange={(e) => {
              setPassphrase(e.target.value)
            }}
            data-testid="manage-passphrase-old"
          />
        </div>

        <div className="nr-field">
          <span className="nr-field__label">The new one</span>
          <input
            className="nr-input"
            type="password"
            value={nextPassphrase}
            spellCheck={false}
            onChange={(e) => {
              setNextPassphrase(e.target.value)
            }}
            data-testid="manage-passphrase-new"
          />
        </div>

        <div className="nr-field">
          {/* Twice, because there is no recovery from a typo here that is not
              "restore from your mnemonic and lose your registrations". */}
          <span className="nr-field__label">The new one again</span>
          <input
            className="nr-input"
            type="password"
            value={confirmPassphrase}
            spellCheck={false}
            onChange={(e) => {
              setConfirmPassphrase(e.target.value)
            }}
            data-testid="manage-passphrase-confirm"
          />
          {confirmPassphrase.length > 0 && !matches && (
            <p className="nr-hint nr-warn" data-testid="manage-passphrase-mismatch">
              These two do not match.
            </p>
          )}
          {same && (
            <p className="nr-hint nr-warn" data-testid="manage-passphrase-same">
              That is the passphrase it already has.
            </p>
          )}
        </div>

        <p className="nr-note" data-testid="manage-passphrase-cost">
          Write the new one down before you tap. Nothing on this device can recover it, and a
          passphrase nobody remembers makes this wallet exactly as unreachable as one nobody stole.
          Your mnemonic still restores the seed, and it does not restore the quorums registered here
          or the names you gave the other cosigners.
        </p>

        {error !== null && (
          <div className="nr-banner nr-banner--danger" data-testid="manage-passphrase-error">
            <strong>Not changed</strong>
            <span>{error}</span>
          </div>
        )}
      </Screen>
    )
  }

  // --- Renaming -------------------------------------------------------------
  if (mode === 'rename') {
    return (
      <Screen
        title="Name this wallet"
        subtitle="Renaming needs the passphrase."
        banner={banner}
        nav={nav}
        identity={identity}
        testId="manage-rename"
        actions={
          <>
            <Button
              onClick={() => {
                setMode('menu')
                setError(null)
              }}
              testId="manage-rename-back"
            >
              Back
            </Button>
            <div className="nr-spacer" />
            <Button
              variant="primary"
              disabled={label.trim().length === 0 || passphrase.length === 0 || busy}
              onClick={() =>
                void run(async () => {
                  await onRename(label, colour, passphrase)
                  setMode('menu')
                  setPassphrase('')
                })
              }
              testId="manage-rename-submit"
            >
              {busy ? 'Saving' : 'Save'}
            </Button>
          </>
        }
      >
        {/* The name and the colour on one row. They are the two halves of one
            answer to one question, and stacked they cost 60px above a keyboard
            that had nowhere left to go: the bottom four of its five rows were
            under the action bar. */}
        <div className="nr-split nr-split--lead">
          <div className="nr-field">
            <span className="nr-field__label">Name</span>
            <input
              className="nr-input"
              value={label}
              maxLength={48}
              spellCheck={false}
              onChange={(e) => {
                setLabel(e.target.value)
              }}
              data-testid="manage-label"
            />
          </div>

          <div className="nr-field">
            <span className="nr-field__label">Colour</span>
            <div className="nr-swatches" data-testid="manage-colours">
              {WALLET_COLOUR_NAMES.map((name) => (
                <button
                  key={name}
                  type="button"
                  className="nr-swatch"
                  data-colour={name}
                  aria-pressed={colour === name}
                  aria-label={name}
                  onClick={() => {
                    setColour(name)
                  }}
                  data-testid={`manage-colour-${name}`}
                />
              ))}
            </div>
          </div>
        </div>

        {/* THE LABEL IS THE KEYBOARD'S OWN READOUT.
            A separate label above it costs 24px, and on a device carrying the
            network banner this screen was 37px over with its bottom row of keys
            off the panel. The readout has to say something before anything is
            typed, so it says which field this is. */}
        <TextKeyboard
          value={passphrase}
          onChange={setPassphrase}
          placeholder="Passphrase for this wallet"
          testId="manage-passphrase"
        />

        {/* Said out loud, because the counter on the unlock screen is
            prominent enough that a user would reasonably assume it applies
            here too, and hesitate to rename anything. */}
        <p className="nr-note" data-testid="manage-rename-safe">
          The name and the colour are sealed inside the encrypted file, so changing either means
          rewriting it. A wrong passphrase here is refused and costs nothing: it does not count
          against the attempts that erase this wallet, because changing a colour must never be a way
          to lose one.
        </p>

        {error !== null && (
          <div className="nr-banner nr-banner--danger" data-testid="manage-error">
            <strong>Not saved</strong>
            <span>{error}</span>
          </div>
        )}
      </Screen>
    )
  }

  // --- Erasing --------------------------------------------------------------
  if (mode === 'destroy') {
    // Typed out rather than tapped. The comparison is on the trimmed text
    // because a keyboard on a touchscreen adds trailing spaces the user cannot
    // see, and refusing over an invisible character teaches nothing.
    const confirmed = typed.trim() === wallet.label.trim() && typed.trim().length > 0

    return (
      <Screen
        title="Erase this wallet"
        subtitle={wallet.label}
        banner={banner}
        nav={nav}
        identity={identity}
        testId="manage-destroy"
        actions={
          <>
            <Button
              onClick={() => {
                setMode('menu')
                setTyped('')
                setError(null)
              }}
              testId="manage-destroy-back"
            >
              Keep it
            </Button>
            <div className="nr-spacer" />
            <Button
              variant="danger"
              disabled={!confirmed || busy}
              onClick={() =>
                void run(async () => {
                  await onDestroy()
                })
              }
              testId="manage-destroy-submit"
            >
              {busy ? 'Erasing' : 'Erase it'}
            </Button>
          </>
        }
      >
        <div className="nr-banner nr-banner--danger" data-testid="manage-destroy-warning">
          <strong>This removes the seed from this device</strong>
          <span>
            Nothing on this device recovers it afterwards. If you wrote the mnemonic down, that
            paper is now the only copy and it still works. If you did not, the money in this wallet
            is gone.
          </span>
        </div>

        <div className="nr-field">
          <span className="nr-field__label">Type the wallet name to confirm</span>
          <input
            className="nr-input"
            value={typed}
            spellCheck={false}
            placeholder={wallet.label}
            onChange={(e) => {
              setTyped(e.target.value)
            }}
            data-testid="manage-destroy-confirm"
          />
        </div>

        {error !== null && (
          <div className="nr-banner nr-banner--danger" data-testid="manage-error">
            <strong>Not erased</strong>
            <span>{error}</span>
          </div>
        )}
      </Screen>
    )
  }

  // --- The menu -------------------------------------------------------------
  return (
    <Screen
      title="Manage wallet"
      subtitle={wallet.label}
      banner={banner}
      nav={nav}
      identity={identity}
      testId="manage-screen"
      actions={
        <Button onClick={onBack} testId="manage-back">
          Back
        </Button>
      }
    >
      {!labelVerified && (
        <p className="nr-note" data-testid="manage-unnamed">
          This wallet was saved before names were sealed with them, so it has no confirmed name.
          Giving it one now writes it inside the encryption, where nobody holding the card can
          change it.
        </p>
      )}

      {changed && (
        <div className="nr-banner nr-banner--ok" data-testid="manage-passphrase-done">
          <strong>The passphrase is changed</strong>
          <span>
            This wallet opens under the new one from now on, including after a reboot. The old one
            no longer works and nothing on this device remembers it.
          </span>
        </div>
      )}

      {/* DESTINATIONS, not buttons, the same way More and Start render theirs.
          Two identical full width buttons said nothing about the difference
          between changing a label and changing the thing that decrypts the
          seed, and this screen's third control erases the wallet. */}
      <Choice
        title="Name and colour"
        description="What this wallet is called on this device, and the dot beside it."
        selected={false}
        onSelect={() => {
          setMode('rename')
          setError(null)
        }}
        testId="manage-choose-rename"
      />

      {onChangePassphrase !== undefined && (
        <Choice
          title="Change the passphrase"
          description="What decrypts this wallet on this device. The mnemonic behind it does not change."
          selected={false}
          onSelect={() => {
            setMode('passphrase')
            setPassphrase('')
            setNextPassphrase('')
            setConfirmPassphrase('')
            setChanged(false)
            setError(null)
          }}
          testId="manage-choose-passphrase"
        />
      )}

      {/* Separated from the button above by more than a gap. The two actions
          are one tap apart in the DOM and worlds apart in consequence. */}
      <div className="nr-danger-zone" data-testid="manage-danger">
        <span className="nr-danger-zone__title">Erasing</span>
        <p className="nr-hint">
          Removes this wallet&apos;s seed from the device. Your mnemonic still recovers it. Nothing
          else does.
        </p>
        <Button
          variant="danger"
          onClick={() => {
            setMode('destroy')
            setTyped('')
            setError(null)
          }}
          testId="manage-choose-destroy"
        >
          Erase this wallet
        </Button>
      </div>
    </Screen>
  )
}
