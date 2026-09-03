import { type ReactElement, type ReactNode, useState } from 'react'
import { Screen } from '../components/Screen.js'
import { Button } from '../components/Button.js'
import { WordKeyboard } from '../components/WordKeyboard.js'
import { Info } from '../components/Info.js'

/**
 * The seed, shown once.
 *
 * Spec: ui.screens.seed
 *
 * This is the one screen that displays key material, and the exception is
 * narrow by construction rather than by policy: the daemon refuses to reveal a
 * mnemonic once backup is confirmed, and refuses outright for a seed loaded
 * from storage. So this screen can only ever be reached once per wallet.
 *
 * Confirming the backup is IRREVERSIBLE and is styled as a danger action for
 * that reason. It is the last moment the words exist anywhere but on paper.
 *
 * A CHECKBOX IS NOT A BACKUP. This screen used to show the words, ask the user
 * to tick "I have written all 24 words down", and hide them forever. Nothing
 * checked. The failure that allows is total and silent: somebody who mistyped a
 * word, skipped one, or wrote them in the wrong order believes they have a
 * backup, and finds out otherwise at the only moment it matters, when the
 * device is gone.
 *
 * So a few words are asked back, by position, before the words go. The daemon
 * already had `seed.checkWord` for exactly this, written so it compares one
 * word and returns a boolean and the untrusted side never learns a word it did
 * not already have. Nothing called it.
 *
 * WHAT THE CHECK IS AND IS NOT. It catches a backup that was not written down,
 * or written wrongly at the positions asked. It cannot catch a wrong word at a
 * position it did not ask about, and it cannot tell paper from a photograph. It
 * is a check against carelessness, which is what loses most coins, and not
 * against anything adversarial: the person answering is the person who was just
 * shown the words.
 */

export interface SeedScreenProps {
  readonly words: readonly string[]
  readonly fingerprint: string
  /**
   * Check one word the user typed back, by position.
   *
   * Goes to the daemon rather than comparing against `words` here. Comparing in
   * the frontend would work and would check nothing that matters: the words are
   * already on this screen, so a bug that showed the wrong ones would be
   * confirmed against itself. The daemon holds the seed and is the only thing
   * that can say a word is right.
   */
  readonly onCheckWord?: ((index: number, word: string) => Promise<boolean>) | undefined
  /**
   * Which positions to ask about, chosen by the daemon.
   *
   * Not chosen here. Math.random is banned on this device and the frontend has
   * no other source, which is the rule doing its job: the daemon has
   * randomBytes and already holds the words.
   */
  readonly onCheckPositions?: ((count: number) => Promise<readonly number[]>) | undefined
  readonly onConfirm: () => void
  /** Where this screen sits in a journey, when it is part of one. */
  readonly steps?: ReactElement | null
  /** Who this device is and which wallet it has open. See `Identity`. */
  readonly identity?: ReactNode
  readonly banner?: ReactElement | null
}

/**
 * How many words are asked back.
 *
 * Three. Enough that answering them by luck is not a thing that happens, and
 * few enough that somebody who genuinely wrote the words down is not made to
 * re-enter all of them, which is how a check gets skipped by being tedious.
 */
const CHECKED_WORDS = 3

