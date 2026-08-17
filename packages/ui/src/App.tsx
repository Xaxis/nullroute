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

import { useCallback, useEffect, useState } from 'react'
import { LockScreen, type AttestationView } from './screens/LockScreen.js'
import { SetupScreen, type EntropyMode, type NetworkChoice } from './screens/SetupScreen.js'
import { DiceScreen } from './screens/DiceScreen.js'
import { SeedScreen } from './screens/SeedScreen.js'
import { ImportScreen } from './screens/ImportScreen.js'
import { WalletScreen, type ScriptType } from './screens/WalletScreen.js'
import { PsbtScreen, type PsbtReviewView } from './screens/PsbtScreen.js'
import { ScanScreen, type ScanResult } from './screens/ScanScreen.js'
import { WalletsScreen, type WalletRow } from './screens/WalletsScreen.js'
import { UnlockedScreen } from './screens/UnlockedScreen.js'
import { WalletChip } from './components/WalletChip.js'
import { PassphraseScreen } from './screens/PassphraseScreen.js'
import {
  MultisigScreen,
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
}

type Stage =
  | { readonly at: 'loading' }
  | { readonly at: 'unreachable'; readonly message: string }
  | { readonly at: 'lock' }
  | { readonly at: 'setup' }
  | { readonly at: 'dice' }
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
  | { readonly at: 'scan'; readonly forStage: 'psbt' }
  /** A wallet exists on disk and the passphrase has not been given yet. */
  | { readonly at: 'unlock' }
  /** A wallet has just been created and can be saved to this device. */
  | { readonly at: 'protect' }
  | { readonly at: 'multisig' }
  /** Choosing which of several wallets to open. */
  | { readonly at: 'wallets' }
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
  const [attestation, setAttestation] = useState<AttestationView | null>(null)
  const [status, setStatus] = useState<DeviceStatus | null>(null)
  const [store, setStore] = useState<StoreStatus | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wallets, setWallets] = useState<readonly WalletRow[]>([])
  /** Why the wallet list may be wrong or incomplete. Never rendered as empty. */
  const [listFailure, setListFailure] = useState<string | null>(null)
  const [maxWallets, setMaxWallets] = useState(8)
  /**
   * The open wallet, as the daemon reports it.
   *
   * From the response to unlocking, which is derived from the seed actually
   * loaded, and never from the row the user tapped. Those differ exactly when
   * something has gone wrong, which is when it matters.
   */
  const [activeWallet, setActiveWallet] = useState<{
    id: string
    label: string
    colour: string
  } | null>(null)

  const refresh = useCallback(async (): Promise<DeviceStatus> => {
    const next = await call<DeviceStatus>(transport, 'device.status')
    setStatus(next)
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
        if (cancelled) return
        setAttestation(att)
        setStatus(st)
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
   * The header, on every screen.
   *
   * The wallet chip comes AFTER the network banner in the DOM, so when the 800px
   * header runs out of room it is the wallet label that truncates and never the
   * network warning. INV-UI-3 requires that warning to stay visible, and a
   * decoration must not be able to push it off the panel.
   */
  const banner =
    status === null ? null : (
      <>
        {!status.network.isMainnet && <NetworkBanner network={status.network} />}
        {activeWallet !== null && (
          <WalletChip
            label={activeWallet.label}
            colour={activeWallet.colour}
            networkLabel={status.network.label}
            isMainnet={status.network.isMainnet}
          />
        )}
      </>
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

  const unlockWallet = useCallback(
    async (id: string, passphrase: string): Promise<void> => {
      // Cleared BEFORE the call. wallets.unlock locks the session first, so
      // from the moment it is issued nothing is open; leaving the old value in
      // place means a failed unlock returns to a picker whose header still
      // names, and whose list still marks as open, a wallet the daemon has
      // already closed.
      setActiveWallet(null)

      const opened = await call<{
        active: { id: string; label: string; colour: string }
        fingerprint: string
        hintCorrected: boolean
        labelVerified: boolean
        bip39Passphrase: boolean
      }>(transport, 'wallets.unlock', { id, passphrase })
      setActiveWallet(opened.active)
      setError(null)
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
    []
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
      call<{ addresses: { address: string; path: string; index: number }[] }>(
        transport,
        'wallet.addresses',
        { scriptType, change, start, count }
      ),
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
      call<{ psbt: string; inputsSigned: number; signedWith: readonly string[] }>(
        transport,
        'psbt.sign',
        { psbt, overrideBlockingWarnings }
      ),
    []
  )

  const ourMultisigKey = useCallback(
    async () => call<OurKeyView>(transport, 'multisig.ourKey'),
    []
  )

  const reviewQuorum = useCallback(
    async (descriptor: string) =>
      call<RegistrationView>(transport, 'multisig.review', { descriptor }),
    []
  )

  const registerQuorum = useCallback(async (descriptor: string) => {
    await call(transport, 'multisig.register', { descriptor })
  }, [])

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
        <div className="nr-banner nr-banner--testnet">
          <strong>Not running</strong>
          <span>
            The signing daemon is not reachable, so there is no attestation to show and no wallet
            to unlock. Start it with <span className="nr-mono">make dev</span>.
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
      />
    )
  }

  if (stage.at === 'setup') {
    return (
      <SetupScreen
        banner={banner}
        onStart={(mode: EntropyMode, network: NetworkChoice) => {
          const go = async (): Promise<void> => {
            await call(transport, 'network.set', { id: network })
            await refresh()
            setStage(mode === 'dice' ? { at: 'dice' } : { at: 'import' })
          }
          void go()
        }}
      />
    )
  }

  if (stage.at === 'dice') {
    return (
      <DiceScreen
        banner={banner}
        onAccount={account}
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
            setStage({ at: 'seed', words: revealed.words, fingerprint: revealed.fingerprint })
          }
          void go()
        }}
      />
    )
  }

  if (stage.at === 'import') {
    return (
      <ImportScreen
        banner={banner}
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
          setStage({ at: 'protect' })
        }}
      />
    )
  }

  if (stage.at === 'seed') {
    return (
      <SeedScreen
        banner={banner}
        words={stage.words}
        fingerprint={stage.fingerprint}
        onConfirm={() => {
          const go = async (): Promise<void> => {
            await call(transport, 'seed.confirmBackup')
            await refresh()
            // Offering to persist comes immediately after confirming the words
            // are on paper, and in that order. The daemon refuses to store a
            // wallet whose mnemonic has not been confirmed, because a device
            // holding the only copy of a seed is one dead SD card away from a
            // total loss.
            setStage({ at: 'protect' })
          }
          void go()
        }}
      />
    )
  }

  if (stage.at === 'wallet' && status !== null) {
    return (
      <>
        <WalletScreen
          banner={banner}
          fingerprint={status.fingerprint ?? 'unknown'}
          onAddresses={addresses}
          onDescriptor={descriptor}
          onVerifyAddress={verifyAddress}
          onSignTransaction={() => {
            setStage({ at: 'psbt' })
          }}
          onMultisig={() => {
            setStage({ at: 'multisig' })
          }}
          onLock={() => {
            const go = async (): Promise<void> => {
              await call(transport, 'session.lock')
              // The chip is the only always-visible answer to "which wallet is
              // this", so it must not survive the wallet it names.
              setActiveWallet(null)
              await refresh()
              setStage({ at: 'lock' })
            }
            void go()
          }}
        />
        {error !== null && (
          <div className="nr-banner nr-banner--testnet">
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
        onSubmit={async (passphrase) => {
          await call(transport, 'store.create', { passphrase })
          setStore(await call<StoreStatus>(transport, 'store.status'))
          setStage({ at: 'wallet' })
        }}
        onCancel={() => {
          // Skipping is allowed and says what it costs. A wallet held only in
          // memory is gone at the next reboot, which is a legitimate choice for
          // a one-off signing session and a bad surprise otherwise.
          setStage({ at: 'wallet' })
        }}
      />
    )
  }

  if (stage.at === 'multisig') {
    return (
      <MultisigScreen
        banner={banner}
        onOurKey={ourMultisigKey}
        onReview={reviewQuorum}
        onRegister={registerQuorum}
        onBack={() => {
          setStage({ at: 'wallet' })
        }}
      />
    )
  }

  if (stage.at === 'psbt') {
    return (
      <PsbtScreen
        banner={banner}
        initialPsbt={stage.prefill ?? ''}
        onScan={() => {
          setStage({ at: 'scan', forStage: 'psbt' })
        }}
        onReview={reviewPsbt}
        onSign={signPsbt}
        onBack={() => {
          setStage({ at: 'wallet' })
        }}
      />
    )
  }

  if (stage.at === 'wallets') {
    return (
      <WalletsScreen
        banner={banner}
        wallets={wallets}
        max={maxWallets}
        active={activeWallet}
        onUnlock={unlockWallet}
        onCreate={() => {
          setStage({ at: 'setup' })
        }}
        onCancel={() => {
          setStage({ at: 'lock' })
        }}
        {...(listFailure === null ? {} : { failure: listFailure })}
      />
    )
  }

  if (stage.at === 'unlocked' && status !== null && activeWallet !== null) {
    return (
      <UnlockedScreen
        banner={banner}
        label={activeWallet.label}
        colour={activeWallet.colour}
        fingerprint={stage.fingerprint}
        networkLabel={status.network.label}
        isMainnet={status.network.isMainnet}
        usedPassphrase={stage.usedPassphrase}
        labelVerified={stage.labelVerified}
        hintCorrected={stage.hintCorrected}
        onContinue={() => {
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
          void go()
        }}
      />
    )
  }

  if (stage.at === 'scan') {
    return (
      <ScanScreen
        banner={banner}
        title="Scan a transaction"
        hint="Point the camera at the QR code your coordinator is showing."
        onCancel={() => {
          setStage({ at: stage.forStage })
        }}
        onResult={(result: ScanResult) => {
          // A PSBT is carried as raw bytes in a BBQr sequence and as base64
          // when it fits in one code. Both end up as base64 here, because that
          // is what the review path takes and what a user can read back.
          const text = result.kind === 'text' ? result.text.trim() : toBase64(result.data)
          setStage({ at: stage.forStage, prefill: text })
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
