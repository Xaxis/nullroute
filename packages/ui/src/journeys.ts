/**
 * What a person is trying to do, and the steps it takes.
 *
 * Spec: ui.journeys
 *
 * The device's screens are organised by feature: addresses, export, multisig,
 * backup. That is how the code is shaped and it is not how anybody arrives. A
 * person holding this thing is trying to accomplish something ("get my three
 * Pis onto one wallet", "sign the transaction my laptop just made", "replace
 * the one that died"), and the mapping from that sentence to a sequence of
 * screens is knowledge the device has and the user does not.
 *
 * A journey is that mapping, written down. It gives three things a flat stage
 * machine cannot:
 *
 *   POSITION. "Step 2 of 5" and the name of the step. Every one of these flows
 *   has an irreversible action somewhere in it, and a user who does not know
 *   how far along they are cannot tell whether they have reached it.
 *
 *   A HONEST PREAMBLE. What you need before you start, and what will have
 *   happened at the end. The multisig flow needs other people's keys and cannot
 *   be finished alone, and finding that out at step 3 with a seed already on
 *   screen is the wrong time.
 *
 *   THE NEXT MOVE. A flow that ends by dumping the user on a wallet screen has
 *   not told them the job is unfinished. Registering a quorum on THIS device
 *   does nothing until every other cosigner registers the same descriptor and
 *   the coordinator imports the bundle, and that sentence belongs at the end of
 *   the journey rather than in a document.
 *
 * WHAT A JOURNEY IS NOT. It is not a wizard that hides the screens. Every step
 * is a screen that already exists and works on its own, reachable directly, and
 * a journey only decides the order and says where you are. A user who knows the
 * device can ignore all of it.
 */

/** The stages a journey can point at. Kept as strings so this file has no imports. */
export type JourneyStage =
  | 'setup'
  | 'dice'
  | 'import'
  | 'seed'
  | 'protect'
  | 'wallets'
  | 'wallet'
  | 'receive'
  | 'multisig'
  | 'quorum'
  | 'psbt'
  | 'scan'
  | 'backup'
  | 'message'
  | 'manage'
  | 'labels'
  | 'child'

export interface JourneyStep {
  readonly stage: JourneyStage
  /** Named for what the user is doing, not for the screen they are on. */
  readonly label: string
}

export type JourneyId =
  'new-wallet' | 'restore-wallet' | 'sign' | 'receive' | 'multisig' | 'protect-device'

export interface Journey {
  readonly id: JourneyId
  /** The user's sentence, in their words. */
  readonly goal: string
  /** One line under it, saying what this actually is. */
  readonly summary: string
  /**
   * What has to be true before starting, in plain language.
   *
   * Empty for a journey that needs nothing. Shown before the first step, never
   * after it: the point is to stop somebody discovering at step 3 that they
   * needed a second device in the room.
   */
  readonly needs: readonly string[]
  readonly steps: readonly JourneyStep[]
  /**
   * What is still unfinished when the last step completes.
   *
   * Empty when the journey really is complete. Non-empty for anything that
   * takes more than this device: a registered quorum is inert until every other
   * cosigner registers the same descriptor.
   */
  readonly thenWhat: readonly string[]
  /**
   * True when this journey operates on a wallet, so one has to be open.
   *
   * NOT a reason to refuse. This is a cold storage device: signing needs a key
   * in memory, deriving a receive address needs a seed, backing up needs
   * something to back up. Those are not limitations to report, they are the
   * ordinary state of the machine, and a guide that stops at its own first
   * prerequisite has failed at the one thing it exists to do.
   *
   * So it prepends a step instead. `stepsFor` puts "Open a wallet" at the front
   * when none is open, the count says 5 rather than 4, and the flow continues
   * through it. The user asked to sign a transaction; being told to go and do
   * something else first is the device declining to help.
   */
  readonly operatesOnAWallet: boolean
}

