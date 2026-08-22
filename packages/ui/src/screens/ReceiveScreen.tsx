import { type ReactElement, type ReactNode, useCallback, useEffect, useState } from 'react'
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

/** A registered quorum this wallet can receive to. */
export interface ReceiveSource {
  /** The eight characters every device in the quorum compares. */
  readonly checksum: string
  readonly threshold: number | null
  readonly total: number | null
  readonly descriptor: string
}

export interface ReceiveScreenProps {
  /**
   * Quorums registered on this identity, if any.
   *
   * THE BUG THIS EXISTS FOR. This screen derived a single-signature address and
   * nothing else. On a device holding a registered 2-of-3, tapping Receive
   * produced an address spendable by that one device, which is precisely what
   * the quorum was set up to prevent. Money sent there is not lost, and it is
   * protected by one key instead of two, and nothing on the screen said which
   * kind of address it was showing.
   *
   * So a device in a quorum is asked which wallet the money is for, and the
   * quorum is the default. Somebody who registered a 2-of-3 and then wanted a
   * single-signature address has to say so.
   */
  readonly quorums?: readonly ReceiveSource[]
  /** Derive from one quorum, when a quorum is chosen. */
  readonly onQuorumAddress?:
    ((descriptor: string, index: number) => Promise<ReceiveAddress>) | undefined
  readonly onAddress: (index: number) => Promise<ReceiveAddress>
  /**
   * Confirms the shown address really derives from this device's keys.
   *
   * SINGLE-SIGNATURE ONLY. A quorum address does not derive from this device
   * alone by construction, so asking this about one and reporting the answer
   * would put "this device could not find that address" under an address that
   * is perfectly correct. That is worse than no check: it teaches somebody to
   * ignore the one alarm on the screen.
   */
  readonly onVerify: (address: string) => Promise<{ found: boolean; path?: string }>
  /**
   * Re-derives a quorum address from the registered descriptor.
   *
   * Separate from `onVerify` because it answers a different question. This one
   * asks whether the address came out of the descriptor every device in the
   * quorum agreed on, which is what a user is actually checking when they take
   * a multisig address off a screen.
   */
  readonly onVerifyQuorum?:
    | ((descriptor: string, address: string) => Promise<{ found: boolean; index?: number }>)
    | undefined
  readonly onBack: () => void
  readonly steps?: ReactElement | null
  /** Who this device is and which wallet it has open. See `Identity`. */
  readonly identity?: ReactNode
  readonly banner?: ReactElement | null
  /** The navigation rail, forwarded to Screen. Always safe to leave this screen. */
  readonly nav?: ReactElement | null
}

/** Groups of four, so two people can read it to each other without losing place. */
export function chunkAddress(address: string): string {
  return (address.match(/.{1,4}/gu) ?? [address]).join(' ')
}

