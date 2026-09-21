/**
 * Tests for the three verifiers that read the profiles rather than an artifact.
 *
 * These were the last entries on UNTESTED_VERIFIERS. They need no image and no
 * root filesystem, only a profile object and a directory of files, which makes
 * the absence of a suite for them harder to justify than for the ones that
 * needed a card: there was never anything to build first.
 *
 * verifierIgnoresBackends is the one worth reading. It enforces that no
 * verifier consults `backends`, because a verifier that does lets a backend
 * excuse itself from a rule it did not implement. Writing that detector took
 * three attempts: matching the bare word flagged the file it lives in, whose
 * own function name contains it, and matching property access flagged its own
 * regex literal. The fixtures below pin both of those, because a detector that
 * cannot be written without tripping itself gets silenced rather than fixed.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  documentedClaim,
  documentedWeakness,
  profileSelfCheck,
  verifierIgnoresBackends,
} from '../../provisioning/checks/meta.mjs'

/** One profile in the shape the loader hands these functions. */
const loaded = (assertions: readonly unknown[], file = 'os-signer.yaml') => [
  { file, profile: { assertions } },
]

const sound = {
  id: 'INV-PROV-99',
  verify: [{ check: 'partition-present' }],
  does_not_cover: 'What is inside the partition.',
}

describe('provisioning.profile-self-check', () => {
  it('passes-an-assertion-naming-a-declared-verifier', () => {
    expect(profileSelfCheck(loaded([sound]))).toEqual([])
  })

  /** An assertion with no verifier cannot fail, which is not the same as holding. */
  it('catches-an-assertion-that-names-no-verifier-at-all', () => {
    const problems = profileSelfCheck(loaded([{ ...sound, verify: [] }]))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('names no verifier at all')
  })

  it('catches-an-assertion-naming-a-verifier-the-registry-does-not-declare', () => {
    const problems = profileSelfCheck(
      loaded([{ ...sound, verify: [{ check: 'wishful-thinking' }] }])
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('wishful-thinking')
  })

  it('names-the-file-and-the-assertion-so-the-problem-can-be-found', () => {
    const problems = profileSelfCheck(loaded([{ ...sound, verify: [] }], 'os-verity.yaml'))
    expect(problems[0]).toContain('os-verity.yaml')
    expect(problems[0]).toContain('INV-PROV-99')
  })
})

describe('provisioning.documented-weakness', () => {
  it('passes-an-assertion-that-states-what-it-does-not-cover', () => {
    expect(documentedWeakness(loaded([sound]))).toEqual([])
  })

  it('catches-an-assertion-with-no-concession-at-all', () => {
    const problems = documentedWeakness(loaded([{ id: sound.id, verify: sound.verify }]))
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('does not say what it fails to cover')
  })

  /**
   * THE CASE THE SCHEMA CANNOT CATCH. minLength counts characters and
   * whitespace is characters, so a required field padded with spaces satisfies
   * it while saying nothing, and padding a required field is what people do
   * when a field feels like a chore.
   */
  it('catches-a-concession-padded-with-whitespace-to-satisfy-the-schema', () => {
    const problems = documentedWeakness(loaded([{ ...sound, does_not_cover: '            ' }]))
    expect(problems).toHaveLength(1)
  })
})

describe('provisioning.verifier-ignores-backends', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nullroute-meta-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const check = (name: string, source: string) => {
    writeFileSync(join(dir, name), source)
    return verifierIgnoresBackends(dir)
  }

  it('catches-a-verifier-reading-the-key-as-a-property', () => {
    const problems = check(
      'bad.mjs',
      'export function f(profile) {\n  return profile.backends\n}\n'
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('bad.mjs')
  })

  it('catches-a-verifier-reading-the-key-by-subscript', () => {
    const problems = check('bad.mjs', "export function f(p) {\n  return p['backends']\n}\n")
    expect(problems).toHaveLength(1)
  })

  /** The first version of the detector flagged the file it lives in. */
  it('allows-the-word-in-a-block-comment', () => {
    const source =
      '/**\n * Verifiers must not consult profile.backends at all.\n */\nexport const f = 1\n'
    expect(check('fine.mjs', source)).toEqual([])
  })

  it('allows-the-word-in-a-line-comment', () => {
    expect(check('fine.mjs', '// never read .backends here\nexport const f = 1\n')).toEqual([])
  })

  /** The second version flagged its own regex literal. */
  it('allows-the-key-inside-a-regex-literal', () => {
    expect(check('fine.mjs', 'export const rule = /\\.backends\\b/\n')).toEqual([])
  })

  it('allows-the-key-inside-a-string', () => {
    expect(check('fine.mjs', "export const message = 'do not read .backends'\n")).toEqual([])
  })

  it('ignores-files-that-are-not-modules', () => {
    expect(check('notes.txt', 'profile.backends\n')).toEqual([])
  })
})

describe('provisioning.documented-claim', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nullroute-claim-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const citing = (params: unknown) =>
    loaded([{ ...sound, verify: [{ check: 'documented-claim', params }] }])

  it('passes-when-the-document-really-contains-the-sentence', () => {
    writeFileSync(join(dir, 'HARDENING.md'), 'Some prose.\n\nThe browser is the weakest.\n')
    expect(
      documentedClaim(
        citing({ document: 'HARDENING.md', contains: 'The browser is the weakest.' }),
        dir
      )
    ).toEqual([])
  })

  /**
   * THE CASE THIS VERIFIER EXISTS FOR. INV-PROV-19 cited docs/VERIFICATION.md,
   * which does not contain the word "weakest" anywhere. The sentence is in
   * provisioning/HARDENING.md. Nothing read either parameter, so a wrong path
   * and a real one were indistinguishable for as long as the assertion existed.
   */
  it('catches-a-document-that-does-not-say-what-the-assertion-says-it-says', () => {
    writeFileSync(join(dir, 'VERIFICATION.md'), 'How to check a root hash.\n')
    const problems = documentedClaim(
      citing({ document: 'VERIFICATION.md', contains: 'The browser is the weakest.' }),
      dir
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('and it does not')
  })

  /** A document that is not there has not made the statement. */
  it('fails-rather-than-passing-when-the-document-is-not-there', () => {
    const problems = documentedClaim(
      citing({ document: 'gone.md', contains: 'anything at all' }),
      dir
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('cannot be read')
  })

  /**
   * Markdown wraps, and the sentence this was written for has a line break
   * inside a bolded phrase. Matching the raw bytes would fail on the real
   * document while passing on every fixture written as one line.
   */
  it('matches-a-sentence-that-markdown-wrapped-across-two-lines', () => {
    writeFileSync(
      join(dir, 'HARDENING.md'),
      'a slightly higher score. **The browser is the\nweakest component on the device.** The design response\n'
    )
    expect(
      documentedClaim(
        citing({
          document: 'HARDENING.md',
          contains: 'The browser is the weakest component on the device.',
        }),
        dir
      )
    ).toEqual([])
  })

  /** Unnamed, there is no claim to look for, so it would pass on any document. */
  it('refuses-a-citation-with-no-sentence-to-look-for', () => {
    writeFileSync(join(dir, 'HARDENING.md'), 'anything\n')
    const problems = documentedClaim(citing({ document: 'HARDENING.md' }), dir)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('would pass on')
  })

  it('ignores-assertions-that-cite-no-document', () => {
    expect(documentedClaim(loaded([sound]), dir)).toEqual([])
  })
})
