# nullroute: summary for a grant application

Workstream E. A plain-language summary for a reader who knows Bitcoin and has
never seen this project. Every number below says where it came from. Numbers
from a command were produced on this branch at commit `e2cd5d6` on 24 September
2026.

## Status

- **Pre-1.0.** The version file reads `0.1.0`. Nothing has been released, and
  no image has been signed or published.
- **Unaudited.** Nobody but its author has reviewed the cryptography or the
  code.
- **Where it runs today.** The whole device (signing daemon and touchscreen
  interface) runs on a Mac or a Linux machine with `make dev`. It also builds as
  an SD card image for a Raspberry Pi 4, and that image boots under QEMU, where
  `make image-boot-test` checks that a copy with one byte changed fails to boot.
- **Next milestone: hardware bring-up.** The first boot on a Raspberry Pi 4 with
  the official 7 inch touchscreen has not happened yet. It is the next piece of
  work, and it is what exercises the firmware path, the panel, the touch
  controller and the camera.
- **Keep real money off it** until an outside review and hardware bring-up are
  both done. The [README](../README.md#status) says the same.

## What already existed

nullroute builds on published documents and on five signers that already work.
It does not replace any of them.

### Published documents

Status words are each document's own, from the header of the file fetched from
`bitcoin/bips` on 24 September 2026 ([signer profile, section 7](../spec/signer-profile.md#7-normative-dependencies);
[research/00-current-state.md, section 4.1](00-current-state.md#41-published-documents-consulted)).

| Document | Status | What it defines |
| --- | --- | --- |
| BIP-39 | Deployed | Mnemonic words from entropy |
| BIP-32 | Deployed | Hierarchical key derivation |
| BIP-174 | Deployed (1.4.4) | PSBT. Display to the user is optional: "optionally showing this data to the user as a confirmation of intent" |
| BIP-380 to 387 | Deployed | Output descriptors and their checksum |
| BIP-389 | Draft | Multipath descriptor keys |
| BIP-322 | Complete (2.0.0) | Message signing |
| BIP-329 | Draft | Wallet label export |
| BIP-129 | Complete | BSMS multisig setup; points to Blockchain Commons UR for QR transport |
| BBQr (Coinkite) | "Deployed Widely" (its README) | Multi-frame QR, with an eight character header |
| UR (Blockchain Commons) | Its maintainers say its papers "are _not_ standards" | Multi-frame QR with fountain coding |

### Signers that already do this job

From [research/00-current-state.md, section 4.2](00-current-state.md#42-comparison-table),
which quotes each project's source at the revision recorded in
[research/handoff-A.md](handoff-A.md#sources-and-revisions).

| Project | QR transport for PSBTs | Dice | Firmware check |
| --- | --- | --- | --- |
| Coldcard | BBQr, base64, hex | SHA-256 of the ASCII roll string, 99 rolls for 24 words | Factory-signed firmware, secure element checksum |
| SeedSigner (0.8.7) | Reads UR, BBQr and others; writes UR only | Same rule, exactly 99 rolls | Reproducible images, GPG-signed hash file |
| Krux | UR, BBQr and others; replies in kind | Same rule, at least 99 rolls | Signed releases, reproducible build |
| Specter DIY | Base64, UR; no BBQr found | None | Bootloader accepts only signed upgrades after the first install |
| Jade | UR only | None on the device | Only Blockstream-signed firmware runs |

Three things no published document covers, from
[research/00-current-state.md, section 5.2](00-current-state.md#52-where-no-published-document-exists):

1. **How dice become a seed (N1).** Coldcard, SeedSigner and Krux share one rule
   by convention, and it is written down in no BIP.
2. **What a signer must show before it signs (N2).** BIP-174 makes display
   optional. The five projects differ on what counts as change and on what to do
   when a change claim cannot be checked.
3. **What a device must show about the software it runs (N3).** Each project
   uses a vendor signature or a secure element. None, as documented, shows the
   user a number they can recompute from source with coreutils before unlocking.

## What nullroute adds

### A method: code, specs and tests that have to agree

Every module ships with a machine-readable spec. Each spec declares invariants,
and each invariant names the tests that prove it. `make verify` runs five checks
and writes `verification-report.json`. The signing daemon refuses to start
unless that report exists, records a pass, lists at least one check and no
failed one, and names the same `MANIFEST.lock` that is on disk (INV-BUILD-1, five tests in
[`packages/daemon/test/verification-gate.test.ts`](../packages/daemon/test/verification-gate.test.ts)).

Output of `make verify` on this branch:

| Check | Result |
| --- | --- |
| Coverage | 256 of 256 runtime exports of `packages/core` named by a spec |
| Invariants | 317 invariants bound to 890 tests, each of which ran and passed; 1187 tests in the suite |
| Vectors | 15 of 15 vector files match their pinned hash |
| Differential | 3 modules cross-checked against `bitcoinjs-lib` |
| Integrity | 346 files, root `3630ffd79271d43c61645fa60ed2c633fd922c921cc5c5d4286bb4fab317f0af` |

Totals: 38 specs, 317 invariants. The README badges state the same two numbers,
and `make badges` checks that they match.

What this proves and what it does not: the code does what its specs say, on the
inputs the tests use. It does not prove that the specs describe a secure design.
That takes a human reviewer ([docs/VERIFICATION.md](../docs/VERIFICATION.md#what-verification-does-not-give-you)).

### A software identity anyone can recompute with coreutils

Before the PIN is entered, the lock screen shows the manifest root: SHA-256 of
`MANIFEST.lock`, which is plain `sha256sum` output for every tracked file under
`packages/`, `spec/` and `provisioning/`, sorted under `LC_ALL=C`. Anyone can
recompute it without this project's tools:

```console
$ sha256sum -c MANIFEST.lock
$ sha256sum MANIFEST.lock
$ git ls-files -z packages spec provisioning | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum
```

For this summary the three were run with macOS `shasum -a 256`. All 346 files
matched, and both roots were the value in the table above.

The screen also says what the number does not prove. It is drawn by the software
it describes, so it catches an accident or a crude substitution, not an attacker
who replaced the code that draws it. Nothing has been released, so there is no
published value to compare against yet
([signer profile, section 4.2](../spec/signer-profile.md#42-what-this-does-not-prove)).

### Dice entropy a user can reproduce by hand

The seed is SHA-256 of the ASCII roll string with no separator and no trailing
newline. The device requires at least 100 rolls, because 99 rolls of a fair die
give 255.911 bits, short of 256. The published worked example
([docs/ENTROPY.md](../docs/ENTROPY.md)) was rechecked for this summary:

```console
$ printf '%s' '1234561234561234561234561234561234561234561234561234561234561234561234561234561234561234561234561234' | shasum -a 256
e56403e8522ddeae1b44a1e8148b1ba4d3b4c626ccf20980056eedcc7e0c0f35  -
```

Signatures are deterministic: RFC 6979 for ECDSA, and BIP-340 with `aux_rand`
fixed to 32 zero bytes. Anyone holding the seed can recompute every signature
byte for byte. The cost is the fault-injection resistance that random
`aux_rand` would add, and the threat model states that trade.

### A draft signer profile, and a kit to check any signer against it

[`spec/signer-profile.md`](../spec/signer-profile.md) is a draft specification
(version 0.1) for air-gapped signers. It is a proposal. Nobody has adopted it,
including nullroute, which fails parts of it. It has 62 requirements in seven
areas: entropy, pre-signing review, signing, attestation, hardware, transport
and dependencies. No requirement names a board, panel or vendor. Each one names
its check: a vector file, a nullroute invariant, a manual procedure, or
UNTESTABLE with the reason.

[`conformance/`](../conformance/README.md) turns the testable part into
something a second implementation can run:

- **Vectors.** Eleven JSON files, 107 cases, in
  [`spec/vectors/signer-profile/`](../spec/vectors/signer-profile/SHA256SUMS),
  pinned by a `SHA256SUMS` file that coreutils can check.
- **Expected values from outside nullroute.** Bitcoin Core 31.1 on regtest, the
  BIP texts, `printf | sha256sum`, and Coinkite's reference BBQr code plus a real
  Coldcard scan. None was produced by running nullroute.
- **A runner.** [`conformance/run.mjs`](../conformance/run.mjs) uses Node
  built-ins only. The signer under test is reached through a small adapter
  module that reports what the signer did; the runner does every comparison and
  parses signed PSBTs, BBQr frames and QR symbols itself.
- **Known failures that expire.** A listed failure that starts passing fails
  the run, so the list cannot outlive a fix.

Another project's signer, written in another language for other hardware, can
claim conformance by passing the vectors. The vectors are JSON and can be read
from any language. The reference runner expects a JavaScript adapter, so a
signer written in something else needs a thin bridge, for example a
subprocess call. Nobody has written a second adapter yet.

## What is done and verified

"Verified" here means a named check passed. It does not mean observed on the
Raspberry Pi, and it does not mean reviewed by anyone but the author.

| Claim | How it is checked | Source of the expected result |
| --- | --- | --- |
| Code, specs and tests agree | `make verify` (run for this summary; output above) | The specs in `packages/*/src/**/*.spec.yaml` |
| BIP-32, BIP-39, BIP-84, BIP-86, BIP-380 checksums | `make test-vectors`; `make verify` checks the pins | Vectors from the BIPs, vendored in [`spec/vectors/`](../spec/vectors/bip32.json) (BIP-32 vectors 1 to 4, all 24 English BIP-39 vectors, the BIP-84 and BIP-86 addresses, all 8 BIP-380 checksums) |
| Derivation, addresses and signatures agree with a second implementation | `make test-differential` | `bitcoinjs-lib` |
| Signatures are deterministic | `make test-repro` signs one PSBT 100 times | Byte comparison against libsecp256k1 |
| The signer profile's testable requirements | `make conformance` (run for this summary): 104 cases pass, 3 are known failures, 1 SHOULD is missed | Bitcoin Core 31.1 regtest, BIP texts, coreutils, Coinkite's BBQr code |
| A wallet can be recovered and spent without nullroute | `make test-recovery-drill` (INV-INTEROP-1) | Bitcoin Core on regtest |
| The manifest root is recomputable | The three commands above | coreutils (`shasum` on macOS) |
| Dice to seed | INV-DICE-1 to INV-DICE-8, and `dice-to-entropy.json` | `printf \| sha256sum`; BIP-39 checked against the Trezor vectors |
| The card image boots, and a modified copy does not | `make image` then `make image-boot-test`, under QEMU (run for this summary: the card booted and started the signing daemon; the copy with one byte flipped reported a corrupted verity block and was rejected) | The kernel's dm-verity mapping in the booted guest, judged on the host from the console log. The kiosk browser needs a display and is not judged, and Raspberry Pi firmware is not exercised |

**The recovery drill** was run for this summary against Bitcoin Core 31.1.0 on
regtest. It recovered and spent six wallet kinds with Core alone: p2wpkh,
p2sh-p2wpkh, p2pkh, p2tr, a 2-of-3 `wsh(sortedmulti)` and a 2-of-3 taproot
quorum. Core derived the addresses, built each spend, finalised and broadcast
it. nullroute contributed only signatures. CI runs the same drill against Core
28.0, downloaded from bitcoincore.org and checked against a pinned SHA-256.

The review rules checked by vectors include: change only when re-derived from
the device's own seed or a registered quorum; the fee computed as inputs minus
outputs, never read from the PSBT; any sighash other than `ALL` or `DEFAULT`
blocks signing; and a segwit v0 input without the transaction it spends blocks
signing until the user overrides, because its amount could be understated
(INV-PSBT-17; BIP-174 describes the attack).

## What remains unverified or known to fail

### Known failures in the conformance run

Every entry in
[`conformance/known-failures/nullroute.json`](../conformance/known-failures/nullroute.json):

| Requirement | Case | Reason |
| --- | --- | --- |
| SP-TX-5 | `two-transfers-disjoint-indices` | The QR collector compares total, file type and encoding only, so two transfers with disjoint frame indices are joined into one payload (gap N5). BBQr has no whole-payload checksum to tell them apart |
| SP-TX-6 | `write-1in20out` | The QR encoder writes byte mode only; BBQr says frames MUST use alphanumeric mode (gap G2) |
| SP-TX-6 | `write-1in2out` | The same |

One SHOULD is also missed: an output carrying a false taproot derivation claim
is shown as a payment, as required, but the review does not say the
transaction claimed it (SP-REV-7). The same claim made through
`PSBT_OUT_BIP32_DERIVATION` is reported.

### Not met in the profile's own tables

- **The lockfile is outside the manifest (SP-ATT-5).** `package-lock.json` and
  the root `package.json` are not under `packages spec provisioning`, so a
  changed dependency does not move the number on the lock screen. Only the
  image checksum covers them. Whether to add them is the owner's decision
  ([handoff-C, open question 2](handoff-C.md#open-questions-for-the-owner)).
- **BBQr byte mode against alphanumeric (SP-TX-6)**, above. The profile keeps
  BBQr's requirement rather than writing nullroute's behaviour into it.
- **UR is not supported**, read or write. SeedSigner writes PSBTs only as UR and
  Jade reads and writes only UR, so a user pairing nullroute with either has no
  shared animated QR format. Adding UR means new parsing surface and possibly a
  new dependency, and the decision is pending with the owner
  ([handoff-A, open question 2](handoff-A.md#open-questions-for-the-owner)).

### Open items from workstreams C and D

| Item | State |
| --- | --- |
| SP-TX-5 cannot be fully met from BBQr frames alone | Needs a decision: validate the assembled payload, require a digest BBQr has no field for, or weaken the requirement |
| BIP-322 variant prefix | Closed. BIP-322 1.0.0 says signers MUST prefix the signature with its variant (`smp`). nullroute now writes it and reproduces the published p2wpkh vector byte for byte, prefix included, against `bip-0322/basic-test-vectors.json` pinned in `spec/vectors/` |
| The override path | Every vector signs with `override: false`. No case checks that a blocked transaction signs only with the override and that it does not persist (SP-REV-22) |
| Locktime when every input is final | The review still says the transaction cannot confirm before the locktime, which is not enforced in that case. The profile does not say what to show |
| PSBT version 2 | Referenced by two specs, fed by no test. The profile requires version 0 only |
| Published BIP vectors not included | No BIP-174 PSBT vectors, no invalid-input vectors for BIP-32 or BIP-380, no descriptor-to-script vectors for BIP-381 to 387, no BIP-340, 341 or 143 signing vectors ([handoff-D, SP-DEP-1 table](handoff-D.md#bip-vectors-for-sp-dep-1)) |
| Portable vectors for SP-REV-1 and SP-SIG-1 | Checked by nullroute's own tests only |
| The adapter repeats two pieces of UI logic | `bbqrPayload` in `QrDisplay.tsx` and `maySign` in `PsbtScreen.tsx`, so a UI change the adapter does not follow would go unnoticed |
| Tools not run | GNU coreutils and a glibc locale were not run for the manifest vectors; only macOS tools and ICU |

Closed since those handoffs, each by a commit on `main`: segwit v0 input amounts
(SP-REV-3, `8b9272b`), the daemon's start-up refusal and its tests (SP-ATT-6,
`d20a918`), unknown PSBT input pairs dropped at signing (SP-REV-11, `e2cd5d6`),
replaceability computed over every input instead of any (SP-REV-9, `e2cd5d6`),
and the multi-frame PSBT sent as base64 text instead of binary (G1, `a0ed400`).

### Open items from workstream A

- The reason given for reading BBQr encoding `Z` says Coldcard writes it by
  default; Coldcard's current source writes base32 (G5,
  `packages/core/src/qr/bbqr.spec.yaml` line 38). The behaviour is right and the
  stated reason is not.
- `docs/AIR-GAP.md` and `docs/PROVISIONING.md` are cited from source comments
  and do not exist (G8).
- Build comments in the `Makefile` and CI still name a Raspberry Pi 5 target;
  the only supported board is the Pi 4 (G9).
- `docs/ENTROPY.md` says the dice rule is compatible with Coldcard without
  naming the dice-only path; Coldcard's mixing path hashes differently.
- A 100-roll nullroute seed cannot be re-entered on SeedSigner, which takes
  exactly 99, and a 99-roll seed from Coldcard, SeedSigner or Krux cannot be
  reproduced on nullroute.
- No coordinator has been run against nullroute's QR output. G1 is fixed in
  code and checked against Coinkite's reference joiner, not against a
  coordinator's camera.

### Waiting on hardware bring-up

Everything below exists as code or as a build-time check, and none of it has
run on a Raspberry Pi.

- The firmware path from power-on to the kernel, which is built and on the card.
- The DSI panel and its touch controller (SP-HW-1, SP-HW-4). The build refuses
  to finish unless the merged device tree enables both.
- The camera. Nothing in `provisioning/` names a camera driver, so whether the
  kiosk browser can reach a Pi Camera Module 3 is open (SP-HW-5).
- Layout on the real panel: full addresses (SP-REV-5, SP-HW-2) and the
  read-to-the-end gate before Sign (SP-REV-21) are measured at 800x480 in a
  headless browser only.
- The lock screen as the first screen that accepts input (SP-ATT-1), checked in
  unit tests only, and the dm-verity root read from the live mapping
  (SP-ATT-10), checked in unit tests with the mapping itself exercised under
  QEMU.
- Network interfaces on the running device (SP-HW-6). Radio drivers and
  firmware are removed from the image; the radio chip is still on the board.
- Argon2id cost on the board: the spec states roughly half a second per guess on
  a Pi 4 (SP-HW-10).

### Out of scope by design, and not built

No secure element: someone holding the SD card is limited by the passphrase and
Argon2id at 64 MiB and three passes. No signed boot chain (tier 2): an attacker
who rewrites the boot partition controls the numbers the device shows. No
signing key and no published image (tier 0 signing and publishing are planned).
Duress features are planned and not built, and the threat model says they would
buy time against an unsophisticated adversary and nothing more. Image
reproducibility depends on the live Debian mirror, not a pinned snapshot. The
full list is in [docs/THREAT-MODEL.md](../docs/THREAT-MODEL.md#out-of-scope).

### Documents that disagreed with the code

Writing this summary found four, all corrected in the commit that added it:
the SD card transport described as available in the README and the threat
model, two stale rows in `spec/signer-profile.md`, the failure count in
`conformance/README.md`, and INV-PSBT-1, which was named in the threat model
and three specs and declared nowhere. It is now declared, with a test that a
transaction mixing an owned and a foreign input is signed only where it is
owned.

## What needs people rather than code

| Need | Why code cannot supply it |
| --- | --- |
| Outside cryptographic and code review | `make verify` proves the code matches its specs. Whether the specs describe a secure design is a human judgement, and so far only the author has made it |
| A second, independent implementation of the profile | Vectors catch a shared mistake only where the expected value came from outside both implementations. A second signer, on other hardware and in another language, is the test of whether the profile is implementable as written |
| Discussion on bitcoin-dev and Delving Bitcoin | The profile takes positions others may reject: 100 rolls where three products accept 99, BBQr's alphanumeric mode, a blocking rule for segwit v0 inputs, no UR. Those need argument from people who build signers and coordinators |
| Coordinator authors testing interoperability | No coordinator has read nullroute's multi-frame QR output, and the conformance kit stands in for coordinators with Coinkite's reference code and one Coldcard scan |
| Hardware bring-up | Someone with the board, the panel and the camera has to boot the card, then record what the panel, touch, camera and network interfaces actually do |

## Sources

| Document | What it gives this summary |
| --- | --- |
| [research/00-current-state.md](00-current-state.md) | The comparison with five signers and the published documents, with URLs |
| [research/handoff-A.md](handoff-A.md), [handoff-C.md](handoff-C.md), [handoff-D.md](handoff-D.md) | Decisions, findings and open questions from the earlier workstreams |
| [spec/signer-profile.md](../spec/signer-profile.md) | The draft profile and nullroute's conformance tables |
| [conformance/README.md](../conformance/README.md) | How to run the vectors against any signer |
| [docs/VERIFICATION.md](../docs/VERIFICATION.md) | The manifest recipe, the verification report and the recovery procedure |
| [docs/THREAT-MODEL.md](../docs/THREAT-MODEL.md) | What the device defends against, and the out-of-scope list |