export function ReceiveScreen(props: ReceiveScreenProps): ReactElement {
  const {
    quorums = [],
    onQuorumAddress,
    onAddress,
    onVerify,
    onVerifyQuorum,
    onBack,
    steps,
    identity,
    banner,
    nav,
  } = props

  /**
   * Which wallet the money is for.
   *
   * Defaults to the FIRST registered quorum when there is one, because a device
   * that has been through registration is a device somebody set up a quorum on,
   * and defaulting to the single-signature address there is defaulting to the
   * weaker answer silently. Null means single-signature, chosen explicitly.
   */
  const [source, setSource] = useState<ReceiveSource | null>(quorums[0] ?? null)

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
      // The quorum's address when a quorum is chosen, this device's own only
      // when it was chosen explicitly. Falling back to the single-signature
      // path because the quorum derivation is unavailable would hand somebody
      // the weaker address at the moment they were told they were getting the
      // stronger one, so it fails instead.
      if (source !== null) {
        if (onQuorumAddress === undefined) {
          throw new Error(
            'This build cannot derive a quorum address, so it will not show one. Do not use ' +
              'the single-signature address below for money meant for the quorum.'
          )
        }
        setShown(await onQuorumAddress(source.descriptor, index))
        return
      }
      setShown(await onAddress(index))
    } catch (err) {
      setError((err as Error).message)
    }
  }, [index, onAddress, onQuorumAddress, source])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Screen
      title="Receive"
      /* Not the wallet label. The identity chip in this same header names the
         open wallet on every screen now, so this was the name twice, two
         hundred pixels apart, where the subtitle's job is saying what THIS
         screen is for. */
      subtitle="An address to give somebody, one at a time."
      banner={banner}
      nav={nav}
      identity={identity}
      steps={steps}
      testId="receive-screen"
      actions={
        <>
          <Button onClick={onBack} testId="receive-back">
            Back
          </Button>
          <div className="nr-spacer" />
          {/* IN THE BAR, LIKE EVERY OTHER CHECK ON THE DEVICE.

              This was a full width button in the body carrying its whole
              sentence as a label, so the same act had two treatments: the
              screen that checks somebody else's proof puts "Check it" in the
              action bar, and this one put "Check this address is really mine"
              in the middle of the page. The sentence is not lost, it is the
              subtitle of the note the check produces.

              It also bought back 56px on the path where this device is in a
              quorum and somebody picks the single-signature address anyway,
              which is the path carrying two warnings and a QR code. */}
          {verified === null && shown !== null && (
            <Button
              disabled={busy}
              onClick={() => {
                void (async () => {
                  setBusy(true)
                  try {
                    // The right question for the address actually on screen.
                    // Asking whether a quorum address derives from this device
                    // alone answers no, correctly, about something that is not
                    // wrong, and the screen would shout about it.
                    const verdict =
                      source === null || onVerifyQuorum === undefined
                        ? await onVerify(shown.address)
                        : await onVerifyQuorum(source.descriptor, shown.address)
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
              {busy ? 'Checking' : 'Check it'}
            </Button>
          )}
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

      {/* WHICH WALLET THIS ADDRESS IS FOR, first and always, on a device that
          holds more than one answer. A 2-of-3 and this device's own key derive
          completely different addresses, both look like ordinary bech32, and
          money sent to the wrong one is protected by one key instead of two.
          Only shown when there is a choice: a device in no quorum has one
          answer and a tab bar with one tab is furniture. */}
      {quorums.length > 0 && (
        /* The tabs and the sentence about what they picked, on one line. The
           sentence describes the chosen source, so it belongs beside the
           control that chose it rather than on a row of its own, which is
           where it was costing the QR code below it 41px of the panel. */
        <div className="nr-beside">
          <div className="nr-tabs" data-testid="receive-sources">
            {quorums.map((quorum) => (
              <button
                key={quorum.checksum}
                type="button"
                className="nr-tab"
                aria-pressed={source?.checksum === quorum.checksum}
                onClick={() => {
                  setSource(quorum)
                }}
                data-testid={`receive-source-${quorum.checksum}`}
              >
                {quorum.threshold} of {quorum.total}
              </button>
            ))}
            <button
              type="button"
              className="nr-tab"
              aria-pressed={source === null}
              onClick={() => {
                setSource(null)
              }}
              data-testid="receive-source-single"
            >
              This device alone
            </button>
          </div>

          {source === null ? (
            /* Chosen deliberately, and said plainly, because it is the weaker
               answer on a device that holds a quorum. */
            <div className="nr-banner nr-banner--danger" data-testid="receive-single-warning">
              <strong>This address is protected by this device alone</strong>
              <span>
                Not by your quorum. Whoever holds this one device can spend anything sent here,
                which is the thing the quorum was set up to prevent. Use it only if you meant to.
              </span>
            </div>
          ) : (
            <p className="nr-hint" data-testid="receive-quorum-note">
              A {source.threshold} of {source.total} address, from the quorum whose checksum is{' '}
              <span className="nr-mono">{source.checksum}</span>. Spending from it needs{' '}
              {source.threshold} of the devices, and this is one of them.
            </p>
          )}
        </div>
      )}

      {shown !== null && (
        <>
          {/* THE ADDRESS AND ITS CODE IN ONE ROW, AND THE WARNING UNDER THEM.

              These used to stack, on the reasoning that the characters are what
              protect the money and the code is a convenience, so the warning
              took the space above the fold and the code took what was left.
              Measured on the built gallery, what was left was not enough: 44px
              of a 144px code sat under the action bar, on the one screen whose
              job is handing somebody something to point a camera at. A code
              that is three quarters visible looks scannable and is not.

              It was a real trade and it was between the wrong two things. The
              panel is 800px wide and this is a column down the middle of it.

              The address is in the same row as the code because they are one
              thing in two forms, and on the path where this device is in a
              quorum and somebody picks the single-signature address anyway,
              that row is what buys the second warning its room. */}
          <div className="nr-split nr-split--aside" data-testid="receive-split">
            <div className="nr-split__col">
              <div className="nr-receive" data-testid="receive-address">
                <span className="nr-receive__value">{chunkAddress(shown.address)}</span>
                <span className="nr-receive__path nr-mono" data-testid="receive-path">
                  {shown.path}
                </span>
              </div>

              <div className="nr-banner nr-banner--testnet" data-testid="receive-warning">
                <strong>Read it from this screen, not from the one you paste it into</strong>
                <span>
                  This device has no network and cannot protect the address on its way to whoever is
                  paying you. Software that swaps an address after it is copied is the ordinary way
                  this money is lost, and every screen involved looks correct. Compare the
                  characters above against what the payer is about to send to.
                </span>
              </div>

              {verified === true ? (
                <p className="nr-note" data-testid="receive-verified">
                  {source === null
                    ? 'Re-derived from this device\u2019s keys and it matches. That proves the address on this screen is yours. It proves nothing about the address on any other screen.'
                    : `Re-derived from the ${String(source.threshold)} of ${String(source.total)} descriptor and it matches. That proves the address on this screen belongs to the quorum. It proves nothing about the address on any other screen.`}
                </p>
              ) : verified === false ? (
                <div className="nr-banner nr-banner--danger" data-testid="receive-unverified">
                  <strong>This device could not find that address</strong>
                  <span>
                    It was shown by this screen and does not re-derive from{' '}
                    {source === null ? 'this wallet' : 'the registered descriptor'}. Do not use it.
                    Something is wrong with this device or with what it just displayed.
                  </span>
                </div>
              ) : null}
            </div>

            {/* The right column, and last in the DOM on purpose. A screen
                reader reaches the address, then the warning about reading it
                off this panel, and only then the code, which is the order
                somebody should meet them in. Sighted users see the code
                immediately because it is the only white rectangle on a dark
                screen. */}
            <div className="nr-qr--small">
              <QrDisplay text={shown.address} fileType="unicode" testId="receive-qr" />
            </div>
          </div>
        </>
      )}
    </Screen>
  )
}
