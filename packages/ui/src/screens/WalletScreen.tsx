import { type ReactElement, type ReactNode, useCallback, useEffect, useState } from 'react'
import { Screen } from '../components/Screen.js'
import { Refusal } from '../components/Refusal.js'
import { Button } from '../components/Button.js'
import { QrDisplay } from '../components/QrDisplay.js'

/**
 * The wallet: accounts, addresses, and export.
 *
 * Spec: ui.screens.wallet
 *
 * Three things a user actually needs from a signer that has no balance and no
 * network: what my addresses are, what to give a coordinator, and whether an
 * address someone showed me is really mine.
 *
 * The last one is the security-relevant one. A coordinator asking you to send
 * to an address is the moment substitution happens, and the answer has to come
 * from re-derivation rather than from comparing what two screens display.
 */

export type ScriptType = 'p2pkh' | 'p2sh-p2wpkh' | 'p2wpkh' | 'p2tr'

export interface AddressRow {
  readonly address: string
  readonly path: string
  readonly index: number
  /**
   * The user's own note about this address, from a loaded BIP-329 file.
   *
   * Never evidence of anything. The device decides an address is its own by
   * deriving it, which is what the path beside it records; a label is text
   * that arrived on a card. It is here because a column of twenty bech32
   * strings is unreadable and one of them saying "Rent" is not.
   */
  readonly label?: string | null
}

/** A registered quorum, and where this device sits in it. */
export interface QuorumView {
  readonly descriptor: string
  /** The eight characters every device in this quorum compares. */
  readonly checksum?: string
  readonly cosigners?: readonly {
    readonly position: number
    readonly name?: string
    readonly fingerprint?: string
    readonly xpub: string
    readonly isThisDevice: boolean
  }[]
  readonly threshold: number | null
  readonly total: number | null
  /** One-based, so it can be said out loud to another cosigner. */
  readonly ourPosition: number | null
  readonly unreadable: string | null
}

export interface WalletScreenProps {
  readonly fingerprint: string
  /**
   * Registered quorums.
   *
   * Shown because three identical devices holding one wallet all display the
   * same wallet name. Which cosigner you are holding is otherwise nowhere on
   * the screen, and that is how somebody signs with the wrong device.
   */
  readonly quorums?: readonly QuorumView[]
  readonly onAddresses: (
    scriptType: ScriptType,
    change: boolean,
    start: number,
    count: number
  ) => Promise<{ addresses: readonly AddressRow[] }>
  readonly onDescriptor: (
    scriptType: ScriptType,
    change: boolean
  ) => Promise<{ descriptor: string; checksum: string }>
  /**
   * The account xpub, with the origin a descriptor needs around it.
   *
   * Optional and secondary to the descriptor, which is the thing to export. An
   * xpub on its own says nothing about the script type, so pasting one into
   * software that guessed differently produces a watch-only wallet showing a
   * zero balance for a wallet that has coins in it. It is here because some
   * software still asks for exactly this and nothing else.
   */
  readonly onXpub?: (
    scriptType: ScriptType
  ) => Promise<{ xpub: string; path: string; masterFingerprint: string }>
  readonly onVerifyAddress: (address: string) => Promise<{
    found: boolean
    path?: string
    scriptType?: string
    change?: boolean
    searchedTo?: number
  }>
  /** Who this device is and which wallet it has open. See `Identity`. */
  readonly identity?: ReactNode
  readonly banner?: ReactElement | null
  /** The navigation rail, forwarded to Screen. */
  readonly nav?: ReactElement | null
}

const SCRIPT_TYPES: { id: ScriptType; label: string; note: string }[] = [
  { id: 'p2wpkh', label: 'Native segwit', note: 'BIP-84, bc1q. The default.' },
  { id: 'p2tr', label: 'Taproot', note: 'BIP-86, bc1p.' },
  { id: 'p2sh-p2wpkh', label: 'Nested segwit', note: 'BIP-49, starts with 3. For compatibility.' },
  { id: 'p2pkh', label: 'Legacy', note: 'BIP-44, starts with 1. For recovery.' },
]

/**
 * The two branches of a BIP-44 path, as two options rather than one toggle.
 *
 * "Receiving", not "Receive": this is the branch the list is showing, and the
 * menu has a Receive DESTINATION. The same word in two places, one a state and
 * one a journey, is the kind of collision that makes somebody tap the wrong
 * thing once and distrust the screen afterwards.
 */
const BRANCHES: { label: string; change: boolean; testId: string }[] = [
  { label: 'Receiving', change: false, testId: 'branch-receiving' },
  { label: 'Change', change: true, testId: 'branch-change' },
]

