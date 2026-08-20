import { type ReactElement } from 'react'

/**
 * Where you are, and everywhere else you can go.
 *
 * Spec: ui.components.nav-rail
 *
 * WHAT WAS WRONG WITHOUT IT. Every screen was a full-screen takeover with its
 * own action bar, and there was no persistent way to see where you were or move
 * somewhere else. Destinations ended up wherever there was room: "More" was a
 * tab inside the wallet screen, "Sign a transaction" sat in an action bar
 * beside "Lock" and beside pagination for a list, and "Receive" was stranded on
 * the end of a row of script-type filters. The one screen that oriented anybody
 * was opt-in and offered to be dismissed permanently.
 *
 * WHY A RAIL AND NOT A BAR. The panel is 800 by 480, and 480 is the scarce
 * axis: the body already scrolls, so vertical pressure turns into swiping,
 * while horizontal pressure turns into controls that do not fit side by side. A
 * rail spends the axis there is more of. It costs 104 of 800 across and returns
 * a whole tab row and half an action bar down the page.
 *
 * IT CARRIES DESTINATIONS ONLY. An action bar says what you can do on the
 * screen you are on; this says which screen you could be on instead. Mixing
 * those is what produced a bar holding a session control, a task, and
 * pagination at equal weight.
 *
 * IT IS NOT SHOWN DURING A FLOW. Rolling dice, writing down a mnemonic and
 * typing a passphrase are sequences with a beginning and an end, and offering
 * an exit from the middle of one is offering to throw work away. Screens pass
 * the rail only when leaving is free.
 */

export type NavDestination = 'home' | 'wallet' | 'sign' | 'receive' | 'quorums' | 'more'

export interface NavRailProps {
  /** Which destination the screen behind this rail belongs to. */
  readonly current: NavDestination
  readonly onNavigate: (destination: NavDestination) => void
  /**
   * Ending the session.
   *
   * Separated from the destinations by a rule and a gap, because it is the one
   * control here that does not take you somewhere: it closes the wallet. It
   * lives in the rail rather than in an action bar because it has to be
   * reachable from every screen, which is exactly what a rail is for.
   */
  readonly onLock?: (() => void) | undefined
  /** Hidden when this device is in no quorum, so the rail has nothing dead in it. */
  readonly showQuorums?: boolean
  /**
   * Whether a wallet is open.
   *
   * Four of the six destinations are ABOUT a wallet, and with none open they
   * lead to screens that have nothing to show or refuse outright. A rail whose
   * entries do not work is worse than a shorter rail: it teaches somebody that
   * tapping things here sometimes does nothing, and the next time it matters
   * they will not trust it.
   *
   * Home and More both work without one, which is why they stay: More is where
   * switching wallets, naming the device and checking it live.
   */
  readonly walletOpen?: boolean
}

/**
 * The destinations, in the order somebody meets them.
 *
 * Home first because it answers "what am I doing", then the wallet, then the
 * two things people came to do, then everything else. Not alphabetical and not
 * by frequency: by the shape of the task.
 *
 * WORDS, NOT ICONS. The first version paired each label with a geometric glyph.
 * Two of the six were conventional and the rest were shapes standing in for
 * ideas nobody would guess: a lozenge for a quorum, a grid for a wallet. An
 * icon that has to be learned is worse than the word it sits above, and the
 * rail is 104px wide, which is room for the word. `make prose` also refused the
 * tick, since it falls in the range this project bans, and hunting for a
 * substitute would have been solving the wrong problem.
 */
const DESTINATIONS: readonly {
  readonly id: NavDestination
  readonly label: string
}[] = [
  { id: 'home', label: 'Home' },
  { id: 'wallet', label: 'Wallet' },
  { id: 'sign', label: 'Sign' },
  { id: 'receive', label: 'Receive' },
  { id: 'quorums', label: 'Quorums' },
  { id: 'more', label: 'More' },
]

/** Destinations that need a wallet behind them to show anything. */
const NEEDS_WALLET = new Set<NavDestination>(['wallet', 'sign', 'receive', 'quorums'])

export function NavRail(props: NavRailProps): ReactElement {
  const { current, onNavigate, onLock, showQuorums = true, walletOpen = true } = props

  const shown = DESTINATIONS.filter((destination) => {
    if (!walletOpen && NEEDS_WALLET.has(destination.id)) return false
    return destination.id !== 'quorums' || showQuorums
  })

  return (
    <nav className="nr-rail" aria-label="Main" data-testid="nav-rail">
      {shown.map((destination) => {
        const active = destination.id === current
        return (
          <button
            key={destination.id}
            type="button"
            className="nr-rail__item"
            // aria-current rather than aria-pressed: this is navigation, and a
            // screen reader should say "current page" rather than "pressed".
            aria-current={active ? 'page' : undefined}
            onClick={() => {
              onNavigate(destination.id)
            }}
            data-testid={`nav-${destination.id}`}
          >
            <span className="nr-rail__label">{destination.label}</span>
          </button>
        )
      })}

      {onLock !== undefined && (
        <>
          <div className="nr-rail__spacer" />
          <button
            type="button"
            className="nr-rail__item nr-rail__item--lock"
            onClick={onLock}
            data-testid="nav-lock"
          >
            <span className="nr-rail__label">Lock</span>
          </button>
        </>
      )}
    </nav>
  )
}
