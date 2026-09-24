# Handoff, workstream D

Companion to `conformance/` and `spec/vectors/signer-profile/`: the vectors
`spec/signer-profile.md` named, a runner any signer can be checked with, and
nullroute's adapter and results. What was decided, what running it found, what
the owner has to decide, and what was not verified.

## What landed

| Path | Contents |
| --- | --- |
| `spec/vectors/signer-profile/` | Eleven vector files, 107 cases, and `SHA256SUMS` |
| `conformance/run.mjs` | The runner, Node built-ins only |
| `conformance/adapters/nullroute.mjs` | The adapter for this repository's built packages |
| `conformance/known-failures/nullroute.json` | Six failing checks, each with a reason |
| `conformance/fixtures/qr-mode.json` | pyqrcode symbols the runner reads to check its own QR mode reader |
| `conformance/generate/` | The generators and `regenerate.sh`, as the record of every expected value's source |
| `conformance/README.md` | For an implementer who has never seen nullroute |
| `make conformance` | Builds, then runs the nullroute adapter with its known failures |

| Vector file | Cases | Independent source of the expected values |
| --- | --- | --- |
| `dice-to-entropy.json` | 17 | `printf \| shasum -a 256` and `/sbin/sha256sum`; BIP-39 from the BIP text and the `bitcoin/bips` word list, checked against the 24 Trezor vectors; PBKDF2 from Python's `hashlib` |
| `dice-accounting.json` | 25 | Exact integers: largest `k` with `2^k <= 6^n` |
| `review-fee-and-amounts.json` | 7 | Bitcoin Core 31.1 regtest: `decodepsbt` fee, `getaddressinfo` path, `testmempoolaccept` |
| `review-input-amounts.json` | 7 | Core PSBTs edited at the key-value level; verdicts from SP-REV-3, BIP-174, BIP-341; Core's decode error recorded |
| `review-change.json` | 9 | Core `getaddressinfo`; the BIP-84 and BIP-86 published addresses and keys |
| `review-sighash.json` | 13 | BIP-143 and BIP-341 sighash rules; Core's names recorded |
| `review-timelocks.json` | 8 | `LOCKTIME_THRESHOLD` in Core's source; BIP-125; Core's `getmempoolentry` for the six cases it could broadcast |
| `review-unknown-fields.json` | 2 | BIP-174 line 417; Core `decodepsbt` lists the pairs as unknown |
| `review-ownership.json` | 5 | Core PSBTs from the BIP-32 test vector 1 wallet; verdicts from SP-REV-24 and 25 |
| `manifest-root.json` | 2 | `LC_ALL=C sort -z \| xargs -0 sha256sum`; the forbidden roots from `LC_ALL=en_US.UTF-8 sort` and ICU `en-US` |
| `bbqr-psbt.json` | 12 | Coinkite's reference splitter at `8dc7ef07`, a real Coldcard scan from the same repository, cross-checked with Python base32 and zlib |

Running `regenerate.sh` twice into fresh directories produced identical files,
`SHA256SUMS` included.

## Decisions made

