import { type ReactElement, type ReactNode, useState } from 'react'
import { Screen } from '../components/Screen.js'
import { Refusal } from '../components/Refusal.js'
import { Working } from '../components/Working.js'
import { TextKeyboard } from '../components/TextKeyboard.js'
import { Button } from '../components/Button.js'
import { Info } from '../components/Info.js'

/**
 * Every quorum this device is in, and what it cannot tell you about them.
 *
 * Spec: ui.screens.fleet
 *
 * The wallet screen shows a one-line summary per quorum and the multisig screen
 * shows one quorum at a time, during registration. Neither answers the question
 * somebody holding the second of three devices actually has: what am I part of,
 * who else is in it, and is any of it finished.
 *
 * THE HONEST HALF IS THE POINT. This device cannot know whether the other
 * cosigners registered the descriptor, and it cannot know whether the
 * coordinator ever imported the bundle. Both are facts about other machines,
 * and this one has no network. A screen that showed a tick beside "all
 * cosigners registered" would be inventing a status, and the whole reason a
 * quorum is dangerous is that an unfinished one looks exactly like a finished
 * one: it receives money either way.
 *
 * So the outstanding work is presented as a list of things to confirm yourself,
 * with the device saying plainly that it is not reporting them. That is less
 * satisfying than a green tick and it is the only version that is true.
 */

export interface FleetCosigner {
  readonly position: number
  readonly name?: string
  readonly fingerprint?: string
  readonly xpub: string
  readonly isThisDevice: boolean
}

export interface FleetQuorum {
  readonly descriptor: string
  /** The eight characters every device in this quorum compares. */
  readonly checksum: string
  readonly threshold: number | null
  readonly total: number | null
  /** One-based, so it can be said out loud. */
  readonly ourPosition: number | null
  readonly cosigners: readonly FleetCosigner[]
  /** Why the device could not place itself in this quorum, if it could not. */
  readonly unreadable: string | null
}

export interface FleetScreenProps {
  readonly quorums: readonly FleetQuorum[]
  /** The name of the device in your hand, so the list has a subject. */
  readonly deviceName?: string | undefined
  readonly onAddresses?: ((quorum: FleetQuorum) => void) | undefined
  /**
   * Forget a registered quorum.
   *
   * A quorum registered by mistake was permanent, which is a strange property
   * for the step the documentation calls dangerous. Confirmed by typing the
   * checksum, for the same reason erasing a wallet is confirmed by typing its
   * name: a second tap on a 7 inch panel lands where the last one did.
   *
   * `persisted` is whether the removal was written into the saved wallet. It
   * is the daemon's answer and the list reports it, because a removal that
   * was not written comes back at the next unlock (INV-UI-104).
   */
  readonly onForget?:
    ((quorum: FleetQuorum) => Promise<{ readonly persisted: boolean }>) | undefined
  readonly onBack: () => void
  /** Who this device is and which wallet it has open. See `Identity`. */
  readonly identity?: ReactNode
  readonly banner?: ReactElement | null
  /** The navigation rail, forwarded to Screen. Always safe to leave this screen. */
  readonly nav?: ReactElement | null
}

