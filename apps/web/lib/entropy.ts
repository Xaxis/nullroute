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

export interface MnemonicExample {
  readonly words: readonly string[]
  /** The 64-byte BIP-39 seed with an empty passphrase, as hex. */
  readonly seed: string
}

/**
 * The worked example's 24 words and seed, read from the same document.
 *
 * Read, not recomputed: the site has no BIP-39 implementation and should not
 * grow one. The document is checked against the code by the device's own
 * tests, and what this guards is the site quoting it faithfully: exactly 24
 * words, numbered 1 to 24, and a seed of exactly 128 hex characters.
 */
export function readMnemonicExample(): MnemonicExample {
  const doc = readRepoFile('docs/ENTROPY.md')
  const grid = /produces this 24-word mnemonic:\n\n```\n([\s\S]+?)\n```/.exec(doc)?.[1]
  const seedBlock = /this BIP-39 seed:\n\n```\n([0-9a-f]+)\n([0-9a-f]+)\n```/.exec(doc)
  if (grid === undefined || seedBlock === null) {
    throw new Error('nullroute.diy: no worked mnemonic or seed found in docs/ENTROPY.md.')
  }
  const numbered = new Map<number, string>()
  for (const match of grid.matchAll(/(\d+)\.\s+([a-z]+)/g)) {
    numbered.set(Number(match[1]), match[2] ?? '')
  }
  const words = Array.from({ length: 24 }, (_, i) => numbered.get(i + 1) ?? '')
  const seed = `${seedBlock[1] ?? ''}${seedBlock[2] ?? ''}`
  if (numbered.size !== 24 || words.some((w) => w === '') || seed.length !== 128) {
    throw new Error(
      'nullroute.diy: the worked mnemonic in docs/ENTROPY.md is not 24 words and a 64-byte seed.'
    )
  }
  return { words, seed }
}
