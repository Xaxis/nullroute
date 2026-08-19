import { type ReactElement, useCallback, useEffect, useState } from 'react'
import { Screen } from '../components/Screen.js'
import { Button } from '../components/Button.js'
import { QrDisplay } from '../components/QrDisplay.js'

/**
 * One address, big enough to read off the screen.
 *
 * Spec: ui.screens.receive
 *
 * The wallet screen lists twenty addresses in a table, which is the right shape
 * for auditing an account and the wrong shape for taking one. Receiving is the
 * task where a person reads characters off this panel and compares them with
 * another screen, and a dense table on a 7 inch display is where that goes
 * wrong: the eye slips a row, and a row here is a different address.
 *
 * So this shows exactly one, in the largest type the panel affords, chunked the
 * way the manifest hash is chunked, with the derivation path beside it. Moving
 * to the next one is a deliberate tap.
 *
 * THE WARNING IS THE POINT OF THE SCREEN. An air-gapped signer protects the
 * key and cannot protect the address on its way to whoever is paying you. The
 * ordinary way this money is lost has nothing to do with cryptography: software
 * on the networked machine replaces the address after it is copied, the payer
 * sends to the attacker, and every screen involved looks correct. Reading the
 * address off THIS panel, character by character, against what the payer is
 * about to send to, is the only step that catches it.
 */

export interface ReceiveAddress {
  readonly address: string
  readonly path: string
  readonly index: number
}

export interface ReceiveScreenProps {
  /**
   * How the device describes itself, for the header.
   *
   * Several identical devices in a quorum show the same wallet name, so the
   * cosigner position is what tells them apart, and taking an address from the
   * wrong one is a wallet nobody is watching.
   */
  readonly walletLabel: string
  readonly onAddress: (index: number) => Promise<ReceiveAddress>
  /** Confirms the shown address really derives from this device's keys. */
  readonly onVerify: (address: string) => Promise<{ found: boolean; path?: string }>
  readonly onBack: () => void
  readonly steps?: ReactElement | null
  /** Back to the wallet, or the picker. Rendered in the header by Screen. */
  readonly onHome?: (() => void) | undefined
  /** What this physical device is called. Rendered in the header by Screen. */
  readonly device?: { readonly name: string; readonly colour: string } | undefined
  readonly banner?: ReactElement | null
}

/** Groups of four, so two people can read it to each other without losing place. */
export function chunkAddress(address: string): string {
  return (address.match(/.{1,4}/gu) ?? [address]).join(' ')
}

export function ReceiveScreen(props: ReceiveScreenProps): ReactElement {
  const { walletLabel, onAddress, onVerify, onBack, steps, onHome, device, banner } = props

  const [index, setIndex] = useState(0)
  const [shown, setShown] = useState<ReceiveAddress | null>(null)
  const [verified, setVerified] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    // Cleared first, both of them. An address left on screen while the next one
    // derives is an address being read under the wrong index, and a verified
    // tick left over from the previous address is worse than no tick at all.
    setShown(null)
    setVerified(null)
    setError(null)
    try {
      setShown(await onAddress(index))
    } catch (err) {
      setError((err as Error).message)
    }
  }, [index, onAddress])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Screen
      title="Receive"
      subtitle={walletLabel}
      banner={banner}
      onHome={onHome}
      device={device}
      steps={steps}
      testId="receive-screen"
      actions={
        <>
          <Button onClick={onBack} testId="receive-back">
            Back
          </Button>
          <div className="nr-spacer" />
          <Button
            disabled={index === 0}
            onClick={() => {
              setIndex(Math.max(0, index - 1))
            }}
            testId="receive-prev"
          >
            Previous
          </Button>
          {/* Not "next unused". This device has no network, so it cannot know
              which addresses have been paid to, and a label claiming otherwise
              would be the one lie an air-gapped wallet must not tell. */}
          <Button
            onClick={() => {
              setIndex(index + 1)
            }}
            testId="receive-next"
          >
            Another
          </Button>
        </>
      }
    >
      {error !== null && (
        <div className="nr-banner nr-banner--danger" data-testid="receive-error">
          <strong>Not derived</strong>
          <span>{error}</span>
        </div>
      )}

      {shown !== null && (
        <>
          <div className="nr-receive" data-testid="receive-address">
            <span className="nr-receive__value">{chunkAddress(shown.address)}</span>
            <span className="nr-receive__path nr-mono" data-testid="receive-path">
              {shown.path}
            </span>
          </div>

          {/* The whole reason the screen exists, and not behind a disclosure.
              Above the QR code, because the characters are what protect the
              money and the code is a convenience: on a 480px panel a full size
              QR put this warning below the fold, which is precisely where it
              stops working. */}
          <div className="nr-banner nr-banner--testnet" data-testid="receive-warning">
            <strong>Read it from this screen, not from the one you paste it into</strong>
            <span>
              This device has no network and cannot protect the address on its way to whoever is
              paying you. Software that swaps an address after it is copied is the ordinary way
              this money is lost, and every screen involved looks correct. Compare the characters
              above against what the payer is about to send to.
            </span>
          </div>

          <div className="nr-qr--small">
            <QrDisplay text={shown.address} fileType="unicode" testId="receive-qr" />
          </div>

          {verified === null ? (
            <Button
              disabled={busy}
              onClick={() => {
                void (async () => {
                  setBusy(true)
                  try {
                    const verdict = await onVerify(shown.address)
                    setVerified(verdict.found)
                  } catch (err) {
                    setError((err as Error).message)
                  } finally {
                    setBusy(false)
                  }
                })()
              }}
              testId="receive-verify"
            >
              {busy ? 'Checking' : 'Check this address is really mine'}
            </Button>
          ) : verified ? (
            <p className="nr-note" data-testid="receive-verified">
              Re-derived from this device&apos;s keys and it matches. That proves the address on
              this screen is yours. It proves nothing about the address on any other screen.
            </p>
          ) : (
            <div className="nr-banner nr-banner--danger" data-testid="receive-unverified">
              <strong>This device could not find that address</strong>
              <span>
                It was shown by this screen and does not re-derive from this wallet. Do not use it.
                Something is wrong with this device or with what it just displayed.
              </span>
            </div>
          )}
        </>
      )}
    </Screen>
  )
}
