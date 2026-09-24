# Handoff, workstream A

Companion to `research/00-current-state.md`. What was decided while writing it,
what the owner has to decide next, and everything that was not verified.

## Scope kept

- Research only. No code, spec, doc outside `research/`, or `MANIFEST.lock`
  entry was changed. `research/` is outside the manifest (which covers
  `packages/` and `spec/`) and outside the directories `make prose` scans.
- Every external claim was taken from a file fetched on 24 September 2026. None
  is stated from memory.

## Decisions made

1. **No external document is called a standard.** BIPs are cited with their own
   status field (Deployed, Complete). BBQr and UR are each described as one
   organisation's document, with their own status words quoted.
2. **Coldcard, SeedSigner and Krux are treated as sharing a dice convention**,
   not a published method: SHA-256 over the ASCII digits `1` to `6`. Each was
   confirmed from source code, not from docs alone.
3. **Released code over development branches.** SeedSigner's review behaviour
   is reported from tag 0.8.7, with `dev` noted separately, because `dev` is
   substantially stricter and a comparison should not credit unreleased work.
4. **Board assumptions were classified** as hardware, tuning, incidental or
   stale (section 3 of the main document), so the owner can see that the hard
   dependencies are in `provisioning/` and the 800x480 geometry, not in
   `packages/core`.
5. **G1 is reported as a divergence, not as a confirmed interop failure.** The
   code reading is certain; no coordinator was run to confirm how one reacts.

## Open questions for the owner

1. **G1, the base64 inside BBQr `P`.** Change the outbound path to split the
   binary PSBT (matching BBQr, BIP-174's file form, Coldcard and nullroute's own
   reader), and add a test that feeds a Coldcard-produced `B$2P` sequence? This
   is a code change and was out of scope here.
2. **UR support (G4).** Add read-only UR `psbt`/`crypto-psbt` so SeedSigner and
   Jade users have a common animated format, or declare BBQr-only in the draft
   specification and say which devices that excludes? UR needs CBOR and fountain
   decoding, which is new parsing surface and possibly a new dependency, and
   dependencies need your approval.
3. **Byte mode against BBQr's alphanumeric MUST (G2).** Keep byte mode and state
   the departure in `core.qr.bbqr` by name, or add an alphanumeric path for
   BBQr frames only?
4. **The Coldcard `Z` sentence (G5).** Reword the reason in `core.qr.bbqr`,
   `packages/core/src/qr/bbqr.ts` and `docs/USING.md` to cite the BBQr
   receiver requirement instead of Coldcard's default?
5. **The Coldcard compatibility sentence in `docs/ENTROPY.md:128-129`.** Name
   the dice-only path explicitly, and add that a 99-roll Coldcard, SeedSigner or
   Krux seed cannot be reproduced on nullroute, and a 100-roll nullroute seed
   cannot be re-entered on SeedSigner?
6. **Dice as a draft specification (N1).** Propose the shared convention as
   written text (SHA-256 over ASCII `1`-`6`, no separator, no newline, minimum
   100 for 24 words, a published worked example)? It would disagree with the
   three products on 99 against 100, and with BCR-2020-001 on encoding. Decide
   whether the proposal should also define 12-word truncation, which nullroute
   does not offer.
7. **Missing documents (G8).** Write `docs/AIR-GAP.md` and
   `docs/PROVISIONING.md`, or repoint the citations to `docs/USING.md` and
   `provisioning/HARDENING.md`? A reviewer following a citation into a missing
   file is the first thing a hostile review finds.
8. **Stale Pi 5 comments (G9).** Fix `Makefile:358` and
   `.github/workflows/ci.yml:389` now, and mark the rpi-image-gen backend's
   `layer: rpi5` as disagreeing with the profile?
9. **Mixed-transfer refusal (N5).** Add a whole-payload digest check, or a test
   documenting the case where two transfers share total, type and encoding?
10. **Grant framing.** The strongest distinct claims, from the comparison, are
    N2 and N3: no published document says what a signer must show before
    signing or what it must show about the software it runs, and nullroute has
    both as machine-checked invariants. Lead with those rather than transport,
    where nullroute is behind (G1, G4)?

## Could not verify

External, from the three research passes:

- Whether tag 40308 (`output-descriptor`) means the BCR-2020-010 or BCR-2023-010
  structure today; the registry and the newer paper disagree.
- Whether UR payloads must use minimal two-letter Bytewords, and whether UR's
  case guidance is normative (it appears as a goal, not MUST text).
- Whether SeedSigner accepts the unprefixed `ur:psbt`; only `crypto-psbt`
  patterns were found.
- Which UR type name Krux writes; the `uUR` module was not fetched.
- Whether SeedSigner shows a firmware hash on the device; README and docs only.
- When SeedSigner's stricter `dev` review ships.
- Specter DIY: any on-device firmware hash (the bootloader repository was not
  read); absence of BBQr and descriptor UR is from `src/` only, not the
  `microur` submodule.
- Coldcard: the upgrade page's Genuine and Caution wording and "Show Version"
  path came from a fetch summary, not raw HTML; the `check-repro` target itself
  was not read.
- Jade: whether a bare base64 PSBT or a descriptor can be imported by QR; the
  full dice procedure in its external guide; "User input" as an entropy source.
- Krux: whether tampered firmware can reproduce the flash hash; only the
  project's own statements were read.
- Which BBQr writers emit `Z` by default, now that Coldcard's source says it
  does not.

Internal:

- How any real coordinator reacts to nullroute's multi-frame PSBT (G1). No
  coordinator was run.
- The QR file type used for a finalised raw transaction after signing; not
  traced.
- Whether the built image exposes the Pi Camera Module 3 to Chromium's
  `getUserMedia`. Nothing in `provisioning/` names a camera driver. This belongs
  to the hardware bring-up milestone.

## Sources and revisions

Fetched 24 September 2026. Where a commit was recorded it is given; otherwise
the named branch at that date, so line numbers may drift.

| Source | Revision |
| --- | --- |
| `github.com/bitcoin/bips` | `e8987d3e` |
| `github.com/BlockchainCommons/Research` | `e4a4fbb1` |
| `github.com/coinkite/BBQr` | `8dc7ef07` |
| `github.com/SeedSigner/seedsigner` | tag `0.8.7`, and branch `dev` |
| `github.com/selfcustody/krux` | branch `main` (latest release v26.08.0) |
| `github.com/cryptoadvance/specter-diy` | branch `master` |
| `github.com/Coldcard/firmware` | branch `master` |
| `github.com/Blockstream/Jade` | branch `master` |
| `coldcard.com/docs`, `help.blockstream.com` | pages as served that day |
