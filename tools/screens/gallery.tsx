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
 * all pass every check in the suite. tools/checks/check-device-ui.mjs drives a real
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

import { StrictMode, cloneElement } from 'react'
import { createRoot } from 'react-dom/client'
import {
  BackupScreen,
  ChildSeedScreen,
  IdleBanner,
  NavMenu,
  Identity,
  Steps,
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
  ScanScreen,
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
/*
 * The header identity, as every screen now receives it: one node built once,
 * not a device prop each screen renders its own way.
 */
const DEVICE = (
  <Identity
    device="The one in the attic"
    wallet={{ label: 'Cold storage, three of five', colour: 'teal' }}
    networkLabel="Mainnet"
    isMainnet
    onSwitch={noop}
  />
)

/** With nothing open: what the lock screen and the picker show. */
const NO_WALLET = <Identity device="The one in the attic" onSwitch={noop} />

/*
 * The menu, closed, as most screens carry it.
 *
 * One constant rather than a literal per fixture. Fixtures had drifted apart
 * from each other and from the app: a contact sheet of the headers showed the
 * same screen rendered with a menu in one state and without it in another,
 * which made the header look inconsistent in a harness whose whole job is
 * catching that.
 */
const MENU = <NavMenu open={false} onToggle={noop} onNavigate={noop} />

/** Long enough to be the worst case a real device would meet. */
const XPUB =
  'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj'
const DESCRIPTOR = `wsh(sortedmulti(2,[73c5da0a/48h/0h/0h/2h]${XPUB}/<0;1>/*,[aabbccdd/48h/0h/0h/2h]${XPUB}/<0;1>/*,[11223344/48h/0h/0h/2h]${XPUB}/<0;1>/*))#8rf6pq2t`
const ADDRESS = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'
/**
 * TWENTY FOUR WORDS, because that is what the device makes.
 *
 * This was the twelve word test vector, so the seed screen was measured with
 * two fewer rows of chips than it ever renders on a real device: 66px the
 * harness could not see, on the one screen in this product that displays a
 * seed. Twelve word wallets exist here only by import, which is the case with
 * more room rather than less.
 *
 * The official all-abandon vector at 256 bits, so it is a real mnemonic with a
 * valid checksum rather than a plausible-looking string.
 */
const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon ' +
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon ' +
  'abandon art'

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

/**
 * A banner element that renders nothing.
 *
 * THE STATE THE REAL APP IS IN MOST OF THE TIME, and the one no fixture had.
 * App built its banner as a fragment with two conditional children, so on a
 * mainnet device with no idle warning it produced an element that is not null
 * and draws nothing. Screen tested for null, so the strip rendered empty, and
 * the grid above it then handed that empty strip the whole panel.
 *
 * Kept as a fixture rather than deleted with the bug: an empty banner is a
 * thing a caller can construct, and the guard that now refuses it needs
 * something to refuse.
 */
const EMPTY_BANNER = (
  <>
    {false}
    {null}
  </>
)

/** A whole proof, as one scan of an armoured block delivers it. */
const SCANNED_PROOF = {
  address: 'bc1ppv609nr0vr25u07u95waq5lucwfm6tde4nydujnu8npg4q75mr5sxq8lt3',
  message: 'I control this address as of 2026-08-19.',
  signature:
    'AUDjpClYFHngjnqQ3F0/3dyrLsOHFNEm4rKaaAc9GsfhC5+DngPJmXTeAmz+yfsVRa61PD2k9/CEQnLDvNUn9Qug',
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
      // The kind this device actually emits. It read 'fee-high' here, which is
      // not one, so the gallery was showing a refusal the daemon cannot cause.
      kind: 'high-fee' as const,
      message:
        'The fee is 8.4 percent of what this transaction spends, which is far above anything normal. Check the amounts before signing.',
      blocking: true,
    },
    {
      kind: 'unknown-fields' as const,
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
    <LockScreen
      identity={NO_WALLET}
      nav={<NavMenu open={false} onToggle={noop} onNavigate={noop} walletOpen={false} />}
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
  /**
   * The state a user actually sees: verification PASSED, hash abbreviated.
   *
   * The fixture above is the failing state with the hash expanded, which is
   * the worst case and the right thing for screen-fit to measure. It is a bad
   * sample for "what does somebody see on the hundredth boot", and reading it
   * as one is how an audit concludes that a 64 character hash dominates the
   * screen when the default is eight.
   */
  'lock-passing': () => (
    <LockScreen
      identity={NO_WALLET}
      attestation={{
        rootHash: '942b6a2b53d02c1bce1ce4e7592d3f13e44f23db8dea4ef02c4aea2970813600',
        rootHashShort: '942b6a2b',
        verityRootHash: 'c30d56036f3729bac36a5683533133016638af11d2d59debf9b90f09e8b56ade',
        specCount: 37,
        invariantCount: 283,
        tier: 'signer',
        version: '0.1.0',
        checks: [
          { name: 'coverage', status: 'passed', detail: '' },
          { name: 'invariants', status: 'passed', detail: '' },
          { name: 'vectors', status: 'passed', detail: '' },
          { name: 'differential', status: 'passed', detail: '' },
          { name: 'integrity', status: 'passed', detail: '' },
        ],
      }}
      network={{ id: 'mainnet', label: 'Mainnet', isMainnet: true }}
      fingerprint="73c5da0a"
      nav={<NavMenu open={false} onToggle={noop} onNavigate={noop} walletOpen={false} />}
      onGuide={noop}
      onUnlock={noop}
      onToggleExpanded={noop}
    />
  ),
  /*
   * The menu open, on the gate screen, which is the reason it is a menu.
   *
   * The fit harness measures this state: a floating panel is the one thing on
   * this device that is not laid out by the screen grid, so nothing else would
   * catch it running off the bottom of 480px.
   */
  'lock-no-verity': () => (
    <LockScreen
      identity={NO_WALLET}
      attestation={{
        rootHash: '942b6a2b53d02c1bce1ce4e7592d3f13e44f23db8dea4ef02c4aea2970813600',
        rootHashShort: '942b6a2b',
        // No mapping, which is what `make dev` on a laptop reports. The screen
        // has to say which guarantee is absent rather than leave a gap.
        verityRootHash: null,
        specCount: 37,
        invariantCount: 283,
        tier: 'signer',
        version: '0.1.0',
        checks: [
          { name: 'coverage', status: 'passed', detail: '' },
          { name: 'invariants', status: 'passed', detail: '' },
          { name: 'vectors', status: 'passed', detail: '' },
          { name: 'differential', status: 'passed', detail: '' },
          { name: 'integrity', status: 'passed', detail: '' },
        ],
      }}
      network={{ id: 'mainnet', label: 'Mainnet', isMainnet: true }}
      fingerprint="73c5da0a"
      nav={<NavMenu open={false} onToggle={noop} onNavigate={noop} walletOpen={false} />}
      onGuide={noop}
      onUnlock={noop}
      onToggleExpanded={noop}
    />
  ),
  /*
   * The menu open, on the gate screen, which is the reason it is a menu.
   *
   * The fit harness measures this state: a floating panel is the one thing on
   * this device that is not laid out by the screen grid, so nothing else would
   * catch it running off the bottom of 480px.
   */
  'lock-menu-open': () => (
    <LockScreen
      identity={NO_WALLET}
      attestation={{
        rootHash: '942b6a2b53d02c1bce1ce4e7592d3f13e44f23db8dea4ef02c4aea2970813600',
        rootHashShort: '942b6a2b',
        specCount: 37,
        invariantCount: 283,
        tier: 'signer',
        version: '0.1.0',
        checks: [
          { name: 'coverage', status: 'passed', detail: '' },
          { name: 'invariants', status: 'passed', detail: '' },
          { name: 'vectors', status: 'passed', detail: '' },
          { name: 'differential', status: 'passed', detail: '' },
          { name: 'integrity', status: 'passed', detail: '' },
        ],
      }}
      network={{ id: 'mainnet', label: 'Mainnet', isMainnet: true }}
      fingerprint="73c5da0a"
      nav={<NavMenu open onToggle={noop} onNavigate={noop} walletOpen={false} />}
      onGuide={noop}
      onUnlock={noop}
      onToggleExpanded={noop}
    />
  ),
  setup: () => <SetupScreen identity={NO_WALLET} nav={MENU} onStart={noop} />,
  dice: () => (
    <DiceScreen
      identity={DEVICE}
      nav={<NavMenu open={false} onToggle={noop} onNavigate={noop} />}
      onAccount={never}
      onComplete={noop}
      onCancel={noop}
      onRollForMe={async (count: number) => Promise.resolve({ rolls: '4'.repeat(count) })}
    />
  ),
  // Off a real device, which is the state that must refuse rather than pass.
  machine: () => (
    <MachineEntropyScreen
      identity={DEVICE}
      nav={<NavMenu open={false} onToggle={noop} onNavigate={noop} />}
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
  import: () => <ImportScreen identity={DEVICE} nav={MENU} onImport={never} onCancel={noop} />,
  seed: () => (
    <SeedScreen
      identity={DEVICE}
      words={MNEMONIC.split(' ')}
      fingerprint="73c5da0a"
      onCheckPositions={async () => Promise.resolve([1, 4, 9])}
      onCheckWord={async () => Promise.resolve(true)}
      onConfirm={noop}
    />
  ),
  passphrase: () => (
    <PassphraseScreen
      identity={DEVICE}
      mode="enter"
      attemptsRemaining={2}
      maxAttempts={10}
      onSubmit={never}
      onCancel={noop}
    />
  ),
  wallets: () => (
    <WalletsScreen
      identity={NO_WALLET}
      nav={<NavMenu open={false} onToggle={noop} onNavigate={noop} walletOpen={false} />}
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
      identity={DEVICE}
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
      identity={DEVICE}
      nav={<NavMenu current="wallet" open={false} onToggle={noop} onNavigate={noop} />}
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
      onDescriptor={async () => Promise.resolve({ descriptor: DESCRIPTOR, checksum: '8rf6pq2t' })}
      onXpub={async () =>
        Promise.resolve({ xpub: XPUB, path: "m/84'/0'/0'", masterFingerprint: '73c5da0a' })
      }
      onVerifyAddress={never}
    />
  ),
  psbt: () => (
    <PsbtScreen
      identity={DEVICE}
      nav={MENU}
      initialPsbt=""
      onScan={noop}
      onReview={never}
      onSign={never}
      onBack={noop}
    />
  ),
  // Signed, and NOT finished: the state the second device of three lands on,
  // where the next move is another device rather than the machine that built
  // the transaction.
  'psbt-signed-partial': () => (
    <PsbtScreen
      identity={DEVICE}
      nav={<NavMenu open={false} onToggle={noop} onNavigate={noop} />}
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
              {
                position: 0,
                fingerprint: 'aabbccdd',
                name: 'The attic Pi',
                isThisDevice: false,
                signed: true,
              },
              { position: 1, fingerprint: '73c5da0a', isThisDevice: true, signed: true },
              {
                position: 2,
                fingerprint: '11223344',
                name: 'The one at my brother\u2019s',
                isThisDevice: false,
                signed: false,
              },
              { position: 3, fingerprint: '55667788', isThisDevice: false, signed: false },
            ],
            unattributed: 1,
            waiting:
              'Still to sign: The one at my brother\u2019s and one cosigner you have not named.',
          },
        })
      }
      onBack={noop}
    />
  ),
  // The same screen a minute before the device locks itself: an idle warning,
  // a testnet banner and the wallet chip all in a header that has to leave room
  // for a transaction underneath.
  /* ==========================================================================
     WHAT THE DEVICE LOOKS LIKE WHEN SOMETHING FAILS.

     Nineteen screens carry an error banner and not one of them had ever been
     rendered here. They are asserted in unit tests, which run in jsdom: no
     cascade, no box model, so a banner off the bottom of the panel or drawn in
     a colour nobody can read passes every one of them. That is exactly how the
     lock screen once shipped with no styling at all.

     These states use handlers that reject, which is what the gallery's `never`
     already does, and a reach list that taps the control which calls them. The
     failure path is then measured by the same checks as everything else: it has
     to fit, to be legible in both themes, and to use the same three roles.
     ========================================================================== */
  'psbt-failed': () => (
    <PsbtScreen
      identity={DEVICE}
      nav={MENU}
      initialPsbt="cHNidP8BAHUCAAAAAQ=="
      onScan={noop}
      onReview={never}
      onSign={never}
      onBack={noop}
    />
  ),
  'multisig-failed': () => (
    <MultisigScreen
      identity={DEVICE}
      nav={MENU}
      onScan={noop}
      initialText={DESCRIPTOR}
      onOurKey={never}
      onReview={never}
      onRegister={never}
      onBack={noop}
    />
  ),
  'receive-failed': () => (
    <ReceiveScreen identity={DEVICE} nav={MENU} onAddress={never} onVerify={never} onBack={noop} />
  ),
  'assemble-failed': () => (
    <AssembleQuorumScreen
      identity={DEVICE}
      nav={<NavMenu open={false} onToggle={noop} onNavigate={noop} />}
      onOurKey={async () =>
        Promise.resolve({
          keyExpression: `[73c5da0a/48'/0'/0'/2']${XPUB}`,
          masterFingerprint: '73c5da0a',
        })
      }
      onAssemble={never}
      onReview={noop}
      onScan={noop}
      scanned={`[aabbccdd/48'/0'/0'/2']${XPUB}`}
      onBack={noop}
    />
  ),
  'labels-failed': () => (
    <LabelsScreen
      identity={DEVICE}
      onScan={noop}
      nav={<NavMenu open={false} onToggle={noop} onNavigate={noop} />}
      initialText={
        '{"type":"addr","ref":"bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu","label":"Rent, March"}'
      }
      onImport={never}
      onExport={never}
      onBack={noop}
    />
  ),
  'quorum-failed': () => (
    <QuorumAddressesScreen
      identity={DEVICE}
      nav={<NavMenu open={false} onToggle={noop} onNavigate={noop} />}
      descriptor={DESCRIPTOR}
      position={{ ours: 2, of: 3 }}
      onAddresses={never}
      onBack={noop}
    />
  ),
  'verify-message-error': () => (
    <VerifyMessageScreen
      identity={DEVICE}
      nav={MENU}
      onScan={noop}
      scannedProof={SCANNED_PROOF}
      onVerify={never}
      onBack={noop}
    />
  ),
  /*
   * A camera that opens and then reads two frames from different transfers.
   *
   * The refusal this draws is the interesting one on this screen. A camera that
   * will not open is a dead end with a Cancel button; a camera reading half of
   * one sequence and half of another assembles a payload out of two documents
   * unless something stops it, and what stops it is a banner over a live
   * viewfinder that the user has to read while pointing the device at a screen.
   *
   * An empty MediaStream, because the harness has no camera and the screen only
   * needs something to hand to the video element.
   */
  /*
   * A transaction built against somebody else's descriptor.
   *
   * The coordinator's usual mistake, and the one that looks most like working:
   * a well-formed PSBT arrives, the review renders in full, and not one input
   * belongs to this wallet. The screen has to say so before the amounts, since
   * a person reading a plausible outputs table has no way to tell.
   *
   * No blocking warning here on purpose, so this measures the refusal on its
   * own rather than underneath another one.
   */
  /*
   * A review built while a registered quorum could not be read.
   *
   * The interesting half is what is NOT on the screen: none of that quorum's
   * addresses are in the owned index, so its change is in the outputs table
   * below as a payment to a stranger. The banner is the only thing that says
   * the table is describing a smaller wallet than the user has.
   */
  'psbt-unreadable-quorum': () => (
    <PsbtScreen
      identity={DEVICE}
      nav={MENU}
      initialPsbt="cHNidP8BAHUCAAAAAQ=="
      onScan={noop}
      onReview={async () =>
        Promise.resolve({ ...REVIEW, signable: true, warnings: [], unreadableRegistrations: 1 })
      }
      onSign={never}
      onBack={noop}
    />
  ),
  'psbt-not-ours': () => (
    <PsbtScreen
      identity={DEVICE}
      nav={MENU}
      initialPsbt="cHNidP8BAHUCAAAAAQ=="
      onScan={noop}
      onReview={async () =>
        Promise.resolve({ ...REVIEW, signable: true, ownedInputs: 0, warnings: [] })
      }
      onSign={never}
      onBack={noop}
    />
  ),
  'scan-failed': () => (
    <ScanScreen
      identity={DEVICE}
      nav={MENU}
      onResult={noop}
      onCancel={noop}
      openCamera={async () => Promise.resolve(new MediaStream())}
      readFrame={async () => Promise.resolve(['B$2P0200MFRGGZDF', 'B$2P0300MFRGGZDF'])}
    />
  ),
  /*
   * Sources this device could observe and did not like, which is different from
   * sources it could not observe at all.
   *
   * The `machine` state above is the second: every row unknown, which is what
   * happens off a Pi. That hides the banner that says the device will not do the
   * thing, because the unknown banner takes its place. Nothing had ever drawn
   * the refusal itself.
   */
  'machine-unhealthy': () => (
    <MachineEntropyScreen
      identity={DEVICE}
      nav={<NavMenu open={false} onToggle={noop} onNavigate={noop} />}
      onHealth={async () =>
        Promise.resolve({
          healthy: false,
          unknown: false,
          checks: [
            { name: 'kernel-pool', verdict: 'ok' as const, detail: 'seeded, 256 bits' },
            {
              name: 'hardware-rng',
              verdict: 'failed' as const,
              detail: 'returned the same block twice',
            },
            { name: 'boot-age', verdict: 'ok' as const, detail: 'up 41 minutes' },
          ],
        })
      }
      onGenerate={never}
      onBack={noop}
    />
  ),
  // Healthy sources and a generator that refuses anyway, which is the only way
  // to reach the last banner on this screen.
  'machine-failed': () => (
    <MachineEntropyScreen
      identity={DEVICE}
      nav={<NavMenu open={false} onToggle={noop} onNavigate={noop} />}
      onHealth={async () =>
        Promise.resolve({
          healthy: true,
          unknown: false,
          checks: [
            { name: 'kernel-pool', verdict: 'ok' as const, detail: 'seeded, 256 bits' },
            { name: 'hardware-rng', verdict: 'ok' as const, detail: 'present and distinct' },
            { name: 'boot-age', verdict: 'ok' as const, detail: 'up 41 minutes' },
          ],
        })
      }
      onGenerate={never}
      onBack={noop}
    />
  ),
  // The export tab with the xpub disclosure open and the derivation refused.
  'wallet-xpub-failed': () => (
    <WalletScreen
      identity={DEVICE}
      nav={<NavMenu open={false} onToggle={noop} onNavigate={noop} />}
      fingerprint="73c5da0a"
      onAddresses={async () =>
        Promise.resolve({
          addresses: Array.from({ length: 10 }, (_, i) => ({
            address: ADDRESS,
            path: `m/84'/0'/0'/0/${String(i)}`,
            index: i,
            label: null,
          })),
        })
      }
      onDescriptor={async () => Promise.resolve({ descriptor: DESCRIPTOR, checksum: '8rf6pq2t' })}
      onXpub={never}
      onVerifyAddress={never}
    />
  ),

  'psbt-idle': () => (
    <PsbtScreen
      nav={<NavMenu open={false} onToggle={noop} onNavigate={noop} />}
      banner={CROWDED_HEADER}
      initialPsbt="cHNidP8BAHUCAAAAAQ=="
      onScan={noop}
      onReview={async () => Promise.resolve(REVIEW)}
      onSign={never}
      onBack={noop}
    />
  ),
  // The same screen with a banner that draws nothing, which is what a mainnet
  // device with no idle warning actually passes. See EMPTY_BANNER.
  'psbt-empty-banner': () => (
    <PsbtScreen
      nav={<NavMenu open={false} onToggle={noop} onNavigate={noop} />}
      banner={EMPTY_BANNER}
      initialPsbt="cHNidP8BAHUCAAAAAQ=="
      onScan={noop}
      onReview={async () => Promise.resolve(REVIEW)}
      onSign={never}
      onBack={noop}
    />
  ),
  // The screen that authorises spending money, in the state where it does so.
  'psbt-review': () => (
    <PsbtScreen
      identity={DEVICE}
      nav={<NavMenu open={false} onToggle={noop} onNavigate={noop} />}
      initialPsbt="cHNidP8BAHUCAAAAAQ=="
      onScan={noop}
      onReview={async () => Promise.resolve(REVIEW)}
      onSign={never}
      onBack={noop}
    />
  ),
  multisig: () => (
    <MultisigScreen
      identity={DEVICE}
      onScan={noop}
      nav={<NavMenu open={false} onToggle={noop} onNavigate={noop} />}
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
    <QuorumAddressesScreen
      identity={DEVICE}
      nav={<NavMenu open={false} onToggle={noop} onNavigate={noop} />}
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
  message: () => (
    <MessageScreen identity={DEVICE} nav={MENU} onReview={never} onSign={never} onBack={noop} />
  ),
  /*
   * The same screen with the promises resolving, so the review and the signed
   * states can be reached and measured.
   *
   * They never had been. The fixture above hands this screen two promises that
   * never settle, which is right for measuring the keyboard and means the two
   * states after it were invisible to every visual guard in the repo. One of
   * them carries a QR code holding the address, the message and the signature,
   * which is the only thing on that screen worth having.
   */
  'message-signed': () => (
    <MessageScreen
      identity={DEVICE}
      nav={MENU}
      onReview={async (message) =>
        Promise.resolve({
          message,
          hashHex: '7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069',
          characters: message.length,
          bytes: message.length,
          refusals: [],
          warnings: [],
        })
      }
      onSign={async (message, _scriptType, path) =>
        Promise.resolve({
          address: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
          message,
          signature:
            'AkgwRQIhAOzyynlqt93lOKJr+wmmxIens//zPzl9tqIOua93wO6MAiBi5n5EyAcPScO' +
            '+eknGHbJ4jc1Iw1TnAmoBEcdgYlOTAQ==',
          path,
        })
      }
      onBack={noop}
    />
  ),
  backup: () => (
    <BackupScreen
      identity={DEVICE}
      onScan={noop}
      nav={MENU}
      onCreate={never}
      onDescribe={never}
      onRestore={never}
      onBack={noop}
    />
  ),
  more: () => (
    <MoreScreen
      identity={DEVICE}
      nav={<NavMenu current="more" open={false} onToggle={noop} onNavigate={noop} />}
      theme="dark"
      onSetTheme={async () => Promise.resolve()}
      onMultisig={noop}
      onProveControl={noop}
      onCheckProof={noop}
      onBackup={noop}
      onLabels={noop}
      onManage={noop}
      onSwitchWallet={noop}
      onCheckDevice={noop}
      onNameDevice={noop}
      onChildSeed={noop}
      onBack={noop}
    />
  ),
  /**
   * The panel in LIGHT. Rendered by stamping the attribute the app stamps, so
   * this measures the real theme rather than a second stylesheet.
   */
  'wallet-light': () => {
    document.documentElement.setAttribute('data-theme', 'light')
    return (
      <WalletScreen
        identity={DEVICE}
        nav={<NavMenu current="wallet" open={false} onToggle={noop} onNavigate={noop} />}
        fingerprint="73c5da0a"
        quorums={[QUORUM]}
        onAddresses={async () =>
          Promise.resolve({
            addresses: Array.from({ length: 10 }, (_, i) => ({
              address: ADDRESS,
              path: `m/84'/0'/0'/0/${String(i)}`,
              index: i,
              label: i === 2 ? 'Rent, March' : null,
            })),
          })
        }
        onDescriptor={async () => Promise.resolve({ descriptor: DESCRIPTOR, checksum: '8rf6pq2t' })}
        onXpub={async () =>
          Promise.resolve({ xpub: XPUB, path: "m/84'/0'/0'", masterFingerprint: '73c5da0a' })
        }
        onVerifyAddress={never}
      />
    )
  },
  labels: () => (
    <LabelsScreen
      identity={DEVICE}
      onScan={noop}
      nav={<NavMenu open={false} onToggle={noop} onNavigate={noop} />}
      // Filled, so the import button is live and the imported state is
      // reachable. That state is where the session-only caveat renders, and it
      // is the taller of the two.
      initialText={
        '{"type":"addr","ref":"bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu","label":"Rent, March"}'
      }
      onImport={async () =>
        Promise.resolve({
          labels: [
            {
              type: 'addr',
              ref: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
              label: 'Rent, March',
            },
            {
              type: 'tx',
              ref: '5f2c1e9a4b7d8c3f60a1b2c3d4e5f60718293a4b5c6d7e8f9012a3b4c5d6e7f8',
              label: 'Sold the bike',
              spendable: false,
            },
          ],
          skipped: [{ line: 4, reason: 'not an object' }],
          note: 'Two labels read from one file.',
        })
      }
      onExport={async () => Promise.resolve({ text: '{"type":"addr"}\n' })}
      onBack={noop}
    />
  ),
  child: () => <ChildSeedScreen identity={DEVICE} nav={MENU} onDerive={never} onBack={noop} />,
  // Checking somebody else's proof. Measured empty, which is the state with a
  // full keyboard and three tabs and nothing else, and after a pass and a
  // failure, which are the two states that add a banner above all of it.
  'verify-message': () => (
    <VerifyMessageScreen
      identity={DEVICE}
      nav={MENU}
      onScan={noop}
      // A whole proof from one scan, which is how somebody actually arrives
      // here: the check button is live and the fields are full.
      scannedProof={SCANNED_PROOF}
      onVerify={async () => Promise.resolve({ valid: true, scriptType: 'p2tr' })}
      onBack={noop}
    />
  ),
  'verify-message-failed': () => (
    <VerifyMessageScreen
      identity={DEVICE}
      nav={MENU}
      onScan={noop}
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
  start: () => (
    <StartScreen
      identity={DEVICE}
      walletOpen={false}
      onBegin={noop}
      onSkip={noop}
      // No wallet open, so the rail shows only what works without one.
      nav={
        <NavMenu
          current="guide"
          open={false}
          onToggle={noop}
          onNavigate={noop}
          walletOpen={false}
        />
      }
    />
  ),
  assemble: () => (
    <AssembleQuorumScreen
      identity={DEVICE}
      nav={<NavMenu open={false} onToggle={noop} onNavigate={noop} />}
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
      identity={DEVICE}
      nav={<NavMenu open={false} onToggle={noop} onNavigate={noop} />}
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
      nav={<NavMenu open={false} onToggle={noop} onNavigate={noop} />}
      identity={DEVICE}
      current={{ name: 'The one in the attic', colour: 'teal' }}
      onSave={never}
      onBack={noop}
    />
  ),
  // The failing case, which is the one that should be impossible and therefore
  // the one worth looking at: a device open with a check failing.
  attestation: () => (
    <AttestationScreen
      identity={DEVICE}
      nav={<NavMenu open={false} onToggle={noop} onNavigate={noop} />}
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
      onLock={noop}
      expanded
      onToggleExpanded={noop}
      onBack={noop}
    />
  ),
  receive: () => (
    <ReceiveScreen
      identity={DEVICE}
      nav={<NavMenu open={false} onToggle={noop} onNavigate={noop} />}
      onAddress={async (index: number) =>
        Promise.resolve({ address: ADDRESS, path: `m/84'/0'/0'/0/${String(index)}`, index })
      }
      onVerify={async () => Promise.resolve({ found: true, path: "m/84'/0'/0'/0/0" })}
      onBack={noop}
    />
  ),
  /*
   * Every entry the menu has: six destinations and a lock, on a device with a
   * wallet open and a quorum registered. This is the tallest the panel gets,
   * and it is the state that decides whether the eighth entry would fit.
   */
  'receive-menu-open': () => (
    <ReceiveScreen
      identity={DEVICE}
      nav={<NavMenu open={false} onToggle={noop} onNavigate={noop} />}
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
    <ReceiveScreen
      identity={DEVICE}
      nav={<NavMenu open={false} onToggle={noop} onNavigate={noop} />}
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
    return <FinishScreen identity={DEVICE} nav={MENU} journey={multisig} onDone={noop} />
  },
  manage: () => (
    <ManageWalletScreen
      identity={DEVICE}
      nav={<NavMenu open={false} onToggle={noop} onNavigate={noop} />}
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
  backup: [
    ['backup-choose-create'],
    ['backup-choose-restore'],
    // Writing a backup that fails. One key is enough: the button is gated on
    // the passphrase being non-empty, not on it being any good.
    ['backup-choose-create', 'pk-key-a', 'backup-create-submit'],
  ],
  quorum: [['quorum-branch-change']],
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
  'receive-quorum': [
    ['receive-verify'],
    ['receive-source-single'],
    ['receive-source-single', 'receive-verify'],
  ],
  // Straight into the review, which is the state that matters, and then into
  // the confirmation that a blocking warning forces.
  // Sign is correctly disabled on the review fixture, which carries a blocking
  // warning: reaching the signed screen means ticking the override, which is
  // what a person does.
  /* Scrolled before signing, because that is now the requirement rather than
     good manners: the review is 800px past the fold and Sign is refused until
     the body reaches its end. A list that taps Sign without it describes
     something a person cannot do, and the harness says so. */
  'psbt-review': [
    ['psbt-review'],
    ['psbt-review', 'scroll'],
    ['psbt-review', 'psbt-override', 'scroll', 'psbt-sign'],
  ],
  'psbt-signed-partial': [['psbt-review'], ['psbt-review', 'scroll', 'psbt-sign']],
  // Into the review, which is where the header has the least room to spare.
  'psbt-idle': [['psbt-review']],
  // The failure paths. Each taps the control whose handler rejects, so the
  // banner the screen draws on a failed call is on screen and measurable.
  'psbt-failed': [['psbt-review']],
  'multisig-failed': [['multisig-review']],
  'psbt-not-ours': [['psbt-review']],
  'psbt-unreadable-quorum': [['psbt-review']],
  'assemble-failed': [['assemble-build']],
  // Nothing to tap. The camera opens, plays, and pulls its first frame through
  // the decoder on a 200ms timer, so this state arrives about two seconds after
  // the screen does and the harness has to wait for it rather than measure at
  // 120ms and conclude it was never drawn.
  'scan-failed': [['wait:scan-error']],
  'labels-failed': [['labels-import']],
  'verify-message-error': [['verify-run']],
  child: [['child-derive']],
  'device-name': [['device-name-save']],
  message: [['pk-key-a', 'message-review']],
  passphrase: [['pk-key-a', 'passphrase-submit']],
  // Acknowledged and generated, which is the only route to this screen's last
  // banner: the button is gated on both the tick and a healthy report.
  'machine-failed': [['machine-acknowledge', 'machine-generate']],
  // Open the disclosure, then ask for the xpub. The banner renders inside the
  // disclosure, which is the part worth measuring: a refusal nested two levels
  // down on the tab that already holds a QR code and a 200 character descriptor.
  'wallet-xpub-failed': [['tab-export', 'xpub-disclosure', 'xpub-show']],
  // Unlocking a wallet that refuses, and clearing a row whose wallet is
  // already gone. Two different screens inside the one fixture, and the second
  // is reached through a row that is disabled unless the wallet is a tombstone.
  wallets: [
    ['wallet-row-aaaaaaaaaaaaaaaa', 'pk-key-a', 'wallet-unlock-submit'],
    ['wallet-row-cccccccccccccccc', 'wallets-forget-submit'],
  ],
  // Every state this screen has, and then the three refusals. Every handler on
  // the manage fixture already rejects and nothing had ever tapped them.
  manage: [
    ['manage-choose-rename'],
    ['manage-choose-destroy'],
    // The tallest state on this screen: a banner about what it does not
    // change, three password fields, and a paragraph about what cannot be
    // recovered.
    ['manage-choose-passphrase'],
    // The name field starts empty when the label is unverified, which is what
    // this fixture is, so it is typed rather than assumed.
    [
      'manage-choose-rename',
      'type:manage-label:Cold storage, three of five',
      'pk-key-a',
      'manage-rename-submit',
    ],
    [
      'manage-choose-destroy',
      'type:manage-destroy-confirm:Cold storage, three of five',
      'manage-destroy-submit',
    ],
    [
      'manage-choose-passphrase',
      'type:manage-passphrase-old:old one',
      'type:manage-passphrase-new:new one',
      'type:manage-passphrase-confirm:new one',
      'manage-passphrase-submit',
    ],
  ],
  // Typed rather than tapped out on the word keyboard. Twelve words is forty
  // eight taps of harness standing in for one paste, and the screen offers this
  // route precisely because somebody restoring has the words in front of them.
  import: [
    ['import-typed-toggle'],
    ['import-typed-toggle', `type:import-mnemonic:${MNEMONIC}`, 'import-submit'],
  ],
  // Forgetting a quorum, confirmed by typing its checksum back.
  fleet: [
    ['fleet-forget-start'],
    ['fleet-forget-start', 'type:fleet-forget-confirm:8rf6pq2t', 'fleet-forget-submit'],
  ],
  // Typed, reviewed, and then signed. The signed state is the one that matters:
  // it holds the QR carrying the address, the message and the signature, and
  // nothing had ever measured it.
  // A key first: Review is disabled on an empty message, and a reach list that
  // taps a disabled control fails loudly rather than measuring the screen it was
  // already on.
  'message-signed': [
    ['pk-key-a', 'message-review'],
    ['pk-key-a', 'message-review', 'message-sign'],
  ],
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

/**
 * Every state carries the network banner, unless its fixture set one already.
 *
 * WHY THIS IS NOT A DECORATION. Two of sixty eight states used to carry a
 * banner. A real device on signet, testnet4 or regtest carries one on EVERY
 * screen, permanently, and the strip costs about 50px of a 480px panel. So the
 * fit harness was measuring a screen 50px taller than the one a person
 * developing against this device actually looks at, and reporting it as
 * fitting.
 *
 * That is not a hypothetical gap. Walking the real application turned up the
 * seed screen 40px over with its "Paper only" warning cut, the word keyboard
 * clipped on the backup check, and the goal hub hiding three of its six goals,
 * every one of them reported as fitting by check-screen-fit.
 *
 * MEASURING THE TIGHTER CASE IS ENOUGH. A banner only ever adds height, so a
 * screen that fits with one fits without. Mainnet, which is the shipping
 * configuration, has more room rather than less, and does not need its own
 * sixty eight fixtures to prove it.
 *
 * An explicit banner in a fixture wins, so the idle-warning and empty-banner
 * states still measure what they were written to measure.
 */
/**
 * Screens a guided journey passes through, by gallery name.
 *
 * Taken from the stages in packages/ui/src/journeys.ts. A screen reached inside
 * a journey renders a step counter above its title, which makes the header 90px
 * instead of 74, and NO fixture set one: sixteen more pixels the harness could
 * not see, on top of the thirty four the network banner costs.
 *
 * Only these, rather than all of them. The banner is universal on any device
 * that is not on mainnet, so measuring every state with one is measuring the
 * truth. A step counter is not: it appears only inside a journey, and holding
 * the attestation screen to a standard it will never face would be inventing
 * work rather than finding it.
 */
const IN_A_JOURNEY = new Set([
  'setup',
  'dice',
  'machine',
  'seed',
  'import',
  'psbt',
  'psbt-idle',
  'psbt-review',
  'psbt-signed-partial',
  'receive',
  'receive-quorum',
  'multisig',
  'quorum',
  'backup',
  'wallets',
])

function withSteps(element: React.ReactElement, name: string): React.ReactElement {
  if (!IN_A_JOURNEY.has(name)) return element
  const existing = (element.props as { steps?: unknown }).steps
  if (existing !== undefined) return element
  return cloneElement(element as React.ReactElement<{ steps?: React.ReactNode }>, {
    // Four of five, because the label is the longest thing this line ever
    // carries and a two digit count is the widest it gets.
    steps: <Steps current={4} total={5} label="Write the words down" />,
  })
}

function withBanner(element: React.ReactElement): React.ReactElement {
  const existing = (element.props as { banner?: unknown }).banner
  if (existing !== undefined) return element
  return cloneElement(element as React.ReactElement<{ banner?: React.ReactNode }>, {
    banner: <NetworkBanner network={{ id: 'signet', label: 'Signet', isMainnet: false }} />,
  })
}

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
      withBanner(withSteps(render(), name))
    )}
  </StrictMode>
)
