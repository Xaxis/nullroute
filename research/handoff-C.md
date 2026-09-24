# Handoff, workstream C

Companion to `spec/signer-profile.md`, the first draft of a board-neutral
profile for air-gapped signers. What was decided while writing it, what the
owner has to decide, what the draft found that nobody had written down, and
what was not verified.

## Scope kept

- One new file under `spec/` (`spec/signer-profile.md`) and this file. No code,
  invariant, doc or vector changed.
- `spec/` is a manifest root (`MANIFEST_ROOTS := packages spec provisioning` in
  the `Makefile`), so adding the profile moved the manifest root. `make
  manifest` was run and `MANIFEST.lock` is in the same commit, along with the
  transcript in `docs/VERIFICATION.md` that the target rewrites. The root moved
  from `a3d1d459f82ad0614ed8bfd41f892829aca8c98ce319079774cdda4985588fc9` to
  `2b27a53b60f5dc5cc8905a1fa929925ce435d7754dc912c00f6a023cd4762521` on this
  branch. The only manifest line added is `spec/signer-profile.md`; the
  `research/` directory is outside the manifest. If `main` moves before this
  merges, the manifest has to be regenerated on the merge result.
- `make manifest` reports the site CSP as unchecked because this worktree has
  no website build. The CSP hashes in `vercel.json` depend on the manifest root
  through the home page transcript, so `make web-check` (or `make web-build &&
  node tools/gen-csp.mjs`) has to run before this branch is deployed.
- External documents were fetched on 24 September 2026: `bitcoin/bips` at
  commit `7c7cb232c228b258616ef64a3a079aa82996da8c`, `coinkite/BBQr` `master`,
  `BlockchainCommons/Research` `master` (BCR-2020-001), and RFC 8174 from
  rfc-editor.org. Every BIP status and quote in the profile comes from those
  files. Claims about SeedSigner, Coldcard, Krux, Specter DIY and Jade are
  taken from `research/00-current-state.md` and were not re-fetched.

## Decisions made

1. **Profile, not description.** Requirements are written for any signer. nullroute
   appears only in conformance tables, and it fails four requirements in them
   (SP-REV-3, SP-ATT-5, SP-TX-6, and part of SP-ATT-6 and SP-TX-5). Weakening a
   requirement to make nullroute pass would have defeated the purpose.
2. **24 words and 100 rolls only.** The profile defines no 12-word variant.
   It shows the arithmetic both ways (floating point and `6^99 < 2^256 < 6^100`).
3. **Bias is stated, not solved.** The profile shows that 100 rolls keep 256
   bits of min-entropy only while the likeliest face stays at or below
   p = 0.169576 (fair is 0.166667), requires accepting more than 100 rolls, and
   forbids implying the device assessed the dice. It does not raise the count.
4. **SP-REV-3 is new.** No nullroute invariant covers it. It comes from the
   BIP-174 Signer text on segwit v0 fee lying and the BIP-341 rationale for
   committing to all input amounts, both quoted in the profile.
5. **High fees warn and do not block** (SP-REV-13, a SHOULD), matching the code.
6. **BBQr's alphanumeric MUST is kept** (SP-TX-6) and nullroute is marked as not
   meeting it, rather than writing byte mode into the profile. SP-TX-4 (never
   write `Z`) is stricter than BBQr and says so.
7. **Deterministic signing is included** (SP-SIG-1) although it was not in the
   brief, because the review section is incomplete without saying what the
   signature commits to and what randomness it consumes. BIP-340's own text on
   zero `aux_rand` and the fault-injection cost is quoted.
8. **PSBT version 0 is required, version 2 is not.** No test in the repository
   feeds a version 2 PSBT, so support is marked UNVERIFIED.
9. **UR is left undecided** and pointed at open question 2 in
   `research/handoff-A.md`.
10. **"Met" means an invariant with a bound test exists**, not that it was seen on
    hardware. Every hardware-dependent line says what exists before bring-up.

## Vector files for workstream D

All under `spec/vectors/signer-profile/`. None exists yet.

| File | Requirements |
| --- | --- |
| `dice-to-entropy.json` | SP-ENT-1 to SP-ENT-4, SP-ENT-10, SP-HW-9 |
| `dice-accounting.json` | SP-ENT-5 |
| `review-fee-and-amounts.json` | SP-REV-2, SP-REV-4, SP-REV-13 |
| `review-input-amounts.json` | SP-REV-3 |
| `review-change.json` | SP-REV-6, SP-REV-7 |
| `review-sighash.json` | SP-REV-8, SP-REV-23 |
| `review-timelocks.json` | SP-REV-9 |
| `review-unknown-fields.json` | SP-REV-11 |
| `review-ownership.json` | SP-REV-24, SP-REV-25 |
| `manifest-root.json` | SP-ATT-2 (paths that sort differently under `C` and a UTF-8 locale) |
| `bbqr-psbt.json` | SP-TX-2 to SP-TX-6, including at least one sequence from another implementation |

## Findings for the owner

Things the draft turned up in the repository. None was changed.

