/**
 * nullroute's local ESLint plugin.
 *
 * These rules encode invariants from docs/THREAT-MODEL.md that would otherwise
 * be enforced by people remembering them. They are deliberately kept in-repo
 * rather than published as a package: a security rule that lives behind a
 * version bump is a security rule that drifts from the code it guards.
 *
 * Every rule here has a regression suite in test/eslint-rules/. If you change a
 * rule, the suite is the thing that proves the invariant still has teeth.
 */

import { noNetwork } from './no-network.js'
import { noCrossTierImport } from './no-cross-tier-import.js'
import { noWeakRandomness } from './no-weak-randomness.js'
import { noTruthyVerdict } from './no-truthy-verdict.js'

export default {
  meta: { name: 'nullroute-local', version: '1.0.0' },
  rules: {
    'no-network': noNetwork,
    'no-cross-tier-import': noCrossTierImport,
    'no-weak-randomness': noWeakRandomness,
    'no-truthy-verdict': noTruthyVerdict,
  },
}
