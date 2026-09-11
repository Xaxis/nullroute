import { type ReactElement, type ReactNode, useState } from 'react'
import { Screen } from '../components/Screen.js'
import { Refusal } from '../components/Refusal.js'
import { Working } from '../components/Working.js'
import { Button } from '../components/Button.js'
import { Choice } from '../components/Choice.js'
import { TextKeyboard } from '../components/TextKeyboard.js'
import { Info } from '../components/Info.js'

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

/**
 * The longest wallet name the daemon will seal. Kept in step with MAX_LABEL.
 *
 * THIS FIELD SAID 48 AND THE DAEMON SAID 32. Everything between the two was
 * typeable, accepted by the field, and then refused by `normaliseLabel` after
 * the passphrase had been derived twice, which is several seconds of a device
 * that looks frozen followed by a refusal for a rule the screen had just told
 * the user was 48. check-ui-constants compares the two numbers now, the same
 * way it compares the two colour lists, and for the same reason: the UI cannot
 * import from packages/daemon, so a value that exists on both sides drifts.
 */
const NAME_LIMIT = 32

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

/**
 * Does the typed name match the wallet's, closely enough to count as intent?
 *
 * WHAT THE GESTURE IS PROVING is that you know which wallet this is. It is not
 * proving that you can reproduce its capitalisation, and on this device that
 * distinction is the difference between a confirmation and a wall: the only
 * keyboard is the on-screen one, its shift is one-shot, and a name like "Cold
 * storage, three of five" is twenty seven taps with a shift and a trip to the
 * symbol layer for the comma. Somebody who cannot finish it cannot erase a
 * wallet they own, which is a defect wearing the costume of a safeguard.
 *
 * So case is ignored and runs of whitespace are one space, which is also what
 * `normaliseLabel` does to the name before sealing it. Punctuation still
 * counts: it is the part somebody reading the header actually has to read.
 *
 * A near miss is still a miss. "Family Vaul" does not erase "Family Vault".
 */
function sameName(typed: string, label: string): boolean {
  const flatten = (value: string): string => value.trim().replace(/\s+/g, ' ').toLowerCase()
  const wanted = flatten(label)
  return wanted.length > 0 && flatten(typed) === wanted
}

/**
 * Why the primary button is grey, rendered into the action bar.
 *
 * IN THE BAR RATHER THAN UNDER THE FIELD, which is where it was. A line that
 * appears the moment somebody mistypes, on a screen whose keyboard ends 3px
 * above the action bar, pushes the bottom row of keys under that bar: the space
 * key disappears at the exact moment it starts being needed. The stylesheet
 * makes the same argument for `.nr-field__labelrow`.
 *
 * One at a time, deliberately. There is room in the bar for one sentence, and
 * "that is the one it already has" is the more fundamental of the two: fixing
 * it changes what the other one is comparing.
 */
