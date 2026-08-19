/**
 * Every device screen, rendered at 800x480 with fixture data.
 *
 * NOT PART OF THE DEVICE. It lives in tools/ rather than packages/ for two
 * reasons: it must never be bundled into the image, and MANIFEST.lock covers
 * packages/ and spec/, so a change to a fixture here would alter the root hash
 * a user compares before entering their PIN.
 *
 * WHY IT EXISTS. Every screen past the lock screen had no layout verification
 * of any kind. The component tests run in jsdom, which computes no cascade and
 * no box model, so a button row that does not fit the panel, text clipped by a
 * fixed-height header, or an action bar pushed off the bottom of a 480px screen
 * all pass every check in the suite. tools/check-device-ui.mjs drives a real
 * browser and can only reach the lock screen, because there is no daemon.
 *
 * The failure this was written after: the wallet screen's action bar reached
 * eight buttons one at a time, each addition obviously fine on its own.
 *
 * Fixtures are deliberately at the long end of plausible. A label of the
 * maximum length, a descriptor with three cosigners, an error message that runs
 * to two lines. A screen that fits its happy path and not its worst case is a
 * screen that breaks the first time something goes wrong, which is the moment
 * it is most important to be readable.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import {
  BackupScreen,
  ChildSeedScreen,
  DiceScreen,
  ImportScreen,
  LabelsScreen,
  LockScreen,
  ManageWalletScreen,
  MessageScreen,
  MultisigScreen,
  StartScreen,
  PassphraseScreen,
  PsbtScreen,
  QuorumAddressesScreen,
  SeedScreen,
  SetupScreen,
  UnlockedScreen,
  WalletScreen,
  WalletsScreen,
} from '../../packages/ui/src/index.js'
import '../../packages/ui/src/styles.css'

/**
 * Every callback the gallery hands a screen.
 *
 * Rejects rather than resolving, so a fixture that accidentally depends on a
 * response fails visibly instead of rendering a screen half-populated with
 * whatever a default resolved to.
 */
const never = (): Promise<never> =>
  Promise.reject(new Error('The gallery calls nothing. This is a layout harness.'))
const noop = (): void => undefined

/** Long enough to be the worst case a real device would meet. */
const XPUB =
  'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj'
const DESCRIPTOR = `wsh(sortedmulti(2,[73c5da0a/48h/0h/0h/2h]${XPUB}/<0;1>/*,[aabbccdd/48h/0h/0h/2h]${XPUB}/<0;1>/*,[11223344/48h/0h/0h/2h]${XPUB}/<0;1>/*))#8rf6pq2t`
const ADDRESS = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'
const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

const QUORUM = {
  descriptor: DESCRIPTOR,
  threshold: 2,
  total: 3,
  ourPosition: 2,
  unreadable: null,
}

