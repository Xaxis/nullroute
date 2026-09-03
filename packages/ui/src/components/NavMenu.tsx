import { type ReactElement, useEffect, useRef } from 'react'

/**
 * The navigation menu, in the header, on every screen.
 *
 * Spec: ui.components.nav-menu
 *
 * WHY THIS REPLACED A RAIL. The first attempt at fixing navigation was a fixed
 * left rail. It worked on the screens that had it and it could not appear on
 * the one screen everybody sees first: the lock screen is a gate with no wallet
 * behind it, so a rail of wallet destinations had nothing to show, and somebody
 * booting the device still met an application with no visible way around.
 *
 * A header menu has no such problem. It costs nothing until it is opened, it
 * sits in a header that is already on every screen, and it can carry one entry
 * or nine without changing the layout underneath it. The rail also spent 104 of
 * 800 pixels permanently to save two taps, which is a bad trade on a panel
 * where the address list was already fighting for room.
 *
 * IT INCLUDES GUIDE ME. That was the entry point that mattered and it was
 * hiding: an opt-in screen you could dismiss permanently, plus a button on the
 * lock screen and nowhere else. It is a destination like any other now.
 *
 * WHAT IT STILL WILL NOT DO is offer an exit where leaving destroys something
 * that cannot be made again: the seed words, which are shown once, a signed
 * transaction, which exists only on the screen that made it, and the two gates
 * that have to be read. Those screens pass no menu, and no switchable wallet
 * name either, because that is the same exit in different clothes.
 */

export type NavDestination = 'guide' | 'wallet' | 'sign' | 'receive' | 'quorums' | 'more' | 'lock'

export interface NavMenuProps {
  /** Which destination the screen behind this menu belongs to, if any. */
  readonly current?: NavDestination | undefined
  readonly onNavigate: (destination: NavDestination) => void
  /** Whether the panel is showing. Lifted, so a screen change can close it. */
  readonly open: boolean
  readonly onToggle: () => void
  /**
   * Whether a wallet is open.
   *
   * Most destinations are ABOUT a wallet and lead to screens with nothing to
   * show without one. A menu whose entries sometimes do nothing teaches
   * somebody not to trust it the time it matters.
   */
  readonly walletOpen?: boolean
  /** Hidden when this device is in no quorum, so nothing in here is dead. */
  readonly showQuorums?: boolean
}

interface Entry {
  readonly id: NavDestination
  readonly label: string
  readonly hint: string
  /** Needs a wallet behind it to show anything. */
  readonly needsWallet: boolean
}

/**
 * The destinations, in the order somebody meets them.
 *
 * Guide first because it answers "what am I trying to do", then the wallet,
 * then the two things people came here to do, then everything else. Not
 * alphabetical and not by frequency: a list ordered by frequency puts ending
 * the session next to looking at an address.
 */
const ENTRIES: readonly Entry[] = [
  {
    id: 'guide',
    label: 'Guide me',
    hint: 'Pick a goal and the device puts the steps in order',
    needsWallet: false,
  },
  {
    id: 'wallet',
    label: 'Wallet',
    hint: 'Addresses, export, and checking an address',
    needsWallet: true,
  },
  {
    id: 'sign',
    label: 'Sign a transaction',
    hint: 'Read what it does, then authorise it',
    needsWallet: true,
  },
  {
    id: 'receive',
    label: 'Receive',
    hint: 'An address, one at a time, large enough to read',
    needsWallet: true,
  },
  { id: 'quorums', label: 'Quorums', hint: 'Everything this device cosigns', needsWallet: true },
  {
    id: 'more',
    label: 'More',
    hint: 'Backup, labels, proofs, and this device',
    needsWallet: false,
  },
]

export function NavMenu(props: NavMenuProps): ReactElement {
  const { current, onNavigate, open, onToggle, walletOpen = true, showQuorums = true } = props

  const panel = useRef<HTMLDivElement>(null)

  // Escape closes it. There is no keyboard on the device, and there is one on
  // the machine this gets developed against, and a panel that traps a
  // developer is a panel that gets worked around rather than fixed.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onToggle()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onToggle])

  const shown = ENTRIES.filter((entry) => {
    if (entry.needsWallet && !walletOpen) return false
    return entry.id !== 'quorums' || showQuorums
  })

  return (
    <div className="nr-navmenu">
      <button
        type="button"
        className="nr-navmenu__button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={onToggle}
        data-testid="nav-menu-button"
      >
        Menu
      </button>

      {open && (
        <>
          {/* A backdrop, so a tap anywhere closes it, and so a tap meant for
              the menu cannot land on the screen behind it. Without one,
              somebody who opens the menu and changes their mind taps a control
              on the screen underneath, which on this device is how you sign
              something you were not looking at.

              A div rather than a button: it has no label worth announcing, it
              duplicates what Escape already does, and as a focusable control
              covering the whole panel it is a 800x480 tap target adjacent to
              everything, which is both untrue and the sort of thing the fit
              harness is right to refuse. */}
          <div
            className="nr-navmenu__scrim"
            aria-hidden="true"
            onClick={onToggle}
            data-testid="nav-menu-scrim"
          />

          <div className="nr-navmenu__panel" role="menu" ref={panel} data-testid="nav-menu">
            {shown.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="menuitem"
                className="nr-navmenu__item"
                // aria-current, not aria-pressed: this is navigation, so a
                // screen reader should say "current page" rather than
                // "pressed".
                aria-current={entry.id === current ? 'page' : undefined}
                onClick={() => {
                  onNavigate(entry.id)
                }}
                data-testid={`nav-${entry.id}`}
              >
                <span className="nr-navmenu__label">{entry.label}</span>
                <span className="nr-navmenu__hint">{entry.hint}</span>
              </button>
            ))}

            {walletOpen && (
              <button
                type="button"
                role="menuitem"
                // Last, and separated. It is the one entry here that does not
                // take you anywhere: it closes the wallet. Adjacent to a
                // destination it would be one mis-tap from ending the session.
                className="nr-navmenu__item nr-navmenu__item--lock"
                onClick={() => {
                  onNavigate('lock')
                }}
                data-testid="nav-lock"
              >
                <span className="nr-navmenu__label">Lock</span>
                <span className="nr-navmenu__hint">Close the wallet and forget the seed</span>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