1. **The vectors stay where the profile named them**, in
   `spec/vectors/signer-profile/`, and `conformance/` reads them from there. The
   profile's paths did not move. `spec/` is a manifest root, so the manifest
   root moved (see [Manifest](#manifest)).
2. **Two pins, both enforced.** `SHA256SUMS` in `sha256sum` format, so an
   outsider checks the files with coreutils and the runner refuses a mismatch.
   And a `vectors:` entry for each file in the nullroute spec that owns the
   behaviour (`dice.spec.yaml`, `review.spec.yaml`, `bbqr.spec.yaml`,
   `daemon/psbt.spec.yaml`, `daemon.spec.yaml`), so `make verify` checks them
   with the existing mechanism: it now reports 15 of 15 vector files. The comment
   in `packages/verify/src/vectors.ts` said vectors run inside the test suite,
   and now says the profile vectors run under `make conformance`.
   `conformance/generate/pin_specs.py` rewrites both after a regeneration.
3. **The adapter reports, the runner judges.** Where a check needs to look inside
   the signer's output, the runner parses it itself: BIP-174 key-value maps for
   signed PSBTs, BBQr headers and base32 for frames, and the QR format
   information and first data codeword for the mode. None of that code is
   shared with any signer.
4. **Verdicts are `allow`, `block-until-override`, `refuse`.** Where the profile
   permits more than one (a blocking condition may also be an outright refusal
   under SP-REV-22; a stricter SP-REV-3 is still conforming), the case lists
   them in `verdictIn`.
5. **Review cases use a mainnet context over regtest-funded PSBTs**, so the
   expected change addresses are the ones BIP-84 and BIP-86 print. The generator
   stops unless Core derives exactly those addresses from the converted BIP-84
   root key. The prevouts exist only on a discarded regtest chain.
6. **Change search bound is the adapter's to declare** (`changeSearchBound`). The
   cases at indices 99, 100 and 999 expect change below the bound and a payment
   at or past it, which catches an off-by-one in either direction.
7. **Known failures fail when they stop failing.** A stale entry fails the run,
   so the list cannot outlive a fix.
8. **`make conformance` is in `check` and in CI's vectors job, not in
   `check-fast`.** It takes about three seconds and needs no network or
   `bitcoind`, but it runs against `dist/`, and `check-fast` has no build step.
   Adding one would cost `check-fast` a full `tsc --build`. `make ci-parity`
   and `make make-targets` pass with the new target.
9. **Two cases go beyond the files the profile named**: `one-hundred-sixes`
   (SP-ENT-7: a flagged pattern still derives) and
   `payment-to-own-receive-address` (SP-REV-14, SHOULD). Both are labelled with
   their requirement.
10. **The QR mode check reads the first segment only.** That is enough to tell
    byte mode from alphanumeric. The runner checks its reader against ten
    pyqrcode symbols (versions 2 to 11, levels L and H, three modes) every time
    it starts; during development it read 20 of 20 pyqrcode symbols from
    versions 3 to 32 correctly.
11. **`make prose` now covers `conformance/`.**
12. **The generators are Python and are committed** as the record of where each
    value came from. They need `bitcoind`, network access and `pyqrcode`, which
    `regenerate.sh` installs into the scratch directory with `pip3 --target`.
    Nothing in `make` runs them and nothing in `packages/` depends on them.

## Findings

Running the vectors against nullroute: 101 cases pass, 6 fail, 1 SHOULD is
missed. None was fixed. The expected values are unchanged.

1. **SP-REV-11: unknown input pairs are dropped at signing.** An unknown
   key-value pair in an input map is missing from the signed PSBT. Global and
   output pairs, and a proprietary input pair, survive. Root cause, reproduced
   with `@scure/btc-signer` alone: `parsePsbt` calls
   `btc.Transaction.fromPSBT(bytes)` (`packages/core/src/psbt/parse.ts` line
   71) without `{ allowUnknown: true }`, and signing calls `updateInput`, which
   re-normalises the input with `allowUnknown` false and drops the pair
   (`transaction.js`, `updateInput` and `normalizeInput`). With the option set,
   the pair survives signing. INV-PSBT-15 states the pairs are "preserved in the
   signed output", and its test (`preserves-fields-it-does-not-understand`)
   round-trips the PSBT without signing it. The review screen tells the user
   "They are preserved and passed through". Whether `allowUnknown` relaxes
   anything else in the library was not checked.
2. **SP-REV-9: replaceability is computed as every input, not any input.**
   `review.ts` sets `replaceable = false` as soon as one input has a sequence of
   `0xfffffffe` or above. BIP-125 line 40: a transaction signals "if any of its
   inputs" is below that. Bitcoin Core 31.1's `getmempoolentry` reports
   `bip125-replaceable: true` for both mixed-sequence cases. The device shows
   the non-blocking "does not signal replaceability ... your only option is to
   wait" warning for a transaction that signals.
3. **SP-REV-7, SHOULD: a false taproot derivation claim is not reported.** The
   output is correctly shown as a payment. `review.ts` reads only
   `bip32Derivation` when it fills `changeRejectedBecause`, so a false
   `PSBT_OUT_TAP_BIP32_DERIVATION` goes unmentioned.
4. **SP-TX-5 (N5) and SP-TX-6 (G2) confirmed.** Two transfers with disjoint
   indices are joined; frames are written in byte mode. Both were already
   recorded as not met.
5. **G1 is fixed and G6 is closed in the conformance run.** The writer's frames
   join to the binary PSBT, and the reader accepts Coinkite's reference
   sequences in `2`, `H` and `Z` and the real Coldcard scan. These run under
   `make conformance`, not in the vitest suite.
6. **SP-REV-3 behaves as the profile's table says**, including the stricter
   block on a foreign segwit v0 input.
7. **The entropy count holds** for every tested count up to 9616 rolls,
   including the twelve where `n * log2(6)` lies closest below an integer.
8. **BIP-322 signatures carry no variant prefix.** `bip-0322.mediawiki` at
   `7c7cb232`, line 97: "Signers MUST prefix the signature with the variant
   that was used to create the signature." The published "Hello World"
   signature in `bip-0322/basic-test-vectors.json` is `smpAkgwRQIhAOzy...`, and
   INV-MSG-6's test (`message.sign.test.ts`,
   `reproduces-the-official-bip322-vector-byte-for-byte`) expects
   `AkgwRQIhAOzy...`, the same string without `smp`. No `smp` appears in
   `packages/core/src/message`. So the profile's "byte for byte" (section 7)
   holds after the prefix only, and nullroute's output does not meet the BIP's
   MUST at this revision. Found by the SP-DEP-1 survey and re-checked against
   the fetched file.
9. **Generator pitfall, recorded for whoever regenerates.** Core's
   `getaddressinfo` reports `ischange: true` for any owned script missing from
   its address book, receive addresses included. The generator uses the branch
   in `hdkeypath` instead.

## BIP vectors for SP-DEP-1

SP-DEP-1 asked this workstream to list, per BIP, which published vectors
nullroute includes. BIP texts at `bitcoin/bips` `7c7cb232`. The survey was done
by reading each BIP's test vector section and searching this repository; the
BIP-322 prefix and the absence of BIP-174 PSBTs were re-checked by hand.

Key: **vendored** means a file in `spec/vectors/` pinned by hash; **inline**
means values copied into a test; **none** means no published value is checked.

| BIP | Publishes vectors | In nullroute | Not included |
| --- | --- | --- | --- |
| 32 | Test vectors 1 to 5 | Vendored: vectors 1 to 4, every chain (`spec/vectors/bip32.json`) | Vector 5, invalid extended keys |
| 39 | Trezor `vectors.json`, and a Japanese file | Vendored: all 24 English vectors, four directions | Other languages in the same file; the Japanese file |
| 44, 48 | No (path tables only) | Not applicable | |
| 49 | Yes | None | All |
| 67 | Four vectors | None; sort order tested with nullroute's own keys | All |
| 84 | Keys and three addresses | Vendored: the three addresses | Root and account keys, private and public keys |
| 85 | Several | Inline: two derivation cases, BIP-39 words, HEX, PWD BASE64 | DRNG, WIF, XPRV, PWD BASE85, RSA, DICE and others |
| 86 | Keys, internal and output keys, three addresses | Vendored: the three addresses | Keys, internal key, output key, scriptPubKey |
| 125 | No | Not applicable | |
| 129 | Four modes | None; own BSMS strings | All |
| 143 | Five worked sighashes | None | All |
| 173, 350 | Valid and invalid strings and addresses | None (one BIP-173 address appears only as a stranger's address) | All |
| 174 | About 46, including invalid PSBTs and a role walk-through | None | All |
| 370, 371 | Yes | None | All |
| 340 | `test-vectors.csv`, 19 rows | None (one public key reused as an arbitrary key) | All |
| 341 | `wallet-test-vectors.json` | None | All |
| 322 | Basic and generated files | Inline: some basic vectors, including the RFC 6979 "Hello World" signature | Most tx hashes, non-p2wpkh and error cases, the generated file |
| 380 | Checksums and key expressions | Vendored: all 8 checksums. Inline: 9 valid key forms, checked as "parses" only | Private key forms (refused by design), all 21 invalid key expressions |
| 381, 382, 383, 387 | Yes | None | All |
| 386 | Yes | Two input keys reused; scripts compared with `@scure/btc-signer`, not the BIP | All expected scripts |
| 389 | Yes | None; one form refused by design | All |
| 329 | Eight-line export | None | All |
| 388 | Yes | Not used by nullroute | All |

The largest gaps against SP-DEP-1's own list (BIP-32, BIP-39, BIP-174 and the
descriptor documents): no BIP-174 vector at all, no invalid-input vector for
BIP-32 or BIP-380, and no descriptor-to-script vector for BIPs 381 to 387. For
signing, no BIP-340, BIP-341 or BIP-143 vector is checked; signatures are
checked for determinism and against bitcoinjs-lib.

## Manifest

`spec/` and the five spec files changed, so `make manifest` was run and
`MANIFEST.lock` and the transcript in `docs/VERIFICATION.md` are in the commit.
The root on this branch is
`eb76cc80b3533feeed0b1fe6ae4bd410431210d2d48ab51be64f048bb6a11871`. If `main`
moves first, regenerate it on the merge result. `make manifest` reported the
site CSP as unchecked (no website build in this worktree), so `make web-check`
has to run before a deploy.

## Open questions for the owner

1. **SP-TX-5 cannot be met from BBQr frames alone.** Two transfers that agree on
   total, type and encoding and never repeat an index carry nothing that tells
   them apart, and Coinkite's reference join accepts them. The profile's first
   sentence is a MUST. Either require the receiver to validate the assembled
   payload (for a PSBT, that it parses and its inputs and outputs are
   consistent), require a digest from the sender (which BBQr has no field for),
   or weaken the sentence. The vector expects `refuse` until this is decided.
2. **Fix SP-REV-11 and SP-REV-9?** Both look small (`allowUnknown` on parse; `any`
   for `every` in `review.ts`), and both change code in the signing path, so
   they are the owner's call. INV-PSBT-15 needs a test that signs.
3. **Portable vectors for SP-REV-1 and SP-SIG-1?** The profile checks both with
   nullroute's invariants only. Malformed inputs are easy to add. A signature
   file (PSBT, seed, expected signed PSBT) with values from Bitcoin Core's
   signer would make SP-SIG-1 checkable by others.
4. **The override path is not exercised.** `signPsbt` is always called with
   `override: false`. A case where a blocked transaction signs only with the
   override, and the override does not persist, would cover SP-REV-22.
5. **Locktime with every input final.** When every sequence is `0xffffffff`,
   nLockTime is not enforced, and the review still says the transaction cannot
   confirm until that block or date. The profile does not say what to show.
6. **Mainnet context over regtest coins**, or a test network with coin type 1
   paths? The latter loses the BIP-published addresses as expected values.
7. **Should `make conformance` join `check-fast`** once `check-fast` builds, or
   should the vitest suite run the runner so failures bind to invariants?
8. **Global unknown pairs** survive but are not counted in the review
   (documented in `review.spec.yaml`). The vector's SHOULD count is 2 (input and
   output), so it does not flag this.

