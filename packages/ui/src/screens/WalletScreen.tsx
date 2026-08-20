import { type ReactElement, useCallback, useEffect, useState } from 'react'
import { Screen } from '../components/Screen.js'
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
  /**
   * Leaves for the quorum's addresses.
   *
   * The one screen that proves every cosigner registered the same descriptor,
   * so it is reached from the quorum itself rather than from a menu.
   */
  readonly onQuorum?: (quorum: QuorumView) => void
  /**
   * What this physical device is called. Rendered in the header by Screen.
   *
   * The lock screen is the single most important place for it: it is the first
   * thing shown when somebody picks a device up, and every device in a quorum
   * looks identical until one is unlocked.
   */
  readonly device?: { readonly name: string; readonly colour: string } | undefined
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
    onQuorum,
    device,
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

  return (
    <Screen
      title="Wallet"
      subtitle={`Fingerprint ${fingerprint}`}
      banner={banner}
      nav={nav}
      device={device}
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
      {quorums.length > 0 && (
        <div className="nr-card nr-card--tight" data-testid="wallet-quorums">
          {quorums.map((quorum, index) => (
            <div className="nr-row" key={index}>
              <span className="nr-label">Multisig</span>
              <span className="nr-value">
                {quorum.unreadable !== null
                  ? 'This device cannot place itself in this quorum'
                  : `${String(quorum.threshold)} of ${String(quorum.total)}, you are cosigner ${String(quorum.ourPosition)}`}
              </span>
              {/* Only for a quorum this device can actually place itself in.
                  Deriving addresses from a descriptor it cannot read would
                  produce an error, and offering the button anyway would make
                  the unreadable case look like a display problem. */}
              {onQuorum !== undefined && quorum.unreadable === null && (
                <Button
                  onClick={() => {
                    onQuorum(quorum)
                  }}
                  testId={`wallet-quorum-${String(index)}`}
                >
                  Addresses
                </Button>
              )}
            </div>
          ))}
          <p className="nr-hint">
            Every device in this quorum shows the same wallet name, because they hold the same
            wallet. The cosigner number is what tells them apart, and the addresses are what prove
            they all registered the same descriptor.
          </p>
        </div>
      )}

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

      {tab !== 'verify' && (
        <div className="nr-tabs">
          {SCRIPT_TYPES.map((s) => (
            <button
              key={s.id}
              type="button"
              className="nr-tab"
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
          <div className="nr-spacer" />
          <button
            type="button"
            className="nr-tab"
            aria-pressed={change}
            onClick={() => {
              setChange(!change)
              setStart(0)
            }}
            data-testid="toggle-change"
          >
            {/* "Receiving", not "Receive". This is the branch the list is
                showing, and the rail now has a Receive DESTINATION: the same
                word in two places, one a state and one a journey, is the kind
                of collision that makes somebody tap the wrong thing once and
                distrust the screen afterwards. */}
            {change ? 'Change' : 'Receiving'}
          </button>
        </div>
      )}

      {/* WHICH ADDRESSES THESE ARE, on a device that holds more than one
          answer. This list is derived from this device's own key: taking one
          and receiving to it puts money behind one key rather than behind the
          quorum, which is the mistake the Receive screen was making until it
          learned to ask. Only shown when there is something to confuse it
          with. */}
      {tab === 'addresses' && quorums.length > 0 && (
        <p className="nr-note" data-testid="addresses-not-the-quorum">
          These are this device&rsquo;s own addresses, not your quorum&rsquo;s. Money sent to one
          of these is spendable by this device alone. For an address your quorum controls, use
          Receive, or open the quorum below.
        </p>
      )}

      {tab === 'addresses' && (
        <div className="nr-card nr-card--tight">
          <table className="nr-table nr-table--dense">
            <thead>
              <tr>
                <th className="nr-table__index">Index</th>
                <th>Address</th>
              </tr>
            </thead>
            <tbody data-testid="address-rows">
              {rows.map((row) => (
                <tr key={row.path}>
                  <td className="nr-mono nr-table__index">{row.index}</td>
                  <td>
                    <span className="nr-address">{row.address}</span>
                    <div className="nr-hint nr-mono">{row.path}</div>
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
            that is derivable from a seed phrase. Keep it wherever you keep the words, and it is
            not a secret: it holds no private key and cannot spend anything.
          </p>
        </div>
      )}

      {tab === 'export' && descriptor !== null && (
        <>
          <div className="nr-card nr-card--tight">
            <span className="nr-label">
              {quorums.length > 0 ? 'This device alone, not the quorum' : 'Output descriptor'}
            </span>
            <div className="nr-address" data-testid="descriptor">
              {descriptor.descriptor}
            </div>
          </div>
          <QrDisplay text={descriptor.descriptor} fileType="unicode" testId="descriptor-qr" />
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
              <summary className="nr-details__summary">
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
                    <div className="nr-banner nr-banner--danger" data-testid="xpub-error">
                      <strong>Not derived</strong>
                      <span>{xpubError}</span>
                    </div>
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
        </>
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
            <div className="nr-banner nr-banner--testnet" data-testid="verify-not-found">
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
