import { type ReactElement, useCallback, useEffect, useState } from 'react'
import { Screen } from '../components/Screen.js'
import { Button } from '../components/Button.js'

/**
 * Addresses for a registered quorum.
 *
 * Spec: ui.screens.quorum-addresses
 *
 * THIS IS THE SCREEN THREE DEVICES COMPARE. A multisig address is derived from
 * every cosigner's key at once, so it is the one value that proves all of them
 * registered the same descriptor. Two devices showing a different address at
 * index 0 means somebody's descriptor differs by a character, and the money
 * sent to the wrong one is spendable only by whoever holds that other quorum.
 *
 * The consequence of finding that out late is severe and the consequence of
 * finding it out here is nothing at all, which is why this screen exists rather
 * than a note in the documentation telling people to check.
 *
 * The address is derived from the descriptor, not read from a file, so this
 * device is stating what IT believes the quorum's addresses are. That is the
 * useful claim: an address that matched because both devices read the same
 * wrong file would prove nothing.
 */

export interface QuorumAddressRow {
  readonly address: string
  readonly index: number
}

export interface QuorumAddressesScreenProps {
  /** The registered descriptor these addresses come from. */
  readonly descriptor: string
  /** How this device sits in the quorum, for the header. Already one-based. */
  readonly position?: { readonly ours: number; readonly of: number } | undefined
  readonly onAddresses: (
    descriptor: string,
    change: boolean,
    start: number,
    count: number
  ) => Promise<{ addresses: readonly QuorumAddressRow[]; change: boolean }>
  readonly onBack: () => void
  /** Where this screen sits in a journey, when it is part of one. */
  readonly steps?: ReactElement | null
  /** Back to the wallet, or the picker. Rendered in the header by Screen. */
  readonly onHome?: (() => void) | undefined
  /** What this physical device is called. Rendered in the header by Screen. */
  readonly device?: { readonly name: string; readonly colour: string } | undefined
  readonly banner?: ReactElement | null
}

const PAGE = 10

export function QuorumAddressesScreen(props: QuorumAddressesScreenProps): ReactElement {
  const { descriptor, position, onAddresses, onBack, steps, onHome, device, banner } = props

  const [change, setChange] = useState(false)
  const [start, setStart] = useState(0)
  const [rows, setRows] = useState<readonly QuorumAddressRow[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    // Cleared first. Leaving the previous page on screen while the next one
    // derives means a user reads index 0 under a header that says index 10,
    // and reading the wrong row against another device is the exact mistake
    // this screen exists to prevent.
    setRows([])
    setError(null)
    try {
      const result = await onAddresses(descriptor, change, start, PAGE)
      setRows(result.addresses)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [descriptor, change, start, onAddresses])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Screen
      title="Quorum addresses"
      subtitle={
        position === undefined
          ? 'Derived on this device from the registered descriptor.'
          : `This device is cosigner ${String(position.ours)} of ${String(position.of)}.`
      }
      banner={banner}
      onHome={onHome}
      device={device}
      steps={steps}
      testId="quorum-addresses"
      actions={
        <>
          <Button onClick={onBack} testId="quorum-back">
            Back
          </Button>
          <div className="nr-spacer" />
          <Button
            disabled={start === 0}
            onClick={() => {
              setStart(Math.max(0, start - PAGE))
            }}
            testId="quorum-prev"
          >
            Back {PAGE}
          </Button>
          <Button
            onClick={() => {
              setStart(start + PAGE)
            }}
            testId="quorum-next"
          >
            Next {PAGE}
          </Button>
        </>
      }
    >
      <div className="nr-tabs">
        {([false, true] as const).map((branch) => (
          <button
            key={String(branch)}
            type="button"
            className="nr-tab"
            aria-pressed={change === branch}
            onClick={() => {
              setChange(branch)
              setStart(0)
            }}
            data-testid={`quorum-branch-${branch ? 'change' : 'receive'}`}
          >
            {branch ? 'Change' : 'Receive'}
          </button>
        ))}
      </div>

      {error !== null && (
        <div className="nr-banner nr-banner--danger" data-testid="quorum-error">
          <strong>Not derived</strong>
          <span>{error}</span>
        </div>
      )}

      <table className="nr-table nr-table--dense" data-testid="quorum-rows">
        <thead>
          <tr>
            <th className="nr-table__index">#</th>
            <th>Address</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.index}>
              <td className="nr-mono nr-table__index">{row.index}</td>
              <td className="nr-mono nr-break">{row.address}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* The whole point, said where it is read rather than in a document. */}
      <p className="nr-note" data-testid="quorum-compare">
        Read one of these aloud against the same index on another device in this quorum. They are
        derived from every cosigner&apos;s key at once, so two devices agreeing here is the proof
        that every one of them registered the same descriptor. If they differ, do not send anything:
        one of the devices has a descriptor that is off by a character, and coins sent to the wrong
        address are spendable only by whoever holds that other quorum.
      </p>
    </Screen>
  )
}
