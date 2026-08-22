import { type ReactElement, type ReactNode, useState } from 'react'
import { Screen } from '../components/Screen.js'
import { Button } from '../components/Button.js'
import { TextKeyboard } from '../components/TextKeyboard.js'

/**
 * Choosing which wallet to open.
 *
 * Spec: ui.screens.wallets
 *
 * Every word on this screen before a passphrase is entered is unverified. The
 * names, colours and networks are read from a file beside each sealed blob, and
 * anyone who has held the card could have edited them. That is not a flaw to be
 * hidden: the device cannot know what a wallet is called until it opens it, and
 * a screen that presented these as facts would be lying with a straight face.
 *
 * So the honesty note is not dismissible and does not scroll away. It costs a
 * line of a 480px panel and it is the difference between a picker and a claim.
 *
 * WHAT IS NOT SHOWN. No fingerprint. It is the one value on this device with a
 * cryptographic ground truth, and INV-UI-20 already establishes the rule that a
 * fingerprint nobody verified must not be displayed as though it were checked.
 * A picker is precisely where that mistake would be made, because a user
 * comparing eight hex characters believes they have proved something.
 */

export interface WalletRow {
  readonly id: string
  readonly label: string
  readonly colour: string
  readonly network: string
  readonly exists: boolean
  readonly attemptsRemaining: number
  readonly destroyed: boolean
}

export interface WalletsScreenProps {
  readonly wallets: readonly WalletRow[]
  readonly max: number
  /** The open wallet, if one is open. Authenticated, unlike the rows. */
  readonly active?: { readonly id: string; readonly label: string } | null
  readonly onUnlock: (id: string, passphrase: string) => Promise<void>
  readonly onCreate: () => void
  /**
   * Clear the directory of a wallet whose seed is already gone.
   *
   * Optional, because a device with no tombstones never needs it. A row left by
   * exhausted attempts cannot be opened and cannot be erased through the manage
   * screen, which requires the wallet to be open, so without this the row is
   * permanent and eight of them fill the device.
   */
  readonly onForget?: (id: string) => Promise<void>
  readonly onCancel?: () => void
  /**
   * Leaves for naming this physical device.
   *
   * Offered here because the picker is where somebody with several devices
   * most often notices they cannot tell which one they are holding: every
   * wallet in a quorum has the same name on every device.
   */
  readonly onNameDevice?: () => void
  /**
   * Check a proof, from the picker, with nothing open.
   *
   * Here rather than only behind an unlocked wallet, because verification uses
   * no key. Somebody handed an address and a signature over a coffee should not
   * have to type the passphrase to the most dangerous thing they own in order
   * to do arithmetic on a stranger's message.
   */
  readonly onCheckProof?: () => void
  /**
   * Why this list may be wrong or incomplete.
   *
   * Shown ABOVE the rows, because a list that failed to load renders as an
   * empty one, and an empty picker tells a user with three wallets that this
   * device holds none.
   */
  readonly failure?: string
  /** Who this device is and which wallet it has open. See `Identity`. */
  readonly identity?: ReactNode
  /**
   * The navigation menu.
   *
   * Safe to leave: nothing has been chosen here yet, and Back was already the
   * way out. Without it this was the one screen between the lock screen and a
   * wallet with no menu in its header, which is the sort of gap that teaches
   * somebody the menu is not always there.
   */
  readonly nav?: ReactNode
  /**
   * Where this screen sits in a journey.
   *
   * The picker became a journey step when journeys stopped refusing to start
   * without a wallet and began opening one instead.
   */
  readonly steps?: ReactElement | null
  readonly banner?: ReactElement | null
}

