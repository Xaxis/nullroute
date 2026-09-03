import { type ReactElement, type ReactNode, useState } from 'react'
import { Screen } from '../components/Screen.js'
import { Refusal } from '../components/Refusal.js'
import { Button } from '../components/Button.js'
import { QrDisplay } from '../components/QrDisplay.js'
import { Info } from '../components/Info.js'

/**
 * BIP-329 labels, in and out.
 *
 * Spec: ui.screens.labels
 *
 * A LABEL DECIDES NOTHING. It is a note somebody wrote about a transaction, an
 * address or an output, and it arrives on a card from software this device
 * knows nothing about. It ends up rendered beside an amount on the screen a
 * user reads before signing, which makes a hostile label a way to make a
 * payment read as something it is not.
 *
 * The parser refuses labels that can render as something other than what they
 * contain, rather than repairing them, so a file that tried is visible as a
 * skipped line rather than silently cleaned up. This screen's job is to report
 * that: how many were read, how many were dropped and why, and that none of it
 * changed what the device believes about which coins are its own.
 *
 * The drop count is not a footnote. JSON Lines exists so a file can be appended
 * to and partially recovered, so a partial import is a normal outcome and a
 * user who was not told is a user who thinks a label is missing because they
 * never wrote it.
 */

export interface LabelRow {
  readonly type: string
  readonly ref: string
  readonly label: string
  readonly spendable?: boolean
}

export interface ImportedLabels {
  readonly labels: readonly LabelRow[]
  readonly skipped: readonly { readonly line: number; readonly reason: string }[]
  readonly note: string
}

export interface LabelsScreenProps {
  /**
   * The navigation menu, when leaving this screen is free.
   *
   * The only signal this device gives for that. It replaced a Home button in
   * the same corner meaning the same thing, which is how that corner came to
   * have three states and no rule.
   */
  readonly nav?: ReactNode
  readonly onImport: (text: string) => Promise<ImportedLabels>
  readonly onExport: (labels: readonly LabelRow[]) => Promise<{ text: string }>
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
  /** Who this device is and which wallet it has open. See `Identity`. */
  readonly identity?: ReactNode
  readonly banner?: ReactElement | null
}

export function LabelsScreen(props: LabelsScreenProps): ReactElement {
  const { onImport, onExport, initialText, onScan, onBack, identity, banner, nav } = props

  const [text, setText] = useState(initialText ?? '')
  const [imported, setImported] = useState<ImportedLabels | null>(null)
  const [exported, setExported] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // --- Written back out ------------------------------------------------------
  if (exported !== null) {
    return (
      <Screen
        title="Labels written"
        subtitle="The same format other wallets read."
        banner={banner}
        nav={nav}
        identity={identity}
        testId="labels-exported"
        actions={
          <Button
            onClick={() => {
              setExported(null)
            }}
            testId="labels-exported-back"
          >
            Back
          </Button>
        }
      >
        <QrDisplay text={exported} fileType="json" testId="labels-qr" />

        <details className="nr-details">
          <summary className="nr-details__summary">Show it as text, to save on a card</summary>
          <div className="nr-field">
            <textarea
              className="nr-input nr-input--area nr-break"
              readOnly
              rows={8}
              value={exported}
              data-testid="labels-export-text"
            />
          </div>
        </details>

        <Info label="The file format">
          One JSON object per line, and a trailing newline, so this file can be appended to rather
          than rewritten. Writing what was read gives the same bytes, which means an export can be
          compared against the last one.
        </Info>
      </Screen>
    )
  }

  return (
    <Screen
      title="Labels"
      subtitle="Notes about transactions. They decide nothing."
      banner={banner}
      nav={nav}
      identity={identity}
      testId="labels-screen"
      actions={
        <>
          <Button onClick={onBack} testId="labels-back">
            Back
          </Button>
          <div className="nr-spacer" />
          {imported === null ? (
            <Button
              variant="primary"
              disabled={text.trim().length === 0 || busy}
              onClick={() =>
                void run(async () => {
                  setImported(await onImport(text))
                })
              }
              testId="labels-import"
            >
              {busy ? 'Reading' : 'Read them'}
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={busy || imported.labels.length === 0}
              onClick={() =>
                void run(async () => {
                  setExported((await onExport(imported.labels)).text)
                })
              }
              testId="labels-export"
            >
              {busy ? 'Writing' : 'Write them back out'}
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
        <Refusal title="Not read" testId="labels-error">
          {error}
        </Refusal>
      )}

      {imported === null ? (
        <div className="nr-field">
          <span className="nr-field__label">A BIP-329 label file</span>
          <textarea
            className="nr-input nr-input--area nr-break"
            rows={7}
            spellCheck={false}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
            }}
            data-testid="labels-input"
          />
          {onScan !== undefined && (
            <Button onClick={onScan} testId="labels-scan">
              Scan it with the camera
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="nr-card nr-card--tight" data-testid="labels-result">
            <div className="nr-row">
              <span className="nr-label">Read</span>
              <span className="nr-value">{imported.labels.length} labels</span>
            </div>
            <div className="nr-row">
              <span className="nr-label">Dropped</span>
              <span className="nr-value" data-testid="labels-skipped-count">
                {imported.skipped.length} lines
              </span>
            </div>
          </div>

          {/* Every dropped line, with its reason. A count on its own reads as
              a rounding error; the reason is what tells a user whether their
              file is slightly malformed or whether something tried to make a
              label render as text it does not contain. */}
          {imported.skipped.length > 0 && (
            <div className="nr-banner nr-banner--caution" data-testid="labels-skipped">
              <strong>These lines were not read</strong>
              <span>
                {imported.skipped.map((s) => `line ${String(s.line)}: ${s.reason}`).join('; ')}
              </span>
            </div>
          )}

          <table className="nr-table nr-table--dense" data-testid="labels-rows">
            <thead>
              <tr>
                <th className="nr-table__index">Type</th>
                <th>Label</th>
              </tr>
            </thead>
            <tbody>
              {imported.labels.map((row) => (
                <tr key={`${row.type}:${row.ref}`}>
                  <td className="nr-mono nr-table__index">{row.type}</td>
                  <td>
                    <div>{row.label}</div>
                    <div className="nr-hint nr-mono nr-break">{row.ref}</div>
                    {row.spendable === false && <div className="nr-hint">marked do not spend</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Straight from the daemon rather than written here, so the screen
              cannot forget to say it.

              A RESULT, NOT GUIDANCE, which is why it stays a note rather than
              becoming an Info: it says what just happened to this file, and it
              changes every time. check-ui-roles is told so explicitly, because
              from the outside a paragraph is a paragraph. */}
          <p className="nr-note" data-prose="result" data-testid="labels-note">
            {imported.note}
          </p>

          {/* Said where the labels were loaded, because the next place they
              appear is the signing screen and somebody who saw one there
              should know it will not be there tomorrow. */}
          <Info testId="labels-session-only">
            These are held for this session only and are not saved to the device. A label file can
            hold thousands of entries about transactions this device has never seen, and none of
            them decides anything, so they are not written into the encrypted wallet. Load the file
            again after a reboot.
          </Info>
        </>
      )}
    </Screen>
  )
}
