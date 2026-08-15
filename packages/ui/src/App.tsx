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
import { PassphraseScreen } from './screens/PassphraseScreen.js'
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
  | { readonly at: 'psbt' }
  /** A wallet exists on disk and the passphrase has not been given yet. */
  | { readonly at: 'unlock' }
  /** A wallet has just been created and can be saved to this device. */
  | { readonly at: 'protect' }

const transport = httpTransport()

export function App() {
  const [stage, setStage] = useState<Stage>({ at: 'loading' })
  const [attestation, setAttestation] = useState<AttestationView | null>(null)
  const [status, setStatus] = useState<DeviceStatus | null>(null)
  const [store, setStore] = useState<StoreStatus | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  const banner =
    status !== null && !status.network.isMainnet ? <NetworkBanner network={status.network} /> : null

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
          // Three ways past this screen. A wallet already in memory goes
          // straight through; a wallet sealed on disk needs its passphrase;
          // nothing at all means setup.
          if (status.hasWallet) setStage({ at: 'wallet' })
          else if (store?.exists === true) setStage({ at: 'unlock' })
          else setStage({ at: 'setup' })
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
          onLock={() => {
            const go = async (): Promise<void> => {
              await call(transport, 'session.lock')
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

  if (stage.at === 'psbt') {
    return (
      <PsbtScreen
        banner={banner}
        onReview={reviewPsbt}
        onSign={signPsbt}
        onBack={() => {
          setStage({ at: 'wallet' })
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