1. **Segwit v0 input amounts are taken on trust (SP-REV-3).** `inputAmount` in
   `packages/core/src/psbt/review.ts` returns the witness UTXO amount when there
   is one and neither requires nor warns about a missing non-witness UTXO. The
   library covers part of this: `@scure/btc-signer` 2.3.0 checks a non-witness
   UTXO's TXID and its agreement with a witness UTXO while parsing
   (`transaction.js` lines 305-345, called at 613) and refuses to sign a legacy
   input without one (line 536). A segwit v0 input with only a witness UTXO is
   reviewed with whatever amount it states, which is the case BIP-174 line 415
   describes. Krux warns in this case ("Unverified input amounts!",
   `research/00-current-state.md` 4.3).
2. **The manifest root does not cover dependencies (SP-ATT-5).** `package-lock.json`
   and the root `package.json` sit outside `packages spec provisioning`, so a
   dependency change leaves the lock-screen value unchanged. Only the tier 0
   image checksum covers them.
3. **The daemon's refusal to start has no invariant and no test (SP-ATT-6).**
   `requirePassingVerification` in `packages/daemon/src/boot/attestation.ts`
   is described in the `daemon.ipc.socket` algorithm text only. A search of the
   repository for the function name and its error messages finds no test.
4. **`docs/THREAT-MODEL.md` overclaims the fee defence.** Line 62 says "a hard
   warning threshold and a second confirmation". The code's `high-fee` and
   `high-fee-rate` warnings are non-blocking and there is no second
   confirmation. Lines 62 and 64 also cite INV-PSBT-2 for fee drain and for
   timelock and RBF, where the invariants that cover them are INV-PSBT-4 and
   INV-PSBT-7.
5. **`docs/USING.md` says "Frames from two transfers are never merged".** The
   collector refuses mismatched headers and conflicting repeats (INV-QR-4), but
   by reading the code two transfers with the same total, type and encoding and
   disjoint indices would be joined (N5 in `research/00-current-state.md`).
6. **SD card transport against "nothing mounts removable media".** `docs/USING.md`
   ("The two transports") says transactions can arrive on an SD card as base64
   text. `docs/THREAT-MODEL.md` ("Malicious QR or SD payloads") says nothing in
   the repository mounts removable media. How a file on a card reaches the
   daemon on the built image was not traced. UNVERIFIED.
7. **"To start, if its own code does not match the manifest"** in
   `docs/USING.md` ("What the device refuses") is broader than the check. At
   start the daemon compares its report's root with SHA-256 of `MANIFEST.lock`
   and opens no source file; file contents are checked by `sha256sum -c` when
   the report is written, and by dm-verity on a tier 1 build.
8. **INV-PSBT-1 is not defined in any spec file.** It appears in
   `docs/THREAT-MODEL.md` and in three specs' `threats:` lists, with no
   invariant or test of that id. The behaviour is covered by INV-PSBT-14 and
   INV-SIG-4.
9. **`CLAUDE.md` says the manifest covers `packages/` and `spec/` only.** The
   `Makefile` and `docs/VERIFICATION.md` include `provisioning/` as well.

## Open questions for the owner

1. Fix SP-REV-3 in code: require a non-witness UTXO for every segwit v0 input,
   or keep accepting a witness UTXO and make "fee unverified" a blocking
   condition with the per-signature override? The first is what BIP-174 says a
   signer may do; the second keeps coordinators that omit the previous
   transaction usable.
2. Add `package-lock.json` (and the root `package.json`) to the manifest roots,
   so the lock-screen value moves when a dependency does? It changes the recipe
   in `docs/VERIFICATION.md` and the manifest root.
3. Give the daemon's start-up refusal an invariant id and tests (missing report,
   `passed: false`, a failed check under `passed: true`, a stale root)?
4. Byte mode against BBQr's alphanumeric MUST (SP-TX-6, G2). Change the encoder
   for BBQr frames, or change the profile to permit byte mode and record why?
   The profile currently follows BBQr.
5. Should the profile define 12 words from 50 rolls? 50 rolls is 129.248 bits
   (50 x 2.584962500721156), enough for ENT = 128, and would let the profile
   describe what Coldcard, SeedSigner and Krux already do. nullroute offers no
   12-word path, and adding one is a feature, not a document change.
6. Should the profile require a whole-payload digest for multi-frame transfers
   (SP-TX-5 is a SHOULD today)? BBQr has no field for one, so this would be a
   departure from BBQr or a reason to consider UR, which carries a CRC-32.
7. Correct the four documentation statements in findings 4, 5, 7 and 9?
8. Is "version 0.1" and the change log the right way to version the profile, or
   should it carry the manifest root it was written against?

## Could not verify

- How the camera reaches Chromium on the built image, and whether the panel,
  touch controller and camera work on a Pi 4. This is the hardware bring-up
  milestone; every affected profile line says what already exists before it.
- Whether nullroute accepts a PSBT version 2. Referenced by two specs, fed by no
  test.
- How an SD card is read on the device (finding 6).
- RFC 6979 was not fetched. It is cited in the profile as nullroute's specs cite
  it, and nothing in the profile depends on its text.
- The dice rows for Coldcard, SeedSigner and Krux come from workstream A's
  fetches, not new ones. Their line numbers are as recorded in
  `research/00-current-state.md` and may have drifted.
- No coordinator was run against any requirement in section 6 of the profile.
