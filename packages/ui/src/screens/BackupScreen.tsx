import { type ReactElement, type ReactNode, useCallback, useState } from 'react'
import { Screen } from '../components/Screen.js'
import { Refusal } from '../components/Refusal.js'
import { Button } from '../components/Button.js'
import { Choice } from '../components/Choice.js'
import { TextKeyboard } from '../components/TextKeyboard.js'
import { QrDisplay } from '../components/QrDisplay.js'
import { Info } from '../components/Info.js'

/**
 * Writing a backup, and restoring one.
 *
 * Spec: ui.screens.backup
 *
 * THE ONE DECISION ON THIS SCREEN is whether the seed goes in. A seedless
 * backup restores a device that can derive addresses, verify change and
 * recognise its own outputs, and cannot spend. A backup WITH a seed is a second
 * copy of the money under one passphrase.
 *
 * Both are legitimate and the difference is not obvious from the outside, so
 * the seed is off by default and turning it on says what it means in those
 * words. A file that quietly contained a spendable key would be the worst kind
 * of surprise: it looks like a settings export and it is a wallet.
 *
 * RESTORING SHOWS WHAT THE FILE SAYS BEFORE ASKING FOR A PASSPHRASE, and says
 * that everything shown at that point is unverified. The label and network on
 * the outside of a backup are there so somebody with three files can tell them
 * apart, and anyone holding the file can edit them. What is restored comes from
 * inside the ciphertext.
 */

export interface BackupDescription {
  readonly label: string
  readonly network: string
  readonly hasSeed: boolean
  readonly createdWith: string
}

export interface RestoredView {
  readonly hasSeed: boolean
  readonly label: string
  readonly network: string
  readonly registrations: number
  readonly createdWith: string
}

export interface BackupScreenProps {
  /**
   * The navigation menu, when leaving this screen is free.
   *
   * The only signal this device gives for that. It replaced a Home button in
   * the same corner meaning the same thing, which is how that corner came to
   * have three states and no rule.
   */
  readonly nav?: ReactNode
  readonly onCreate: (
    passphrase: string,
    includeSeed: boolean,
    label: string
  ) => Promise<{ backup: string; includesSeed: boolean }>
  readonly onDescribe: (backup: string) => Promise<BackupDescription>
  readonly onRestore: (backup: string, passphrase: string) => Promise<RestoredView>
  /**
   * Text the camera already read, if the user arrived that way.
   *
   * A descriptor is 200 characters and this device has no keyboard, so typing
   * one on a 7 inch panel is not a route anybody takes twice.
   */
  readonly initialText?: string
  /** Leaves for the camera. Absent where there is no camera to reach. */
  readonly onScan?: (() => void) | undefined
  readonly onBack: () => void
  /** Where this screen sits in a journey, when it is part of one. */
  readonly steps?: ReactElement | null
  /** Who this device is and which wallet it has open. See `Identity`. */
  readonly identity?: ReactNode
  readonly banner?: ReactElement | null
}

type Mode = 'choose' | 'create' | 'restore'

