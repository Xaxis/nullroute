/**
 * INV-WALLET-1 regression suite: the assurance tier boundary.
 *
 * The claim in docs/THREAT-MODEL.md is that removing packages/wallet leaves a
 * working signer. A single import in the wrong direction quietly makes that
 * false, and the build would still be green. This is the test that notices.
 */

import { RuleTester } from 'eslint'
import { describe, it } from 'vitest'
import { noCrossTierImport } from '../../eslint-rules/no-cross-tier-import.js'

RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
})

const CORE = '/repo/packages/core/src/derive/path.ts'
const WALLET = '/repo/packages/wallet/src/coin-select.ts'
const WEB = '/repo/apps/web/app/page.tsx'

ruleTester.run('nullroute/no-cross-tier-import (INV-WALLET-1)', noCrossTierImport, {
  valid: [
    // The permitted direction: wallet depends on core.
    { code: `import { derive } from "@nullroute/core";`, filename: WALLET },
    { code: `import { Secret } from "@nullroute/core/entropy";`, filename: WALLET },
    // Core depending on audited third-party crypto is fine.
    { code: `import { sha256 } from "@noble/hashes/sha2.js";`, filename: CORE },
    // Relative imports inside a package are unaffected.
    { code: `import { x } from "./sibling.js";`, filename: CORE },
    // A package whose name merely starts similarly must not false-positive.
    { code: `import { x } from "@nullroute/core-utils";`, filename: CORE },
  ],

  invalid: [
    // The forbidden direction. This is the one that breaks the tier claim.
    {
      code: `import { selectCoins } from "@nullroute/wallet";`,
      filename: CORE,
      errors: [{ messageId: 'wrongDirection' }],
    },
    {
      code: `import { store } from "@nullroute/daemon";`,
      filename: CORE,
      errors: [{ messageId: 'wrongDirection' }],
    },
    // Subpath exports are the same violation wearing a hat.
    {
      code: `import { x } from "@nullroute/wallet/utxo";`,
      filename: CORE,
      errors: [{ messageId: 'wrongDirection' }],
    },
    // Dynamic import and re-export are still imports.
    {
      code: `const w = await import("@nullroute/wallet");`,
      filename: CORE,
      errors: [{ messageId: 'wrongDirection' }],
    },
    {
      code: `export * from "@nullroute/daemon";`,
      filename: CORE,
      errors: [{ messageId: 'wrongDirection' }],
    },
    // The website must never pull device code into its build.
    {
      code: `import { signPsbt } from "@nullroute/daemon";`,
      filename: WEB,
      errors: [{ messageId: 'wrongDirection' }],
    },
    {
      code: `import { selectCoins } from "@nullroute/wallet";`,
      filename: WEB,
      errors: [{ messageId: 'wrongDirection' }],
    },
  ],
})
