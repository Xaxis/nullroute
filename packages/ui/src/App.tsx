/**
 * The device shell and its flow.
 *
 * Spec: ui.app
 *
 * A state machine rather than a router. There is no URL bar, no back button and
 * no deep linking on this device, and the flows are short and strictly ordered:
 * a user cannot arrive at the seed screen without having generated a seed, and
 * cannot reach the wallet without having confirmed a backup. Modelling that as
 * routes would invite a state that a URL can express and the device cannot.
 *
 * The failure state is deliberate. If the daemon is unreachable, this says so
 * plainly rather than rendering an empty or optimistic screen: a lock screen
 * with no attestation behind it would be showing a user exactly the reassurance
 * they came to check.
 */

import { type ReactElement, useCallback, useEffect, useState } from 'react'
import { LockScreen, type AttestationView } from './screens/LockScreen.js'
import { SetupScreen, type EntropyMode, type NetworkChoice } from './screens/SetupScreen.js'
import { DiceScreen } from './screens/DiceScreen.js'
import { SeedScreen } from './screens/SeedScreen.js'
import { ImportScreen } from './screens/ImportScreen.js'
import {
  WalletScreen,
  type AddressRow,
  type QuorumView,
  type ScriptType,
} from './screens/WalletScreen.js'
import { PsbtScreen, type PsbtReviewView, type PsbtSignedView } from './screens/PsbtScreen.js'
import { ScanScreen, type ScanResult } from './screens/ScanScreen.js'
import { WalletsScreen, type WalletRow } from './screens/WalletsScreen.js'
import { ManageWalletScreen } from './screens/ManageWalletScreen.js'
import { StartScreen } from './screens/StartScreen.js'
import { AttestationScreen } from './screens/AttestationScreen.js'
import { DeviceNameScreen } from './screens/DeviceNameScreen.js'
import { FleetScreen, type FleetQuorum } from './screens/FleetScreen.js'
import { AssembleQuorumScreen, type AssembledView } from './screens/AssembleQuorumScreen.js'
import { MachineEntropyScreen, type HealthReportView } from './screens/MachineEntropyScreen.js'
import { FinishScreen } from './screens/FinishScreen.js'
import { ReceiveScreen, ReceiveWaiting, type ReceiveAddress } from './screens/ReceiveScreen.js'
import { Steps } from './components/Steps.js'
import { journeyById, stepsFor as journeyStepsFor, type JourneyId } from './journeys.js'
import { LabelsScreen, type ImportedLabels, type LabelRow } from './screens/LabelsScreen.js'
import { VerifyMessageScreen, type VerificationView } from './screens/VerifyMessageScreen.js'
import { parseSignedMessageBlock } from '@nullroute/core'
import {
  ChildSeedScreen,
  type ChildApplication,
  type ChildSeedView,
} from './screens/ChildSeedScreen.js'
import { QuorumAddressesScreen, type QuorumAddressRow } from './screens/QuorumAddressesScreen.js'
import { UnlockedScreen } from './screens/UnlockedScreen.js'
import {
  MessageScreen,
  type MessageReviewView,
  type MessageSignatureView,
} from './screens/MessageScreen.js'
import { BackupScreen, type BackupDescription, type RestoredView } from './screens/BackupScreen.js'
import { IdleBanner } from './components/IdleBanner.js'
import { NavMenu, type NavDestination } from './components/NavMenu.js'
import { Identity } from './components/Identity.js'
import { MoreScreen } from './screens/MoreScreen.js'
import { useIdleLock, type IdleWindow } from './lib/idle.js'
import { PassphraseScreen } from './screens/PassphraseScreen.js'
import {
  MultisigScreen,
  type ImportedFileView,
  type OurKeyView,
  type RegistrationView,
} from './screens/MultisigScreen.js'
import { NetworkBanner } from './components/NetworkBanner.js'
import { Screen } from './components/Screen.js'
import { Button } from './components/Button.js'
import { call } from './lib/client.js'
import { httpTransport } from './lib/transport.js'

interface NetworkView {
  readonly id: 'mainnet' | 'testnet3' | 'testnet4' | 'signet' | 'regtest'
  readonly label: string
  readonly isMainnet: boolean
}

interface StoreStatus {
  readonly exists: boolean
  readonly attemptsRemaining: number
  readonly maxAttempts: number
  readonly destroyed: boolean
}

interface DeviceStatus {
  readonly hasWallet: boolean
  readonly unlocked: boolean
  readonly backupConfirmed: boolean
  readonly fingerprint: string | null
  readonly network: NetworkView
  /**
   * Which wallet is open, from the daemon rather than from the row that was
   * tapped to open it.
   *
   * THIS FIELD WAS MISSING AND THE DAEMON HAS ALWAYS SENT IT. The third time a
   * type here has drifted from what the daemon returns, and the first time it
   * cost something a user could see: the identity chip is set only by the paths
   * that open a wallet, so after the frontend restarted while the daemon kept
   * running, the header said "No wallet open" while the daemon reported
   * hasWallet, unlocked, and the wallet's name.
   *
   * The header is the one thing on every screen that answers "which wallet is
   * this", and it was answering "none" about an open one. Reading it from
   * status means every refresh corrects it rather than only the two paths that
   * happen to set it.
   */
  /*
   * OPTIONAL, and that is a statement about this boundary rather than about the
   * daemon. `call()` casts JSON, it does not validate it, so every field here
   * is a promise this file makes on the daemon's behalf. Declaring it required
   * would let `next.activeWallet` read as never-undefined while a fake, an
   * older daemon, or a truncated response makes it exactly that.
   */
  readonly activeWallet?: {
    readonly id: string
    readonly label: string
    readonly colour: string
  } | null
}

type Stage =
  /** The goal hub. Where a person who has not used this before starts. */
  | { readonly at: 'start' }
  | { readonly at: 'loading' }
  | { readonly at: 'unreachable'; readonly message: string }
  | { readonly at: 'lock' }
  | { readonly at: 'setup' }
  | { readonly at: 'dice' }
  /** Letting the device pick the seed, with what that costs on screen. */
  | { readonly at: 'machine' }
  | { readonly at: 'import' }
  | { readonly at: 'seed'; readonly words: readonly string[]; readonly fingerprint: string }
  | { readonly at: 'wallet' }
  | { readonly at: 'psbt'; readonly prefill?: string }
  /**
   * The camera, on its way somewhere.
   *
   * A scan is never a destination: it always belongs to a screen that asked for
   * it, and the payload goes back there rather than being acted on here.
   */
  /**
   * The camera, on its way to whichever screen asked for it.
   *
   * `forStage` was `'psbt'` and nothing else, so on a device whose primary
   * transport is a QR code exactly one screen could use the camera. A
   * descriptor, a coordinator file, a backup and a label file all arrive the
   * same way and all took pasted text only, which on a machine with no keyboard
   * means an on-screen keyboard and a 200 character descriptor.
   */
  | {
      readonly at: 'scan'
      readonly forStage: 'psbt' | 'multisig' | 'backup' | 'labels' | 'assemble' | 'verify-message'
      /**
       * Work the screen being replaced was holding, handed back on the way out.
       *
       * Only the quorum assembler needs it so far, because it is the only
       * screen where a scan is one step of several rather than the whole
       * input. Cancelling has to return it too: backing out of the camera is
       * not a reason to lose four cosigners.
       */
      readonly collected?: { readonly keys: readonly string[]; readonly threshold: number }
    }
  /** A wallet exists on disk and the passphrase has not been given yet. */
  | { readonly at: 'unlock' }
  /** A wallet has just been created and can be saved to this device. */
  | { readonly at: 'protect' }
  | { readonly at: 'multisig'; readonly prefill?: string }
  /** Building a quorum on the device, with no coordinator. */
  /*
   * Assembling a quorum, INCLUDING what has been collected so far.
   *
   * The keys and threshold live here rather than only in the screen because
   * the trip to the camera unmounts the screen. Without them, every scan
   * emptied the list and a quorum could never hold more than this device plus
   * one scanned key, which made building a 2-of-3 by camera impossible: the
   * exact flow the screen exists for. {at:'quorum'} already carries its
   * QuorumView across the same boundary for the same reason.
   */
  | {
      readonly at: 'assemble'
      readonly prefill?: string
      readonly keys?: readonly string[]
      readonly threshold?: number
    }
  /** Proving control of an address by signing a message with it. */
  | { readonly at: 'message' }
  | { readonly at: 'more' }
  | { readonly at: 'verify-message'; readonly prefill?: string }
  /** Writing or restoring an encrypted backup. */
  | { readonly at: 'backup'; readonly prefill?: string }
  /** Taking one address, big enough to read off the panel. */
  | { readonly at: 'receive' }
  /** The device's own attestation, after it is open. */
  | { readonly at: 'attestation' }
  /** Naming this physical device, so it can be told from its siblings. */
  | { readonly at: 'device-name' }
  /** Reading and writing BIP-329 labels. */
  | { readonly at: 'labels'; readonly prefill?: string }
  /** Deriving a BIP-85 child seed. */
  | { readonly at: 'child' }
  /** Choosing which of several wallets to open. */
  | { readonly at: 'wallets' }
  /** Naming, recolouring or erasing the wallet that is open. */
  | { readonly at: 'manage' }
  /**
   * Addresses for one registered quorum.
   *
   * Carries the quorum rather than an index into the list, because the list is
   * refreshed asynchronously and an index into a list that just changed is how
   * a screen ends up showing a different wallet's addresses under this one's
   * header.
   */
  | { readonly at: 'quorum'; readonly quorum: QuorumView }
  /** Every quorum this device is in, and what it cannot know about them. */
  | { readonly at: 'fleet' }
  /**
   * What just opened, before it can be used.
   *
   * A separate stage rather than a banner on the wallet screen, because a
   * wrong BIP-39 passphrase produces no error and every screen afterwards
   * looks normal. The fingerprint has to be read before anything else happens.
   */
  | {
      readonly at: 'unlocked'
      readonly fingerprint: string
      readonly usedPassphrase: boolean
      readonly labelVerified: boolean
      readonly hintCorrected: boolean
    }

