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
  IdleBanner,
  NavRail,
  NetworkBanner,
  DiceScreen,
  ImportScreen,
  LabelsScreen,
  LockScreen,
  ManageWalletScreen,
  MessageScreen,
  MoreScreen,
  MultisigScreen,
  VerifyMessageScreen,
  StartScreen,
  AttestationScreen,
  DeviceNameScreen,
  FleetScreen,
  AssembleQuorumScreen,
  MachineEntropyScreen,
  FinishScreen,
  ReceiveScreen,
  PassphraseScreen,
  PsbtScreen,
  QuorumAddressesScreen,
  SeedScreen,
  SetupScreen,
  UnlockedScreen,
  WalletScreen,
  WalletsScreen,
  journeyById,
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

/** A named device, so the header chip is measured on every screen. */
const DEVICE = { name: 'The one in the attic', colour: 'teal' }


/** Long enough to be the worst case a real device would meet. */
const XPUB =
  'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj'
const DESCRIPTOR = `wsh(sortedmulti(2,[73c5da0a/48h/0h/0h/2h]${XPUB}/<0;1>/*,[aabbccdd/48h/0h/0h/2h]${XPUB}/<0;1>/*,[11223344/48h/0h/0h/2h]${XPUB}/<0;1>/*))#8rf6pq2t`
const ADDRESS = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'
const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

/**
 * A transaction worth reading carefully.
 *
 * The most security-critical screen on the device, and until this fixture
 * existed the gallery only ever rendered its empty state: a text box waiting
 * for a PSBT. Everything that makes the review screen hard, several outputs, a
 * change output that has to be told apart from a payment, a fee stated three
 * ways, a partial multisig, a blocking warning, went unmeasured and unlooked at.
 *
 * Deliberately at the awkward end of realistic. Four outputs rather than one, a
 * fee that is a large fraction of the spend, two of three signatures present so
 * the quorum arithmetic is on screen, and both a blocking and a non-blocking
 * warning at once.
 */
/**
 * The header a minute before the device locks itself, composed exactly as
 * App.tsx composes it: the countdown and the network tag, with the wallet chip
 * and the device name displaced to make room. Four chips beside a title do not
 * fit in 800px, and this harness is what proved it.
 *
 * Measured on the review screen, because that is the one with the least room
 * left and the one somebody is most likely to be reading quietly when the
 * countdown starts.
 */
const CROWDED_HEADER = (
  <>
    <IdleBanner remaining={42} onStayOpen={noop} />
    <NetworkBanner network={{ id: 'testnet3', label: 'Testnet', isMainnet: false }} />
  </>
)

/** A whole proof, as one scan of an armoured block delivers it. */
const SCANNED_PROOF = {
  address: 'bc1ppv609nr0vr25u07u95waq5lucwfm6tde4nydujnu8npg4q75mr5sxq8lt3',
  message: 'I control this address as of 2026-08-19.',
  signature: 'AUDjpClYFHngjnqQ3F0/3dyrLsOHFNEm4rKaaAc9GsfhC5+DngPJmXTeAmz+yfsVRa61PD2k9/CEQnLDvNUn9Qug',
}

