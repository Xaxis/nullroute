/**
 * INV-UI-102: a verdict that crossed the IPC boundary is compared to `true`,
 * not tested for truthiness.
 *
 * THIS BUG HAS SHIPPED THREE TIMES, in three different screens, and each one
 * failed OPEN. That is what makes it worth a rule rather than a review note.
 *
 *   The lock screen filtered attestation checks with `status === 'failed'`, so
 *   any status the frontend had not been told about read as a pass. A device
 *   failing verification for a new reason would have unlocked.
 *
 *   The signing screen trusted a `signable` flag it received rather than the
 *   blocking warnings behind it, so a response with `signable` set to anything
 *   truthy would have enabled the button that spends money.
 *
 *   The verification screen rendered "The proof checks out" on `result.valid`
 *   being truthy, so the string "false", the number 0.1, or an object would
 *   all have been a pass.
 *
 * WHY TRUTHINESS IS WRONG HERE SPECIFICALLY. Inside one program a boolean is a
 * boolean. These values arrive as parsed JSON from another process, typed only
 * by an interface the compiler believes and cannot check. The type says
 * `boolean` and the runtime says whatever the daemon sent, and every
 * non-boolean is truthy except the few that are not. The safe reading of
 * "anything other than exactly true" is no, on every one of these fields,
 * because each is a device saying something is safe.
 *
 * SO THIS RULE IS THE FRONTEND'S, and it is the cheaper of two fixes. The
 * frontend's `call<T>()` casts parsed JSON to an interface without checking a
 * single field, which is why it needs this. The daemon does the stronger thing
 * instead: `asReport` in boot/attestation.ts refuses a verification report
 * whose `passed` is not `typeof boolean`, so by the time anything reads it, it
 * is one. Validating at the boundary beats comparing at every use, and where
 * the frontend gains a validating parse this rule stops earning its keep
 * there.
 *
 * Applying it to packages/core would be noise. Nothing there crosses a
 * process boundary at all.
 *
 * THE FIELD LIST IS EXPLICIT, and short, on purpose. A rule that flagged every
 * truthiness test in the frontend would fire hundreds of times on things like
 * `if (error)`, and a rule that fires on everything is a rule people disable.
 * These are the names that mean "the device decided this is fine".
 *
 * `=== false` and `!== true` are fine and are not flagged: those are already
 * explicit about which value they mean.
 */

const DEFAULT_FIELDS = [
  'valid',
  'signable',
  'complete',
  'passed',
  'healthy',
  'satisfied',
  'verified',
]

/*
 * `ok` IS NOT ON THAT LIST, and leaving it off is a decision rather than an
 * oversight. It is the most generic name a boolean can have, and the only use
 * of it in the frontend is `response.ok` from the fetch API, which is a real
 * browser boolean rather than anything a daemon sent. A rule whose first and
 * only finding is a false positive is a rule somebody disables, and the next
 * genuine one goes with it.
 *
 * If a daemon response ever carries an `ok` field, add it here and fix the one
 * fetch site. That is a reviewable change, which is the point of the list.
 */

/** @type {import('eslint').Rule.RuleModule} */
export const noTruthyVerdict = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require === true when reading a verdict field that crossed the IPC boundary.',
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          fields: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Property names that mean "the device decided this is fine". Widening this is a reviewable change, which is the point.',
          },
        },
      },
    ],
    messages: {
      truthy:
        '"{{name}}" is a verdict from the daemon, read here for truthiness. It arrives as parsed ' +
        'JSON typed only by an interface the compiler cannot check, so anything that is not ' +
        'exactly true would read as a pass. Write "=== true". This has shipped three times, and ' +
        'every one of them failed open.',
    },
  },

  create(context) {
    const fields = new Set(context.options[0]?.fields ?? DEFAULT_FIELDS)

    /** The property name being read, when the node is a member expression. */
    const verdictName = (node) => {
      if (node.type !== 'MemberExpression' || node.computed) return null
      if (node.property.type !== 'Identifier') return null
      return fields.has(node.property.name) ? node.property.name : null
    }

    const report = (node) => {
      const name = verdictName(node)
      if (name !== null) context.report({ node, messageId: 'truthy', data: { name } })
    }

    return {
      // `verdict ? a : b`
      ConditionalExpression(node) {
        report(node.test)
      },
      // `if (verdict)`
      IfStatement(node) {
        report(node.test)
      },
      // `!verdict`
      UnaryExpression(node) {
        if (node.operator === '!') report(node.argument)
      },
      // `verdict && <thing>` and `verdict || <thing>`, which is how JSX renders
      // conditionally and therefore where this matters most.
      LogicalExpression(node) {
        if (node.operator === '&&' || node.operator === '||') report(node.left)
      },
    }
  },
}