export function SeedScreen(props: SeedScreenProps): ReactElement {
  const { words, fingerprint, onCheckWord, onCheckPositions, onConfirm, steps, identity, banner } =
    props
  const [acknowledged, setAcknowledged] = useState(false)
  const [checking, setChecking] = useState(false)
  const [asked, setAsked] = useState<readonly number[]>([])
  const [at, setAt] = useState(0)
  const [typed, setTyped] = useState<readonly string[]>([])
  const [wrong, setWrong] = useState(false)
  const [busy, setBusy] = useState(false)

  /** Whether this build can check at all. Without it the words are not hidden. */
  const canCheck = onCheckWord !== undefined && onCheckPositions !== undefined

  const begin = async (): Promise<void> => {
    if (onCheckPositions === undefined) return
    setBusy(true)
    try {
      const positions = await onCheckPositions(CHECKED_WORDS)
      setAsked(positions)
      setAt(0)
      setTyped([])
      setWrong(false)
      setChecking(true)
    } finally {
      setBusy(false)
    }
  }

  const answer = async (): Promise<void> => {
    const position = asked[at]
    const word = typed[0]
    if (onCheckWord === undefined || position === undefined || word === undefined) return

    setBusy(true)
    try {
      const correct = await onCheckWord(position, word)
      if (!correct) {
        // Back to the words. Somebody who got one wrong does not have the
        // backup they think they have, and the useful thing is to show them
        // the list again rather than to let them guess at the same prompt.
        setWrong(true)
        setChecking(false)
        setAcknowledged(false)
        return
      }
      setTyped([])
      if (at + 1 >= asked.length) {
        // Every word asked was right. This is the only path to hiding them.
        onConfirm()
        return
      }
      setAt(at + 1)
    } finally {
      setBusy(false)
    }
  }

  // --- Checking a word back -------------------------------------------------
  if (checking) {
    const position = asked[at]
    return (
      <Screen
        title={`Word ${String((position ?? 0) + 1)}`}
        subtitle={`From your paper, not from memory. ${String(at + 1)} of ${String(asked.length)}.`}
        banner={banner}
        identity={identity}
        steps={steps}
        testId="seed-check"
        actions={
          <>
            <Button
              onClick={() => {
                // Back to the words, which are still on the device. Nothing has
                // been confirmed, so nothing is lost by looking again.
                setChecking(false)
              }}
              testId="seed-check-back"
            >
              Show the words again
            </Button>
            <div className="nr-spacer" />
            <Button
              variant="primary"
              disabled={typed[0] === undefined || busy}
              onClick={() => {
                void answer()
              }}
              testId="seed-check-submit"
            >
              {busy ? 'Checking' : 'That is the word'}
            </Button>
          </>
        }
      >
        <Info testId="seed-check-ask">
          Read word {(position ?? 0) + 1} off the paper you just wrote. If you have to remember it
          rather than read it, you do not have a backup yet.
        </Info>

        <WordKeyboard
          words={typed}
          onChange={(next) => {
            // One word at a time: the keyboard collects a list, and this prompt
            // asks for exactly one.
            setTyped(next.slice(-1))
          }}
          target={1}
          testId="seed-check-keyboard"
        />
      </Screen>
    )
  }

  return (
    <Screen
      title="Write these down"
      subtitle={`${String(words.length)} words, in order. This is the only time they are shown.`}
      banner={banner}
      identity={identity}
      steps={steps}
      testId="seed-screen"
      actions={
        <>
          {/* The whole label is the tap target, not just the box. An 18px
              checkbox on a 7 inch touch panel is a control that gets missed,
              and this one gates an irreversible action. */}
          <label className="nr-check">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => {
                setAcknowledged(e.target.checked)
              }}
              data-testid="seed-ack"
            />
            <span className="nr-hint">I have written all {words.length} words down, in order.</span>
          </label>
          <div className="nr-spacer" />
          {/* Irreversible, so never the primary style and never the default.
              It no longer hides anything by itself: it starts the check, and
              answering every word is what hides them. */}
          <Button
            variant="danger"
            disabled={!acknowledged || busy}
            onClick={() => {
              if (!canCheck) {
                // No check available in this build. Confirming anyway would be
                // the old behaviour wearing a new label, so it says so instead.
                return
              }
              void begin()
            }}
            testId="seed-confirm"
          >
            {busy ? 'Starting' : canCheck ? 'Check my backup' : 'Cannot check'}
          </Button>
        </>
      }
    >
      {/* Said, not merely returned from. Somebody sent back to this list with
          no explanation would assume they mistyped on the keyboard, look at
          the words for a second, and try again. The point is that their paper
          is wrong, and that is worth a sentence. */}
      {wrong && (
        <div className="nr-banner nr-banner--danger" data-testid="seed-check-failed">
          <strong>That word did not match</strong>
          <span>
            What is on your paper is not what this device generated, so you do not have a working
            backup yet. Write the list out again from this screen, carefully, and check it against
            the words below before trying again.
          </span>
        </div>
      )}

      <div className="nr-words" data-testid="seed-words">
        {words.map((word, i) => (
          <div key={`${String(i)}-${word}`} className="nr-word">
            <span className="nr-word__index">{i + 1}</span>
            <span className="nr-word__text">{word}</span>
          </div>
        ))}
      </div>

      {/* BOTH ON SCREEN WITH THE WORDS, which they were not.

          Stacked under a grid of twenty four words on a 480px panel, with the
          network banner a test device always carries, "Paper only" was entirely
          below the fold. That is the most consequential sentence in this
          product, on the one screen that displays a seed, and reaching it
          needed a scroll nobody has a reason to make: the words are already
          all visible, so the screen looks finished.

          Side by side they both fit under the grid with room to spare. */}
      <div className="nr-split nr-split--even">
        {/* SHORT ENOUGH TO BE ON THE PANEL, which is the only property that
            matters for a sentence like this one. The longer version ran 29px
            under the fold and was cut mid-word, so the part somebody actually
            read was "do not photograph this screen and do not type the". A
            warning that does not fit is a warning that gets truncated at
            whatever word the panel ends on. data-must-see is what measures it. */}
        <div className="nr-banner nr-banner--caution" data-must-see data-testid="seed-paper-only">
          <strong>Paper only</strong>
          <span>
            Do not photograph these words or type them anywhere. Anyone holding them has your money,
            and this device will not show them again.
          </span>
        </div>

        <div className="nr-card nr-card--tight nr-card--snug" data-must-see>
          <div className="nr-row">
            <span className="nr-label">Fingerprint</span>
            <span className="nr-value nr-mono" data-testid="seed-fingerprint">
              {fingerprint}
            </span>
          </div>
          {/* Two lines, not three. The third ran under the fold, and this is
              the only thing on the device that catches a mistyped passphrase. */}
          <p className="nr-hint">
            Write this down too. A mistyped passphrase silently opens a different, empty wallet, and
            only this catches it.
          </p>
        </div>
      </div>
    </Screen>
  )
}