export function BackupScreen(props: BackupScreenProps): ReactElement {
  const {
    onCreate,
    onDescribe,
    onRestore,
    initialText,
    onScan,
    onBack,
    steps,
    identity,
    banner,
    nav,
  } = props

  /*
   * A scanned backup goes into the BACKUP field, and opens the restore branch.
   *
   * `initialText` is what the camera read, which on this screen is an encrypted
   * backup file. It was seeding the PASSPHRASE, and `text` (the field that
   * holds the file) started empty. So scanning a backup landed the user back on
   * the two-choice screen with the whole blob sitting in the passphrase
   * readout: tapping "Restore" showed an empty textarea and a disabled button,
   * with no way forward but to scan again and repeat it, and tapping "Write a
   * backup" instead wrote a real backup under a passphrase nobody chose and
   * nobody could retype.
   *
   * Every other screen taking a prefill routes it to its content field
   * (MultisigScreen's descriptor, LabelsScreen's text, PsbtScreen's psbt). This
   * one was out of step.
   */
  const [mode, setMode] = useState<Mode>(
    initialText === undefined || initialText === '' ? 'choose' : 'restore'
  )
  const [passphrase, setPassphrase] = useState('')
  const [includeSeed, setIncludeSeed] = useState(false)
  const [written, setWritten] = useState<{ backup: string; includesSeed: boolean } | null>(null)
  const [text, setText] = useState(initialText ?? '')
  const [described, setDescribed] = useState<BackupDescription | null>(null)
  const [restored, setRestored] = useState<RestoredView | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async (work: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }, [])

  // --- A backup has been written -------------------------------------------
  if (written !== null) {
    return (
      <Screen
        title="Backup written"
        subtitle={written.includesSeed ? 'This file can spend your money.' : 'Watch-only.'}
        banner={banner}
        nav={nav}
        identity={identity}
        steps={steps}
        testId="backup-written"
        actions={
          <Button onClick={onBack} testId="backup-done">
            Done
          </Button>
        }
      >
        {written.includesSeed && (
          <div className="nr-banner nr-banner--danger" data-testid="backup-carries-seed">
            <strong>This file is a copy of your wallet</strong>
            <span>
              It holds your seed. Anyone who has it and its passphrase can spend everything. Keep it
              the way you keep the words you wrote down, not the way you keep a settings file.
            </span>
          </div>
        )}

        <QrDisplay text={written.backup} fileType="json" testId="backup-qr" />

        <details className="nr-details">
          <summary className="nr-details__summary">Show it as text, to save on a card</summary>
          <div className="nr-field">
            <textarea
              className="nr-input nr-input--area nr-break"
              readOnly
              rows={8}
              value={written.backup}
              data-testid="backup-text"
            />
          </div>
        </details>
      </Screen>
    )
  }

  // --- A backup has been restored ------------------------------------------
  if (restored !== null) {
    return (
      <Screen
        title="Restored"
        subtitle={restored.label}
        banner={banner}
        nav={nav}
        identity={identity}
        steps={steps}
        testId="backup-restored"
        actions={
          <Button onClick={onBack} testId="backup-restored-done">
            Continue
          </Button>
        }
      >
        <div className="nr-card nr-card--tight">
          <div className="nr-row">
            <span className="nr-label">Network</span>
            <span className="nr-value nr-mono">{restored.network}</span>
          </div>
          <div className="nr-row">
            <span className="nr-label">Cosigners</span>
            <span className="nr-value">{restored.registrations} registered quorums</span>
          </div>
          <div className="nr-row">
            <span className="nr-label">Written by</span>
            <span className="nr-value nr-mono">{restored.createdWith}</span>
          </div>
        </div>

        {restored.hasSeed ? (
          <p className="nr-note" data-testid="backup-restored-seed">
            This backup carried a seed, so this device can sign again.
          </p>
        ) : (
          <div className="nr-banner nr-banner--caution" data-testid="backup-restored-watching">
            <strong>Watch-only</strong>
            <span>
              This backup carried no seed. The device can derive addresses, recognise its own change
              and check what belongs to it, and cannot sign anything. Import the mnemonic to make it
              a spending wallet again.
            </span>
          </div>
        )}
      </Screen>
    )
  }

  // --- Choosing -------------------------------------------------------------
  if (mode === 'choose') {
    return (
      <Screen
        title="Backup"
        subtitle="Write one, or restore one."
        banner={banner}
        nav={nav}
        identity={identity}
        steps={steps}
        testId="backup-screen"
        actions={
          <Button onClick={onBack} testId="backup-cancel">
            Back
          </Button>
        }
      >
        {/* DESTINATIONS, not buttons. These were two identical full width
            buttons carrying two words each, which is the shape this device
            uses for "do the thing on this screen" and not for "go somewhere".
            Choice is what More, Start and the wallet picker already use, and
            it has room for the line saying what each one does.

            One of these erases nothing and the other overwrites what is on the
            device. Rendered identically, that difference was invisible. */}
        <Choice
          title="Write a backup"
          description="Take what is on this device and put it somewhere else. Nothing here changes."
          selected={false}
          onSelect={() => {
            setMode('create')
          }}
          testId="backup-choose-create"
        />
        <Choice
          title="Restore from a backup"
          description="Put a backup back onto this device. What it carries replaces what is here."
          selected={false}
          onSelect={() => {
            setMode('restore')
          }}
          testId="backup-choose-restore"
        />

        <Info label="What a backup holds">
          A backup carries your registered cosigners, your network and your labels: the things a
          seed alone cannot recreate. It does not have to carry the seed, and by default it does
          not.
        </Info>
      </Screen>
    )
  }

  // --- Writing --------------------------------------------------------------
  if (mode === 'create') {
    return (
      <Screen
        title="Write a backup"
        subtitle="Encrypted under a passphrase you choose."
        banner={banner}
        nav={nav}
        identity={identity}
        steps={steps}
        testId="backup-create"
        actions={
          <>
            <Button
              onClick={() => {
                setMode('choose')
              }}
              testId="backup-create-back"
            >
              Back
            </Button>
            <div className="nr-spacer" />
            <Button
              variant={includeSeed ? 'danger' : 'primary'}
              disabled={passphrase.length === 0 || busy}
              onClick={() =>
                void run(async () => {
                  setWritten(await onCreate(passphrase, includeSeed, 'nullroute wallet'))
                })
              }
              testId="backup-create-submit"
            >
              {busy ? 'Writing' : includeSeed ? 'Write a spendable backup' : 'Write it'}
            </Button>
          </>
        }
      >
        {/* FIRST IN THE BODY, because a refusal nobody sees is a refusal that
          did not happen. This sat last, under everything the screen holds, on
          a 480px panel: tapping the button and being refused changed nothing
          the user could see. Measured rather than asserted, because jsdom
          computes no box and every test on it passed throughout. */}
        {error !== null && (
          <Refusal title="Not written" testId="backup-error">
            {error}
          </Refusal>
        )}

        {/* THE CHOICE ABOVE THE KEYBOARD, NOT UNDER IT.

            Whether this file carries the seed is the only consequential
            decision on the screen: with it, the file is a second copy of the
            money, protected by one passphrase. It sat below a 196px keyboard
            and was off the bottom of the panel, so the screen a person actually
            saw offered a passphrase box and no visible choice at all, with the
            default silently applied.

            INV-BACKUP-1 says including the seed changes the action and states
            what it means beforehand. It cannot state it beforehand from below
            the fold. */}
        <div className="nr-beside">
          <span className="nr-field__label">Passphrase for this file</span>
          <button
            type="button"
            className="nr-tab"
            aria-pressed={includeSeed}
            onClick={() => {
              setIncludeSeed(!includeSeed)
            }}
            data-testid="backup-include-seed"
          >
            {includeSeed ? 'Including the seed' : 'Not including the seed'}
          </button>
        </div>
        <TextKeyboard
          value={passphrase}
          onChange={(next) => {
            setError(null)
            setPassphrase(next)
          }}
          testId="backup-passphrase"
        />

        {includeSeed ? (
          <div className="nr-banner nr-banner--danger" data-testid="backup-seed-warning">
            <strong>This will be a second copy of your money</strong>
            <span>
              The file will hold your seed, protected by the passphrase above and nothing else.
              Anyone who gets both can spend everything. This is a real thing to want and it is not
              the default.
            </span>
          </div>
        ) : (
          <Info testId="backup-watching-note">
            The file will hold your cosigners, your network and your labels, and no key. Restoring
            it gives a device that can check what is yours and cannot spend. Your mnemonic is what
            restores the ability to sign.
          </Info>
        )}
      </Screen>
    )
  }

  // --- Restoring ------------------------------------------------------------
  return (
    <Screen
      title="Restore a backup"
      subtitle="Paste or scan the file, then unlock it."
      banner={banner}
      nav={nav}
      identity={identity}
      steps={steps}
      testId="backup-restore"
      actions={
        <>
          <Button
            onClick={() => {
              setMode('choose')
              setDescribed(null)
            }}
            testId="backup-restore-back"
          >
            Back
          </Button>
          <div className="nr-spacer" />
          {described === null ? (
            <Button
              disabled={text.length === 0 || busy}
              onClick={() =>
                void run(async () => {
                  setDescribed(await onDescribe(text))
                })
              }
              testId="backup-describe"
            >
              {busy ? 'Reading' : 'Read it'}
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={passphrase.length === 0 || busy}
              onClick={() =>
                void run(async () => {
                  setRestored(await onRestore(text, passphrase))
                })
              }
              testId="backup-restore-submit"
            >
              {busy ? 'Restoring' : 'Restore'}
            </Button>
          )}
        </>
      }
    >
      {/* FIRST IN THE BODY, because a refusal nobody sees is a refusal that
          did not happen. This sat last, under everything the screen holds, on
          a 480px panel: tapping the button and being refused changed nothing
          the user could see. Measured rather than asserted, because jsdom
          computes no box and every test on it passed throughout. */}
      {error !== null && (
        <Refusal title="Not restored" testId="backup-error">
          {error}
        </Refusal>
      )}

      {described === null ? (
        <div className="nr-field">
          <span className="nr-field__label">The backup file</span>
          <textarea
            className="nr-input nr-input--area nr-break"
            rows={6}
            spellCheck={false}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
            }}
            data-testid="backup-input"
          />
          {onScan !== undefined && (
            <Button onClick={onScan} testId="backup-scan">
              Scan it with the camera
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="nr-card nr-card--tight" data-testid="backup-described">
            <div className="nr-row">
              <span className="nr-label">Called</span>
              <span className="nr-value">{described.label}</span>
            </div>
            <div className="nr-row">
              <span className="nr-label">Network</span>
              <span className="nr-value nr-mono">{described.network}</span>
            </div>
            <div className="nr-row">
              <span className="nr-label">Holds a seed</span>
              <span className="nr-value">{described.hasSeed ? 'Yes' : 'No, watch-only'}</span>
            </div>
          </div>

          {/* Not dismissible. Everything above came from outside the encryption
              and anyone holding the file could have written it. */}
          <p className="nr-note" data-testid="backup-unverified">
            None of that is confirmed yet. It is read from the outside of the file, which anyone
            holding it could have edited. What actually gets restored comes from inside the
            encryption, and the device will show you that instead once it opens.
          </p>

          <span className="nr-field__label">Passphrase for this file</span>
          <TextKeyboard
            value={passphrase}
            onChange={(next) => {
              setError(null)
              setPassphrase(next)
            }}
            testId="backup-restore-passphrase"
          />
        </>
      )}
    </Screen>
  )
}
