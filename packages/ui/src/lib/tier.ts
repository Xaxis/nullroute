/**
 * What the build tier means, in words a person can act on.
 *
 * Spec: ui.screens.attestation
 *
 * The daemon reports the tier as one word, read out of verification-report.json
 * and originally set by the verify CLI. Two screens show it: the lock screen,
 * before anybody has unlocked anything, and the attestation screen.
 *
 * WHY IT IS ON THE LOCK SCREEN AT ALL. A signer-only build and a full build are
 * different artifacts with different code in them, and they have different
 * manifest roots, so somebody comparing the root against a published release is
 * also proving which of the two they hold. The line is what tells them which
 * one that is.
 *
 * WHY IT IS SAID TWICE HERE AND NOT IN TWO PLACES. It used to be an inline
 * conditional in both screens. Two phrasings of one limit is the failure this
 * codebase already names elsewhere: a reader who meets both believes the weaker
 * one. One function, one sentence.
 *
 * "signer only, no wallet code" was accurate and was written for somebody who
 * already knew there was a wallet package to leave out. Nobody reading a lock
 * screen knows that. It says what the device will and will not do instead.
 */

/** The tier a build with no `packages/wallet` in it reports. */
const SIGNER = 'signer'

export function tierLabel(tier: string): string {
  return tier === SIGNER ? 'Signing only, no transaction building' : tier
}

/**
 * The longer form, for the screen that has room to explain rather than label.
 *
 * Returns null for a tier with nothing extra worth saying, so a caller renders
 * nothing rather than a sentence about the absence of a sentence.
 */
export function tierExplanation(tier: string): string | null {
  if (tier !== SIGNER) return null
  return (
    'This build holds the signer and nothing else. It signs a transaction somebody else ' +
    'built and hands it back, and it has no code for choosing coins or setting a fee. That is ' +
    'less that can go wrong with your money, and it is why this build and a full one do not ' +
    'have the same manifest root.'
  )
}