export function FleetScreen(props: FleetScreenProps): ReactElement {
  const { quorums, deviceName, onAddresses, onForget, onBack, identity, banner, nav } = props

  const [forgetting, setForgetting] = useState<FleetQuorum | null>(null)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** What the daemon said about the last removal, or null before there is one. */
  const [forgot, setForgot] = useState<{ readonly persisted: boolean } | null>(null)

  // --- Confirming a removal -------------------------------------------------
  if (forgetting !== null) {
    // Case folded, for the reason the erase panel folds it: the only keyboard
    // on this device has a one-shot shift, and what the gesture proves is that
    // the person can read the checksum off the header, not that they can work
    // the shift key. The checksum is lower case base32 to begin with.
    const confirmed = typed.trim().toLowerCase() === forgetting.checksum.toLowerCase()
    return (
      <Screen
        title="Forget this quorum"
        /* THE CHECKSUM IS IN THE HEADER BECAUSE IT HAS TO SURVIVE BEING COPIED.
           It used to appear only as the placeholder on the field and on the
           keyboard, and a placeholder is gone the moment somebody types into
           it: you tapped one character of an eight character base32 string and
           the other seven were no longer on the screen. The header does not
           scroll, which is the same reason the erase panel puts the wallet name
           there. */
        subtitle={`${String(forgetting.threshold)} of ${String(forgetting.total)}, checksum ${forgetting.checksum}`}
        banner={banner}
        nav={nav}
        identity={identity}
        testId="fleet-forget"
        actions={
          <>
            <Button
              onClick={() => {
                setForgetting(null)
                setTyped('')
                setError(null)
              }}
              testId="fleet-forget-cancel"
            >
              Keep it
            </Button>
            <div className="nr-spacer" />
            <Button
              variant="danger"
              disabled={!confirmed || busy || onForget === undefined}
              onClick={() => {
                void (async () => {
                  if (onForget === undefined) return
                  setBusy(true)
                  setError(null)
                  try {
                    const outcome = await onForget(forgetting)
                    setForgot({ persisted: outcome.persisted === true })
                    setForgetting(null)
                    setTyped('')
                  } catch (err) {
                    setError((err as Error).message)
                  } finally {
                    setBusy(false)
                  }
                })()
              }}
              testId="fleet-forget-submit"
            >
              {busy ? 'Forgetting' : 'Forget it'}
            </Button>
          </>
        }
      >
        {/* FIRST IN THE BODY, because a refusal nobody sees is a refusal that
            did not happen. This was last, under the keyboard, which put it at
            528..568 on a panel whose body ends at 407: a hundred and sixty one
            pixels below the fold. Tapping Forget it and being refused changed
            nothing the user could see. ManageWalletScreen carries the same
            comment for the same reason. */}
        {error !== null && (
          <Refusal title="Not forgotten" testId="fleet-forget-error">
            {error}
          </Refusal>
        )}

        {/* Forgetting CAN reseal the wallet, given a passphrase: two key
            derivations, the same as renaming. This panel sends none, because
            the keyboard's budget is already spent on the checksum, so the
            removal is held for the session and the list says so afterwards.
            The message says only what is true either way; it said "the wallet
            file is being rewritten", which it was not. INV-UI-104. */}
        {busy && (
          <Working label="Forgetting the quorum" testId="fleet-forget-working">
            Leave the device alone until it is finished.
          </Working>
        )}

        {/* What it costs, which is not what people assume. A registration is
            not a key, so nothing here loses money. What it loses is the
            device's ability to tell this quorum's change from a stranger.

            A HEADING AND TWO LINES, because the panel holds a keyboard and the
            budget above the keys is 70px. This said four lines and the field
            below it took another 68, so the keys ran to 514 against an action
            bar at 407: a hundred and seven pixels of the only input device this
            machine has, underneath the bar. Nothing had ever reported it,
            because the tap that reaches this panel is a row low in a list, and
            the harness scrolled the body to reach it before measuring. */}
        <div className="nr-banner nr-banner--caution" data-testid="fleet-forget-cost">
          <strong>This does not lose any money</strong>
          <span>
            A registration is not a key. Change coming back from that quorum will read as a payment
            to a stranger until you register the descriptor again.
          </span>
        </div>

        {/* THE KEYBOARD READOUT IS THE FIELD, the way it is on the panel that
            erases a wallet. A labelled input above the keys showed the same
            eight characters twice and cost 82px of the 70 there are, and it
            showed them in plain mono while the readout under it showed dots:
            the same value, on the same panel, contradicting itself about
            whether it was a secret.

            It is not. A checksum is what you compare against the header, and
            dots compare to nothing. */}
        {!busy && (
          <TextKeyboard
            value={typed}
            onChange={(next) => {
              setError(null)
              setTyped(next)
            }}
            secret={false}
            placeholder="Type the checksum to confirm"
            testId="fleet-forget-keyboard"
          />
        )}

        {/* Below the keys, because it is advice rather than a warning: what to
            do if you might want the quorum back, which is not a thing anybody
            needs to read before deciding. */}
        <Info testId="fleet-forget-keep">
          Keep the descriptor somewhere if you might want it back. Registering it again is the only
          way this device recognises that quorum&rsquo;s change as its own, and nothing here can
          reconstruct a descriptor it has forgotten. Forgetting it here does not remove it from a
          saved wallet: it is gone until the device locks, and back at the next unlock.
        </Info>
      </Screen>
    )
  }

  return (
    <Screen
      title="Quorums"
      subtitle={
        deviceName === undefined
          ? `${String(quorums.length)} registered on this device.`
          : `${String(quorums.length)} registered on ${deviceName}.`
      }
      banner={banner}
      nav={nav}
      identity={identity}
      testId="fleet-screen"
      actions={
        <Button onClick={onBack} testId="fleet-back">
          Back
        </Button>
      }
    >
      {/* THE DAEMON'S ANSWER, not an assumption about it. A removal that was
          not written into the saved wallet comes back at the next unlock, and
          a list that silently lost the quorum would read as permanent.
          INV-UI-104. */}
      {forgot !== null && (
        <div
          className={`nr-banner ${forgot.persisted === true ? 'nr-banner--ok' : 'nr-banner--caution'}`}
          data-testid="fleet-forgot"
        >
          <strong>{forgot.persisted === true ? 'Forgotten' : 'Forgotten for this session'}</strong>
          <span>
            {forgot.persisted === true
              ? 'It is removed from the saved wallet too.'
              : 'Nothing was written to a saved wallet. If it was saved there, it is back at the next unlock.'}
          </span>
        </div>
      )}

      {quorums.length === 0 && (
        <Info testId="fleet-empty">
          This device is not in any quorum yet. Registering one is what makes it recognise that
          quorum&rsquo;s change as its own, and until then it can sign for a single-signature wallet
          and nothing else.
        </Info>
      )}

      {quorums.map((quorum) => (
        <div className="nr-card" key={quorum.descriptor} data-testid="fleet-quorum">
          {quorum.unreadable !== null ? (
            <>
              <span className="nr-card__label">Cannot be read</span>
              <p className="nr-hint">{quorum.unreadable}</p>
            </>
          ) : (
            <>
              <div className="nr-row">
                <span className="nr-label">Quorum</span>
                <span className="nr-value">
                  {quorum.threshold} of {quorum.total} must sign
                </span>
              </div>
              <div className="nr-row">
                <span className="nr-label">This device</span>
                <span className="nr-value nr-ok" data-testid="fleet-position">
                  cosigner {quorum.ourPosition} of {quorum.total}
                </span>
              </div>
              <div className="nr-row">
                <span className="nr-label">Checksum</span>
                <span className="nr-value nr-mono" data-testid="fleet-checksum">
                  {quorum.checksum}
                </span>
              </div>

              <table className="nr-table nr-table--dense">
                <tbody>
                  {quorum.cosigners.map((cosigner) => (
                    <tr key={cosigner.position}>
                      <td className="nr-mono nr-table__index">{cosigner.position + 1}</td>
                      <td>
                        {cosigner.isThisDevice ? (
                          <span className="nr-ok">this device</span>
                        ) : (
                          <>
                            {/* A name if there is one, and an honest gap if
                                there is not. "Unnamed" is a prompt; inventing
                                something from the fingerprint would be dressing
                                up four bytes chosen by whoever wrote the
                                descriptor. */}
                            <div>
                              {cosigner.name ?? <span className="nr-hint">not named yet</span>}
                            </div>
                            <div className="nr-hint nr-mono">
                              {cosigner.fingerprint ?? 'no fingerprint'}, unverified
                            </div>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="nr-row">
                {onAddresses !== undefined && (
                  <Button
                    onClick={() => {
                      onAddresses(quorum)
                    }}
                    testId="fleet-addresses"
                  >
                    Compare addresses
                  </Button>
                )}
                {onForget !== undefined && (
                  <Button
                    onClick={() => {
                      setForgetting(quorum)
                      setTyped('')
                      setError(null)
                    }}
                    testId="fleet-forget-start"
                  >
                    Forget it
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      ))}

      {/* Last, and not a status. Everything above is something this device
          knows; everything here is about other machines it cannot see. */}
      {quorums.length > 0 && (
        <div className="nr-banner nr-banner--caution" data-testid="fleet-cannot-know">
          <strong>What this device cannot tell you</strong>
          <span>
            Whether the other cosigners registered the same descriptor, and whether your coordinator
            ever imported it. Both are facts about other machines, and this one has no network. An
            unfinished quorum receives money exactly like a finished one, so confirm those yourself:
            compare the checksum above on every device, and compare an address at the same index.
          </span>
        </div>
      )}
    </Screen>
  )
}