const transport = httpTransport()

/**
 * What the camera is being pointed at, per destination.
 *
 * The scan screen said "Scan a transaction" whatever you were scanning,
 * because for a long time a transaction was the only thing it could scan. On a
 * device with one camera and four things that arrive by QR, naming the wrong
 * one is how somebody holds up the wrong card and concludes the reader is
 * broken.
 */
const SCANNING: Record<
  'psbt' | 'multisig' | 'backup' | 'labels' | 'assemble' | 'verify-message',
  { readonly title: string; readonly hint: string }
> = {
  psbt: {
    title: 'Scan a transaction',
    hint: 'Point the camera at the QR code your coordinator is showing.',
  },
  multisig: {
    title: 'Scan a descriptor',
    hint: 'The quorum descriptor, or a setup file your coordinator exported.',
  },
  assemble: {
    title: 'Scan a cosigner key',
    hint: 'The key another device shows under Multisig. It cannot spend anything.',
  },
  backup: {
    title: 'Scan a backup',
    hint: 'The encrypted backup file. You will still need its passphrase.',
  },
  'verify-message': {
    title: 'Scan a signature',
    hint: 'The proof somebody gave you. Nothing here needs a key or a wallet open.',
  },
  labels: {
    title: 'Scan a label file',
    hint: 'A BIP-329 label file. Nothing in it changes what this device believes is yours.',
  },
}

/**
 * Bytes to base64, without a dependency and without Node's Buffer.
 *
 * This runs in the browser, where `btoa` takes a binary string rather than
 * bytes, so the conversion is explicit. Chunked because spreading a large array
 * into `String.fromCharCode` overflows the argument limit on a transaction of
 * any size, which is exactly the case this exists for.
 */