function whyRefused(matches: boolean, same: boolean, confirmed: string): ReactElement | null {
  if (same) {
    return (
      <span className="nr-status nr-status--fail" data-testid="manage-passphrase-same">
        That is the passphrase it already has
      </span>
    )
  }
  if (confirmed.length > 0 && !matches) {
    return (
      <span className="nr-status nr-status--fail" data-testid="manage-passphrase-mismatch">
        These two do not match
      </span>
    )
  }
  return null
}

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

  /**
   * Which field the rename panel's one keyboard types into.
   *
   * DEFAULTS TO THE PASSPHRASE, and the reason is which mistake costs more. Get
   * it wrong the other way and somebody types their passphrase into the name
   * field, where it is shown in plain text on a lit panel in whatever room the
   * device is in, and then sealed into the wallet file as its name. Get it
   * wrong this way and they type a wallet name into a row of dots, notice
   * immediately, and tap the other field.
   */
  const [renameField, setRenameField] = useState<'name' | 'passphrase'>('passphrase')
  /** Which of the three passphrase fields the keyboard types into. */
  const [changeField, setChangeField] = useState<'old' | 'new' | 'again'>('old')

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
      // And the keys are pointed back at the field that was just emptied. On a
      // device whose only keyboard serves several fields, clearing one and
      // leaving the keys aimed at another means the next thing the user types
      // lands somewhere they are not looking. Harmless on the panels that do
      // not read these: `passphrase` is the field cleared above on both.
      setChangeField('old')
      setRenameField('passphrase')
    } finally {
      setBusy(false)
    }
  }

  // --- Changing the passphrase ----------------------------------------------
  if (mode === 'passphrase') {
    const matches = nextPassphrase.length > 0 && nextPassphrase === confirmPassphrase
    const same = nextPassphrase.length > 0 && nextPassphrase === passphrase
    const fill = (next: string): void => {
      setError(null)
      if (changeField === 'old') setPassphrase(next)
      else if (changeField === 'new') setNextPassphrase(next)
      else setConfirmPassphrase(next)
    }
    return (
      <Screen
        title="Change the passphrase"
        subtitle="What unlocks the file, not your addresses."
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

            {/* WHY THE BUTTON IS GREY, BESIDE THE BUTTON.

                These two said it under the third field, which is where they
                belonged until this screen acquired a keyboard. The arithmetic
                now rules it out: the keys end at 405 and the action bar starts
                at 407, so anything that appears above them and is taller than
                two pixels puts the bottom row underneath it, and one of these
                lines is twenty. It would appear on the keystroke that made the
                two passphrases differ, which is the moment somebody is looking
                hardest at the keys. Nothing above a keyboard may change size
                while somebody is typing on it.

                The action bar is the one strip on the panel that never moves,
                it is where the unlock gate already puts its attempt counter,
                and it is beside the control whose state it is explaining. */}
            {whyRefused(matches, same, confirmPassphrase)}

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
        {/* FIRST IN THE BODY, because a refusal nobody sees is a refusal that
          did not happen. This sat last, under everything the screen holds, on
          a 480px panel: tapping the button and being refused changed nothing
          the user could see. Measured rather than asserted, because jsdom
          computes no box and every test on it passed throughout. */}
        {error !== null && (
          <Refusal title="Not changed" testId="manage-passphrase-error">
            {error}
          </Refusal>
        )}

        {/* TWO DERIVATIONS, NOT ONE: the old passphrase is verified by opening
            the envelope and the new one is sealed with, so this is the longest
            wait on the device outside a restore. It is also the one where a
            user who gives up halfway has the most to lose, since what is being
            rewritten is the file the wallet lives in. */}
        {busy && (
          <Working label="Changing the passphrase" testId="manage-passphrase-working">
            The wallet file is being rewritten with the new passphrase. Leave the device alone until
            it says it is done.
          </Working>
        )}

        {/* THREE FIELDS ON ONE ROW, AND THE ROW IS ALSO THE SELECTOR.

            Stacked, these were 204px on a screen with 70px above the keyboard,
            which is why this panel shipped with three fields nobody could fill:
            there is no on-screen keyboard installed in the image and cage
            provides none, so an input with no TextKeyboard bound to it can be
            filled under `make dev` in a browser and nowhere on the device.

            Tapping a field is what says which one the keys fill, the same way
            the unlock gate does it. No tabs: four controls for three values is
            how the unlock gate lost its keyboard off the bottom of the panel.

            The labels are written to fit a 242px column. check-screen-fit
            measures what happens when they do not. */}
        <div className="nr-split nr-split--trio">
          <div className={`nr-field${changeField === 'old' ? ' nr-field--active' : ''}`}>
            <div className="nr-field__labelrow">
              <span className="nr-field__label">The one it has now</span>
            </div>
            <input
              className="nr-input"
              type="password"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={passphrase}
              onChange={(e) => {
                setPassphrase(e.target.value)
              }}
              onFocus={() => {
                setChangeField('old')
              }}
              onClick={() => {
                setChangeField('old')
              }}
              data-testid="manage-passphrase-old"
            />
          </div>

          <div className={`nr-field${changeField === 'new' ? ' nr-field--active' : ''}`}>
            <div className="nr-field__labelrow">
              <span className="nr-field__label">The new one</span>
            </div>
            <input
              className="nr-input"
              type="password"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={nextPassphrase}
              onChange={(e) => {
                setNextPassphrase(e.target.value)
              }}
              onFocus={() => {
                setChangeField('new')
              }}
              onClick={() => {
                setChangeField('new')
              }}
              data-testid="manage-passphrase-new"
            />
          </div>

          {/* Twice, because there is no recovery from a typo here that is not
              "restore from your mnemonic and lose your registrations". */}
          <div className={`nr-field${changeField === 'again' ? ' nr-field--active' : ''}`}>
            <div className="nr-field__labelrow">
              <span className="nr-field__label">The new one again</span>
            </div>
            <input
              className="nr-input"
              type="password"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={confirmPassphrase}
              onChange={(e) => {
                setConfirmPassphrase(e.target.value)
              }}
              onFocus={() => {
                setChangeField('again')
              }}
              onClick={() => {
                setChangeField('again')
              }}
              data-testid="manage-passphrase-confirm"
            />
          </div>
        </div>

        {/* Hidden while it works, for the same reason as every other screen
            that derives a key: nothing can be typed, and a keyboard that looks
            tappable and does nothing is the worst thing to show somebody
            already wondering whether the device is alive. It also collapses the
            body, which is what puts the message above on the panel. */}
        {!busy && (
          /* The three fields are written out here rather than through a
             variable holding the same conditional. check-typeable reads this
             expression to decide whether a field on the panel has anything to
             fill it with, and a binding one hop away from the call site is a
             binding it cannot see. The rule is deliberately textual, and being
             textual is how it found these three unfillable. */
          <TextKeyboard
            value={
              changeField === 'old'
                ? passphrase
                : changeField === 'new'
                  ? nextPassphrase
                  : confirmPassphrase
            }
            onChange={fill}
            placeholder="Nothing typed"
            testId="manage-passphrase-keyboard"
          />
        )}

        {/* BELOW THE KEYS, AND SAID TWICE ABOVE THEM FIRST.

            This is the single most dangerous belief a user can leave this
            screen with, and the panel has 70px above the keyboard, which one
            row of fields uses entirely. So the short form is in the subtitle,
            which is on the header and cannot be scrolled away, and again in the
            description of the menu entry that reaches this screen. The long
            form is here, where somebody who wants the whole answer scrolls to
            it. A banner that cost the screen its keyboard would leave nobody
            able to change a passphrase at all. */}
        <div className="nr-banner nr-banner--caution" data-testid="manage-passphrase-scope">
          <strong>This does not change your addresses</strong>
          <span>
            It changes what unlocks the file on this card. The seed inside is untouched, so every
            address, every xpub and every descriptor stays exactly what it was, and your mnemonic
            still recovers them. A BIP-39 passphrase is a different thing: that one feeds the seed
            itself, and nothing on this device can change it.
          </span>
        </div>

        <Info testId="manage-passphrase-cost">
          Write the new one down before you tap. Nothing on this device can recover it, and a
          passphrase nobody remembers makes this wallet exactly as unreachable as one nobody stole.
          Your mnemonic still restores the seed, and it does not restore the quorums registered here
          or the names you gave the other cosigners.
        </Info>
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
        {/* FIRST IN THE BODY, because a refusal nobody sees is a refusal that
          did not happen. This sat last, under everything the screen holds, on
          a 480px panel: tapping the button and being refused changed nothing
          the user could see. Measured rather than asserted, because jsdom
          computes no box and every test on it passed throughout. */}
        {error !== null && (
          <Refusal title="Not saved" testId="manage-error">
            {error}
          </Refusal>
        )}

        {/* Renaming reseals. It verifies the passphrase by opening the
            envelope and then writes a new one, so choosing a different colour
            costs exactly as much arithmetic as unlocking twice. */}
        {busy && (
          <Working label="Saving the wallet" testId="manage-rename-working">
            The wallet file is being rewritten, so leave the device alone until it is finished.
          </Working>
        )}

        {/* WHAT IS TYPED SHARES THE ROW. WHAT IS TAPPED DOES NOT.

            The row above a keyboard is also that keyboard's selector, so it
            holds the two values this panel takes by typing and nothing else.
            The colour is eight tap targets that need no keys at all, and it
            sits below them.

            That is a measurement rather than a preference. The body is 287px,
            the keyboard is 188px of it and the gap another 14, so everything
            above the keys adds up to 70px: one row of labelled fields. The name
            and the colour shared this row before the name had any way of being
            filled, which left the wallet name typeable in a browser under `make
            dev` and nowhere on the hardware. */}
        <div className="nr-split nr-split--even">
          <div className={`nr-field${renameField === 'name' ? ' nr-field--active' : ''}`}>
            <div className="nr-field__labelrow">
              <span className="nr-field__label">Name</span>
            </div>
            <input
              className="nr-input"
              value={label}
              maxLength={NAME_LIMIT}
              spellCheck={false}
              onChange={(e) => {
                setLabel(e.target.value)
              }}
              onFocus={() => {
                setRenameField('name')
              }}
              onClick={() => {
                setRenameField('name')
              }}
              data-testid="manage-label"
            />
          </div>

          <div className={`nr-field${renameField === 'passphrase' ? ' nr-field--active' : ''}`}>
            <div className="nr-field__labelrow">
              <span className="nr-field__label">Passphrase for this wallet</span>
            </div>
            <input
              className="nr-input"
              type="password"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={passphrase}
              onChange={(e) => {
                setPassphrase(e.target.value)
              }}
              onFocus={() => {
                setRenameField('passphrase')
              }}
              onClick={() => {
                setRenameField('passphrase')
              }}
              data-testid="manage-rename-passphrase"
            />
          </div>
        </div>

        {/* Hidden while it works, for the same reason as every other screen
            that derives a key: nothing can be typed, and a keyboard that looks
            tappable and does nothing is the worst thing to show somebody
            already wondering whether the device is alive. It also collapses
            the body, which is what puts the message above on the panel. */}
        {!busy && (
          <TextKeyboard
            value={renameField === 'name' ? label : passphrase}
            /* The name is not a secret and the passphrase is, so the readout
               shows what the active field shows. A row of dots under a label
               reading NAME would be the keyboard contradicting the field it is
               filling. */
            secret={renameField === 'passphrase'}
            onChange={(next) => {
              setError(null)
              // CAPPED HERE TOO. maxLength is an attribute of an input element
              // and this keyboard is not one: it calls onChange with whatever
              // has been tapped, so the limit the field advertises held for a
              // browser and not for the device. A name past the limit is
              // refused by the daemon after the passphrase has been derived
              // twice.
              if (renameField === 'name') setLabel(next.slice(0, NAME_LIMIT))
              else setPassphrase(next)
            }}
            testId="manage-rename-keyboard"
          />
        )}

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

        {/* Said out loud, because the counter on the unlock screen is
            prominent enough that a user would reasonably assume it applies
            here too, and hesitate to rename anything. */}
        <Info testId="manage-rename-safe">
          The name and the colour are sealed inside the encrypted file, so changing either means
          rewriting it. A wrong passphrase here is refused and costs nothing: it does not count
          against the attempts that erase this wallet, because changing a colour must never be a way
          to lose one.
        </Info>
      </Screen>
    )
  }

  // --- Erasing --------------------------------------------------------------
  if (mode === 'destroy') {
    const confirmed = sameName(typed, wallet.label)

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
        {/* FIRST IN THE BODY, because a refusal nobody sees is a refusal that
          did not happen. This sat last, under everything the screen holds, on
          a 480px panel: tapping the button and being refused changed nothing
          the user could see. Measured rather than asserted, because jsdom
          computes no box and every test on it passed throughout. */}
        {error !== null && (
          <Refusal title="Not erased" testId="manage-error">
            {error}
          </Refusal>
        )}

        {/* ON THE PANEL WHILE THE NAME IS BEING TYPED, not on a screen before
            it. This is the one action on the device that destroys money, and
            the sentence saying so has to be in front of somebody at the moment
            they are proving they mean it.

            That costs a sentence. The body has 287px, the keyboard takes 188
            and the gap 14, so this banner has 70px: a heading and two lines.
            The line it lost said nothing on this device recovers the seed,
            which is what the heading already says. */}
        <div className="nr-banner nr-banner--danger" data-testid="manage-destroy-warning">
          <strong>This removes the seed from this device</strong>
          <span>
            If you wrote the mnemonic down, that paper still works. If you did not, the money here
            is gone.
          </span>
        </div>

        {/* THE KEYBOARD READOUT IS THE FIELD, which is the rename panel's
            argument in a place it matters more. A labelled input above the keys
            would show the same string twice and cost 82px, and there are 70.

            So this panel had a warning, a field, and no way to fill it: the
            name could be typed in a browser under `make dev` and not on the
            hardware, where nothing installs a virtual keyboard. A confirmation
            nobody can complete is not a safe confirmation, it is a wallet that
            cannot be erased.

            Not masked. The whole gesture is comparing what you typed against
            the name in the header, and dots cannot be compared to anything. */}
        {!busy && (
          <TextKeyboard
            value={typed}
            secret={false}
            placeholder="Type the wallet name to confirm"
            onChange={(next) => {
              setError(null)
              setTyped(next)
            }}
            testId="manage-destroy-keyboard"
          />
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
        <Info testId="manage-unnamed">
          This wallet was saved before names were sealed with them, so it has no confirmed name.
          Giving it one now writes it inside the encryption, where nobody holding the card can
          change it.
        </Info>
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
          // Back to the passphrase on every visit, so a second trip through
          // this screen does not start with the keys pointed at the name
          // because that is where they were left last time.
          setRenameField('passphrase')
          setError(null)
        }}
        testId="manage-choose-rename"
      />

      {onChangePassphrase !== undefined && (
        <Choice
          title="Change the passphrase"
          /* SAYS WHAT DOES NOT CHANGE, and that is load-bearing rather than
             tidy. The panel this reaches has 70px above its keyboard, so the
             long version of this warning is below the keys; the short version
             lives here and in that screen's subtitle, which is on the header
             and cannot be scrolled away. */
          description="What decrypts this wallet on this device. Your addresses and your mnemonic do not change."
          selected={false}
          onSelect={() => {
            setMode('passphrase')
            setPassphrase('')
            setNextPassphrase('')
            setConfirmPassphrase('')
            setChangeField('old')
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