const SCREENS: Record<string, () => React.ReactElement> = {
  // A FAILING attestation, not a passing one. The failure path is the one that
  // matters and the one nobody sees while developing, and it is the longest
  // text this screen ever holds.
  lock: () => (
    <LockScreen
      attestation={{
        rootHash: '942b6a2b53d02c1bce1ce4e7592d3f13e44f23db8dea4ef02c4aea297081360d',
        rootHashShort: '942b6a2b...7081360d',
        specCount: 31,
        invariantCount: 210,
        tier: 'Tier 0: reproducible signed image',
        version: '0.1.0',
        checks: [
          { name: 'coverage', status: 'passed', detail: '204 of 204 runtime exports covered' },
          { name: 'invariants', status: 'passed', detail: '210 invariants bound to 475 tests' },
          { name: 'vectors', status: 'passed', detail: '4 of 4 vector files match' },
          { name: 'differential', status: 'passed', detail: '1 module cross-checked' },
          {
            name: 'integrity',
            status: 'failed',
            detail: 'packages/core/src/derive/hd.ts does not match MANIFEST.lock',
          },
        ],
      }}
      network={{ id: 'mainnet', label: 'Mainnet', isMainnet: true }}
      fingerprint="73c5da0a"
      onUnlock={noop}
      expanded
      onToggleExpanded={noop}
    />
  ),
  setup: () => <SetupScreen onStart={noop} />,
  dice: () => <DiceScreen onAccount={never} onComplete={noop} onCancel={noop} />,
  import: () => <ImportScreen onImport={never} onCancel={noop} />,
  seed: () => (
    <SeedScreen words={MNEMONIC.split(' ')} fingerprint="73c5da0a" onConfirm={noop} />
  ),
  passphrase: () => (
    <PassphraseScreen mode="enter" attemptsRemaining={2} maxAttempts={10} onSubmit={never} onCancel={noop} />
  ),
  wallets: () => (
    <WalletsScreen
      max={8}
      wallets={[
        {
          id: 'aaaaaaaaaaaaaaaa',
          label: 'Cold storage, three of five',
          colour: 'teal',
          network: 'mainnet',
          exists: true,
          attemptsRemaining: 10,
          destroyed: false,
        },
        {
          id: 'bbbbbbbbbbbbbbbb',
          label: 'Signet testing',
          colour: 'amber',
          network: 'signet',
          exists: true,
          attemptsRemaining: 3,
          destroyed: false,
        },
        {
          id: 'cccccccccccccccc',
          label: 'Erased by attempts',
          colour: 'rose',
          network: 'mainnet',
          exists: false,
          attemptsRemaining: 0,
          destroyed: true,
        },
      ]}
      active={{ id: 'aaaaaaaaaaaaaaaa', label: 'Cold storage, three of five' }}
      onUnlock={never}
      onCreate={noop}
      onForget={never}
      onCancel={noop}
      failure="One wallet on this device could not be read, so this list may be incomplete."
    />
  ),
  unlocked: () => (
    <UnlockedScreen
      label="Cold storage, three of five"
      colour="teal"
      fingerprint="73c5da0a"
      networkLabel="Mainnet"
      isMainnet
      usedPassphrase
      labelVerified={false}
      hintCorrected
      onContinue={noop}
      onLock={noop}
    />
  ),
  wallet: () => (
    <WalletScreen
      fingerprint="73c5da0a"
      quorums={[QUORUM]}
      onAddresses={async () =>
        Promise.resolve({
          addresses: Array.from({ length: 10 }, (_, i) => ({
            address: ADDRESS,
            path: `m/84'/0'/0'/0/${String(i)}`,
            index: i,
          })),
        })
      }
      onDescriptor={async () =>
        Promise.resolve({ descriptor: DESCRIPTOR, checksum: '8rf6pq2t' })
      }
      onXpub={async () =>
        Promise.resolve({ xpub: XPUB, path: "m/84'/0'/0'", masterFingerprint: '73c5da0a' })
      }
      onVerifyAddress={never}
      onSignTransaction={noop}
      onMultisig={noop}
      onProveControl={noop}
      onBackup={noop}
      onLabels={noop}
      onManage={noop}
      onChildSeed={noop}
      onQuorum={noop}
      onLock={noop}
    />
  ),
  psbt: () => (
    <PsbtScreen initialPsbt="" onScan={noop} onReview={never} onSign={never} onBack={noop} />
  ),
  multisig: () => (
    <MultisigScreen
      onOurKey={async () =>
        Promise.resolve({
          xpub: XPUB,
          path: "m/48'/0'/0'/2'",
          masterFingerprint: '73c5da0a',
          keyExpression: `[73c5da0a/48'/0'/0'/2']${XPUB}`,
        })
      }
      onReview={never}
      onRegister={never}
      onImportFile={never}
      onExportBundle={never}
      registeredCount={1}
      onBack={noop}
    />
  ),
  quorum: () => (
    <QuorumAddressesScreen
      descriptor={DESCRIPTOR}
      position={{ ours: 2, of: 3 }}
      onAddresses={async () =>
        Promise.resolve({
          change: false,
          addresses: Array.from({ length: 10 }, (_, i) => ({
            address: 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3',
            index: i,
          })),
        })
      }
      onBack={noop}
    />
  ),
  message: () => <MessageScreen onReview={never} onSign={never} onBack={noop} />,
  backup: () => <BackupScreen onCreate={never} onDescribe={never} onRestore={never} onBack={noop} />,
  labels: () => <LabelsScreen onImport={never} onExport={never} onBack={noop} />,
  child: () => <ChildSeedScreen onDerive={never} onBack={noop} />,
  start: () => <StartScreen walletOpen={false} onBegin={noop} onSkip={noop} />,
  manage: () => (
    <ManageWalletScreen
      wallet={{ label: 'Cold storage, three of five', colour: 'teal' }}
      labelVerified={false}
      onRename={never}
      onDestroy={never}
      onBack={noop}
    />
  ),
}

/**
 * States worth measuring beyond the one a screen opens in, as testids tapped in
 * order before the harness measures.
 *
 * A screen's default state is rarely its largest. The wallet's destination tab,
 * a confirmation carrying a warning banner and a keyboard, a result page with a
 * QR code: those are where a screen stops fitting, and none of them is what you
 * see when you arrive.
 *
 * This table lives beside the fixtures rather than in the checking tool,
 * because which taps matter is a property of the screen, and a list of
 * selectors inside a tool goes stale the first time somebody renames a button.
 * A testid here that no longer exists fails the harness rather than being
 * skipped, for the same reason.
 */
const REACH: Record<string, readonly (readonly string[])[]> = {
  wallet: [['tab-export'], ['tab-verify'], ['tab-more']],
  backup: [['backup-choose-create'], ['backup-choose-restore']],
  manage: [['manage-choose-rename'], ['manage-choose-destroy']],
  quorum: [['quorum-branch-change']],
  // The disclosure adds a textarea to a screen already holding a full
  // keyboard, which is the tallest this screen ever gets.
  import: [['import-typed-toggle']],
  // The preamble for the longest journey: what it needs, its five steps, and
  // what it still does not finish. The most text this screen ever holds.
  start: [['start-goal-multisig']],
}

// Published before rendering. A screen that throws must fail loudly as that
// screen rather than making the harness conclude the gallery is empty and skip
// every other screen with it.
;(
  window as unknown as {
    NULLROUTE_SCREENS: { name: string; reach: readonly string[] }[]
  }
).NULLROUTE_SCREENS = Object.keys(SCREENS).flatMap((name) => [
  { name, reach: [] },
  ...(REACH[name] ?? []).map((reach) => ({ name, reach })),
])

const name = new URLSearchParams(window.location.search).get('screen') ?? 'wallet'
const render = SCREENS[name]

const mount = document.getElementById('root')
if (mount === null) throw new Error('The gallery page has no #root.')
const root = createRoot(mount)
root.render(
  <StrictMode>
    {render === undefined ? (
      <pre data-testid="gallery-unknown">
        {`No screen called ${name}. Known: ${Object.keys(SCREENS).join(', ')}`}
      </pre>
    ) : (
      render()
    )}
  </StrictMode>
)