## Could not verify

- **Nothing ran on hardware.** The adapter reports what the code decides, not
  what the panel displays or whether a camera reads the frames. Hardware
  bring-up on the Pi is the next milestone, and SP-HW, SP-REV-5 and SP-REV-21
  stay manual until then.
- **The adapter repeats two pieces of UI logic** rather than driving the UI: the
  `codes` memo in `QrDisplay.tsx` (three lines, around the exported
  `bbqrPayload`) and `maySign` in `PsbtScreen.tsx`. It names both files. A
  change there that the adapter does not follow would go unnoticed.
- **Only Coinkite's code and one Coldcard scan** stand in for other BBQr
  implementations. No Coldcard-written type `P` sequence, and no coordinator
  reading nullroute's frames, was tested.
- **`sha256sum` here is macOS's** (`/sbin/sha256sum`, "Darwin 1.0") and
  `shasum`; they agree. GNU coreutils was not run. The locale-order example
  used macOS `sort` and ICU; a glibc locale was not run.
- **The BIP-39 code in the generator was written for it.** It matches all 24
  Trezor vectors before it is used, and the worked example matches
  `docs/ENTROPY.md`.
- **The SP-DEP-1 table comes from a survey** of the BIP texts and a search of
  this repository. Spot checks are noted above; the rest was not re-derived.
- **The full test suite passed on the second run.** The first `make verify` in
  this worktree failed one daemon test on a timeout
  (`phase4.ipc.test.ts`, `says-the-descriptors-were-shown-rather-than-loaded`),
  which passed alone and on the rerun, while another process was using the
  CPU.
