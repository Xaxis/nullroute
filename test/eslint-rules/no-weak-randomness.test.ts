/**
 * Regression suite for the weak-randomness ban.
 *
 * Math.random() fails silently: code using it produces plausible output forever
 * and the weakness surfaces only when someone else notices the pattern.
 */

import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'
import { noWeakRandomness } from '../../eslint-rules/no-weak-randomness.js'

RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
})

ruleTester.run('nullroute/no-weak-randomness', noWeakRandomness, {
  valid: [
    { code: `import { randomBytes } from "node:crypto"; randomBytes(32);` },
    { code: `Math.floor(x); Math.log2(6); Math.ceil(y);` },
    // A property named random on something that is not Math.
    { code: `rng.random();` },
    { code: `const { random } = myRng; random();` },
    // getRandomValues is allowed unless the option is set (daemon may use it).
    { code: `crypto.getRandomValues(buf);` },
  ],

  invalid: [
    { code: `Math.random();`, errors: [{ messageId: 'mathRandom' }] },
    { code: `const x = Math.random() * 6;`, errors: [{ messageId: 'mathRandom' }] },
    { code: `[1,2,3].sort(() => Math.random() - 0.5);`, errors: [{ messageId: 'mathRandom' }] },
    // In the UI, entropy must come from the daemon. See docs/ENTROPY.md.
    {
      code: `crypto.getRandomValues(new Uint8Array(32));`,
      options: [{ banGetRandomValues: true }],
      errors: [{ messageId: 'getRandomValues' }],
    },
    {
      code: `globalThis.crypto.getRandomValues(buf);`,
      options: [{ banGetRandomValues: true }],
      errors: [{ messageId: 'getRandomValues' }],
    },
  ],
})
