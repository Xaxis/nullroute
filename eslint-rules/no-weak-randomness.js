/**
 * `Math.random()` is banned in packages/core and packages/daemon.
 *
 * It is not a CSPRNG, it never was, and the failure mode is silent: code that
 * uses it produces plausible-looking output forever and the weakness only
 * surfaces when someone else notices the pattern. In a process that handles
 * seed material there is no legitimate use for it.
 *
 * The rule also catches `crypto.getRandomValues` in the frontend, where
 * docs/ENTROPY.md promises it is never called for anything security relevant.
 * Entropy collection happens in the daemon or it does not happen.
 *
 * Where randomness IS needed (padding unused profile slots, for example) the
 * source is `node:crypto`'s randomBytes in the daemon, never here.
 */

/** @type {import('eslint').Rule.RuleModule} */
export const noWeakRandomness = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Forbid Math.random and frontend getRandomValues in key-adjacent code.',
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          banGetRandomValues: {
            type: 'boolean',
            description:
              'Also ban crypto.getRandomValues. Set for the UI, where entropy must come from the daemon.',
          },
        },
      },
    ],
    messages: {
      mathRandom:
        'Math.random() is not a CSPRNG and is forbidden here. Use randomBytes from node:crypto in the daemon.',
      getRandomValues:
        'crypto.getRandomValues() must not be called in the frontend for anything security relevant. ' +
        'Entropy collection and seed derivation happen in the daemon. See docs/ENTROPY.md.',
    },
  },

  create(context) {
    const options = context.options[0] ?? {}
    const banGetRandomValues = options.banGetRandomValues === true

    return {
      MemberExpression(node) {
        if (node.computed || node.property.type !== 'Identifier') return

        // Math.random
        if (
          node.property.name === 'random' &&
          node.object.type === 'Identifier' &&
          node.object.name === 'Math'
        ) {
          context.report({ node, messageId: 'mathRandom' })
          return
        }

        // crypto.getRandomValues / globalThis.crypto.getRandomValues
        if (banGetRandomValues && node.property.name === 'getRandomValues') {
          context.report({ node, messageId: 'getRandomValues' })
        }
      },
    }
  },
}