function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export function App() {
  const [stage, setStage] = useState<Stage>({ at: 'loading' })
  const [menuOpen, setMenuOpen] = useState(false)

  /**
   * The journey underway, if there is one, and how far into it.
   *
   * Held beside the stage rather than inside it, because a journey outlives any
   * one stage and a stage has to work identically whether or not it is part of
   * one. Every screen in a journey is reachable directly, and the only thing
   * this adds is the header saying where you are.
   *
   * The step is tracked here rather than derived from the stage: the signing
   * journey is three steps on one screen, so a stage does not identify a step.
   */
  const [journey, setJourney] = useState<{
    id: JourneyId
    step: number
    /**
     * The steps decided when the journey began.
     *
     * Held rather than recomputed, because a journey that starts by opening a
     * wallet has one more step than the same journey started with one already
     * open, and recomputing after the wallet opens would renumber the flow
     * under the user: "step 2 of 5" would become "step 1 of 4" at the moment
     * they succeeded at something.
     */
    steps: readonly { stage: string; label: string }[]
  } | null>(null)

  /**
   * A journey whose last step just completed, and whose leftovers have not been
   * read yet.
   *
   * Held separately from the stage rather than being one, because the screen
   * that finished the last step has already routed somewhere sensible and this
   * renders over the top of wherever that was. Dismissing it lands the user
   * exactly where they would have been.
   *
   * Without this the multisig journey ends by dropping somebody on the wallet
   * screen, which says by saying nothing that a quorum is finished. It can
   * receive and it cannot spend until every other cosigner registers the same
   * descriptor.
   */
  const [completed, setCompleted] = useState<JourneyId | null>(null)

  /**
   * The header for the current step, or nothing.
   *
   * Nothing when the stage is not one this journey visits, which happens the
   * moment a user leaves the path. That is the honest outcome: a step counter
   * that kept counting after somebody wandered off would be describing a
   * position they are not in.
   */
  const stepsFor = (at: Stage['at']): ReactElement | null => {
    if (journey === null) return null
    const step = journey.steps[journey.step]
    if (step?.stage !== at) return null
    return (
      <Steps
        current={journey.step + 1}
        total={journey.steps.length}
        label={step.label}
        testId="journey-steps"
      />
    )
  }

  /**
   * Move to the next step of the journey, if this stage was part of one.
   *
   * Called by the screens as they hand off. A stage that is not the current
   * step leaves the journey where it is rather than guessing, since guessing is
   * how a counter ends up ahead of the user.
   */
  const advance = (from: Stage['at']): void => {
    setJourney((held) => {
      if (held === null) return held
      if (held.steps[held.step]?.stage !== from) return held
      if (held.step + 1 >= held.steps.length) {
        setCompleted(held.id)
        return null
      }
      return { ...held, step: held.step + 1 }
    })
  }
  const [attestation, setAttestation] = useState<AttestationView | null>(null)
  const [status, setStatus] = useState<DeviceStatus | null>(null)
  const [store, setStore] = useState<StoreStatus | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /**
   * The last action that failed, shown until it is dismissed or another runs.
   *
   * WHY THIS EXISTS. Every asynchronous action in this component was launched
   * with `run(go)`, in seven places, which drops a rejection on the floor.
   * The whole class is dead buttons: the daemon refuses, nothing catches it,
   * the screen does not change and the device says nothing at all.
   *
   * That is not hypothetical. Continue on the dice screen, after a hundred
   * rolls, called `seed.reveal`, got "No wallet is loaded", and did nothing
   * visible. Somebody would tap it again, and again, with no way to find out
   * that the seed they had just generated was gone.
   */
  const [actionError, setActionError] = useState<string | null>(null)
  const [wallets, setWallets] = useState<readonly WalletRow[]>([])
  /**
   * Registered quorums, AND WHICH WALLET THEY WERE READ FOR.
   *
   * The wallet is part of the value because clearing a list on every path that
   * closes a wallet did not hold. Two paths cleared it and four did not (the
   * idle lock, the unlocked screen's Lock, erasing, opening another wallet from
   * the picker), so a quorum read for one
   * wallet was offered on the next one's Receive screen as where its money
   * should go. Keyed like this, a list read for a different wallet is not a
   * list at all, whichever path closed the old one. INV-UI-88.
   *
   * `unread` is "could not ask" as distinct from "none". The fetch below turns
   * a failed query into an empty list, which is right for the wallet screen and
   * wrong for Receive: there, an empty list is a device in no quorum, and it
   * shows the single-signature address as the only answer.
   */
  const [quorumList, setQuorumList] = useState<{
    readonly wallet: string
    readonly quorums: readonly QuorumView[]
    readonly unread: boolean
  } | null>(null)
  /** Bumped after anything that changes the registrations of the open wallet. */
  const [quorumEdits, setQuorumEdits] = useState(0)
  /** Why the wallet list may be wrong or incomplete. Never rendered as empty. */
  const [listFailure, setListFailure] = useState<string | null>(null)
  const [maxWallets, setMaxWallets] = useState(8)

  /**
   * Run an action and put any failure on the screen.
   *
   * Use this instead of `void promise`. The rule this enforces is the one
   * CLAUDE.md states for signing paths and which is worth just as much
   * everywhere else on a device with no console and no log a user can read: a
   * swallowed exception is indistinguishable from a control that does nothing.
   */
  const run = useCallback((action: () => Promise<void>): void => {
    setActionError(null)
    void action().catch((cause: unknown) => {
      setActionError(cause instanceof Error ? cause.message : String(cause))
    })
  }, [])
  /**
   * The open wallet, as the daemon reports it.
   *
   * From the response to unlocking, which is derived from the seed actually
   * loaded, and never from the row the user tapped. Those differ exactly when
   * something has gone wrong, which is when it matters.
   */
  // Whether the open wallet's name came out of the ciphertext. False for one
  // migrated from a v1 store, which sealed no name. The unlocked screen says so
  // once; the manage screen is where it gets fixed, so it has to know too.
  /**
   * What this physical device is called, or nothing.
   *
   * Read before unlocking, because "which of my three devices is this" is the
   * question you have at the moment you pick one up. Unauthenticated, and every
   * screen that shows it says so, so it decides nothing.
   */
  const [device, setDevice] = useState<{ name: string; colour: string } | null>(null)

  /**
   * Which theme the panel renders in.
   *
   * Dark until the daemon says otherwise, which is also what it says when
   * nothing has been chosen. Stamped on the document element rather than held
   * in React state alone, because the stylesheet switches on
   * `[data-theme='light']` and a class on a component would not reach the
   * scrollbars, the selection colour or the ground behind the app.
   */
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  useEffect(() => {
    // The attribute is only ever SET, never removed, so there is no frame in
    // which the document has no theme. Dark is stamped explicitly rather than
    // left as the bare-:root default, so a stale attribute from a previous
    // render cannot survive a switch back.
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const [labelVerified, setLabelVerified] = useState(true)
  const [activeWallet, setActiveWallet] = useState<{
    id: string
    label: string
    colour: string
  } | null>(null)

  /*
   * Which wallet is loaded, as one string, or null when none is.
   *
   * A seed that has not been saved has no id, and is told apart by its
   * fingerprint so that replacing one unsaved seed with another still counts as
   * a different wallet.
   */
  const walletKey =
    status?.hasWallet === true ? (activeWallet?.id ?? `unsaved:${status.fingerprint ?? ''}`) : null
  const readQuorums = quorumList !== null && quorumList.wallet === walletKey ? quorumList : null
  const quorums = readQuorums?.quorums ?? []
  const quorumsUnread = readQuorums?.unread ?? false
  // With nothing loaded there is nothing to read, and so nothing to wait for.
  const quorumsKnown = walletKey === null || readQuorums !== null

  const refresh = useCallback(async (): Promise<DeviceStatus> => {
    const next = await call<DeviceStatus>(transport, 'device.status')
    setStatus(next)
    // The daemon is the authority on which wallet is open, so every refresh
    // corrects the header rather than only the two paths that open one.
    //
    // ONLY WHEN IT ACTUALLY SAID SO. call() casts JSON rather than validating
    // it, so an absent field arrives as undefined, and treating that as "no
    // wallet" would let a refresh landing just after an unlock wipe the name
    // the unlock had set. Present-and-null is a lock and is believed; absent is
    // no answer and changes nothing.
    if (next.activeWallet !== undefined) setActiveWallet(next.activeWallet)
    return next
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const att = await call<AttestationView>(transport, 'attestation.get')
        const st = await call<DeviceStatus>(transport, 'device.status')
        // Asked before unlocking on purpose: the lock screen has to know
        // whether this device holds a wallet at all, and if it does, how close
        // it is to erasing itself.
        const store = await call<StoreStatus>(transport, 'store.status')
        // Not fatal. A daemon without storage cannot be named, and a device
        // that refused to boot because a cosmetic file was missing would be a
        // bad trade for a name.
        let named: {
          identity: { name: string; colour: string; theme?: 'dark' | 'light' } | null
        } = { identity: null }
        try {
          named = await call<typeof named>(transport, 'device.identity')
        } catch {
          /* unnamed */
        }
        if (cancelled) return
        setDevice(named.identity)
        // Before the first paint of anything but the loading state, so the
        // lock screen is the first thing rendered in the chosen theme rather
        // than the first thing to flicker out of the default.
        setTheme(named.identity?.theme ?? 'dark')
        setAttestation(att)
        setStatus(st)
        setActiveWallet(st.activeWallet ?? null)
        setStore(store)
        setStage({ at: 'lock' })
      } catch (err) {
        if (!cancelled) setStage({ at: 'unreachable', message: (err as Error).message })
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  /**
   * Closing the wallet when nobody is at the device.
   *
   * The daemon owns the deadline and does the locking; this supplies the one
   * thing the daemon cannot see, which is whether a person is here. See
   * packages/ui/src/lib/idle.ts.
   */
  const idle = useIdleLock({
    unlocked: status?.hasWallet === true,
    beat: useCallback(async (): Promise<IdleWindow | null> => {
      const beaten = await call<{ idle: IdleWindow | null }>(transport, 'session.heartbeat', {})
      return beaten.idle
    }, []),
    lock: useCallback(() => {
      const go = async (): Promise<void> => {
        // Already locked daemon-side by the time this runs, in the ordinary
        // case: the sweep there does not wait for a screen to ask. Called
        // anyway so the two cannot disagree, and so the frontend state is
        // reset by the same path a deliberate lock uses.
        await call(transport, 'session.lock')
        setActiveWallet(null)
        await refresh()
        setStage({ at: 'wallets' })
      }
      run(go)
    }, [refresh]),
  })

  /**
   * The banner strip, under the header rather than inside it.
   *
   * WHY IT MOVED. These used to be a slot between the title and the header
   * controls, which meant every warning was competing for one row with the
   * name of the screen and the name of the device. It was a competition the
   * warnings won: on the idle state the title wrapped to three lines and the
   * device name was dropped outright, so a warning about the session hid the
   * answer to "which session". The code went to real trouble to manage that,
   * ordering the DOM so the network warning truncated last and dropping chips
   * on a timer, and all of it was working around a header that was too small
   * because it was doing two jobs.
   *
   * A full width strip has room for both warnings at once and takes nothing
   * from the header when there are none.
   */
  /*
   * NULL RATHER THAN AN EMPTY FRAGMENT.
   *
   * This returned a fragment whose two children were both conditional, so on a
   * mainnet device with no idle warning it produced an element that rendered
   * nothing. Screen tests `banner !== null`, which that passes, so the strip
   * rendered anyway: an empty band with padding and a bottom border, which then
   * took the whole panel because of the grid bug above it.
   *
   * The two failures were independent and each one hid the other. Deciding here
   * whether there is anything to say means the strip only exists when it has
   * something in it.
   */
  const idleBanner =
    status !== null && idle.warning && idle.remaining !== null ? (
      <IdleBanner remaining={idle.remaining} onStayOpen={idle.stayOpen} />
    ) : null
  const networkBanner =
    status !== null && !status.network.isMainnet ? <NetworkBanner network={status.network} /> : null
  /*
   * A failed action, on whatever screen you are standing on.
   *
   * In the strip rather than inside a screen because the failure belongs to
   * the tap, not to the layout: the seven actions that can fail here are spread
   * across nine screens, and each one growing its own error slot is how they
   * end up with nine different treatments and two with none.
   *
   * Dismissable, and cleared by the next action, because an error about
   * something you have since done differently is worse than no error.
   */
  const failureBanner =
    actionError === null ? null : (
      <div className="nr-banner nr-banner--danger" data-testid="action-error">
        <strong>That did not work</strong>
        <span>{actionError}</span>
        <button
          type="button"
          className="nr-banner__dismiss"
          onClick={() => {
            setActionError(null)
          }}
          data-testid="action-error-dismiss"
        >
          Dismiss
        </button>
      </div>
    )

  const banner =
    idleBanner === null && networkBanner === null && failureBanner === null ? null : (
      <>
        {failureBanner}
        {idleBanner}
        {networkBanner}
      </>
    )

  /**
   * Who this device is and which wallet it has open, in one control.
   *
   * It replaced two: a device chip that could not be tapped, and a wallet chip
   * that lived in the banner slot and was dropped whenever a warning wanted
   * the room. Tapping it opens the picker, which is where switching wallets
   * belongs on a device that holds eight of them: it used to be four taps
   * deep, inside More, under a screen about something else.
   *
   * THE SWITCH IS OFFERED ONLY WHERE THE MENU IS. Both mean "leaving here is
   * free", and a device that refuses an exit in the menu while offering the
   * same exit through the wallet name two inches away has not refused
   * anything.
   */
  const identity = (
    <Identity
      device={device?.name}
      {...(activeWallet === null
        ? {}
        : { wallet: { label: activeWallet.label, colour: activeWallet.colour } })}
      {...(status === null
        ? {}
        : { networkLabel: status.network.label, isMainnet: status.network.isMainnet })}
      onSwitch={() => {
        setMenuOpen(false)
        // The same clearing the menu does. This chip is the other exit, and an
        // exit that leaves the step counter running puts "step 2 of 4" on an
        // unrelated screen later, describing a journey somebody walked away
        // from. Leaving is leaving, whichever control did it.
        setJourney(null)
        setCompleted(null)
        setStage({ at: 'wallets' })
      }}
    />
  )

  /**
   * The same chip, with no way through it.
   *
   * For the screens that carry no menu. Both controls mean "leaving here is
   * free", and a device that refuses an exit in the menu while offering the
   * same exit through the wallet name two inches to the left has not refused
   * anything: tapping this on the seed screen would have thrown away the words
   * before anybody wrote them down.
   */
  const identityFixed = (
    <Identity
      device={device?.name}
      {...(activeWallet === null
        ? {}
        : { wallet: { label: activeWallet.label, colour: activeWallet.colour } })}
      {...(status === null
        ? {}
        : { networkLabel: status.network.label, isMainnet: status.network.isMainnet })}
    />
  )

  /**
   * End the session, from wherever you are.
   *
   * Defined once because the rail offers it on every destination and the
   * wallet screen used to define its own. Two copies of "lock" that differed
   * in what they cleared would be two different amounts of forgetting.
   */
  const lockSession = useCallback((): void => {
    const go = async (): Promise<void> => {
      await call(transport, 'session.lock')
      // The chip is the only always-visible answer to "which wallet is this",
      // so it must not survive the wallet it names.
      setActiveWallet(null)
      await refresh()
      setStage({ at: 'lock' })
    }
    run(go)
  }, [refresh])

  /**
   * The navigation rail, for screens it is safe to leave.
   *
   * Built here rather than in each screen so the destinations and their routes
   * are defined once. A screen in the middle of a flow passes nothing and gets
   * no rail: see the note on Screen's `nav` prop.
   */
  // Lifted, so that navigating closes it. A panel left open over the screen it
  // just moved to is the classic version of this control, and on a device where
  // the next tap might authorise a transaction it is worse than untidy.
  const menu = (current?: NavDestination): ReactElement => (
    <NavMenu
      {...(current === undefined ? {} : { current })}
      open={menuOpen}
      onToggle={() => {
        setMenuOpen((was) => !was)
      }}
      walletOpen={status?.hasWallet === true}
      showQuorums={quorums.length > 0}
      onNavigate={(destination) => {
        setMenuOpen(false)
        // LEAVING A JOURNEY CLEARS IT, wherever you leave it for. A step
        // counter that survived would reappear on an unrelated screen later
        // claiming somebody is three steps into something they walked away
        // from. This lived in a Home handler until Home went, and the menu is
        // the only exit now, so it belongs here.
        setJourney(null)
        setCompleted(null)
        if (destination === 'guide') setStage({ at: 'start' })
        else if (destination === 'wallet') setStage({ at: 'wallet' })
        else if (destination === 'sign') setStage({ at: 'psbt' })
        else if (destination === 'receive') setStage({ at: 'receive' })
        else if (destination === 'quorums') setStage({ at: 'fleet' })
        else if (destination === 'lock') lockSession()
        else setStage({ at: 'more' })
      }}
    />
  )

  const loadWallets = useCallback(async (): Promise<void> => {
    // Never swallowed. A failed list rendered as an empty one tells a user with
    // three wallets that this device holds none, which is the single most
    // alarming thing a signing device can say and is a lie. The error is shown
    // and the previous list is left alone.
    try {
      const listed = await call<{
        wallets: readonly WalletRow[]
        max: number
        active: { id: string; label: string; colour: string } | null
        migrationError: string | null
      }>(transport, 'wallets.list', {})
      setWallets(listed.wallets)
      setMaxWallets(listed.max)
      setActiveWallet(listed.active)
      setListFailure(
        listed.migrationError === null
          ? null
          : `A wallet saved by an older version of this device could not be moved into place: ` +
              `${listed.migrationError} It has not been changed, and the wallets below are ` +
              `unaffected.`
      )
    } catch (err) {
      setListFailure(
        `This device could not be asked what wallets it holds: ${(err as Error).message} ` +
          `That is not the same as holding none. Do not set up a new wallet until this is fixed.`
      )
    }
  }, [])

  /**
   * Refresh the list whenever the picker is entered.
   *
   * Fetched on entry rather than held in sync, so a device whose wallets
   * changed in another session shows what is there rather than a cached list.
   * In an effect rather than in render, because listing migrates a legacy
   * store on first sight and that must happen once, not on every paint.
   */
  useEffect(() => {
    if (stage.at !== 'wallets') return
    void loadWallets()
  }, [stage.at, loadWallets])

  /**
   * Read the quorum list whenever the loaded wallet changes, or its
   * registrations do.
   *
   * NOT WHEN THE WALLET SCREEN IS ENTERED, which is what this used to key on.
   * Guide me > Receive money goes from unlocking straight to Receive without
   * passing the wallet screen, so a wallet in a 2-of-3 was offered only its
   * single-signature address. The wallet is what the list belongs to, so the
   * wallet is what refetches it. INV-UI-88.
   *
   * Failure is swallowed here and only here: a device with no registrations at
   * all is the common case, and a wallet screen that refused to render because
   * a multisig query failed would be worse than one showing no cosigner number.
   * The failure is kept distinguishable from an answer, so Receive, where the
   * difference decides what an address is worth, can say so.
   */
  useEffect(() => {
    if (walletKey === null) return
    let cancelled = false
    const read = async (): Promise<void> => {
      try {
        const listed = await call<{ quorums: readonly QuorumView[] }>(
          transport,
          'multisig.registrations',
          {}
        )
        if (!cancelled) setQuorumList({ wallet: walletKey, quorums: listed.quorums, unread: false })
      } catch {
        if (!cancelled) setQuorumList({ wallet: walletKey, quorums: [], unread: true })
      }
    }
    void read()
    return () => {
      cancelled = true
    }
  }, [walletKey, quorumEdits])

  /** Read the list again after something changed what it holds. */
  const quorumsChanged = useCallback((): void => {
    setQuorumEdits((edits) => edits + 1)
  }, [])

  const unlockWallet = useCallback(
    async (id: string, passphrase: string): Promise<void> => {
      // Cleared BEFORE the call. wallets.unlock locks the session first, so
      // from the moment it is issued nothing is open; leaving the old value in
      // place means a failed unlock returns to a picker whose header still
      // names, and whose list still marks as open, a wallet the daemon has
      // already closed.
      setActiveWallet(null)

      let opened: {
        active: { id: string; label: string; colour: string }
        fingerprint: string
        hintCorrected: boolean
        labelVerified: boolean
        bip39Passphrase: boolean
      }
      try {
        opened = await call<typeof opened>(transport, 'wallets.unlock', { id, passphrase })
      } catch (refused) {
        // THE OLD WALLET IS ALREADY GONE. The daemon locks before it tries, so a
        // wrong passphrase for B closes A as well. Without asking again, status
        // still said A was open: the menu offered its actions and the wallet
        // screen showed its fingerprint on a device holding no seed. INV-UI-71.
        try {
          await refresh()
        } catch (unasked) {
          throw new Error(
            `${(refused as Error).message} The device could not then be asked what is open: ` +
              (unasked as Error).message,
            { cause: unasked }
          )
        }
        throw refused
      }
      setActiveWallet(opened.active)
      setLabelVerified(opened.labelVerified)
      setError(null)
      // The device status, refreshed, because opening a wallet is what changes
      // it. Without this `status.hasWallet` stayed false for the rest of the
      // session and three things read it: the idle lock never armed, so the
      // feature that closes the wallet when nobody is there did not run at all;
      // a journey begun after unlocking prepended "Open a wallet" to a flow
      // whose wallet was already open; and the lock screen routed a device with
      // a loaded wallet back to the picker.
      //
      // Nothing looked wrong. That is the whole reason this comment is here
      // rather than a bare call.
      await refresh()
      // Never straight to the wallet. Everything a user needs in order to
      // notice that the wrong wallet opened is on the next screen, and after
      // that there is nothing left to notice it with.
      setStage({
        at: 'unlocked',
        fingerprint: opened.fingerprint,
        usedPassphrase: opened.bip39Passphrase,
        labelVerified: opened.labelVerified,
        hintCorrected: opened.hintCorrected,
      })
    },
    [refresh]
  )

  // --- IPC-backed callbacks ------------------------------------------------

  const account = useCallback(
    async (rolls: string) =>
      call<{
        accounting: {
          rolls: number
          bits: number
          targetBits: number
          sufficient: boolean
          rollsRemaining: number
        }
        warnings: { kind: string; message: string; detail: string }[]
      }>(transport, 'entropy.account', { rolls }),
    []
  )

  const addresses = useCallback(
    async (scriptType: ScriptType, change: boolean, start: number, count: number) =>
      // AddressRow rather than a structural type written out here. The two had
      // drifted: the daemon started returning a BIP-329 label per address, the
      // screen started rendering one, and this signature still said there was
      // no such field. It worked, because call() casts JSON and an extra key
      // survives, but anybody reading this would have concluded labels do not
      // reach the screen.
      call<{ addresses: AddressRow[] }>(transport, 'wallet.addresses', {
        scriptType,
        change,
        start,
        count,
      }),
    []
  )

  const descriptor = useCallback(
    async (scriptType: ScriptType, change: boolean) =>
      call<{ descriptor: string; checksum: string }>(transport, 'wallet.descriptor', {
        scriptType,
        change,
      }),
    []
  )

  const reviewPsbt = useCallback(
    async (psbt: string) => call<PsbtReviewView>(transport, 'psbt.review', { psbt }),
    []
  )

  const signPsbt = useCallback(
    async (psbt: string, overrideBlockingWarnings: boolean) =>
      // PsbtSignedView, not three fields written out here. This had drifted:
      // the daemon returns the signature progress, who still has to sign,
      // whether this device had already signed, and the finalised transaction,
      // and the screen renders all four. It worked, because call() casts JSON,
      // and anybody reading this would have concluded none of them arrive.
      call<PsbtSignedView>(transport, 'psbt.sign', { psbt, overrideBlockingWarnings }),
    []
  )

  const ourMultisigKey = useCallback(async () => call<OurKeyView>(transport, 'multisig.ourKey'), [])

  const reviewQuorum = useCallback(
    async (descriptor: string) =>
      call<RegistrationView>(transport, 'multisig.review', { descriptor }),
    []
  )

  /*
   * The passphrase goes through when there is one, and `persisted` comes back.
   *
   * Neither did. The daemon writes a registration into the sealed wallet only
   * when it is handed the passphrase, and otherwise holds it for the session
   * and answers `persisted: false`. This sent none and dropped the answer, so
   * every quorum registered on the device went at the next lock while the
   * screen said it would be recognised from now on. INV-UI-104.
   *
   * Compared to true rather than read for truthiness, because call() casts
   * JSON and an absent field must read as not saved (INV-UI-102).
   */
  const registerQuorum = useCallback(
    async (descriptor: string, passphrase?: string): Promise<{ persisted: boolean }> => {
      const answer = await call<{ persisted?: unknown }>(
        transport,
        'multisig.register',
        passphrase === undefined ? { descriptor } : { descriptor, passphrase }
      )
      quorumsChanged()
      return { persisted: answer.persisted === true }
    },
    [quorumsChanged]
  )

  const verifyAddress = useCallback(
    async (address: string) =>
      call<{
        found: boolean
        path?: string
        scriptType?: string
        change?: boolean
        searchedTo?: number
      }>(transport, 'wallet.verifyAddress', { address }),
    []
  )

  // --- Screens -------------------------------------------------------------

  if (stage.at === 'loading') {
    return (
      <Screen title="nullroute" testId="loading">
        <p className="nr-note">Reading the device attestation.</p>
      </Screen>
    )
  }

  if (stage.at === 'unreachable') {
    return (
      <Screen title="nullroute" subtitle="No daemon" testId="unreachable">
        <div className="nr-banner nr-banner--caution">
          <strong>Not running</strong>
          <span>
            The signing daemon is not reachable, so there is no attestation to show and no wallet to
            unlock. Start it with <span className="nr-mono">make dev</span>.
          </span>
        </div>
        <p className="nr-hint nr-mono">{stage.message}</p>
      </Screen>
    )
  }

  if (stage.at === 'lock' && attestation !== null && status !== null) {
    return (
      <LockScreen
        attestation={attestation}
        identity={identity}
        nav={menu()}
        network={status.network}
        {...(status.fingerprint === null ? {} : { fingerprint: status.fingerprint })}
        expanded={expanded}
        onToggleExpanded={() => {
          setExpanded((v) => !v)
        }}
        onUnlock={() => {
          // A wallet already in memory goes straight through. Everything else
          // goes to the picker, which is what lists the wallets on the device,
          // migrates a pre-multi-wallet store on first sight, and offers to
          // make one when there are none. Routing "no wallet" straight to
          // setup would mean a device that had wallets but no session could
          // never reach them, and a legacy store would never be migrated
          // because nothing else calls wallets.list.
          if (status.hasWallet) setStage({ at: 'wallet' })
          else setStage({ at: 'wallets' })
        }}
        onGuide={() => {
          setJourney(null)
          setStage({ at: 'start' })
        }}
      />
    )
  }

  // Over the top of whatever the last step routed to, so dismissing it lands
  // the user where they would have been anyway.
  if (completed !== null) {
    const finished = journeyById(completed)
    if (finished !== undefined) {
      return (
        <FinishScreen
          banner={banner}
          nav={menu()}
          identity={identity}
          journey={finished}
          onDone={() => {
            setCompleted(null)
          }}
        />
      )
    }
  }

  if (stage.at === 'start') {
    return (
      <StartScreen
        nav={menu('guide')}
        banner={banner}
        identity={identity}
        walletOpen={status?.hasWallet === true}
        onBegin={(id: JourneyId) => {
          const chosen = journeyById(id)
          if (chosen === undefined) return
          // Decided once, here. A journey that operates on a wallet gains an
          // "open a wallet" step at the front when none is open, rather than
          // being refused: this is a cold storage device, and needing a wallet
          // is its ordinary state rather than an obstacle to report.
          const steps = journeyStepsFor(chosen, status?.hasWallet === true)
          setJourney({ id, step: 0, steps })
          const first = steps[0]
          if (first !== undefined) setStage({ at: first.stage } as Stage)
        }}
        onSkip={() => {
          setJourney(null)
          setStage({ at: status?.hasWallet === true ? 'wallet' : 'wallets' })
        }}
      />
    )
  }

  if (stage.at === 'setup') {
    return (
      <SetupScreen
        banner={banner}
        nav={menu()}
        onCancel={() => {
          setStage({ at: 'wallets' })
        }}
        identity={identity}
        steps={stepsFor('setup')}
        onStart={(mode: EntropyMode, network: NetworkChoice) => {
          const go = async (): Promise<void> => {
            await call(transport, 'network.set', { id: network })
            await refresh()
            advance('setup')
            setStage(
              mode === 'dice'
                ? { at: 'dice' }
                : mode === 'machine'
                  ? { at: 'machine' }
                  : { at: 'import' }
            )
          }
          run(go)
        }}
      />
    )
  }

  if (stage.at === 'dice') {
    return (
      <DiceScreen
        banner={banner}
        nav={menu()}
        identity={identity}
        steps={stepsFor('dice')}
        onAccount={account}
        onRollForMe={async (count: number) =>
          call<{ rolls: string }>(transport, 'entropy.rollDice', { count })
        }
        onCancel={() => {
          setStage({ at: 'setup' })
        }}
        onComplete={(rolls, mixMachine) => {
          const go = async (): Promise<void> => {
            await call(transport, 'entropy.fromDice', { rolls, mixMachine })
            const revealed = await call<{ words: string[]; fingerprint: string }>(
              transport,
              'seed.reveal'
            )
            advance('dice')
            setStage({ at: 'seed', words: revealed.words, fingerprint: revealed.fingerprint })
          }
          run(go)
        }}
      />
    )
  }

  if (stage.at === 'machine') {
    return (
      <MachineEntropyScreen
        banner={banner}
        nav={menu()}
        identity={identity}
        steps={stepsFor('dice')}
        onHealth={async () => call<HealthReportView>(transport, 'entropy.health')}
        onGenerate={async (acknowledged: boolean) => {
          await call(transport, 'entropy.fromMachine', { acknowledged })
          const revealed = await call<{ words: string[]; fingerprint: string }>(
            transport,
            'seed.reveal'
          )
          advance('dice')
          setStage({ at: 'seed', words: revealed.words, fingerprint: revealed.fingerprint })
        }}
        onBack={() => {
          setStage({ at: 'setup' })
        }}
      />
    )
  }

  if (stage.at === 'import') {
    return (
      <ImportScreen
        banner={banner}
        nav={menu()}
        identity={identity}
        steps={stepsFor('import')}
        onCancel={() => {
          setStage({ at: 'setup' })
        }}
        onImport={async (mnemonic, passphrase) => {
          await call(transport, 'wallet.import', { mnemonic, passphrase })
          await refresh()
          // An imported wallet skips the seed screen, because its words are by
          // definition already written down somewhere. It still has to be
          // offered the chance to persist, or importing would be the one route
          // into the device that cannot produce a wallet surviving a reboot.
          advance('import')
          setStage({ at: 'protect' })
        }}
      />
    )
  }

  if (stage.at === 'seed') {
    return (
      <SeedScreen
        banner={banner}
        identity={identityFixed}
        steps={stepsFor('seed')}
        words={stage.words}
        fingerprint={stage.fingerprint}
        onCheckPositions={async (count: number) => {
          const chosen = await call<{ positions: readonly number[] }>(
            transport,
            'seed.checkPositions',
            { count }
          )
          return chosen.positions
        }}
        onCheckWord={async (index: number, word: string) => {
          // The DAEMON decides whether the word is right. Comparing against the
          // words this screen was handed would confirm the screen against
          // itself, which checks nothing about the seed that was actually
          // stored.
          const verdict = await call<{ correct: boolean }>(transport, 'seed.checkWord', {
            index,
            word,
          })
          return verdict.correct === true
        }}
        onConfirm={() => {
          const go = async (): Promise<void> => {
            await call(transport, 'seed.confirmBackup')
            await refresh()
            // Offering to persist comes immediately after confirming the words
            // are on paper, and in that order. The daemon refuses to store a
            // wallet whose mnemonic has not been confirmed, because a device
            // holding the only copy of a seed is one dead SD card away from a
            // total loss.
            advance('seed')
            setStage({ at: 'protect' })
          }
          run(go)
        }}
      />
    )
  }

  if (stage.at === 'more' && status !== null) {
    return (
      <MoreScreen
        nav={menu('more')}
        theme={theme}
        onSetTheme={
          device === null
            ? undefined
            : async (next: 'dark' | 'light') => {
                // Optimistic, then confirmed. The panel switches on the tap
                // because waiting on a disk write to change a colour feels
                // broken, and the daemon's answer is what sticks: if the write
                // fails the theme goes back rather than claiming to persist.
                setTheme(next)
                try {
                  const saved = await call<{ identity: { theme: 'dark' | 'light' } }>(
                    transport,
                    'device.setTheme',
                    { theme: next }
                  )
                  setTheme(saved.identity.theme)
                } catch (err) {
                  setTheme(theme)
                  throw err
                }
              }
        }
        banner={banner}
        identity={identity}
        onMultisig={() => {
          setStage({ at: 'multisig' })
        }}
        onProveControl={() => {
          setStage({ at: 'message' })
        }}
        onCheckProof={() => {
          setStage({ at: 'verify-message' })
        }}
        onBackup={() => {
          setStage({ at: 'backup' })
        }}
        onLabels={() => {
          setStage({ at: 'labels' })
        }}
        onSwitchWallet={() => {
          // Locks first. Two seeds resident at once is the state from which a
          // device signs with the wrong one, and `wallets.unlock` locks
          // anyway, so doing it here means the picker is never showing a
          // wallet as open that the next tap is about to replace.
          const go = async (): Promise<void> => {
            await call(transport, 'session.lock')
            setActiveWallet(null)
            await refresh()
            setStage({ at: 'wallets' })
          }
          run(go)
        }}
        onCheckDevice={() => {
          setStage({ at: 'attestation' })
        }}
        onNameDevice={() => {
          setStage({ at: 'device-name' })
        }}
        onChildSeed={() => {
          setStage({ at: 'child' })
        }}
        {...(activeWallet === null
          ? {}
          : {
              onManage: () => {
                setStage({ at: 'manage' })
              },
            })}
        onBack={() => {
          setStage({ at: 'wallet' })
        }}
      />
    )
  }

  if (stage.at === 'wallet' && status !== null) {
    return (
      <>
        <WalletScreen
          nav={menu('wallet')}
          identity={identity}
          quorums={quorums}
          banner={banner}
          fingerprint={status.fingerprint ?? 'unknown'}
          onAddresses={addresses}
          onDescriptor={descriptor}
          onVerifyAddress={verifyAddress}
          onXpub={async (scriptType: ScriptType) =>
            call<{ xpub: string; path: string; masterFingerprint: string }>(
              transport,
              'wallet.xpub',
              { scriptType }
            )
          }
        />
        {error !== null && (
          <div className="nr-banner nr-banner--caution">
            <strong>Error</strong>
            <span>{error}</span>
            <Button
              onClick={() => {
                setError(null)
              }}
            >
              Dismiss
            </Button>
          </div>
        )}
      </>
    )
  }

  if (stage.at === 'unlock' && store !== null) {
    return (
      <PassphraseScreen
        mode="enter"
        banner={banner}
        // A gate. No menu, and therefore no switching wallets through the
        // chip either: both are the same exit wearing different clothes.
        identity={identityFixed}
        attemptsRemaining={store.attemptsRemaining}
        maxAttempts={store.maxAttempts}
        onSubmit={async (passphrase) => {
          try {
            await call(transport, 'store.unlock', { passphrase })
          } finally {
            // Refreshed whether or not it worked: a failure has consumed an
            // attempt, and the screen has to show the new count. On the last
            // one the wallet is gone and the device is back to setup.
            const next = await call<StoreStatus>(transport, 'store.status')
            setStore(next)
            if (!next.exists) setStage({ at: 'setup' })
          }
          await refresh()
          setStage({ at: 'wallet' })
        }}
      />
    )
  }

  if (stage.at === 'protect') {
    return (
      <PassphraseScreen
        mode="set"
        banner={banner}
        nav={menu()}
        identity={identity}
        steps={stepsFor('protect')}
        onSubmit={async (passphrase) => {
          // wallets.create, NOT store.create. The latter addresses the single
          // blob at the root of the store directory and is refused outright
          // once the device can hold named wallets, which it always can. This
          // called store.create for a while after that refusal landed, so
          // saving a newly created wallet failed on a real device while every
          // test passed, because the tests called the daemon directly.
          //
          // The label is provisional and the user renames it from the wallet
          // screen. Naming a wallet before its passphrase would be one more
          // screen between generating a seed and protecting it.
          const created = await call<{ id: string; active: { label: string; colour: string } }>(
            transport,
            'wallets.create',
            {
              passphrase,
              label: `Wallet ${new Date().toISOString().slice(0, 10)}`,
              colour: 'slate',
            }
          )
          setActiveWallet({
            id: created.id,
            label: created.active.label,
            colour: created.active.colour,
          })
          // The same reason as the unlock path: creating a wallet is what
          // changes device.status, and nothing else re-reads it. Found by the
          // guard written for the unlock bug, which had this second instance
          // in it from the start.
          await refresh()
          setStore(await call<StoreStatus>(transport, 'store.status'))
          // Last step of the setup and restore journeys, so this ends them and
          // the wallet screen shows what is still unfinished.
          advance('protect')
          setStage({ at: 'wallet' })
        }}
        onCancel={() => {
          // Skipping is allowed and says what it costs. A wallet held only in
          // memory is gone at the next reboot, which is a legitimate choice for
          // a one-off signing session and a bad surprise otherwise.
          advance('protect')
          setStage({ at: 'wallet' })
        }}
      />
    )
  }

  if (stage.at === 'assemble') {
    return (
      <AssembleQuorumScreen
        banner={banner}
        nav={menu()}
        identity={identity}
        onOurKey={ourMultisigKey}
        scanned={stage.prefill ?? undefined}
        initialKeys={stage.keys ?? undefined}
        initialThreshold={stage.threshold ?? undefined}
        onScan={(collected) => {
          setStage({
            at: 'scan',
            forStage: 'assemble',
            collected: { keys: collected.keys, threshold: collected.threshold },
          })
        }}
        onAssemble={async (threshold: number, keys: readonly string[]) =>
          call<AssembledView>(transport, 'multisig.assemble', { threshold, keys })
        }
        onReview={(descriptor: string) => {
          // Straight into the normal review, which is what refuses a quorum
          // this device holds no key in. Building and agreeing stay separate:
          // the dangerous act is agreeing.
          setStage({ at: 'multisig', prefill: descriptor })
        }}
        onBack={() => {
          setStage({ at: 'multisig' })
        }}
      />
    )
  }

  if (stage.at === 'multisig') {
    return (
      <MultisigScreen
        banner={banner}
        nav={menu()}
        identity={identity}
        initialText={stage.prefill ?? ''}
        onScan={() => {
          setStage({ at: 'scan', forStage: 'multisig' })
        }}
        steps={stepsFor('multisig')}
        onOurKey={ourMultisigKey}
        // Three of the multisig journey's steps happen on this one screen, so
        // the counter moves on the action rather than on a change of screen.
        // Both go through `advance`, which refuses to move unless the step it
        // is leaving is the one the user is actually on.
        onReview={async (descriptor: string) => {
          const reviewed = await reviewQuorum(descriptor)
          advance('multisig')
          return reviewed
        }}
        // A passphrase field only when there is a saved wallet to write to. An
        // unsaved seed has none, and the daemon refuses a passphrase it has
        // nowhere to use. INV-UI-104.
        storedWallet={activeWallet !== null}
        onRegister={async (descriptor: string, passphrase?: string) => {
          const outcome = await registerQuorum(descriptor, passphrase)
          advance('multisig')
          return outcome
        }}
        registeredCount={quorums.length}
        onAssemble={() => {
          setStage({ at: 'assemble' })
        }}
        onImportFile={async (contents: string) =>
          call<ImportedFileView>(transport, 'multisig.importFile', { contents })
        }
        // No passphrase: the name field has no keyboard of its own to share
        // with one. The daemon holds the name for the session and says so, and
        // the screen repeats what it said. INV-UI-104.
        onNameCosigner={async (xpub: string, name: string) => {
          const answer = await call<{ persisted?: unknown }>(transport, 'multisig.labelCosigner', {
            xpub,
            label: name,
          })
          return { persisted: answer.persisted === true }
        }}
        onExportBundle={async () => {
          const written = await call<{ bundle: string }>(transport, 'multisig.exportBundle', {})
          advance('multisig')
          return written
        }}
        onBack={() => {
          setStage({ at: 'wallet' })
        }}
      />
    )
  }

  if (stage.at === 'fleet') {
    return (
      <FleetScreen
        nav={menu('quorums')}
        banner={banner}
        identity={identity}
        deviceName={device?.name ?? undefined}
        quorums={quorums as unknown as readonly FleetQuorum[]}
        onAddresses={(quorum: FleetQuorum) => {
          setStage({ at: 'quorum', quorum: quorum as unknown as QuorumView })
        }}
        onForget={async (quorum: FleetQuorum) => {
          // No passphrase, so the removal holds for the session, and the
          // answer goes back to the screen to say so. INV-UI-104.
          const answer = await call<{ persisted?: unknown }>(transport, 'multisig.forget', {
            descriptor: quorum.descriptor,
          })
          // Refetched rather than filtered locally: the daemon holds the
          // session's registrations and a screen keeping its own copy is a
          // screen that disagrees with the device after the next change.
          const listed = await call<{ quorums: readonly QuorumView[] }>(
            transport,
            'multisig.registrations'
          )
          if (walletKey !== null) {
            setQuorumList({ wallet: walletKey, quorums: listed.quorums, unread: false })
          }
          return { persisted: answer.persisted === true }
        }}
        onBack={() => {
          setStage({ at: 'wallet' })
        }}
      />
    )
  }

  if (stage.at === 'quorum') {
    return (
      <QuorumAddressesScreen
        banner={banner}
        nav={menu()}
        identity={identity}
        steps={stepsFor('quorum')}
        descriptor={stage.quorum.descriptor}
        position={
          stage.quorum.ourPosition === null || stage.quorum.total === null
            ? undefined
            : { ours: stage.quorum.ourPosition, of: stage.quorum.total }
        }
        onAddresses={async (descriptor: string, change: boolean, start: number, count: number) =>
          call<{ addresses: readonly QuorumAddressRow[]; change: boolean }>(
            transport,
            'multisig.addresses',
            { descriptor, change, start, count }
          )
        }
        onBack={() => {
          advance('quorum')
          setStage({ at: 'wallet' })
        }}
      />
    )
  }

  if (stage.at === 'psbt') {
    return (
      <PsbtScreen
        nav={menu('sign')}
        banner={banner}
        identity={identity}
        // Withheld in the signed view, where leaving destroys the signature.
        // See PsbtScreen's identityFixed and NavMenu's rule.
        identityFixed={identityFixed}
        steps={stepsFor('psbt')}
        initialPsbt={stage.prefill ?? ''}
        onScan={() => {
          setStage({ at: 'scan', forStage: 'psbt' })
        }}
        onReview={async (psbt: string) => {
          const reviewed = await reviewPsbt(psbt)
          advance('psbt')
          return reviewed
        }}
        onSign={async (psbt: string, override: boolean) => {
          const signed = await signPsbt(psbt, override)
          advance('psbt')
          return signed
        }}
        onBack={() => {
          setStage({ at: 'wallet' })
        }}
      />
    )
  }

  if (stage.at === 'wallets') {
    return (
      <WalletsScreen
        nav={menu()}
        banner={banner}
        identity={identity}
        steps={stepsFor('wallets')}
        wallets={wallets}
        max={maxWallets}
        active={activeWallet}
        onUnlock={unlockWallet}
        onCreate={() => {
          setStage({ at: 'setup' })
        }}
        onNameDevice={() => {
          setStage({ at: 'device-name' })
        }}
        onCheckProof={() => {
          setStage({ at: 'verify-message' })
        }}
        onForget={async (id: string) => {
          await call(transport, 'wallets.forget', { id })
          await refresh()
        }}
        onCancel={() => {
          // The lock screen is the right destination only when nothing is
          // open. Sending somebody who arrived from an open wallet back to a
          // login is the picker deciding to log them out.
          setStage({ at: status?.hasWallet === true ? 'wallet' : 'lock' })
        }}
        {...(listFailure === null ? {} : { failure: listFailure })}
      />
    )
  }

  if (stage.at === 'unlocked' && status !== null && activeWallet !== null) {
    return (
      <UnlockedScreen
        banner={banner}
        identity={identityFixed}
        label={activeWallet.label}
        colour={activeWallet.colour}
        fingerprint={stage.fingerprint}
        networkLabel={status.network.label}
        isMainnet={status.network.isMainnet}
        usedPassphrase={stage.usedPassphrase}
        labelVerified={stage.labelVerified}
        hintCorrected={stage.hintCorrected}
        onContinue={() => {
          // Inside a journey that began by opening a wallet, continuing goes to
          // the NEXT step rather than to the wallet screen. Landing somebody on
          // a wallet after they asked to sign a transaction is the flow giving
          // up one step in, which is what the refusal it replaced did.
          //
          // The unlocked screen is still shown first and is not skipped: it is
          // the only place a mistyped BIP-39 passphrase shows, and that is true
          // whether or not a journey is underway.
          const next = journey === null ? undefined : journey.steps[journey.step + 1]
          if (journey !== null && journey.steps[journey.step]?.stage === 'wallets') {
            setJourney({ ...journey, step: journey.step + 1 })
            setStage({ at: next?.stage ?? 'wallet' } as Stage)
            return
          }
          setStage({ at: 'wallet' })
        }}
        onLock={() => {
          // Straight back to the picker, with the seed forgotten. This is the
          // exit for someone who looked at the fingerprint and did not
          // recognise it, so it must not leave the wallet loaded.
          const go = async (): Promise<void> => {
            await call(transport, 'session.lock')
            setActiveWallet(null)
            await refresh()
            setStage({ at: 'wallets' })
          }
          run(go)
        }}
      />
    )
  }

  if (stage.at === 'manage' && activeWallet !== null) {
    return (
      <ManageWalletScreen
        banner={banner}
        nav={menu()}
        identity={identity}
        wallet={activeWallet}
        labelVerified={labelVerified}
        onChangePassphrase={async (oldPassphrase: string, newPassphrase: string) => {
          await call(transport, 'wallets.passphrase', { oldPassphrase, newPassphrase })
          // The seed did not change, so nothing about the session is stale and
          // the wallet stays open. Refreshed anyway rather than assumed: the
          // one thing this screen must never do is report a change the daemon
          // did not make.
          await refresh()
        }}
        onRename={async (label: string, colour: string, passphrase: string) => {
          const renamed = await call<{ active: { id: string; label: string; colour: string } }>(
            transport,
            'wallets.rename',
            { label, colour, passphrase }
          )
          // The sealed label, not the requested one: the registry trims it and
          // strips characters that do not display, and the chip has to agree
          // with the ciphertext rather than with what was typed.
          setActiveWallet(renamed.active)
          // It came back out of a reseal, so from here it is confirmed.
          setLabelVerified(true)
          await refresh()
        }}
        onDestroy={async () => {
          await call(transport, 'wallets.destroy')
          setActiveWallet(null)
          // Erasing locks the session daemon-side, so there is no wallet to
          // return to. The picker is the only honest destination.
          await refresh()
          setStage({ at: 'wallets' })
        }}
        onBack={() => {
          setStage({ at: 'wallet' })
        }}
      />
    )
  }

  if (stage.at === 'device-name') {
    return (
      <DeviceNameScreen
        banner={banner}
        nav={menu()}
        identity={identity}
        current={device ?? undefined}
        onSave={async (name: string, colour: string) => {
          const saved = await call<{ identity: { name: string; colour: string } }>(
            transport,
            'device.setIdentity',
            { name, colour }
          )
          // The name that comes back, not the one that was typed: the daemon
          // strips characters that do not display, so the header and the file
          // agree rather than the header showing what somebody meant.
          setDevice(saved.identity)
          setStage({ at: status?.hasWallet === true ? 'wallet' : 'wallets' })
        }}
        onBack={() => {
          setStage({ at: status?.hasWallet === true ? 'wallet' : 'wallets' })
        }}
      />
    )
  }

  if (stage.at === 'attestation' && attestation !== null) {
    return (
      <AttestationScreen
        banner={banner}
        nav={menu()}
        identity={identity}
        attestation={attestation}
        expanded={expanded}
        onToggleExpanded={() => {
          setExpanded(!expanded)
        }}
        onBack={() => {
          setStage({ at: 'wallet' })
        }}
        // Only when there is a wallet open. Otherwise the banner that asks for
        // this cannot be on screen, and a lock control with nothing to lock is
        // a button that does nothing.
        onLock={status?.hasWallet === true ? lockSession : undefined}
      />
    )
  }

  if (stage.at === 'receive' && !quorumsKnown) {
    return (
      <ReceiveWaiting
        nav={menu('receive')}
        banner={banner}
        identity={identity}
        steps={stepsFor('receive')}
        onBack={() => {
          setStage({ at: 'wallet' })
        }}
      />
    )
  }

  if (stage.at === 'receive') {
    return (
      <ReceiveScreen
        // Remounted for a different wallet, because the screen chooses its
        // default source once, from the list it mounts with. INV-UI-88.
        key={walletKey ?? 'none'}
        nav={menu('receive')}
        banner={banner}
        identity={identity}
        steps={stepsFor('receive')}
        // Every registered quorum, so the screen can ask which wallet the
        // money is for. Without this it derived a single-signature address on
        // a device holding a 2-of-3, which is money protected by one key
        // instead of two and nothing on the screen saying so.
        // A quorum with no readable checksum is left OUT rather than shown
        // with a blank one. The checksum is what every device in the fleet
        // compares, and a tab labelled with nothing is a choice nobody can
        // make deliberately.
        /* Not the same as an empty list, and this screen is where the
           difference decides what the address is worth. See the prop. */
        quorumsUnread={quorumsUnread}
        quorums={quorums
          .filter((quorum) => quorum.checksum !== undefined)
          .map((quorum) => ({
            checksum: quorum.checksum ?? '',
            threshold: quorum.threshold,
            total: quorum.total,
            descriptor: quorum.descriptor,
          }))}
        onQuorumAddress={async (descriptor: string, index: number) => {
          const derived = await call<{ addresses: readonly { address: string; index: number }[] }>(
            transport,
            'multisig.addresses',
            { descriptor, change: false, start: index, count: 1 }
          )
          const first = derived.addresses[0]
          if (first === undefined) {
            throw new Error(`The daemon returned no quorum address at index ${String(index)}.`)
          }
          // The path is the quorum's, not one derivation this device owns: a
          // sortedmulti address comes from every key at that index. Written as
          // the index rather than as a path, because showing one cosigner's
          // path beside a multisig address implies it derived from that key
          // alone.
          return {
            address: first.address,
            index: first.index,
            path: `quorum index ${String(first.index)}`,
          }
        }}
        onVerifyQuorum={async (descriptor: string, address: string) =>
          call<{ found: boolean; index?: number }>(transport, 'multisig.verifyAddress', {
            descriptor,
            address,
          })
        }
        onAddress={async (index: number) => {
          const derived = await call<{ addresses: readonly ReceiveAddress[] }>(
            transport,
            'wallet.addresses',
            // One at a time. Deriving twenty to show one would put nineteen
            // addresses the user did not ask for into the response.
            { scriptType: 'p2wpkh', change: false, start: index, count: 1 }
          )
          const first = derived.addresses[0]
          if (first === undefined) {
            throw new Error(`The daemon returned no address at index ${String(index)}.`)
          }
          return first
        }}
        onVerify={verifyAddress}
        onBack={() => {
          advance('receive')
          setStage({ at: 'wallet' })
        }}
      />
    )
  }

  if (stage.at === 'labels') {
    return (
      <LabelsScreen
        banner={banner}
        nav={menu()}
        identity={identity}
        initialText={stage.prefill ?? ''}
        onScan={() => {
          setStage({ at: 'scan', forStage: 'labels' })
        }}
        onImport={async (text: string) =>
          // Loaded into the session, so the review screen can show a label
          // beside an output. They are not sealed, so they go at the next lock.
          call<ImportedLabels>(transport, 'labels.import', { text, load: true })
        }
        onExport={async (labels: readonly LabelRow[]) =>
          call<{ text: string }>(transport, 'labels.export', { labels })
        }
        onBack={() => {
          setStage({ at: 'wallet' })
        }}
      />
    )
  }

  if (stage.at === 'child') {
    return (
      <ChildSeedScreen
        banner={banner}
        nav={menu()}
        identity={identity}
        onDerive={async (application: ChildApplication, index: number, size: number) =>
          call<ChildSeedView>(transport, 'bip85.derive', {
            application,
            index,
            // One name on this screen, three names in the standard. Sending
            // all three would have the daemon read whichever it wants and
            // ignore the rest, which is how a screen and a device end up
            // disagreeing about what was derived.
            ...(application === 'mnemonic'
              ? { wordCount: size }
              : application === 'hex'
                ? { bytes: size }
                : { length: size }),
          })
        }
        onBack={() => {
          setStage({ at: 'wallet' })
        }}
      />
    )
  }

  if (stage.at === 'backup') {
    return (
      <BackupScreen
        banner={banner}
        nav={menu()}
        identity={identity}
        initialText={stage.prefill ?? ''}
        onScan={() => {
          setStage({ at: 'scan', forStage: 'backup' })
        }}
        steps={stepsFor('backup')}
        onCreate={async (passphrase: string, includeSeed: boolean, label: string) =>
          call<{ backup: string; includesSeed: boolean }>(transport, 'backup.create', {
            passphrase,
            includeSeed,
            label,
          })
        }
        onDescribe={async (backup: string) =>
          call<BackupDescription>(transport, 'backup.describe', { backup })
        }
        onRestore={async (backup: string, passphrase: string) => {
          const result = await call<RestoredView>(transport, 'backup.restore', {
            backup,
            passphrase,
          })
          await refresh()
          // A backup restored into the open wallet hands back its quorums
          // without changing which wallet is loaded, so nothing else would
          // make the list be read again.
          quorumsChanged()
          return result
        }}
        onBack={() => {
          setStage({ at: 'wallet' })
        }}
      />
    )
  }

  if (stage.at === 'message') {
    return (
      <MessageScreen
        banner={banner}
        nav={menu()}
        identity={identity}
        onReview={async (message: string) =>
          call<MessageReviewView>(transport, 'message.review', { message })
        }
        onSign={async (message: string, scriptType: string, index: number) =>
          call<MessageSignatureView>(transport, 'message.sign', { message, scriptType, index })
        }
        onBack={() => {
          setStage({ at: 'wallet' })
        }}
      />
    )
  }

  if (stage.at === 'verify-message') {
    return (
      <VerifyMessageScreen
        banner={banner}
        nav={menu()}
        identity={identity}
        scanned={stage.prefill}
        // An armoured block fills all three fields from one scan. Parsed in
        // core, which is where the format knowledge belongs, and passed here
        // as three strings so this screen holds none of it.
        scannedProof={
          stage.prefill === undefined
            ? undefined
            : (parseSignedMessageBlock(stage.prefill) ?? undefined)
        }
        onScan={() => {
          setStage({ at: 'scan', forStage: 'verify-message' })
        }}
        onVerify={async (address: string, message: string, signature: string) =>
          call<VerificationView>(transport, 'message.verify', { address, message, signature })
        }
        onBack={() => {
          // Back to the picker rather than the wallet, because this is
          // reachable with nothing unlocked and a wallet screen behind it may
          // not exist.
          setStage({ at: activeWallet === null ? 'wallets' : 'wallet' })
        }}
      />
    )
  }

  if (stage.at === 'scan') {
    return (
      <ScanScreen
        banner={banner}
        nav={menu()}
        identity={identity}
        title={SCANNING[stage.forStage].title}
        hint={SCANNING[stage.forStage].hint}
        onCancel={() => {
          // Carrying the work back. Cancelling the camera is a decision about
          // the camera, not about the four cosigners already collected.
          setStage(
            stage.collected === undefined
              ? { at: stage.forStage }
              : {
                  at: stage.forStage,
                  keys: stage.collected.keys,
                  threshold: stage.collected.threshold,
                }
          )
        }}
        onResult={(result: ScanResult) => {
          // Raw bytes come out of a BBQr sequence, text out of a single code.
          //
          // A PSBT is base64 either way, because that is what the review path
          // takes and what a user can read back. Everything else here is text
          // to begin with (a descriptor, a JSON backup, a JSON Lines label
          // file), and base64-encoding it would hand the screen something it
          // cannot parse and the user something they cannot check.
          const text =
            result.kind === 'text'
              ? result.text.trim()
              : stage.forStage === 'psbt'
                ? toBase64(result.data)
                : new TextDecoder().decode(result.data).trim()
          setStage(
            stage.collected === undefined
              ? { at: stage.forStage, prefill: text }
              : {
                  at: stage.forStage,
                  prefill: text,
                  keys: stage.collected.keys,
                  threshold: stage.collected.threshold,
                }
          )
        }}
      />
    )
  }

  return (
    <Screen title="nullroute" testId="fallback">
      <p className="nr-note">Nothing to show.</p>
    </Screen>
  )
}
