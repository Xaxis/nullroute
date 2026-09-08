import type { ReactElement, ReactNode } from 'react'
import { Info } from './Info.js'

/**
 * The device is deriving a key and has not frozen.
 *
 * WHY THIS IS A COMPONENT AND NOT A SENTENCE ON ONE SCREEN. Every passphrase
 * on this device goes through Argon2id at 64 MiB and three passes. The
 * excluded-controls note in provisioning/profiles/os-signer.yaml measures that
 * at 643ms on a machine considerably faster than a Raspberry Pi, so the device
 * spends several seconds on it, and `reseal` spends twice that because it opens
 * and then seals.
 *
 * Four screens do it: unlocking, writing a backup, restoring one, and
 * registering a quorum. All four showed a disabled button whose label changed
 * to one word, on panels with no other feedback. Several seconds of that is
 * where somebody decides the device has hung and pulls the power, and two of
 * the four are mid-write when they do.
 *
 * THE SLOWNESS IS THE FEATURE, WHICH IS WHY THE TEXT IS FIXED HERE. The same
 * arithmetic runs on every guess an attacker makes. A user who knows that waits
 * rather than panicking, and that only works if every one of the four says so,
 * in the same words, every time. Written per screen it drifts, and the screen
 * that gets the thinnest version is the one somebody happens to write last.
 *
 * THE CALLER MUST ALSO HIDE ITS KEYBOARD. This was learned the expensive way on
 * PassphraseScreen: placed under a full-height keyboard the message is below
 * the fold, and placed above one on a body already scrolled to the input it is
 * off the top. A keyboard that looks tappable and does nothing is also the
 * worst thing to show somebody already wondering whether the device is alive.
 * Rendering this while leaving the keyboard up puts it where nobody will read
 * it, and no test can see that, because jsdom computes no box.
 */
export interface WorkingProps {
  /**
   * What is happening, in two or three words. "Deriving the key", "Encrypting
   * the backup". Present tense, because the answer to "has it hung" is a thing
   * currently in progress.
   */
  readonly label: string
  /**
   * Anything true of this screen alone, such as what is mid-write. Appended
   * after the shared explanation rather than replacing it.
   */
  readonly children?: ReactNode
  readonly testId?: string | undefined
}

export function Working(props: WorkingProps): ReactElement {
  const { label, children, testId } = props
  return (
    <Info label={label} testId={testId}>
      This takes a few seconds, and it is meant to. The same arithmetic runs on every guess an
      attacker makes, so a key that is slow to derive once is expensive to attack repeatedly. Do not
      power the device off while it is working.
      {children !== undefined && <> {children}</>}
    </Info>
  )
}
