/**
 * @nullroute/ui: the device frontend.
 *
 * Receives xpubs, addresses, descriptors and PSBTs. The one exception is the
 * mnemonic during wallet creation, which a user has to see in order to write
 * down; the daemon gates that on session state and refuses it once backup is
 * confirmed. See packages/daemon/src/session.ts.
 *
 * Never generates entropy: a lint rule bans crypto.getRandomValues here,
 * because entropy collection happens in the daemon or it does not happen.
 */

export { MachineEntropyScreen } from './screens/MachineEntropyScreen.js'
export type {
  MachineEntropyScreenProps,
  HealthReportView,
  HealthCheckView,
} from './screens/MachineEntropyScreen.js'

export { AssembleQuorumScreen } from './screens/AssembleQuorumScreen.js'
export type {
  AssembleQuorumScreenProps,
  AssembledView,
} from './screens/AssembleQuorumScreen.js'

export { FleetScreen } from './screens/FleetScreen.js'
export type { FleetScreenProps, FleetQuorum, FleetCosigner } from './screens/FleetScreen.js'

export { DeviceNameScreen } from './screens/DeviceNameScreen.js'
export type { DeviceNameScreenProps } from './screens/DeviceNameScreen.js'

export { AttestationScreen } from './screens/AttestationScreen.js'
export type { AttestationScreenProps } from './screens/AttestationScreen.js'

export { StartScreen } from './screens/StartScreen.js'
export { FinishScreen } from './screens/FinishScreen.js'
export { ReceiveScreen, chunkAddress } from './screens/ReceiveScreen.js'
export type { ReceiveScreenProps, ReceiveAddress } from './screens/ReceiveScreen.js'
export type { FinishScreenProps } from './screens/FinishScreen.js'
export type { StartScreenProps } from './screens/StartScreen.js'

export { VerifyMessageScreen } from './screens/VerifyMessageScreen.js'
export type {
  VerifyMessageScreenProps,
  VerificationView,
  ScannedProof,
} from './screens/VerifyMessageScreen.js'

export { MoreScreen } from './screens/MoreScreen.js'
export type { MoreScreenProps } from './screens/MoreScreen.js'

export { NavMenu } from './components/NavMenu.js'
export type { NavMenuProps, NavDestination } from './components/NavMenu.js'

export { IdleBanner } from './components/IdleBanner.js'
export type { IdleBannerProps } from './components/IdleBanner.js'

export { useIdleLock } from './lib/idle.js'
export type { IdleState, IdleWindow, UseIdleLockOptions } from './lib/idle.js'

export { Steps } from './components/Steps.js'
export type { StepsProps } from './components/Steps.js'

export { JOURNEYS, journeyById, stepOf } from './journeys.js'
export type { Journey, JourneyId, JourneyStage, JourneyStep } from './journeys.js'

export { LockScreen } from './screens/LockScreen.js'
export type { LockScreenProps, AttestationView } from './screens/LockScreen.js'

export { SetupScreen } from './screens/SetupScreen.js'
export type { SetupScreenProps, EntropyMode, NetworkChoice } from './screens/SetupScreen.js'

export { DiceScreen } from './screens/DiceScreen.js'
export type { DiceScreenProps, Accounting, PatternWarning } from './screens/DiceScreen.js'

export { SeedScreen } from './screens/SeedScreen.js'
export type { SeedScreenProps } from './screens/SeedScreen.js'

export { ImportScreen } from './screens/ImportScreen.js'
export type { ImportScreenProps } from './screens/ImportScreen.js'

export { WalletScreen } from './screens/WalletScreen.js'
export type { WalletScreenProps, AddressRow, ScriptType } from './screens/WalletScreen.js'

export { PsbtScreen } from './screens/PsbtScreen.js'
export type { AttributionView, PsbtSignedView } from './screens/PsbtScreen.js'
export type {
  PsbtScreenProps,
  PsbtReviewView,
  PsbtInputView,
  PsbtOutputView,
  PsbtWarningView,
} from './screens/PsbtScreen.js'

export { PassphraseScreen } from './screens/PassphraseScreen.js'
export type { PassphraseScreenProps, PassphraseMode } from './screens/PassphraseScreen.js'

export { MultisigScreen } from './screens/MultisigScreen.js'
export type {
  MultisigScreenProps,
  RegistrationView,
  OurKeyView,
  CosignerView,
} from './screens/MultisigScreen.js'

export { ScanScreen } from './screens/ScanScreen.js'
export type { ScanScreenProps, ScanResult } from './screens/ScanScreen.js'

export { QrDisplay } from './components/QrDisplay.js'
export type { QrDisplayProps } from './components/QrDisplay.js'

export { LabelsScreen } from './screens/LabelsScreen.js'
export type { LabelsScreenProps, LabelRow, ImportedLabels } from './screens/LabelsScreen.js'

export { ChildSeedScreen } from './screens/ChildSeedScreen.js'
export type {
  ChildSeedScreenProps,
  ChildApplication,
  ChildSeedView,
} from './screens/ChildSeedScreen.js'

export { QuorumAddressesScreen } from './screens/QuorumAddressesScreen.js'
export type {
  QuorumAddressesScreenProps,
  QuorumAddressRow,
} from './screens/QuorumAddressesScreen.js'

export { ManageWalletScreen, WALLET_COLOUR_NAMES } from './screens/ManageWalletScreen.js'
export type { ManageWalletScreenProps, WalletColourName } from './screens/ManageWalletScreen.js'

export { BackupScreen } from './screens/BackupScreen.js'
export type { BackupScreenProps, BackupDescription, RestoredView } from './screens/BackupScreen.js'

export { MessageScreen, MESSAGE_SCRIPT_TYPES } from './screens/MessageScreen.js'
export type {
  MessageScreenProps,
  MessageReviewView,
  MessageSignatureView,
} from './screens/MessageScreen.js'

export { UnlockedScreen } from './screens/UnlockedScreen.js'
export type { UnlockedScreenProps } from './screens/UnlockedScreen.js'

export { WalletsScreen } from './screens/WalletsScreen.js'
export type { WalletsScreenProps, WalletRow } from './screens/WalletsScreen.js'
export { Identity } from './components/Identity.js'
export type { IdentityProps } from './components/Identity.js'

export { WordKeyboard } from './components/WordKeyboard.js'
export type { WordKeyboardProps } from './components/WordKeyboard.js'
export { TextKeyboard } from './components/TextKeyboard.js'
export type { TextKeyboardProps } from './components/TextKeyboard.js'

export { Screen } from './components/Screen.js'
export type { ScreenProps } from './components/Screen.js'
export { Button } from './components/Button.js'
export type { ButtonProps } from './components/Button.js'
export { Choice } from './components/Choice.js'
export type { ChoiceProps } from './components/Choice.js'

export { Hash, chunk, abbreviate } from './components/Hash.js'
export type { HashProps } from './components/Hash.js'

export { NetworkBanner } from './components/NetworkBanner.js'
export type { NetworkBannerProps } from './components/NetworkBanner.js'

export {
  prepareScanner,
  decodeFrame,
  assertSameOrigin,
  wasmLocation,
  ScannerError,
} from './lib/scanner.js'

export { call, IpcCallError } from './lib/client.js'
export type { IpcTransport, IpcFailure } from './lib/client.js'
