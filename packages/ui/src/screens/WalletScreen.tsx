import { type ReactElement, useCallback, useEffect, useState } from 'react'
import { Screen } from '../components/Screen.js'
import { Button } from '../components/Button.js'

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
}

export interface WalletScreenProps {
  readonly fingerprint: string
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
  readonly onVerifyAddress: (address: string) => Promise<{
    found: boolean
    path?: string
    scriptType?: string
    change?: boolean
    searchedTo?: number
  }>
  /** Leaves for the signing screen. The reason this device exists. */
  readonly onSignTransaction: () => void
  readonly onLock: () => void
  readonly banner?: ReactElement | null
}

const SCRIPT_TYPES: { id: ScriptType; label: string; note: string }[] = [
  { id: 'p2wpkh', label: 'Native segwit', note: 'BIP-84, bc1q. The default.' },
  { id: 'p2tr', label: 'Taproot', note: 'BIP-86, bc1p.' },
  { id: 'p2sh-p2wpkh', label: 'Nested segwit', note: 'BIP-49, starts with 3. For compatibility.' },
  { id: 'p2pkh', label: 'Legacy', note: 'BIP-44, starts with 1. For recovery.' },
]

type Tab = 'addresses' | 'export' | 'verify'

export function WalletScreen(props: WalletScreenProps): ReactElement {
  const { fingerprint, onAddresses, onDescriptor, onVerifyAddress, onSignTransaction, onLock, banner } =
    props

  const [tab, setTab] = useState<Tab>('addresses')
  const [scriptType, setScriptType] = useState<ScriptType>('p2wpkh')
  const [change, setChange] = useState(false)
  const [start, setStart] = useState(0)
  const [rows, setRows] = useState<readonly AddressRow[]>([])
  const [descriptor, setDescriptor] = useState<{ descriptor: string; checksum: string } | null>(null)
  const [query, setQuery] = useState('')
  const [verdict, setVerdict] = useState<Awaited<
    ReturnType<WalletScreenProps['onVerifyAddress']>
  > | null>(null)
  const [busy, setBusy] = useState(false)

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
      testId="wallet-screen"
      actions={
        <>
          <Button onClick={onLock} testId="wallet-lock">
            Lock
          </Button>
          {/* The primary action on the device. Everything else on this screen
              is preparation for it, so it is not buried in a tab. */}
          <Button variant="primary" onClick={onSignTransaction} testId="wallet-sign">
            Sign a transaction
          </Button>
          <div className="nr-spacer" />
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
        </>
      }
    >
      <div className="nr-tabs">
        {(['addresses', 'export', 'verify'] as const).map((t) => (
          <button
            key={t}
            type="button"
            className="nr-tab"
            aria-pressed={tab === t}
            onClick={() => {
              setTab(t)
            }}
            data-testid={`tab-${t}`}
          >
            {t === 'addresses' ? 'Addresses' : t === 'export' ? 'Export' : 'Verify an address'}
          </button>
        ))}
      </div>

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
          {change ? 'Change' : 'Receive'}
        </button>
      </div>

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
                  <td className="nr-mono nr-table__index">
                    {row.index}
                  </td>
                  <td>
                    <span className="nr-address">{row.address}</span>
                    <div className="nr-hint nr-mono">{row.path}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'export' && descriptor !== null && (
        <>
          <div className="nr-card nr-card--tight">
            <span className="nr-label">Output descriptor</span>
            <div className="nr-address" data-testid="descriptor">
              {descriptor.descriptor}
            </div>
          </div>
          <p className="nr-note">
            This is what a coordinator needs, and it is what makes this wallet recoverable without
            nullroute. The eight characters after the <span className="nr-mono">#</span> are a
            checksum: compare them with the other party out of band, because a single mistyped
            character produces a valid descriptor for a different wallet.
          </p>
        </>
      )}

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
