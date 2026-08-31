/**
 * Every code this device puts on screen must fail loudly when it is misread.
 *
 * THE QUESTION THIS ANSWERS. A camera reads a code off this panel into software
 * on a machine that has a network. If that read is wrong, what happens? On a
 * device whose whole argument is that you can check it, "the scanner is usually
 * right" is not an answer, and a wrong read that produces something plausible
 * is the failure that costs money.
 *
 * The answer turns out to be per payload rather than general, which is why it
 * was never written down anywhere: seven codes, seven different reasons a
 * misread cannot pass silently. Three are authenticated or parsed and fail on
 * their own, three carry a value a human compares, and one is refused by an
 * invariant. A reader who wants to know whether this was thought about had to
 * reconstruct all seven.
 *
 * WHY NOT A CHECKSUM UNDER EVERY CODE. Because there is nothing on the other
 * side to compare it against. A digest this device invents is a convention no
 * coordinator implements, so it would sit under the code looking like a check
 * and be one only between two nullroutes. Claiming otherwise is the kind of
 * overclaiming this project treats as a bug. The mechanisms below are the ones
 * the receiving software already has.
 *
 * What this check enforces is that the set stays closed: a new code on a new
 * screen has to say what makes a misread loud, and an entry here has to point
 * at a code that exists.
 *
 * Run: node tools/check-qr-readback.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SCREENS = join(ROOT, 'packages/ui/src/screens')

/**
 * Why a misread cannot pass silently, per code.
 *
 * `loud` is the mechanism, in the receiving software or in this one. `by` says
 * which of the three kinds it is, because they are not equally strong: parsed
 * is weaker than authenticated, and compared depends on somebody doing it.
 */
const CODES = {
  'backup-qr': {
    by: 'authenticated',
    loud:
      'The backup is AES-256-GCM. A wrong byte fails the tag and restore refuses, ' +
      'rather than restoring something plausible.',
  },
  'labels-qr': {
    by: 'parsed',
    loud:
      'BIP-329 is one JSON document per line, so a corrupted read stops parsing. A label ' +
      'also decides nothing: the worst case is a note that does not arrive.',
  },
  'message-qr': {
    by: 'parsed',
    loud: 'A corrupted signature fails verification. That is what the proof is for.',
  },
  'multisig-bundle-qr': {
    by: 'refused',
    loud:
      'A misread key produces a descriptor this device holds no key in, and registration ' +
      'refuses that rather than making a wallet that receives and never spends. INV-MULTI-6.',
  },
  'psbt-qr': {
    by: 'parsed',
    loud:
      'A corrupted PSBT fails to parse in the coordinator. One that somehow parsed would ' +
      'have to broadcast, and the transaction it names was reviewed on this screen first.',
  },
  'receive-qr': {
    by: 'compared',
    loud:
      'The characters are on screen beside the code, grouped in fours, under a warning ' +
      'marked data-must-see telling somebody to compare them against the payer.',
  },
  'descriptor-qr': {
    by: 'compared',
    loud:
      'A descriptor carries its own BIP-380 checksum, and the software reading it displays ' +
      'that checksum. This is the one case where the comparison is standard rather than ours.',
  },
}

const problems = []

/** Every code this device actually renders. */
const rendered = new Map()
for (const file of readdirSync(SCREENS).filter((name) => name.endsWith('.tsx'))) {
  const source = readFileSync(join(SCREENS, file), 'utf8')
  for (const match of source.matchAll(/<QrDisplay[^>]*testId="([^"]+)"/g)) {
    rendered.set(match[1], file)
  }
}

if (rendered.size === 0) {
  console.error('check-qr-readback: found no QrDisplay anywhere, so this check is blind.')
  process.exit(1)
}

for (const [id, file] of rendered) {
  if (id in CODES) continue
  problems.push(
    `${file} renders a code with testId "${id}" and nothing here says what happens when it\n` +
      `    is misread. Add it to CODES with the mechanism that makes a wrong read loud. If\n` +
      `    there is no such mechanism, that is the finding, and the code should not ship.`
  )
}
for (const id of Object.keys(CODES)) {
  if (rendered.has(id)) continue
  problems.push(
    `CODES lists "${id}", which no screen renders any more. An entry describing a code that\n` +
      `    is gone makes the set look more complete than it is.`
  )
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`\ncheck-qr-readback: ${problem}`)
  process.exit(1)
}

const kinds = new Map()
for (const { by } of Object.values(CODES)) kinds.set(by, (kinds.get(by) ?? 0) + 1)
console.log(
  `check-qr-readback: ${String(rendered.size)} code(s) leave this device, each with a stated ` +
    `failure on a misread (` +
    [...kinds].map(([by, n]) => `${String(n)} ${by}`).join(', ') +
    `)`
)