export const JOURNEYS: readonly Journey[] = [
  {
    id: 'new-wallet',
    goal: 'Set up a new wallet',
    summary: 'Roll dice for a seed nobody has ever held, and save it to this device.',
    needs: [
      'A six-sided die, and about ten minutes. It takes 100 rolls.',
      'Somewhere to write 24 words that is not a photograph and not a computer.',
    ],
    steps: [
      { stage: 'setup', label: 'Choose how to make the seed' },
      { stage: 'dice', label: 'Roll the dice' },
      { stage: 'seed', label: 'Write the words down' },
      { stage: 'protect', label: 'Set a passphrase for this device' },
    ],
    thenWhat: [
      'The words you wrote down are the only thing that recovers this wallet. This device is a convenience; that paper is the wallet.',
    ],
    operatesOnAWallet: false,
  },
  {
    id: 'restore-wallet',
    goal: 'Restore a wallet I already have',
    summary: 'Type in words you wrote down before, and put that wallet back on this device.',
    needs: [
      'The 12, 18 or 24 words, in order.',
      'Its BIP-39 passphrase, if it had one. Without it you get a valid, different, empty wallet and no error.',
    ],
    steps: [
      { stage: 'import', label: 'Type the words in' },
      { stage: 'protect', label: 'Set a passphrase for this device' },
    ],
    thenWhat: [
      'Check the fingerprint against what the old device showed. A mistyped BIP-39 passphrase opens a different wallet silently, and the fingerprint is the only place it shows.',
    ],
    operatesOnAWallet: false,
  },
  {
    id: 'sign',
    goal: 'Sign a transaction',
    summary:
      'Read what a transaction actually does, then authorise it. This is what the device is for.',
    needs: ['The unsigned transaction, as a QR code on another screen or a file on a card.'],
    steps: [
      { stage: 'psbt', label: 'Load the transaction' },
      { stage: 'psbt', label: 'Read what it does' },
      { stage: 'psbt', label: 'Sign it' },
    ],
    thenWhat: [
      'Take the signed transaction back to the machine that made it. Nothing has been broadcast: this device has no network.',
    ],
    operatesOnAWallet: true,
  },
  {
    id: 'receive',
    goal: 'Receive money',
    summary:
      'Get an address, and check on this screen that it is really yours before anyone sends to it.',
    needs: [],
    steps: [
      { stage: 'receive', label: 'Take an address' },
      { stage: 'receive', label: 'Check it is really yours' },
    ],
    thenWhat: [
      'Read the address off THIS screen, not off the machine you copied it into. Software that swaps an address in the clipboard is the ordinary way this money is lost.',
    ],
    operatesOnAWallet: true,
  },
  {
    id: 'multisig',
    goal: 'Set up a wallet across several devices',
    summary:
      'Two or three of these, or this one beside hardware from other vendors, sharing one wallet that needs several of them to spend.',
    needs: [
      'Every other device in the quorum, or its key, in front of you.',
      'Coordinator software on a networked machine to assemble the descriptor and watch the wallet.',
      'This cannot be finished on one device. Each cosigner registers the same descriptor separately.',
    ],
    steps: [
      { stage: 'multisig', label: 'Hand over the key from this device' },
      { stage: 'multisig', label: 'Check the quorum that comes back' },
      { stage: 'multisig', label: 'Register it' },
      { stage: 'quorum', label: 'Compare addresses with the other devices' },
      { stage: 'multisig', label: 'Send the bundle to the coordinator' },
    ],
    thenWhat: [
      'Every other cosigner has to register the same descriptor, character for character. Until they do, this wallet can receive and cannot spend.',
      'The coordinator has to import the bundle, or the wallet is invisible to the software that builds transactions and shows a zero balance.',
      'Compare an address at the same index on every device before sending anything to it. That is the only cheap proof they all agree.',
    ],
    operatesOnAWallet: true,
  },
  {
    id: 'protect-device',
    goal: 'Protect against this device dying',
    summary:
      'Write an encrypted backup of the things a seed alone cannot recreate: your cosigners, your network, your labels.',
    needs: ['A card or a second device to keep the backup on.'],
    steps: [
      { stage: 'backup', label: 'Write the backup' },
      { stage: 'backup', label: 'Check you can read it back' },
    ],
    thenWhat: [
      'A seedless backup restores a device that can check what is yours and cannot spend. Your mnemonic is what restores the ability to sign, and this file is not a substitute for it.',
    ],
    operatesOnAWallet: true,
  },
]

export function journeyById(id: JourneyId): Journey | undefined {
  return JOURNEYS.find((journey) => journey.id === id)
}

/**
 * The step this journey actually starts from, given what is open.
 *
 * A journey that operates on a wallet gains "Open a wallet" at the front when
 * none is, rather than being refused. The rest of the device then works exactly
 * as it does outside a journey: the picker opens a wallet and the flow carries
 * on from the step after it.
 *
 * The step count changes with it, which is the honest thing: opening a wallet
 * is a real step and hiding it would make the counter wrong.
 */
export function stepsFor(journey: Journey, walletOpen: boolean): readonly JourneyStep[] {
  if (!journey.operatesOnAWallet || walletOpen) return journey.steps
  return [{ stage: 'wallets', label: 'Open a wallet' }, ...journey.steps]
}

/**
 * Which step of a journey a stage belongs to.
 *
 * Returns the FIRST match, and several journeys repeat a stage across steps
 * (signing loads, reads and authorises on one screen). A journey therefore
 * tracks its own step index rather than deriving it from the stage, and this is
 * only for entering a journey partway or recovering after a jump.
 */
export function stepOf(journey: Journey, stage: JourneyStage): number {
  const index = journey.steps.findIndex((step) => step.stage === stage)
  return index === -1 ? 0 : index
}
