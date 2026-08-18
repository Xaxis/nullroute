/**
 * The verifiers that inspect the profiles themselves.
 *
 * These need no built image, which is why they are the three that exist. They
 * are also the ones that keep the abstraction falsifiable: INV-PROV-1 says
 * every assertion carries an executable verifier, and INV-PROV-2 says no
 * verifier may consult a profile's `backends` key. Both were assertions about
 * this system that this system did not check.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { VERIFIERS } from './registry.mjs'

/**
 * INV-PROV-1. Every assertion names at least one verifier that is DECLARED.
 *
 * Declared, not implemented. The assertion's own `does_not_cover` concedes that
 * a verifier which always returns true would satisfy it, so requiring
 * implementation here would be a stronger claim than the assertion makes. What
 * this rules out is the case that actually occurred: a `check:` naming
 * something that does not exist anywhere.
 */
export function profileSelfCheck(profiles) {
  const problems = []

  for (const { file, profile } of profiles) {
    for (const assertion of profile.assertions ?? []) {
      const checks = (assertion.verify ?? []).map((entry) => entry.check)
      if (checks.length === 0) {
        problems.push(`${file}: ${assertion.id} names no verifier at all`)
        continue
      }
      for (const check of checks) {
        if (!Object.hasOwn(VERIFIERS, check)) {
          problems.push(
            `${file}: ${assertion.id} names the verifier "${check}", which is not declared ` +
              `in provisioning/checks/registry.mjs`
          )
        }
      }
    }
  }

  return problems
}

/**
 * INV-PROV-2. No verifier reads a profile's `backends` key.
 *
 * A backend that could influence its own verdict would make the abstraction
 * decorative: a backend failing to implement a rule could describe itself as
 * exempt from it. Checked by reading the verifier sources rather than by
 * reviewing them, because a rule enforced by review is a rule that lapses.
 */
export function verifierIgnoresBackends(checksDir) {
  const problems = []

  for (const entry of readdirSync(checksDir)) {
    if (!entry.endsWith('.mjs')) continue
    const source = readFileSync(join(checksDir, entry), 'utf8')

    // Comments, strings and regex literals all discuss the key by name, which
    // is how the rule stays legible to whoever reads it next. Only executable
    // property access is at issue, so everything that is not code is stripped
    // before matching.
    //
    // This is not fussiness. The first version matched the bare word and
    // flagged this file, whose own function name contains it; the second
    // matched property access and flagged its own regex literal. A detector
    // that cannot be written without tripping itself is one that will be
    // silenced rather than fixed.
    const code = source
      .split('\n')
      .filter((line) => {
        const trimmed = line.trim()
        return !trimmed.startsWith('*') && !trimmed.startsWith('//') && !trimmed.startsWith('/*')
      })
      .join('\n')
      // Regex literals, then the three string forms.
      .replace(/\/(?![/*])(?:[^/\\\n]|\\.)+\/[gimsuy]*/g, 'REGEX')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''")
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/`(?:[^`\\]|\\.)*`/g, '``')

    // Property ACCESS, not any occurrence of the word. The earlier version
    // matched the bare identifier and so flagged this file, whose own function
    // name and detector both contain it. What is forbidden is reading the key
    // off a profile, which always looks like one of these three forms.
    if (/\.backends\b|\[\s*['"]backends['"]\s*\]/.test(code)) {
      problems.push(
        `provisioning/checks/${entry} reads "backends" in code. A verifier that consults the ` +
          `backend lets a backend excuse itself from a rule it did not implement.`
      )
    }
  }

  return problems
}

/**
 * INV-PROV-13. An assertion that concedes a weakness states what it does not
 * cover.
 *
 * The rule the whole project runs on, applied to provisioning: a defence that
 * is partial gets described as partial. An assertion with no `does_not_cover`
 * is one whose limits nobody wrote down, which is how a partial control comes
 * to be read as a complete one.
 *
 * OVERLAPS THE SCHEMA, AND NOT ENTIRELY. The schema already requires the key
 * and a minimum length of ten characters, so a missing or very short concession
 * is caught before this runs. What it cannot catch is a value that satisfies
 * the length and says nothing, because minLength counts characters and
 * whitespace is characters. That is the case this covers, and it is a real one:
 * padding a required field is what people do when a field feels like a chore.
 */
export function documentedWeakness(profiles) {
  const problems = []

  for (const { file, profile } of profiles) {
    for (const assertion of profile.assertions ?? []) {
      const stated = assertion.does_not_cover
      if (typeof stated !== 'string' || stated.trim().length === 0) {
        problems.push(
          `${file}: ${assertion.id} does not say what it fails to cover. Every control here is ` +
            `partial in some direction and the direction has to be written down.`
        )
      }
    }
  }

  return problems
}