/**
 * The fourth tab is not a feature, it is a consequence of the panel.
 *
 * Every destination on this device used to be a button in the action bar, and
 * the bar reached eight buttons one addition at a time, each obviously fine on
 * its own. At 800px the last two were off the right edge of the screen: not
 * clipped, not scrollable, simply not there, on a device with no way to scroll
 * a document or resize a window.
 *
 * So the bar now holds what a bar is for, the way out and the primary action,
 * and everything that goes somewhere else lives in the body as a tap target
 * with a line saying what it does. That is better on a touchscreen regardless,
 * because a 40px button labelled "Manage" is both harder to hit and less
 * informative than a full-width row that says what managing means.
 */
type Tab = 'addresses' | 'export' | 'verify'

/**
 * Views OF the wallet. Not destinations: those are in the rail.
 *
 * "More" used to be here as well, which put the same word in two places
 * meaning the same thing once the rail existed. It is a destination, so it
 * lives in the rail and nowhere else.
 */
const TABS: { readonly id: Tab; readonly label: string }[] = [
  { id: 'addresses', label: 'Addresses' },
  { id: 'export', label: 'Export' },
  { id: 'verify', label: 'Verify an address' },
]

export function WalletScreen(props: WalletScreenProps): ReactElement {
  const {
    fingerprint,
    quorums = [],
    nav,
    onAddresses,
    onDescriptor,
    onXpub,
    onVerifyAddress,
    identity,
    banner,
  } = props

  const [tab, setTab] = useState<Tab>('addresses')
  const [scriptType, setScriptType] = useState<ScriptType>('p2wpkh')
  const [change, setChange] = useState(false)
  const [start, setStart] = useState(0)
  const [rows, setRows] = useState<readonly AddressRow[]>([])
  const [descriptor, setDescriptor] = useState<{ descriptor: string; checksum: string } | null>(
    null
  )
  const [xpub, setXpub] = useState<{
    xpub: string
    path: string
    masterFingerprint: string
  } | null>(null)
  const [query, setQuery] = useState('')
  const [verdict, setVerdict] = useState<Awaited<
    ReturnType<WalletScreenProps['onVerifyAddress']>
  > | null>(null)
  const [busy, setBusy] = useState(false)
  // Only the xpub disclosure writes this. Every other failure on this screen
  // leaves its section empty, which is legible; a disclosure that opens onto
  // nothing is not.
  const [xpubError, setXpubError] = useState<string | null>(null)

  const GAP = 10

  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      const result = await onAddresses(scriptType, change, start, GAP)
      if (!cancelled) setRows(result.addresses)
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [scriptType, change, start, onAddresses])

  useEffect(() => {
    if (tab !== 'export') return
    let cancelled = false
    const run = async (): Promise<void> => {
      const result = await onDescriptor(scriptType, change)
      if (!cancelled) setDescriptor(result)
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [tab, scriptType, change, onDescriptor])

  const verify = useCallback(async () => {
    setBusy(true)
    setVerdict(null)
    try {
      setVerdict(await onVerifyAddress(query.trim()))
    } finally {
      setBusy(false)
    }
  }, [query, onVerifyAddress])

  /**
   * The fingerprint, plus where this device sits in its quorums.
   *
   * One quorum names the position, because that is the fact somebody needs and
   * cannot get from anywhere else on the screen. Several give the count
   * instead: three positions in a subtitle is a subtitle nobody reads, and the
   * Quorums destination is one tap away and lists them properly.
   */
  const quorumSummary = ((): string => {
    const base = `Fingerprint ${fingerprint}`
    if (quorums.length === 0) return base

    const only = quorums.length === 1 ? quorums[0] : undefined
    if (only !== undefined) {
      // A quorum this device cannot place itself in says exactly that. A
      // position it had to guess at would be worse than none, and reporting it
      // as "in 1 quorum" would hide that the device does not know whether it
      // holds a key in the thing it is telling you about.
      return only.unreadable !== null
        ? `${base} \u00b7 in a quorum it cannot read`
        : `${base} \u00b7 ${String(only.threshold)} of ${String(only.total)}, cosigner ${String(only.ourPosition)}`
    }

    // Several. The Quorums destination lists them properly with positions;
    // three of them in a subtitle is a subtitle nobody reads.
    const unreadable = quorums.filter((quorum) => quorum.unreadable !== null).length
    const count = `${base} \u00b7 in ${String(quorums.length)} quorums`
    return unreadable === 0 ? count : `${count}, ${String(unreadable)} unreadable`
  })()

  /* The part of the derivation path that every row on show has in common,
     which is all of it but the index. Taken from the rows rather than rebuilt
     from the pickers, so it cannot disagree with what the daemon derived. */
  const pathPrefix = rows.length === 0 ? null : (rows[0]?.path.replace(/\/\d+$/, '') ?? null)

  return (
    <Screen
      title="Wallet"
      /*
       * The quorum summary rides in the SUBTITLE now.
       *
       * It used to be a card at the top of the body: seventy pixels of a
       * 480px panel spent on one line of text and a button, on the screen
       * named after an address list that then started below the fold. Both
       * halves already exist elsewhere. The Quorums destination lists every
       * quorum in full, and its own screen carries the "Compare addresses"
       * button this card duplicated.
       *
       * What is worth keeping at a glance is which cosigner this device is,
       * because every device in a quorum shows the same wallet name and that
       * number is what tells them apart. A subtitle holds that for free.
       */
      subtitle={quorumSummary}
      banner={banner}
      nav={nav}
      identity={identity}
      testId="wallet-screen"
      actions={
        <>
          {/* Lock and Sign moved to the rail, which is reachable from every
              screen rather than only this one. What is left here is what acts
              on the screen you are looking at, which is the rule an action bar
              should have followed all along: this one carried a session
              control, a task and pagination at equal weight. */}
          {tab === 'addresses' && (
            <>
              <Button
                disabled={start === 0}
                onClick={() => {
                  setStart(Math.max(0, start - GAP))
                }}
                testId="addresses-prev"
              >
                Previous
              </Button>
              <Button
                onClick={() => {
                  setStart(start + GAP)
                }}
                testId="addresses-next"
              >
                Next
              </Button>
            </>
          )}
          <div className="nr-spacer" />
        </>
      }
    >
      {/* NO INFO BOX HERE, DELIBERATELY.

          One was written and measured: two lines plus a gap, which took the
          address list from three rows back to one on the screen whose whole job
          is showing addresses. The tabs say Addresses, Export and Verify an
          address, which is the same information in the controls themselves, and
          the qualifier that actually matters is in the table heading beside the
          derivation path. A pattern applied where it costs more than it says is
          not consistency. */}
      <div className="nr-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className="nr-tab"
            aria-pressed={tab === t.id}
            onClick={() => {
              setTab(t.id)
            }}
            data-testid={`tab-${t.id}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* NOT a second row of tabs. These pick a script type, which is a
          property of the list below rather than a section of the screen, and
          rendering them identically to the section tabs put two rows of
          look-alike controls at two different levels of meaning directly on
          top of each other. Labelled and set apart instead. */}
      {tab !== 'verify' && (
        <div className="nr-pickers">
          <div className="nr-picker" data-testid="script-picker">
            <span className="nr-picker__label">Script type</span>
            {SCRIPT_TYPES.map((s) => (
              <button
                key={s.id}
                type="button"
                className="nr-picker__option"
                aria-pressed={scriptType === s.id}
                onClick={() => {
                  setScriptType(s.id)
                  setStart(0)
                  // The xpub on screen belongs to the previous script type, and an
                  // xpub read under the wrong heading is exactly the mistake the
                  // note beneath it warns about.
                  setXpub(null)
                }}
                data-testid={`script-${s.id}`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* WHICH BRANCH, as its own labelled picker.
          
          It used to be a single button in the row above, in the same pill as
          the four script types and separated from them only by a spacer, so a
          fifth pill reading "Receiving" sat beside four script types with one
          of them selected. The obvious reading is that Receiving is a fifth
          script type that happens to be off.
          
          It was also ambiguous on its own terms. The label named the state
          rather than the action, so a button reading "Change" is either "you
          are looking at change" or "tap to change something", and
          `aria-pressed` was tracking a third thing again. Two options with one
          pressed says which branch you are on and cannot be read as a verb. */}
          <div className="nr-picker" data-testid="branch-picker">
            <span className="nr-picker__label">Branch</span>
            {BRANCHES.map((b) => (
              <button
                key={b.label}
                type="button"
                className="nr-picker__option"
                aria-pressed={change === b.change}
                onClick={() => {
                  setChange(b.change)
                  setStart(0)
                }}
                data-testid={b.testId}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* THE LIST SCROLLS, THE CONTROLS DO NOT. `nr-fill` hands this the
          height left over after the tabs and the pickers, and takes the scroll
          off the body.

          Before this the whole body scrolled and the column headings went with
          it, so somebody reading the fifth address had no "Index" above the
          left column and no sight of whether they were on Receiving or on
          Change. Both of those are what tells you which address you are
          looking at. Measured then: ten rows laid out in a 333px window with
          none of them fully on screen, on the screen named Addresses. */}
      {tab === 'addresses' && (
        <div className="nr-card nr-card--tight nr-fill">
          <table className="nr-table nr-table--dense">
            {/* Sticky, so the headings survive the scroll they now sit above. */}
            <thead className="nr-table__stick">
              <tr>
                <th className="nr-table__index">Index</th>
                {/* THE PATH ONCE, IN THE HEADING, NOT UNDER EVERY ROW.

                    Every row carried its own derivation path, and every one of
                    them was the same string with the index changed: the script
                    type is a chip above this table, the branch is the chip
                    beside it, and the index is the column to the left, so the
                    path is fully determined by what is already on screen. It
                    was repetition, and it doubled the height of a row on the
                    screen whose whole job is showing addresses. One row fitted.

                    It is not dropped, because somebody restoring in other
                    software needs it. It is stated once, where it is true for
                    every row beneath it. */}
                <th>
                  Address
                  {pathPrefix !== null && (
                    <span className="nr-th__note nr-mono" data-testid="addresses-path">
                      {pathPrefix}/<span className="nr-th__slot">index</span>
                    </span>
                  )}
                  {/* WHICH ADDRESSES THESE ARE, on a device that holds more
                      than one answer. This list comes from this device's own
                      key: receiving to one of these puts money behind one key
                      rather than behind the quorum, which is the mistake the
                      Receive screen made until it learned to ask.

                      In the heading rather than above the card, for the same
                      reason as the path. It was a body child, so it cost its
                      own line plus a gap on a screen that had room for one
                      address, and it qualifies these rows rather than the
                      screen. */}
                  {quorums.length > 0 && (
                    <span className="nr-th__note" data-testid="addresses-not-the-quorum">
                      this device&rsquo;s own key alone can spend these, use Receive for the
                      quorum&rsquo;s
                    </span>
                  )}
                </th>
              </tr>
            </thead>
            <tbody data-testid="address-rows">
              {rows.map((row) => (
                <tr key={row.path}>
                  <td className="nr-mono nr-table__index">{row.index}</td>
                  <td>
                    <span className="nr-address">{row.address}</span>
                    {row.label !== undefined && row.label !== null && (
                      <div className="nr-hint" data-testid={`address-label-${String(row.index)}`}>
                        Your note: {row.label}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* THE QUORUM'S DESCRIPTOR FIRST, on a device that holds one, and this
          is the export that matters most on the whole device.

          A 2-of-3 CANNOT BE RECONSTRUCTED FROM MNEMONICS ALONE. Holding all
          three seed phrases is not enough: you also need to know the other
          keys, the threshold and the script type, and that is what the
          descriptor records. Somebody who backed up the single-signature
          descriptor below, on the strength of it saying it makes this wallet
          recoverable, would have backed up the wrong thing and would find out
          at the worst possible moment. */}
      {tab === 'export' && quorums.length > 0 && (
        <div className="nr-card nr-card--tight" data-testid="export-quorum">
          <span className="nr-card__label">Back this up: your quorum</span>
          {quorums.map((quorum) => (
            <div key={quorum.descriptor}>
              <div className="nr-row">
                <span className="nr-label">
                  {quorum.threshold} of {quorum.total}
                </span>
                <span className="nr-value nr-mono">{quorum.checksum}</span>
              </div>
              <div className="nr-address nr-break" data-testid="export-quorum-descriptor">
                {quorum.descriptor}
              </div>
            </div>
          ))}
          <p className="nr-hint">
            Your mnemonics are not enough to rebuild a quorum. Recovering one needs this line as
            well: it records the other keys, how many must sign, and the script type, and none of
            that is derivable from a seed phrase. Keep it wherever you keep the words, and it is not
            a secret: it holds no private key and cannot spend anything.
          </p>
        </div>
      )}

      {tab === 'export' && descriptor !== null && (
        <div className="nr-fill">
          {/* THE CODE BESIDE THE LINE IT ENCODES, the same way the signed
              transaction and the receive address do it. Everything this device
              hands out is a block of characters and a square, and they belong
              in one row: stacked, the square is always below the fold on a
              screen that already carries a descriptor. */}
          <div className="nr-split nr-split--aside">
            <div className="nr-split__col">
              <div className="nr-card nr-card--tight">
                <span className="nr-label">
                  {quorums.length > 0 ? 'This device alone, not the quorum' : 'Output descriptor'}
                </span>
                <div className="nr-address" data-testid="descriptor">
                  {descriptor.descriptor}
                </div>
              </div>
            </div>
            <QrDisplay text={descriptor.descriptor} fileType="unicode" testId="descriptor-qr" />
          </div>
          <p className="nr-note">
            {quorums.length > 0
              ? 'This describes a single-signature wallet holding only this device’s key. It is not your quorum and backing it up does not back your quorum up.'
              : 'This is what a coordinator needs, and it is what makes this wallet recoverable without nullroute.'}{' '}
            The eight characters after the <span className="nr-mono">#</span> are a checksum:
            compare them with the other party out of band, because a single mistyped character
            produces a valid descriptor for a different wallet.
          </p>

          {/* Behind a disclosure, and second. The descriptor is the export
              that carries its own script type; an xpub is the one that does
              not, and offering them side by side would present them as
              equivalent. */}
          {onXpub !== undefined && (
            <details className="nr-details">
              <summary className="nr-details__summary" data-testid="xpub-disclosure">
                Some software asks for an xpub instead
              </summary>
              {xpub === null ? (
                <>
                  <Button
                    onClick={() => {
                      void (async () => {
                        setXpubError(null)
                        try {
                          setXpub(await onXpub(scriptType))
                        } catch (err) {
                          setXpubError((err as Error).message)
                        }
                      })()
                    }}
                    testId="xpub-show"
                  >
                    Show the account xpub
                  </Button>
                  {xpubError !== null && (
                    <Refusal title="Not derived" testId="xpub-error">
                      {xpubError}
                    </Refusal>
                  )}
                </>
              ) : (
                <>
                  <div className="nr-card nr-card--tight">
                    <div className="nr-row">
                      <span className="nr-label">Origin</span>
                      <span className="nr-value nr-mono" data-testid="xpub-origin">
                        [{xpub.masterFingerprint}
                        {xpub.path.slice(1)}]
                      </span>
                    </div>
                    <div className="nr-address" data-testid="xpub">
                      {xpub.xpub}
                    </div>
                  </div>
                  <p className="nr-note" data-testid="xpub-note">
                    An xpub does not say which kind of address it makes. Software that guesses a
                    different script type from the one above builds a watch-only wallet with a zero
                    balance for a wallet that has coins in it, and nothing about that looks like an
                    error. Give the descriptor instead wherever it is accepted, and give the origin
                    in brackets alongside this wherever it is not.
                  </p>
                </>
              )}
            </details>
          )}
        </div>
      )}

      {/* Destinations, as tap targets with a line saying what each does. Every
          one of these was a 40px button in the action bar, which was both
          harder to hit and less informative, and two of them were off the edge
          of the panel entirely. */}

      {tab === 'verify' && (
        <>
          <div className="nr-field">
            <span className="nr-field__label">Address to check</span>
            <input
              className="nr-input"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
              }}
              placeholder="bc1..."
              data-testid="verify-input"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          <Button
            variant="primary"
            disabled={query.trim().length === 0 || busy}
            onClick={() => {
              void verify()
            }}
            testId="verify-run"
          >
            {busy ? 'Searching' : 'Is this mine?'}
          </Button>

          {verdict !== null && verdict.found && (
            <div className="nr-card nr-card--tight" data-testid="verify-found">
              <div className="nr-row">
                <span className="nr-label">Result</span>
                <span className="nr-status nr-status--ok">Yes, this address is yours</span>
              </div>
              <div className="nr-row">
                <span className="nr-label">Path</span>
                <span className="nr-value nr-mono">{verdict.path}</span>
              </div>
              <div className="nr-row">
                <span className="nr-label">Type</span>
                <span className="nr-value">
                  {verdict.scriptType}, {verdict.change === true ? 'change' : 'receive'}
                </span>
              </div>
              <p className="nr-hint">
                Re-derived from your seed at that path and compared exactly. This is not a lookup
                against a list the device was given.
              </p>
            </div>
          )}

          {verdict !== null && !verdict.found && (
            <div className="nr-banner nr-banner--caution" data-testid="verify-not-found">
              <strong>Not yours</strong>
              <span>
                This address did not derive from your seed in the first {verdict.searchedTo ?? 0}{' '}
                indices of any supported script type. If a coordinator told you it was yours, stop
                and find out why.
              </span>
            </div>
          )}
        </>
      )}
    </Screen>
  )
}
