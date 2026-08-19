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
import { WalletScreen, type QuorumView, type ScriptType } from './screens/WalletScreen.js'
import { PsbtScreen, type PsbtReviewView } from './screens/PsbtScreen.js'
import { ScanScreen, type ScanResult } from './screens/ScanScreen.js'
import { WalletsScreen, type WalletRow } from './screens/WalletsScreen.js'
import { ManageWalletScreen } from './screens/ManageWalletScreen.js'
import { LabelsScreen, type ImportedLabels, type LabelRow } from './screens/LabelsScreen.js'
import {
  ChildSeedScreen,
  type ChildApplication,
  type ChildSeedView,
} from './screens/ChildSeedScreen.js'
import {
  QuorumAddressesScreen,
  type QuorumAddressRow,
} from './screens/QuorumAddressesScreen.js'
import { UnlockedScreen } from './screens/UnlockedScreen.js'
import {
  MessageScreen,
  type MessageReviewView,
  type MessageSignatureView,
} from './screens/MessageScreen.js'
import {
  BackupScreen,
  type BackupDescription,
  type RestoredView,
} from './screens/BackupScreen.js'
import { WalletChip } from './components/WalletChip.js'
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
  /** Proving control of an address by signing a message with it. */
  | { readonly at: 'message' }
  /** Writing or restoring an encrypted backup. */
  | { readonly at: 'backup' }
  /** Reading and writing BIP-329 labels. */
  | { readonly at: 'labels' }
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
  /**
   * Registered quorums, refreshed whenever the wallet screen is entered.
   *
   * Held here rather than fetched inside the screen so a lock clears it: a
   * cosigner number left over from the previous wallet would be the exact
   * wrong thing to show on a device that holds several.
   */
  const [quorums, setQuorums] = useState<readonly QuorumView[]>([])
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
  // Whether the open wallet's name came out of the ciphertext. False for one
  // migrated from a v1 store, which sealed no name. The unlocked screen says so
  // once; the manage screen is where it gets fixed, so it has to know too.
  const [labelVerified, setLabelVerified] = useState(true)
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

  /**
   * Refresh the quorum list when the wallet screen is entered.
   *
   * Failure is swallowed here and only here: a device with no registrations at
   * all is the common case, and a wallet screen that refused to render because
   * a multisig query failed would be worse than one showing no cosigner number.
   * The panel is absent rather than wrong.
   */
  useEffect(() => {
    if (stage.at !== 'wallet') return
    let cancelled = false
    const run = async (): Promise<void> => {
      try {
        const listed = await call<{ quorums: readonly QuorumView[] }>(
          transport,
          'multisig.registrations',
          {}
        )
        if (!cancelled) setQuorums(listed.quorums)
      } catch {
        if (!cancelled) setQuorums([])
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [stage.at])

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
      setLabelVerified(opened.labelVerified)
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
          quorums={quorums}
          onQuorum={(quorum: QuorumView) => {
            setStage({ at: 'quorum', quorum })
          }}
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
          onProveControl={() => {
            setStage({ at: 'message' })
          }}
          onBackup={() => {
            setStage({ at: 'backup' })
          }}
          onLabels={() => {
            setStage({ at: 'labels' })
          }}
          onChildSeed={() => {
            setStage({ at: 'child' })
          }}
          onXpub={async (scriptType: ScriptType) =>
            call<{ xpub: string; path: string; masterFingerprint: string }>(
              transport,
              'wallet.xpub',
              { scriptType }
            )
          }
          {...(activeWallet === null
            ? {}
            : {
                onManage: () => {
                  setStage({ at: 'manage' })
                },
              })}
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
            { passphrase, label: `Wallet ${new Date().toISOString().slice(0, 10)}`, colour: 'slate' }
          )
          setActiveWallet({
            id: created.id,
            label: created.active.label,
            colour: created.active.colour,
          })
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
        registeredCount={quorums.length}
        onImportFile={async (contents: string) =>
          call<ImportedFileView>(transport, 'multisig.importFile', { contents })
        }
        onExportBundle={async () =>
          call<{ bundle: string }>(transport, 'multisig.exportBundle', {})
        }
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
        onForget={async (id: string) => {
          await call(transport, 'wallets.forget', { id })
          await refresh()
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

  if (stage.at === 'manage' && activeWallet !== null) {
    return (
      <ManageWalletScreen
        banner={banner}
        wallet={activeWallet}
        labelVerified={labelVerified}
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

  if (stage.at === 'labels') {
    return (
      <LabelsScreen
        banner={banner}
        onImport={async (text: string) =>
          call<ImportedLabels>(transport, 'labels.import', { text })
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
        onReview={async (message: string) =>
          call<MessageReviewView>(transport, 'message.review', { message })
        }
        onSign={async (message: string, scriptType: string, path: string) =>
          call<MessageSignatureView>(transport, 'message.sign', { message, scriptType, path })
        }
        onBack={() => {
          setStage({ at: 'wallet' })
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
