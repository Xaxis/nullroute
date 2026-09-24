import { createHash } from 'node:crypto'
import { readRepoFile } from './repo'

/**
 * The worked example from docs/ENTROPY.md, re-derived when the site is built.
 *
 * The home page hands a reader one command and the digest it should print.
 * Both come from the document that publishes them, and the digest is
 * recomputed here, so the build fails if the document's arithmetic is wrong
 * or if the transcript stops being findable. A regex that quietly stopped
 * matching would otherwise leave the page showing nothing, or something stale,
 * with a green build.
 *
 * This replaced an interactive dice widget and the browser harness that pressed
 * its buttons. The widget read as the product (a web page where you roll dice)
 * and proved the same thing a static transcript proves: the rule is SHA-256 of
 * the ASCII roll string with no trailing newline, and any terminal agrees.
 */
export interface EntropyExample {
  readonly rolls: string
  readonly digest: string
}

export function readEntropyExample(): EntropyExample {
  const doc = readRepoFile('docs/ENTROPY.md')
  const match = /printf '%s' '(\d+)' \| sha256sum\n([0-9a-f]{64})/.exec(doc)
  if (match === null) {
    throw new Error(
      "nullroute.diy: no `printf '%s' '<digits>' | sha256sum` transcript found in docs/ENTROPY.md."
    )
  }
  const [, rolls = '', published = ''] = match
  // 100, not 99: 99 rolls is 255.911 bits, which is short of 256.
  if (rolls.length !== 100) {
    throw new Error(
      `nullroute.diy: the ENTROPY.md example is ${String(rolls.length)} rolls, not 100.`
    )
  }
  const digest = createHash('sha256').update(rolls, 'ascii').digest('hex')
  if (digest !== published) {
    throw new Error(
      `nullroute.diy: ENTROPY.md publishes ${published} for its worked example, ` +
        `and SHA-256 of that roll string is ${digest}.`
    )
  }
  return { rolls, digest }
}
