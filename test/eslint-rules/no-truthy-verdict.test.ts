/**
 * INV-UI-102 regression suite: the verdict-truthiness ban.
 *
 * The rule it covers is the only one of the four with no test, and it is the
 * one whose own header says the bug it catches has shipped three times and
 * failed open every time. CLAUDE.md cites it by name, and MachineEntropyScreen
 * carries a comment saying `!== true` rather than `!healthy` is deliberate
 * "see nullroute/no-truthy-verdict". So the codebase has three places pointing
 * at a rule nothing exercised.
 *
 * That matters more here than for a lint rule in general. An ESLint rule that
 * silently stops matching does not fail: the run goes green with nothing found,
 * which is indistinguishable from code that is correct. A rule enforcing a
 * security invariant needs a test for the same reason the invariants do.
 *
 * The cases below are the three real ones from the rule's header, in the shape
 * they shipped in, plus the boundaries of the field list.
 */

import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'
import { noTruthyVerdict } from '../../eslint-rules/no-truthy-verdict.js'

RuleTester.describe = describe
RuleTester.it = it

/*
 * JSX on, unlike the sibling rule tests, and it is the point rather than a
 * detail. The rule's own comment says `verdict && <thing>` "is how JSX renders
 * conditionally and therefore where this matters most", and two of the three
 * bugs it lists shipped in exactly that form. Testing it with the default
 * parser reports a fatal parse error rather than a missing finding, so the
 * cases that matter most would have been the ones quietly not run.
 */
const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2023,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
})

ruleTester.run('nullroute/no-truthy-verdict (INV-UI-102)', noTruthyVerdict, {
  valid: [
    // The form the rule exists to require, in each of the places it fires.
    { code: `if (result.valid === true) { render() }` },
    { code: `const label = review.signable === true ? "yes" : "no";` },
    { code: `if (report.passed !== true) { refuse() }` },
    { code: `const bad = health.healthy === false;` },
    { code: `show(progress.complete === true && next());` },

    /*
     * A field NOT on the list. The list is short on purpose: a rule that fired
     * on every truthiness test in the frontend would fire hundreds of times on
     * things like `if (error)`, and a rule that fires on everything gets
     * disabled along with its genuine findings.
     */
    { code: `if (error) { show(error) }` },
    { code: `if (response.ok) { parse() }` },
    { code: `if (state.loading) { spin() }` },

    /*
     * A computed member, which the rule deliberately does not follow. It cannot
     * know what `key` holds, and guessing would produce exactly the false
     * positive the previous case is about.
     */
    { code: `if (result[key]) { render() }` },

    // A bare identifier that happens to share a name. The rule is about a
    // property read off something that crossed the boundary.
    { code: `if (valid) { render() }` },
  ],

  invalid: [
    /*
     * The three that shipped, in the shape they shipped in.
     *
     * Each is a device saying something is safe, read as "anything truthy".
     * These arrive as parsed JSON typed only by an interface the compiler
     * believes and cannot check, so the string "false", the number 0.1 and an
     * empty object are all a pass.
     */
    {
      // The verification screen: "The proof checks out" on anything truthy.
      code: `{result.valid && <p>The proof checks out</p>}`,
      errors: [{ messageId: 'truthy', data: { name: 'valid' } }],
    },
    {
      // The signing screen: the button that spends money.
      code: `const maySign = review.signable ? true : false;`,
      errors: [{ messageId: 'truthy', data: { name: 'signable' } }],
    },
    {
      // The lock screen, in its negated form.
      code: `if (!report.passed) { block() }`,
      errors: [{ messageId: 'truthy', data: { name: 'passed' } }],
    },

    // Every field the default list names, so widening or narrowing it is a
    // change this test notices rather than one that passes quietly.
    { code: `if (a.complete) { done() }`, errors: [{ messageId: 'truthy' }] },
    { code: `if (a.healthy) { generate() }`, errors: [{ messageId: 'truthy' }] },
    { code: `if (a.satisfied) { proceed() }`, errors: [{ messageId: 'truthy' }] },
    { code: `if (a.verified) { trust() }`, errors: [{ messageId: 'truthy' }] },

    // `||` as well as `&&`, because a default applied to a non-boolean verdict
    // is the same mistake wearing a fallback.
    {
      code: `const shown = status.valid || fallback;`,
      errors: [{ messageId: 'truthy', data: { name: 'valid' } }],
    },

    // Nested reads, which is how these actually appear.
    {
      code: `{review.signatures.complete && <p>Ready to broadcast</p>}`,
      errors: [{ messageId: 'truthy', data: { name: 'complete' } }],
    },

    // The option is what makes the field list reviewable, so it is exercised:
    // a name that is safe by default becomes a finding when configured.
    {
      code: `if (response.ok) { parse() }`,
      options: [{ fields: ['ok'] }],
      errors: [{ messageId: 'truthy', data: { name: 'ok' } }],
    },
  ],
})