const REVIEW = {
  // False, because a blocking warning is present. core defines signable as
  // exactly that, and a fixture that broke the coupling would be exercising a
  // state the daemon cannot produce.
  signable: false,
  replaceable: true,
  locktime: 0,
  ownedInputs: 2,
  signatures: {
    present: 1,
    required: 2,
    complete: false,
    inputs: [
      { index: 0, required: 2, cosigners: 3, present: 1, satisfied: false },
      { index: 1, required: 2, cosigners: 3, present: 1, satisfied: false },
    ],
  },
  sighash: {
    name: 'SIGHASH_ALL',
    meaning: 'Every input and every output is covered. Nothing can be changed after signing.',
    acceptable: true,
  },
  fee: {
    feeBtc: '0.00042000',
    feeSats: '42,000',
    vsize: 312,
    satsPerVbyte: 134.6,
    percentOfSpend: 8.4,
  },
  inputs: [
    {
      index: 0,
      txid: '5f2c1e9a4b7d8c3f60a1b2c3d4e5f60718293a4b5c6d7e8f9012a3b4c5d6e7f8',
      vout: 1,
      amountBtc: '0.00300000',
      derivationPath: "m/48'/0'/0'/2'/0/4",
    },
    {
      index: 1,
      txid: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012a3b4c5d6e7f85f2c1e9a4b7d8c3f60',
      vout: 0,
      amountBtc: '0.00242000',
      derivationPath: "m/48'/0'/0'/2'/0/9",
    },
  ],
  outputs: [
    {
      index: 0,
      address: 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3',
      amountBtc: '0.00250000',
      amountSats: '250,000',
      kind: 'payment' as const,
      changePath: null,
      // A loaded BIP-329 label, measured here because a note under an address
      // is a second line the row did not have and this screen is the tightest
      // on the device.
      label: 'Rent, March',
    },
    {
      index: 1,
      address: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
      amountBtc: '0.00100000',
      amountSats: '100,000',
      kind: 'payment' as const,
      changePath: null,
    },
    {
      index: 2,
      address: null,
      amountBtc: '0.00000000',
      amountSats: '0',
      kind: 'payment' as const,
      changePath: null,
    },
    {
      index: 3,
      address: 'bc1q9vza2e8x573nczrlzms0wvx3gsqjx7vavgkx0l',
      amountBtc: '0.00150000',
      amountSats: '150,000',
      kind: 'change' as const,
      changePath: "m/48'/0'/0'/2'/1/7",
    },
  ],
  warnings: [
    {
      kind: 'fee-high',
      message:
        'The fee is 8.4 percent of what this transaction spends, which is far above anything normal. Check the amounts before signing.',
      blocking: true,
    },
    {
      kind: 'output-unrecognised',
      message:
        'Output 2 has no address this device can render. It is a bare script, and nothing here can tell you where that money goes.',
      blocking: false,
    },
  ],
}

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
    <LockScreen device={DEVICE}
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
  setup: () => <SetupScreen device={DEVICE} onHome={noop} onStart={noop} />,
  dice: () => (
    <DiceScreen device={DEVICE}
      onHome={noop}
      onAccount={never}
      onComplete={noop}
      onCancel={noop}
      onRollForMe={async (count: number) => Promise.resolve({ rolls: '4'.repeat(count) })}
    />
  ),
  // Off a real device, which is the state that must refuse rather than pass.
  machine: () => (
    <MachineEntropyScreen device={DEVICE}
      onHome={noop}
      onHealth={async () =>
        Promise.resolve({
          healthy: false,
          unknown: true,
          checks: [
            { name: 'kernel-pool', verdict: 'unknown' as const, detail: 'not a Linux path here' },
            { name: 'hardware-rng', verdict: 'unknown' as const, detail: 'no /dev/hwrng here' },
            { name: 'boot-age', verdict: 'unknown' as const, detail: 'uptime is not readable' },
          ],
        })
      }
      onGenerate={never}
      onBack={noop}
    />
  ),
  import: () => <ImportScreen device={DEVICE} onHome={noop} onImport={never} onCancel={noop} />,
  seed: () => (
    <SeedScreen device={DEVICE} words={MNEMONIC.split(' ')} fingerprint="73c5da0a"
      onCheckPositions={async () => Promise.resolve([1, 4, 9])}
      onCheckWord={async () => Promise.resolve(true)}
      onConfirm={noop}
    />
  ),
  passphrase: () => (
    <PassphraseScreen device={DEVICE} mode="enter" attemptsRemaining={2} maxAttempts={10} onSubmit={never} onCancel={noop} />
  ),
  wallets: () => (
    <WalletsScreen device={DEVICE}
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
    <UnlockedScreen device={DEVICE}
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
    <WalletScreen device={DEVICE}
      nav={<NavRail current="wallet" onNavigate={noop} onLock={noop} />}
      fingerprint="73c5da0a"
      quorums={[QUORUM]}
      onAddresses={async () =>
        Promise.resolve({
          addresses: Array.from({ length: 10 }, (_, i) => ({
            address: ADDRESS,
            path: `m/84'/0'/0'/0/${String(i)}`,
            index: i,
            // One labelled row, so the harness measures a row that is a line
            // taller than its neighbours rather than a uniform column.
            label: i === 2 ? 'Rent, March' : null,
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
      onQuorum={noop}
    />
  ),
  psbt: () => (
    <PsbtScreen device={DEVICE} onHome={noop} initialPsbt="" onScan={noop} onReview={never} onSign={never} onBack={noop} />
  ),
  // Signed, and NOT finished: the state the second device of three lands on,
  // where the next move is another device rather than the machine that built
  // the transaction.
  'psbt-signed-partial': () => (
    <PsbtScreen device={DEVICE} onHome={noop}
      initialPsbt="cHNidP8BAHUCAAAAAQ=="
      onScan={noop}
      onReview={async () => Promise.resolve({ ...REVIEW, warnings: [], signable: true })}
      onSign={async () =>
        Promise.resolve({
          psbt: 'cHNidP8BAHUCAAAAAQ==',
          inputsSigned: 2,
          signedWith: ["m/48'/0'/0'/2'/0/4", "m/48'/0'/0'/2'/0/9"],
          signatures: {
            present: 2,
            required: 3,
            complete: false,
            inputs: [{ index: 0, required: 3, cosigners: 5, present: 2, satisfied: false }],
          },
          // The state this screen exists for on a fleet: not finished, and the
          // device says which box to walk to rather than that there is one.
          attribution: {
            cosigners: [
              { position: 0, fingerprint: 'aabbccdd', name: 'The attic Pi', isThisDevice: false, signed: true },
              { position: 1, fingerprint: '73c5da0a', isThisDevice: true, signed: true },
              { position: 2, fingerprint: '11223344', name: 'The one at my brother\u2019s', isThisDevice: false, signed: false },
              { position: 3, fingerprint: '55667788', isThisDevice: false, signed: false },
            ],
            unattributed: 1,
            waiting: 'Still to sign: The one at my brother\u2019s and one cosigner you have not named.',
          },
        })
      }
      onBack={noop}
    />
  ),
  // The same screen a minute before the device locks itself: an idle warning,
  // a testnet banner and the wallet chip all in a header that has to leave room
  // for a transaction underneath.
  'psbt-idle': () => (
    <PsbtScreen onHome={noop}
      banner={CROWDED_HEADER}
      initialPsbt="cHNidP8BAHUCAAAAAQ=="
      onScan={noop}
      onReview={async () => Promise.resolve(REVIEW)}
      onSign={never}
      onBack={noop}
    />
  ),
  // The screen that authorises spending money, in the state where it does so.
  'psbt-review': () => (
    <PsbtScreen device={DEVICE} onHome={noop}
      initialPsbt="cHNidP8BAHUCAAAAAQ=="
      onScan={noop}
      onReview={async () => Promise.resolve(REVIEW)}
      onSign={never}
      onBack={noop}
    />
  ),
  multisig: () => (
    <MultisigScreen device={DEVICE} onScan={noop} onHome={noop}
      initialText={DESCRIPTOR}
      onOurKey={async () =>
        Promise.resolve({
          xpub: XPUB,
          path: "m/48'/0'/0'/2'",
          masterFingerprint: '73c5da0a',
          keyExpression: `[73c5da0a/48'/0'/0'/2']${XPUB}`,
        })
      }
      onReview={async () =>
        Promise.resolve({
          descriptor: DESCRIPTOR,
          threshold: 2,
          total: 3,
          sorted: true,
          kind: 'wsh',
          ourPosition: 1,
          cosigners: [
            {
              position: 0,
              name: 'The attic Pi',
              fullXpub: XPUB,
              fingerprint: 'aabbccdd',
              origin: "m/48'/0'/0'/2'",
              xpub: 'xpub6Bos...T9nMdj',
              isThisDevice: false,
            },
            {
              position: 1,
              fullXpub: XPUB,
              fingerprint: '73c5da0a',
              origin: "m/48'/0'/0'/2'",
              xpub: 'xpub6Bos...T9nMdj',
              isThisDevice: true,
            },
            {
              position: 2,
              fullXpub: XPUB,
              fingerprint: '11223344',
              origin: "m/48'/0'/0'/2'",
              xpub: 'xpub6Bos...T9nMdj',
              isThisDevice: false,
            },
          ],
          warnings: [],
        })
      }
      onNameCosigner={never}
      onRegister={never}
      onImportFile={never}
      onExportBundle={never}
      registeredCount={1}
      onBack={noop}
    />
  ),
  quorum: () => (
    <QuorumAddressesScreen device={DEVICE} onHome={noop}
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
  message: () => <MessageScreen device={DEVICE} onHome={noop} onReview={never} onSign={never} onBack={noop} />,
  backup: () => <BackupScreen device={DEVICE} onScan={noop} onHome={noop} onCreate={never} onDescribe={never} onRestore={never} onBack={noop} />,
  more: () => (
    <MoreScreen device={DEVICE}
      nav={<NavRail current="more" onNavigate={noop} onLock={noop} />}
      quorumCount={2}
      onGuide={noop}
      onReceive={noop}
      onMultisig={noop}
      onProveControl={noop}
      onCheckProof={noop}
      onBackup={noop}
      onLabels={noop}
      onManage={noop}
      onFleet={noop}
      onSwitchWallet={noop}
      onCheckDevice={noop}
      onNameDevice={noop}
      onChildSeed={noop}
      onBack={noop}
    />
  ),
  labels: () => (
    <LabelsScreen device={DEVICE} onScan={noop} onHome={noop}
      // Filled, so the import button is live and the imported state is
      // reachable. That state is where the session-only caveat renders, and it
      // is the taller of the two.
      initialText={'{"type":"addr","ref":"bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu","label":"Rent, March"}'}
      onImport={async () =>
        Promise.resolve({
          labels: [
            { type: 'addr', ref: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu', label: 'Rent, March' },
            { type: 'tx', ref: '5f2c1e9a4b7d8c3f60a1b2c3d4e5f60718293a4b5c6d7e8f9012a3b4c5d6e7f8', label: 'Sold the bike', spendable: false },
          ],
          skipped: [{ line: 4, reason: 'not an object' }],
          note: 'Two labels read from one file.',
        })
      }
      onExport={async () => Promise.resolve({ text: '{"type":"addr"}\n' })}
      onBack={noop}
    />
  ),
  child: () => <ChildSeedScreen device={DEVICE} onHome={noop} onDerive={never} onBack={noop} />,
  // Checking somebody else's proof. Measured empty, which is the state with a
  // full keyboard and three tabs and nothing else, and after a pass and a
  // failure, which are the two states that add a banner above all of it.
  'verify-message': () => (
    <VerifyMessageScreen device={DEVICE} onHome={noop} onScan={noop}
      // A whole proof from one scan, which is how somebody actually arrives
      // here: the check button is live and the fields are full.
      scannedProof={SCANNED_PROOF}
      onVerify={async () => Promise.resolve({ valid: true, scriptType: 'p2tr' })}
      onBack={noop}
    />
  ),
  'verify-message-failed': () => (
    <VerifyMessageScreen device={DEVICE} onHome={noop} onScan={noop}
      scannedProof={SCANNED_PROOF}
      onVerify={async () =>
        Promise.resolve({
          valid: false,
          scriptType: 'p2wpkh',
          reason:
            'That signature is by a key that does not produce this address, so it proves control of something else.',
        })
      }
      onBack={noop}
    />
  ),
  start: () => <StartScreen device={DEVICE} walletOpen={false} onBegin={noop} onSkip={noop} />,
  assemble: () => (
    <AssembleQuorumScreen
      device={DEVICE}
      onHome={noop}
      onOurKey={async () =>
        Promise.resolve({
          keyExpression: `[73c5da0a/48'/0'/0'/2']${XPUB}`,
          masterFingerprint: '73c5da0a',
        })
      }
      onAssemble={async (threshold: number, keys: readonly string[]) =>
        Promise.resolve({
          descriptor: DESCRIPTOR,
          checksum: '8rf6pq2t',
          threshold,
          total: keys.length,
          keys,
        })
      }
      onReview={noop}
      onScan={noop}
      scanned={`[aabbccdd/48'/0'/0'/2']${XPUB}`}
      onBack={noop}
    />
  ),
  fleet: () => (
    <FleetScreen
      device={DEVICE}
      onHome={noop}
      deviceName="The one in the attic"
      quorums={[
        {
          descriptor: DESCRIPTOR,
          checksum: '8rf6pq2t',
          threshold: 2,
          total: 3,
          ourPosition: 2,
          cosigners: [
            {
              position: 0,
              name: 'The attic Pi',
              fingerprint: 'aabbccdd',
              xpub: 'xpub1...aaaa',
              isThisDevice: false,
            },
            { position: 1, fingerprint: '73c5da0a', xpub: 'xpub2...bbbb', isThisDevice: true },
            { position: 2, fingerprint: '11223344', xpub: 'xpub3...cccc', isThisDevice: false },
          ],
          unreadable: null,
        },
      ]}
      onAddresses={noop}
      onForget={never}
      onBack={noop}
    />
  ),
  'device-name': () => (
    <DeviceNameScreen
      onHome={noop}
      current={{ name: 'The one in the attic', colour: 'teal' }}
      device={{ name: 'The one in the attic', colour: 'teal' }}
      onSave={never}
      onBack={noop}
    />
  ),
  // The failing case, which is the one that should be impossible and therefore
  // the one worth looking at: a device open with a check failing.
  attestation: () => (
    <AttestationScreen device={DEVICE}
      onHome={noop}
      attestation={{
        rootHash: '942b6a2b53d02c1bce1ce4e7592d3f13e44f23db8dea4ef02c4aea297081360d',
        rootHashShort: '942b6a2b...7081360d',
        specCount: 31,
        invariantCount: 227,
        tier: 'Tier 0: reproducible signed image',
        version: '0.1.0',
        checks: [
          { name: 'coverage', status: 'passed', detail: '212 of 212 runtime exports covered' },
          { name: 'invariants', status: 'passed', detail: '227 invariants bound to 527 tests' },
          { name: 'vectors', status: 'passed', detail: '4 of 4 vector files match' },
          { name: 'differential', status: 'not-applicable', detail: '' },
          {
            name: 'integrity',
            status: 'failed',
            detail: 'packages/core/src/derive/hd.ts does not match MANIFEST.lock.',
          },
        ],
      }}
      expanded
      onToggleExpanded={noop}
      onBack={noop}
    />
  ),
  receive: () => (
    <ReceiveScreen device={DEVICE} onHome={noop}
      walletLabel="Cold storage, three of five"
      onAddress={async (index: number) =>
        Promise.resolve({ address: ADDRESS, path: `m/84'/0'/0'/0/${String(index)}`, index })
      }
      onVerify={async () => Promise.resolve({ found: true, path: "m/84'/0'/0'/0/0" })}
      onBack={noop}
    />
  ),
  // A device holding two quorums, which is the state that added a tab bar to a
  // screen that already carries an address in large type, a QR code and a
  // warning above the fold.
  'receive-quorum': () => (
    <ReceiveScreen device={DEVICE} onHome={noop}
      walletLabel="Cold storage, three of five"
      quorums={[
        { checksum: '8rf6pq2t', threshold: 2, total: 3, descriptor: DESCRIPTOR },
        { checksum: 'q35wkfm7', threshold: 3, total: 5, descriptor: DESCRIPTOR },
      ]}
      onQuorumAddress={async (_descriptor: string, index: number) =>
        Promise.resolve({ address: ADDRESS, path: `quorum index ${String(index)}`, index })
      }
      onVerifyQuorum={async () => Promise.resolve({ found: true, index: 0 })}
      onAddress={async (index: number) =>
        Promise.resolve({ address: ADDRESS, path: `m/84'/0'/0'/0/${String(index)}`, index })
      }
      onVerify={async () => Promise.resolve({ found: true, path: "m/84'/0'/0'/0/0" })}
      onBack={noop}
    />
  ),
  // The multisig journey, because it has the most left over and is therefore
  // the tallest this screen ever gets.
  finish: () => {
    const multisig = journeyById('multisig')
    if (multisig === undefined) throw new Error('the multisig journey is gone')
    return <FinishScreen device={DEVICE} journey={multisig} onDone={noop} />
  },
  manage: () => (
    <ManageWalletScreen device={DEVICE} onHome={noop}
      wallet={{ label: 'Cold storage, three of five', colour: 'teal' }}
      labelVerified={false}
      onRename={never}
      onChangePassphrase={never}
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
  wallet: [['tab-export'], ['tab-verify']],
  backup: [['backup-choose-create'], ['backup-choose-restore']],
  manage: [
    ['manage-choose-rename'],
    ['manage-choose-destroy'],
    // The tallest state on this screen: a banner about what it does not
    // change, three password fields, and a paragraph about what cannot be
    // recovered.
    ['manage-choose-passphrase'],
  ],
  quorum: [['quorum-branch-change']],
  // The disclosure adds a textarea to a screen already holding a full
  // keyboard, which is the tallest this screen ever gets.
  import: [['import-typed-toggle']],
  // The word check, which puts a full word keyboard on the screen that decides
  // whether a backup is real.
  seed: [['seed-ack', 'seed-confirm']],
  // The preamble for the longest journey: what it needs, its five steps, and
  // what it still does not finish. The most text this screen ever holds.
  // Chosen with no wallet open, which is the state that used to be refused and
  // now gains a step.
  start: [['start-goal-multisig'], ['start-goal-sign']],
  // Built, which is where the checksum every device compares is shown.
  assemble: [['assemble-build']],
  // The confirmation, which carries the sentence about what forgetting costs.
  fleet: [['fleet-forget-start']],
  // Imported, which is where the rows, the dropped-line banner and the caveat
  // about labels going at the next lock all appear at once.
  labels: [['labels-import']],
  // Filling each field, and then the result, which is a banner above a screen
  // that already holds a keyboard.
  'verify-message': [['verify-tab-message'], ['verify-run']],
  'verify-message-failed': [['verify-run']],
  // The reviewed quorum, which is where cosigner names appear.
  multisig: [['multisig-review']],
  // Verified, which adds a paragraph under a screen that already holds a QR
  // code, an address in large type and a warning banner.
  receive: [['receive-verify']],
  // The single-signature choice on a device that holds a quorum, which is the
  // weaker answer and carries a banner saying so, and then the verification on
  // top of it.
  'receive-quorum': [['receive-verify'], ['receive-source-single'], ['receive-source-single', 'receive-verify']],
  // Straight into the review, which is the state that matters, and then into
  // the confirmation that a blocking warning forces.
  // Sign is correctly disabled on the review fixture, which carries a blocking
  // warning: reaching the signed screen means ticking the override, which is
  // what a person does.
  'psbt-review': [['psbt-review'], ['psbt-review', 'psbt-override', 'psbt-sign']],
  'psbt-signed-partial': [['psbt-review'], ['psbt-review', 'psbt-sign']],
  // Into the review, which is where the header has the least room to spare.
  'psbt-idle': [['psbt-review']],
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
