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
      // MARKED BEFORE THE STRINGS ARE BLANKED, because the subscript form is
      // written with a string literal and blanking it first destroys the only
      // evidence of it. That is not hypothetical tidying: p['backends'] became
      // p[''] here, so the subscript half of the test below could never match
      // and the rule was enforced against the dot form alone. A verifier could
      // consult the backend by writing a bracket, which is the whole thing
      // INV-PROV-2 exists to prevent. Found by writing a test for it.
      //
      // Only a literal in subscript position is marked, so a message that
      // merely quotes the syntax keeps its marker inside the string and loses
      // it to the blanking on the next line, as it should.
      .replace(/(\[\s*)(['"])backends\2(\s*\])/g, '$1BACKENDS_KEY$3')
      .replace(/'(?:[^'\\]|\\.)*'/g, "''")
      .replace(/"(?:[^"\\]|\\.)*"/g, '""')
      .replace(/`(?:[^`\\]|\\.)*`/g, '``')

    // Property ACCESS, not any occurrence of the word. The earlier version
    // matched the bare identifier and so flagged this file, whose own function
    // name and detector both contain it. What is forbidden is reading the key
    // off a profile, which always looks like one of these three forms.
    if (/\.backends\b|\[\s*BACKENDS_KEY\s*\]/.test(code)) {
      problems.push(
        `provisioning/checks/${entry} reads "backends" in code. A verifier that consults the ` +
          `backend lets a backend excuse itself from a rule it did not implement.`
      )
    }
  }

  return problems
}

/**
 * INV-PROV-34. An assertion that concedes a weakness states what it does not
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

/**
 * An assertion that says a document states something has that document say it.
 *
 * THE BUG THIS EXISTS FOR. INV-PROV-19 asserts two things: that the kiosk unit
 * scores at most 3.0, and that "the documentation states that it is the weakest
 * component on the device". It named two verifiers, and the second was
 * `documented-weakness` with `params: { document: docs/VERIFICATION.md, claim:
 * weakest-component }`.
 *
 * `documented-weakness` is the function above. It takes profiles, walks every
 * assertion's `does_not_cover`, and has never taken a parameter in its life.
 * Both params were read by nothing, anywhere: `document` and `claim` appeared
 * at that one line in the repository and at no other. So the documentation half
 * of a security assertion was verified by a function that cannot open a
 * document, could not fail for that reason, and reported a pass every time.
 *
 * And the parameter was wrong on top of being dead. The sentence is in
 * provisioning/HARDENING.md, beside the exposure scores it explains.
 * docs/VERIFICATION.md does not contain the word "weakest" at all, so the one
 * thing the params did say was false and there was nothing to notice it.
 *
 * WHY A SENTENCE AND NOT A MARKER. `claim: weakest-component` implies a marker
 * convention, an anchor or an HTML comment the verifier looks for. There is no
 * such convention here and inventing one would make the check weaker: a marker
 * survives an edit that reverses the sentence it sits beside, and a reader
 * cannot see it. Naming the words means the assertion and the document say the
 * same thing in the same language, and softening the document fails this.
 */
export function documentedClaim(profiles, root) {
  const problems = []

  for (const { file, profile } of profiles) {
    for (const assertion of profile.assertions ?? []) {
      for (const entry of assertion.verify ?? []) {
        if (entry.check !== 'documented-claim') continue

        const document = entry.params?.document
        const contains = entry.params?.contains
        if (typeof document !== 'string' || typeof contains !== 'string') {
          problems.push(
            `${file}: ${assertion.id} uses documented-claim without both a \`document\` and a ` +
              `\`contains\`. Unnamed, there is no claim to look for and this would pass on ` +
              `every document ever written.`
          )
          continue
        }

        let text
        try {
          text = readFileSync(join(root, document), 'utf8')
        } catch {
          problems.push(
            `${file}: ${assertion.id} says ${document} states something, and ${document} cannot ` +
              `be read. A document that is not there has not made the statement.`
          )
          continue
        }

        // Whitespace is collapsed because markdown wraps, and the sentence this
        // was written for spans a line break in the middle of a bolded phrase.
        // Nothing else is normalised: the words have to be the words.
        const flat = text.replace(/\s+/gu, ' ')
        if (!flat.includes(contains.replace(/\s+/gu, ' '))) {
          problems.push(
            `${file}: ${assertion.id} says ${document} states "${contains}", and it does not. ` +
              `Either the document was softened or the assertion overstates what it says.`
          )
        }
      }
    }
  }

  return problems
}