export function WalletsScreen(props: WalletsScreenProps): ReactElement {
  const {
    wallets,
    max,
    active,
    onUnlock,
    onCreate,
    onForget,
    onCancel,
    onNameDevice,
    onCheckProof,
    failure,
    steps,

    identity,
    nav,
    banner,
  } = props

  // Only wallets that still hold a seed count against the limit. A row left by
  // a wallet erased through exhausted attempts is a tombstone, and letting
  // eight of those say "device is full" would turn a recoverable mistake into
  // a device nobody can add a wallet to.
  const live = wallets.filter((wallet) => wallet.exists).length

  const [selected, setSelected] = useState<WalletRow | null>(null)
  const [tombstone, setTombstone] = useState<WalletRow | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const unlock = async (): Promise<void> => {
    if (selected === null) return
    setBusy(true)
    setError(null)
    try {
      await onUnlock(selected.id, passphrase)
    } catch (err) {
      setError((err as Error).message)
      // Cleared on failure so a second attempt starts from nothing. A field
      // still holding a wrong passphrase is one a user retries unchanged.
      setPassphrase('')
    } finally {
      setBusy(false)
    }
  }

  const forget = async (): Promise<void> => {
    if (tombstone === null || onForget === undefined) return
    setBusy(true)
    setError(null)
    try {
      await onForget(tombstone.id)
      setTombstone(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // --- Clearing a row whose wallet is already gone ---------------------------
  // Confirmed rather than tapped through, not because anything is at risk (the
  // seed went when the counter ran out) but because a user who sees the row
  // disappear should have understood first that it was already empty.
  if (tombstone !== null) {
    return (
      <Screen
        title="Clear this row"
        subtitle={tombstone.label}
        banner={banner}
        steps={steps}
        nav={nav}
        identity={identity}
        testId="wallets-forget"
        actions={
          <>
            <Button
              onClick={() => {
                setTombstone(null)
                setError(null)
              }}
              testId="wallets-forget-back"
            >
              Back
            </Button>
            <div className="nr-spacer" />
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                void forget()
              }}
              testId="wallets-forget-submit"
            >
              {busy ? 'Clearing' : 'Clear it'}
            </Button>
          </>
        }
      >
        <p className="nr-note" data-testid="wallets-forget-note">
          This wallet was erased when its attempt counter ran out. Its seed is already gone and
          clearing the row does not remove anything else. Your mnemonic still recovers it. If you do
          not have one, this row is not what is standing between you and the money.
        </p>

        {error !== null && (
          <div className="nr-banner nr-banner--danger" data-testid="wallets-forget-error">
            <strong>Not cleared</strong>
            <span>{error}</span>
          </div>
        )}
      </Screen>
    )
  }

  // --- Entering a passphrase for one wallet ---------------------------------
  if (selected !== null) {
    return (
      <Screen
        title={selected.label}
        subtitle="This name is not confirmed until the wallet opens."
        banner={banner}
        steps={steps}
        nav={nav}
        identity={identity}
        testId="wallet-unlock-screen"
        actions={
          <>
            <Button
              onClick={() => {
                setSelected(null)
                setPassphrase('')
                setError(null)
              }}
              testId="wallet-unlock-back"
            >
              Back
            </Button>
            <div className="nr-spacer" />
            <span className="nr-hint" data-testid="wallet-unlock-attempts">
              {selected.attemptsRemaining} attempts left
            </span>
            <Button
              variant="primary"
              disabled={passphrase.length === 0 || busy}
              onClick={() => {
                void unlock()
              }}
              testId="wallet-unlock-submit"
            >
              {busy ? 'Opening' : 'Unlock'}
            </Button>
          </>
        }
      >
        <TextKeyboard
          value={passphrase}
          onChange={setPassphrase}
          onSubmit={() => {
            if (passphrase.length > 0 && !busy) void unlock()
          }}
          testId="wallet-unlock-keyboard"
        />

        {error !== null && (
          <div className="nr-banner nr-banner--danger" data-testid="wallet-unlock-error">
            <strong>Not opened</strong>
            <span>{error}</span>
          </div>
        )}

        <p className="nr-note">
          Ten wrong attempts in a row erase this wallet from the device. That counter stops somebody
          guessing at a device they picked up. It does not stop anyone who copied the card first, so
          the passphrase is what is really protecting this.
        </p>
      </Screen>
    )
  }

  // --- The picker -----------------------------------------------------------
  return (
    <Screen
      title="Wallets"
      subtitle={`${String(live)} of ${String(max)} on this device`}
      banner={banner}
      steps={steps}
      nav={nav}
      identity={identity}
      testId="wallets-screen"
      actions={
        <>
          {onCancel !== undefined && (
            <Button onClick={onCancel} testId="wallets-cancel">
              Back
            </Button>
          )}
          {onNameDevice !== undefined && (
            <Button onClick={onNameDevice} testId="wallets-name-device">
              Name this device
            </Button>
          )}
          <div className="nr-spacer" />
          <Button variant="primary" disabled={live >= max} onClick={onCreate} testId="wallets-add">
            {live >= max ? 'Device is full' : 'Add a wallet'}
          </Button>
        </>
      }
    >
      {/* Not dismissible, first, and pinned. Everything below it is a claim
          made by a file rather than by the device, and on a 480px panel a note
          that scrolls away once the device holds five wallets is a note the
          user reads exactly once.
          
          ONE LINE, THOUGH. It was three, and on a 480px panel that is a
          standing paragraph of unchanging text above every wallet on the
          device, every time, forever. A permanent explanation that pushes the
          thing it explains below the fold gets skipped the same way a
          dismissible one does, so length here costs the warning its own
          audience. What survives is the part that is load-bearing: the list is
          not authenticated, and the device tells you when it opens. */}
      <p className="nr-note nr-note--pinned" data-testid="wallets-unverified">
        Read from disk, not confirmed until a wallet opens. The device says so if a name differs.
      </p>

      {failure !== undefined && (
        <div className="nr-banner nr-banner--danger" data-testid="wallets-failure">
          <strong>This list may be incomplete</strong>
          <span>{failure}</span>
        </div>
      )}

      <div className="nr-wlist nr-wlist--scroll" data-testid="wallet-rows">
        {wallets.map((wallet) => (
          <button
            key={wallet.id}
            type="button"
            className="nr-wrow"
            disabled={!wallet.exists && !(wallet.destroyed && onForget !== undefined)}
            onClick={() => {
              setError(null)
              if (!wallet.exists) {
                setTombstone(wallet)
                return
              }
              setSelected(wallet)
              setPassphrase('')
            }}
            data-testid={`wallet-row-${wallet.id}`}
          >
            <span className="nr-wrow__dot" data-colour={wallet.colour} />
            <span className="nr-wrow__label">{wallet.label}</span>
            <span className="nr-spacer" />
            {/* Always, not only off mainnet. With several wallets the absence
                of a warning is not a signal a user can rely on. */}
            <span
              className={`nr-wrow__net${wallet.network === 'mainnet' ? '' : ' nr-wrow__net--test'}`}
            >
              {wallet.network}
            </span>
            {/* These two used to be the same grey chip, in one CSS rule. One
                says this is the wallet you are using and the other says this
                wallet's seed is gone for good, and nothing on the row told
                them apart at a glance. */}
            {active?.id === wallet.id && <span className="nr-wrow__open">open</span>}
            {wallet.destroyed && <span className="nr-wrow__gone">erased</span>}
          </button>
        ))}

        {wallets.length === 0 && failure === undefined && (
          <p className="nr-hint" data-testid="wallets-empty">
            No wallets on this device yet.
          </p>
        )}
      </div>

      {/* WHERE ERASING IS, said here because here is where people look for it.

          This screen lists the wallets, so it is the obvious place to remove
          one, and it does not remove one. That is deliberate at the daemon:
          `registry.forget` refuses while a sealed seed is present, so that
          erasing cannot happen anywhere except from inside the wallet being
          erased, with its passphrase and its name typed out. The rule is right
          and nothing said it, so the feature read as missing.

          A sentence rather than a control. A tap target that erases a wallet,
          in a list of tap targets that open one, on a touchscreen, is the
          mis-tap this whole stylesheet keeps 44px and 6px of air for. */}
      {wallets.some((wallet) => !wallet.destroyed) && (
        <p className="nr-hint" data-testid="wallets-where-erase">
          To erase a wallet, open it and use Erase or rename this wallet under More. A wallet can
          only be erased from inside itself, so this device cannot lose one without being asked for
          its passphrase and its name.
        </p>
      )}

      {/* In the body rather than the action bar, which already holds three
          controls on an 800px panel. This is an occasional thing somebody
          comes here to do, not a step in opening a wallet. */}
      {onCheckProof !== undefined && (
        <Button onClick={onCheckProof} testId="wallets-check-proof">
          Check somebody&rsquo;s proof
        </Button>
      )}
    </Screen>
  )
}
