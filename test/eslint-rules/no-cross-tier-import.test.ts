/**
 * INV-WALLET-1 regression suite: the assurance tier boundary.
 *
 * The claim in docs/THREAT-MODEL.md is that removing packages/wallet leaves a
 * working signer. A single import in the wrong direction quietly makes that
 * false, and the build would still be green. This is the test that notices.
 *
 * IT DID NOT NOTICE, FOR THE WHOLE OF ITS LIFE. Every forbidden case below was
 * written as a bare specifier, and so was the rule, which compared the import
 * against the workspace's npm name and nothing else. A relative path into the
 * same workspace passed both. That is not a theoretical spelling: from
 * apps/web, `../../../../packages/daemon/src/store/store.js` resolves,
 * type-checks under moduleResolution "bundler", and bundles. The suite looked
 * comprehensive because it covered subpaths, dynamic import and re-export, all
 * of which are variations on the half that was implemented.
 *
 * The path cases are below, one per area, and they are the reason this file is
 * longer than the rule.
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
const VERIFY = '/repo/packages/verify/src/manifest.ts'

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
    // A relative path that climbs and comes back into its OWN workspace is
    // ordinary code, and the path half must not fire on it.
    { code: `import { x } from "../../src/util/secret.js";`, filename: CORE },
    { code: `import { x } from "../bip39/wordlist.js";`, filename: CORE },
    // The permitted direction spelled as a path is still permitted.
    { code: `import { derive } from "../../core/src/derive/path.js";`, filename: WALLET },
    // A directory whose name merely starts the same way is not the workspace.
    { code: `import { x } from "../../../packages/daemon-notes/x.js";`, filename: WEB },
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

    // THE SPELLING THE RULE USED TO ALLOW. Each of these resolves into a denied
    // workspace, so each is the same violation as its bare-specifier twin
    // above, and none of them was caught.
    {
      code: `import { WalletStore } from "../../../../packages/daemon/src/store/store.js";`,
      filename: WEB,
      errors: [{ messageId: 'wrongDirection' }],
    },
    {
      code: `import { Screen } from "../../../packages/ui/src/App.js";`,
      filename: WEB,
      errors: [{ messageId: 'wrongDirection' }],
    },
    {
      code: `const s = await import("../../../../packages/daemon/src/index.js");`,
      filename: WEB,
      errors: [{ messageId: 'wrongDirection' }],
    },
    {
      code: `export * from "../../../../packages/wallet/src/index.js";`,
      filename: WEB,
      errors: [{ messageId: 'wrongDirection' }],
    },
    // Core reaching up into the daemon, by path.
    {
      code: `import { store } from "../../../daemon/src/store/store.js";`,
      filename: CORE,
      errors: [{ messageId: 'wrongDirection' }],
    },
    // A path that doubles back is the same import, and the bundler agrees.
    {
      code: `import { x } from "../util/../../../daemon/src/index.js";`,
      filename: CORE,
      errors: [{ messageId: 'wrongDirection' }],
    },
    // The verifier must not depend on what it verifies.
    {
      code: `import { x } from "../../ui/src/index.js";`,
      filename: VERIFY,
      errors: [{ messageId: 'wrongDirection' }],
    },
  ],
})
