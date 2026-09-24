# Current state: transport, entropy, review and attestation

Workstream A. What nullroute does today, what five comparable projects do, and
where each difference sits against a published document. It is the input to a
candidate open specification for air-gapped signers, so every statement below
is either quoted from this repository with a file and line, or quoted from an
external primary source with its URL. Anything that could not be fetched or
confirmed is marked **UNVERIFIED** where the claim is made.

Snapshot: this worktree at `bbefa40` (24 September 2026). External sources were
fetched the same day. Commit hashes for the external repositories are recorded
in `research/handoff-A.md`.

Words used carefully:

- **Draft specification** or **proposal** for anything not yet adopted. None of
  the external documents below is called a standard here, including the ones
  that call themselves one. Blockchain Commons says of its own papers that they
  "are _not_ standards" (see section 4.1).
- **Deployed** is used only where the source says so, for example BIP status
  fields or the BBQr README.

---

## 1. QR transport as implemented

### 1.1 Summary

| Aspect | What nullroute does | Where |
| --- | --- | --- |
| Symbol encoding | ISO/IEC 18004 QR, written in this repository, **byte mode only** | `packages/core/src/qr/encode.spec.yaml:22-25`, `packages/core/src/qr/encode.ts:184` |
| Error correction | Level M | `packages/core/src/qr/bbqr.ts:113-114`, `packages/ui/src/components/QrDisplay.tsx:52` |
| Single-frame density cap | Version 12 | `packages/core/src/qr/bbqr.ts:113`, `packages/ui/src/components/QrDisplay.tsx:52` |
| Multi-frame framing | BBQr, 8 character header, written with encoding `2` (base32) only | `packages/core/src/qr/bbqr.spec.yaml:22-41` |
| Multi-frame read | BBQr with encoding `2`, `H` or `Z` | `packages/core/src/qr/bbqr.ts:219-222` |
| UR (Blockchain Commons) | Not implemented, read or write | no match for `ur:`, `crypto-psbt` or `bytewords` in `packages/`, `docs/` or `spec/` |
| Fountain codes | None (BBQr has none) | not applicable |
| Single frame | Bare payload, no header | `packages/ui/src/ui.spec.yaml:291-298` (INV-UI-22) |
| PSBT payload | Base64 text (see 1.4 for the multi-frame case) | `packages/core/src/psbt/parse.ts:79-82`, `packages/daemon/src/ipc/methods/psbt.ts:178` |
| Descriptor payload | Plain descriptor text with BIP-380 checksum, or a nullroute JSON bundle for a quorum | `packages/ui/src/screens/WalletScreen.tsx:537`, `packages/core/src/descriptor/coordinator.ts:408-439` |
| Decoder (camera) | `zxing-wasm`, served from the device's own origin | `docs/USING.md:806-821`, INV-UI-23 at `packages/ui/src/ui.spec.yaml:300-307` |

### 1.2 The symbol encoder

The encoder is in-tree so that it is covered by `MANIFEST.lock`
(`packages/core/src/qr/encode.spec.yaml:7-11`). It writes byte mode only:

> "Byte mode only. Everything this device emits is base64, hex or a descriptor,
> and alphanumeric mode would save a little room on the descriptor case at the
> price of a second encoder path and a second set of bugs."
> (`packages/core/src/qr/encode.spec.yaml:22-25`)

The mode indicator is hard-coded at `packages/core/src/qr/encode.ts:184`
(`bits.push(0b0100, 4) // byte mode`). INV-QR-1 checks every one of the 160
version and level combinations against zxing as an independent decoder
(`packages/core/src/qr/encode.spec.yaml:51-59`, `:84-97`).

### 1.3 Framing: BBQr

The spec states the header and the split rule:

> "Every part is an eight character header then a payload. `B$`, one character
> of encoding, one of file type, two of base36 for the total and two for this
> part's index. Two base36 characters cap a transfer at 1295 parts, which is the
> format's limit rather than this implementation's."
> (`packages/core/src/qr/bbqr.spec.yaml:22-26`)

> "Written parts are always `2`, base32. Writing `Z` would put a compressor in
> the signing path and a few extra frames is the cheaper price. Read parts may
> be `2`, `H` or `Z`, because Coldcard writes `Z` by default ..."
> (`packages/core/src/qr/bbqr.spec.yaml:36-41`)

Implementation facts:

- File type letters written and read: `P` PSBT, `T` transaction, `J` JSON, `C`
  CBOR, `U` unicode, `B` binary (`packages/core/src/qr/bbqr.ts:77-84`). `X`
  (executable, in the BBQr document) is not in the table and is refused at
  `packages/core/src/qr/bbqr.ts:224-228`.
- The split is on decoded bytes in whole five-byte base32 groups, so each part
  decodes on its own (INV-QR-3, `packages/core/src/qr/bbqr.spec.yaml:57-64`;
  code at `packages/core/src/qr/bbqr.ts:142-176`).
- Every part except the last carries the same number of bytes: one `perPart`
  value is computed once and used for every slice
  (`packages/core/src/qr/bbqr.ts:167-174`).
- Index is zero-based, total counts from one, maximum 1295 parts
  (`packages/core/src/qr/bbqr.ts:53-68`).
- `Z` is inflated as raw deflate through the platform `DecompressionStream`
  (`packages/core/src/qr/bbqr.ts:378`).
- Part size: version 12 at level M by default (`packages/core/src/qr/bbqr.ts:105-114`).
- Frame interval on the display: 400 ms (`packages/ui/src/components/QrDisplay.tsx:37-38`).

Multi-part collection (INV-QR-2, INV-QR-4 at
`packages/core/src/qr/bbqr.spec.yaml:47-74`): parts may arrive in any order and
repeatedly; the collector refuses a part whose total, file type or encoding
differs from the ones already held, and refuses the same index arriving with
different contents (`packages/core/src/qr/bbqr.ts:250-285`). The scanner resets
and reports when either refusal fires (`packages/ui/src/screens/ScanScreen.tsx:173-185`).

Any decoded string that is not a BBQr part is returned as plain text at once
(`packages/ui/src/screens/ScanScreen.tsx:149-171`), so a bare base64 PSBT, a
descriptor or an address in one frame needs no wrapper.

### 1.4 Payload types, and one encoding asymmetry

**PSBT, outbound.** The daemon returns the signed PSBT as base64
(`packages/daemon/src/ipc/methods/psbt.ts:178`, `encodePsbt` at
`packages/core/src/psbt/parse.ts:79-82`). The display is handed that string with
`fileType="psbt"` (`packages/ui/src/screens/PsbtScreen.tsx:515`). If it fits a
version 12 level M code it is shown bare. If not, the display does this:

```ts
const bytes = new TextEncoder().encode(text)
return splitBbqr(bytes, fileType).map((part) => encodeQrText(part.text, { level: 'M' }))
```

(`packages/ui/src/components/QrDisplay.tsx:55-56`)

So a multi-frame PSBT leaves the device as BBQr type `P` whose payload bytes are
**the ASCII of the base64 string**, not the binary PSBT.

**PSBT, inbound.** A completed BBQr transfer on the PSBT path is treated as
binary and base64-encoded before review:

```ts
: stage.forStage === 'psbt'
  ? toBase64(result.data)
```

(`packages/ui/src/App.tsx:2013-2017`)

The two directions therefore disagree about what a `P` payload contains. The
BBQr document defines `P` as "PSBT file" (section 4.1), and BIP-174 defines the
file form as binary (section 4.1). The inbound path matches that reading; the
outbound path does not. The repository's own round-trip test encodes and decodes
the same text through `splitBbqr` and `joinBbqr` and so cannot see the
difference (`packages/ui/test/qr-display.test.tsx:101-126`). No BBQr test in the
repository uses a vector produced by another implementation; the compressed
read test builds its own input with `CompressionStream`
(`packages/core/test/qr.bbqr.test.ts:231-252`). Whether a given coordinator
accepts the outbound form is **UNVERIFIED**: no coordinator was run for this
document. This is listed as gap G1 in section 5.

**Transaction, outbound.** A finalised transaction is offered alongside the PSBT
(INV-UI-36, `packages/ui/src/ui.spec.yaml:455-459`). Its QR file type was not
traced for this document.

**Descriptors, outbound.** A single-signature descriptor is shown as plain text,
file type `U` if it needs splitting
(`packages/ui/src/screens/WalletScreen.tsx:537`). A registered quorum exports a
JSON bundle, file type `J` (`packages/ui/src/screens/MultisigScreen.tsx:222`),
in a format this project defines:

```ts
format: 'nullroute-descriptor-bundle',
version: 1,
...
descriptors: options.descriptors.map((entry) => ({
  desc: entry.descriptor, internal: entry.change, active: true, timestamp: 'now', range: [0, 999],
```

(`packages/core/src/descriptor/coordinator.ts:408-421`)

The inner objects use Bitcoin Core `importdescriptors` field names; the wrapper
is nullroute's own.

**Descriptors, inbound.** Format is detected from content. Accepted: a bare
descriptor, Sparrow or Specter JSON, a Bitcoin Core `importdescriptors` array, a
BIP-129 BSMS file and a Coldcard multisig setup file (INV-COORD-1,
`packages/core/src/descriptor/coordinator.spec.yaml:18-48`). Every path ends in
the project's strict parser with a recomputed BIP-380 checksum, and a checksum
mismatch is refused (INV-COORD-3, `:62-69`).

### 1.5 Stated reasons, as the repository gives them

- BBQr was chosen as "the convention the Bitcoin air-gap ecosystem already
  settled on" (`packages/core/src/qr/bbqr.ts:6-11`).
- Compression is read but never written, to keep a compressor out of the path
  that produces signed transactions (`packages/core/src/qr/bbqr.spec.yaml:108-110`).
- Version 12 cap: "A version 40 code is 177 modules across, which on an 800x480
  panel leaves under two physical pixels per module"
  (`packages/core/src/qr/bbqr.spec.yaml:102-106`).
- No printed checksum under outbound codes, on purpose (`docs/USING.md:829-834`).

---

## 2. Entropy, review and attestation, as specified

### 2.1 Dice entropy derivation (Mode A)

Spec `core.entropy.dice`, assurance tier critical:

> "Each roll is one ASCII digit, 0x31 through 0x36. Rolls are concatenated in
> entry order with no separators and no trailing newline, giving exactly N bytes
> for N rolls. The entropy is SHA-256 of those bytes.
>
> entropy = SHA-256( ascii(roll_1) || ... || ascii(roll_N) )
>
> Those 32 bytes are then standard BIP-39 entropy for a 24-word mnemonic, with no
> nullroute-specific behaviour anywhere in the conversion."
> (`packages/core/src/entropy/dice.spec.yaml:34-42`)

Input constraint: "at least 100 ASCII digits in 1..6, no separators, no
whitespace, no trailing newline" (`packages/core/src/entropy/dice.spec.yaml:27`).
The implementation is `diceToEntropy` at `packages/core/src/entropy/dice.ts:226-239`,
using `sha256` from `@noble/hashes` (`:15`).

| Invariant | Statement (abridged from the spec) | Line |
| --- | --- | --- |
| INV-DICE-1 | Refuses fewer than 100 rolls; 99 rolls is 255.911 bits | `dice.spec.yaml:56-62` |
| INV-DICE-2 | Input strictly canonical: whitespace, separators, trailing newline, any character outside 1..6 rejected, not normalised | `:64-70` |
| INV-DICE-3 | Encoding matches the worked example in `docs/ENTROPY.md` | `:72-77` |
| INV-DICE-4 | Output exactly 32 bytes | `:79-82` |
| INV-DICE-5 | Live accounting truncates rather than rounds | `:84-89` |
| INV-DICE-6 | Pattern warnings never reject | `:91-98` |
| INV-DICE-7 | Deterministic | `:100-103` |
| INV-DICE-8 | Any single changed roll changes the output | `:105-108` |

The published worked example: 100 rolls of `123456` repeated hash to
`e56403e8522ddeae1b44a1e8148b1ba4d3b4c626ccf20980056eedcc7e0c0f35`
(`docs/ENTROPY.md:131-157`). The minimum count is argued at
`docs/ENTROPY.md:59-84`.

Related modes, from `docs/ENTROPY.md:33-52` and the specs:

- **Mode A'** (the device rolls): rejection sampling on bytes at or above 252,
  then the same hash (INV-ENTMODE-1,
  `packages/daemon/src/entropy/modes.spec.yaml:23-29`, `:57-64`). The screen
  states that the device chose the rolls.
- **Mode B** (dice plus machine sources): HKDF-SHA-256 with salt
  `nullroute/entropy/v1` and info `seed` over length-prefixed, canonically
  ordered sources (`packages/core/src/entropy/combine.spec.yaml:34-51`,
  INV-ENT-1 to INV-ENT-3 at `:53-69`).
- **Mode C** (machine only): refused without `acknowledged: true` and unless
  every health gate reports ok (INV-ENTMODE-2,
  `packages/daemon/src/entropy/modes.spec.yaml:31-33`, `:66-74`).

What the device shows: the rolls, in order, with the statement that this exact
string with no trailing newline is what is hashed (INV-UI-9,
`packages/ui/src/ui.spec.yaml:148-153`; copy at
`packages/ui/src/screens/DiceScreen.tsx:243-246`). The device does not display
the 32-byte digest; the user compares the mnemonic.

`docs/ENTROPY.md:128-129` states: "This choice is also compatible with how
Coldcard derives seeds from dice". See section 4 for what Coldcard's own
documentation says.

### 2.2 Review screen requirements

The requirement is split over three specs: core decides what the review may
say, the daemon decides ownership, the UI decides what is shown and when Sign
is live.

**Core, `core.psbt.review`** (`packages/core/src/psbt/review.spec.yaml`):

| Id | Requirement | Line |
| --- | --- | --- |
| INV-PSBT-2 | "An output is labelled change only when its address re-derives from a registered descriptor. An attacker's address placed in the change position is shown as a payment." | `:44-51` |
| INV-PSBT-3 | "Any sighash flag other than SIGHASH_ALL or SIGHASH_DEFAULT blocks signing, including every ANYONECANPAY variant and any mixed set across inputs." | `:53-59` |
| INV-PSBT-4 | Fee is inputs minus outputs, never read from the PSBT; overspend refused | `:61-67` |
| INV-PSBT-5 | A PSBT with no input amount is refused, not reviewed with a guessed fee | `:69-74` |
| INV-PSBT-6 | Sighash described by what the signature does not commit to | `:76-81` |
| INV-PSBT-7 | Replaceability and timelocks surfaced in human terms | `:83-87` |
| INV-PSBT-15 | Unmodelled key-value pairs reported and preserved, never blocking | `:89-96` |
| INV-PSBT-8 | Integer amounts throughout | `:98-103` |

The algorithm text: "An output is `change` only when that function returns a
path. Nothing else, including position, amount or any derivation hint carried
in the PSBT, can earn the change label." (`review.spec.yaml:29-32`)

**Daemon, `daemon.psbt`** (`packages/daemon/src/psbt.spec.yaml`):

| Id | Requirement | Line |
| --- | --- | --- |
| INV-PSBT-12 | Change identified by re-derivation from the seed; no PSBT field is consulted | `:34-41` |
| INV-PSBT-13 | A receive address of this wallet as an output is a payment, not change | `:43-48` |
| INV-PSBT-16 | Registered quorum addresses count as the wallet's own | `:50-61` |
| INV-PSBT-14 | Signing paths come from the inputs' own scripts; no owned input, no signature | `:63-70` |

Stated bound: the ownership index covers four script types, two branches and a
gap limit of one hundred each (`psbt.spec.yaml:85-89`); change beyond the limit
is shown as a payment (`:77-83`).

**Signing, `core.psbt.sign`**: INV-SIG-3, "Signing refuses any transaction whose
review is not signable. The refusal can only be lifted by an explicit per-call
override that is never stored." (`packages/core/src/psbt/sign.spec.yaml:70-76`)

**UI, `ui.screens.lock`** (`packages/ui/src/ui.spec.yaml`):

| Id | Requirement | Line |
| --- | --- | --- |
| INV-UI-11 | Reviewing never signs; signing is a separate action available only after a review rendered | `:165-172` |
| INV-UI-103 | "Signing is refused until the review has been read to its end, and the panel the transaction was pasted into does not count as having read it. Reading latches ..." | `:174-183` |
| INV-UI-12 | Change is presented only together with the re-derived path; every other output is money leaving; a claimed-but-unverified output says so | `:185-194` |
| INV-UI-13 | A blocking warning disables signing; only an explicit per-signature override, not remembered | `:196-203` |
| INV-UI-14 | No owned input, no signing, and the screen says so | `:205-214` |
| INV-UI-62 | The blocking reason is stated beside the button | `:760-770` |
| INV-UI-63 | After signing, where the transaction goes next is stated | `:772-779` |

Multisig progress (who has signed, whether this signature is the last) is in
`packages/core/src/psbt/quorum.spec.yaml` (INV-QUORUM-1 to INV-QUORUM-8) and
INV-UI-36, INV-UI-37 (`packages/ui/src/ui.spec.yaml:455-470`).

### 2.3 Attestation display

**What the daemon enforces at start** (`daemon.ipc.socket`):

> "At startup the verification report must exist, must record passed, must
> contain no failed check, and must record a manifest root hash equal to SHA-256
> of the MANIFEST.lock on disk. Any of the four failing aborts startup."
> (`packages/daemon/src/daemon.spec.yaml:43-45`)

- INV-IPC-3: "The attestation method serves the manifest root hash to the lock
  screen." (`packages/daemon/src/daemon.spec.yaml:84-87`)
- INV-BOOT-1: "The device reports the dm-verity root hash of the mapping it is
  running on, read from the live device-mapper table rather than from the boot
  partition, and reports nothing at all where there is no mapping."
  (`packages/daemon/src/daemon.spec.yaml:137-145`)
- The spec's own bound: "Neither answer defends against an attacker who rewrote
  the boot partition ... only a signed boot chain closes that, and it is tier 2."
  (`packages/daemon/src/daemon.spec.yaml:187-193`)

**What the lock screen shows** (`ui.screens.lock`, algorithm at
`packages/ui/src/ui.spec.yaml:71-82`): the manifest root hash, verification
status with spec and invariant counts, the build tier, and the wallet
fingerprint where a wallet exists. Hashes are chunked in fours and abbreviated
to first eight and last eight, expanding on tap.

| Id | Requirement | Line |
| --- | --- | --- |
| INV-UI-1 | Manifest root hash displayed before unlock | `:85-89` |
| INV-UI-2 | Failed verification disables unlock; never warns and proceeds | `:91-96` |
| INV-UI-4 | Wallet fingerprint shown before unlock | `:106-111` |
| INV-UI-5 | The screen states its values are reported by the software being looked at | `:113-118` |
| INV-UI-6 | Hash chunking and abbreviation | `:120-131` |
| INV-UI-64 | The shell reads the attestation before rendering anything | `:787-795` |
| INV-UI-69 | Root and every check reachable after unlock, same caveat word for word, and the command to check independently | `:833-841` |
| INV-UI-70 | That screen fails closed | `:843-850` |
| INV-UI-72 | The attestation after unlock is the one the lock screen showed | `:860-865` |

The caveat as rendered: "Reported by the software you are looking at, so it
catches an accident or a crude substitution and not an attacker who replaced
the code that draws it. Compare the hash against the published release."
(`packages/ui/src/screens/LockScreen.tsx:224-228`). The verity hash, where
present, is shown beside it; where absent the screen says "No dm-verity
mapping. This system partition is not checked as it is read."
(`packages/ui/src/screens/LockScreen.tsx:261-273`).

How a user checks the number: the root hash is `sha256sum MANIFEST.lock` over a
`LC_ALL=C` sorted `sha256sum` listing (`docs/VERIFICATION.md`, section "1. The
manifest and the root hash"). The threat model records that no release hash has
been published yet (`docs/THREAT-MODEL.md:74`).

Not built: an anti-phishing phrase at unlock is "planned and does not exist"
(`docs/THREAT-MODEL.md:140-152`).

---

## 3. Assumptions about a specific board or panel

The target in every current profile is one board and one panel, and the
repository says so directly: "Raspberry Pi 4 (4GB) | The only board this image
supports, and the only device tree on the card."
(`docs/VERIFICATION.md:360`, `README.md:106`). First boot on that board with
that panel is the next milestone (`README.md:180`).

Classification used below:

- **Hardware**: the artifact cannot work on another board or panel without a
  change to this file.
- **Tuning**: a number chosen for this hardware; another board works but the
  number should be re-measured.
- **Incidental**: prose that names the hardware; nothing depends on it.
- **Stale**: contradicts the current profile.

### 3.1 Provisioning and build

| File | Assumption | Class |
| --- | --- | --- |
| `provisioning/profiles/os-signer.yaml:11-25` | `boards:` lists only `raspberrypi-4`; comments record why Pi 5 and CM5 were removed (Debian trixie kernel device trees) | Hardware |
| `provisioning/profiles/os-signer.yaml:491-563` | INV-PROV-25, INV-PROV-26: config.txt names the overlay for the official Raspberry Pi 7 inch DSI touchscreen, and the overlay is on the card | Hardware (panel) |
| `provisioning/profiles/os-signer.yaml:589-615` | Boot file list: `bcm2711-rpi-4-b.dtb`, Pi 4 GPU firmware, `overlays/nullroute-7inch-dsi.dtbo` | Hardware |
| `provisioning/profiles/os-verity.yaml:18-26` | Same board restriction for the verity profile | Hardware |
| `provisioning/build/build-system.sh:326-382` | Copies `bcm2711-rpi-4-b.dtb`; merges the panel overlay into it with `fdtoverlay` and refuses to build unless `dsi@7e700000` is okay and `edt,edt-ft5406` is present | Hardware |
| `provisioning/build/build-system.sh:401-414` | config.txt: `arm_64bit=1`, `kernel=kernel8.img`, `dtoverlay=nullroute-7inch-dsi` | Hardware |
| `provisioning/build/build-system.sh:725-733` | genimage boot partition names the Pi 4 tree and the panel overlay | Hardware |
| `provisioning/build/overlays/nullroute-7inch-dsi.dts:42-48` | "PI 4 ONLY, and not by choice"; `compatible = "brcm,bcm2711"` | Hardware (board and panel) |
| `provisioning/build/overlays/nullroute-7inch-dsi.dts:71-92` | Panel `raspberrypi,7inch-touchscreen-panel`, touch controller FT5406 at 0x38 | Hardware (panel) |
| `provisioning/checks/rootfs.mjs:869-934` | Verifier asserts the overlay for "the official 7 inch DSI touchscreen" | Hardware (panel) |
| `provisioning/checks/image.mjs:957-1034` | Verifier checks `dtoverlay=` targets exist on the boot partition | Generic mechanism; the only overlay it sees is the panel's |
| `provisioning/build/initramfs/init:77-87`, `provisioning/build/build-initramfs.sh:53-55` | Loads `sdhci-iproc` (Pi 4 and 5 SD host) and `bcm2835` (older host) plus virtio for QEMU | Hardware, already multi-board |
| `provisioning/build/boot-test.sh:82` | QEMU `-M virt -cpu cortex-a72` (the Pi 4's core type) | Test harness only |
| `provisioning/units/nullroute-kiosk.service:113` | Chromium `--window-size=800,480` | Hardware (panel resolution) |
| `provisioning/units/nullrouted.service:119` and `provisioning/HARDENING.md:62` | `DeviceAllow=/dev/hwrng r` | Linux interface, present on several boards; not model specific |
| `provisioning/backends/rpi-image-gen/nullroute-signer.yaml:14-16` | `layer: rpi5`, with the comment "The 5 and the CM5 share this. A 4 build changes this line" | **Stale**: advisory backend, `status: planned`, never run (`:3-6`), contradicts `boards: [raspberrypi-4]` |
| `Makefile:358` | "The target is a Raspberry Pi 5" (reason for arm64 container) | **Stale** comment; arm64 is still correct for a Pi 4 |
| `.github/workflows/ci.yml:389` | "the target is a Raspberry Pi 5" | **Stale** comment, same |
| `tools/checks/check-profiles.mjs:272-376` | Maps board names to SoCs and device trees; ties the BCM2711 wording in `docs/ENTROPY.md` to the board list | Consistency check; generic by design |

### 3.2 Device code (`packages/`)

| File | Assumption | Class |
| --- | --- | --- |
| `packages/ui/index.html:5`, `packages/ui/src/styles.css:6` | "The device is a fixed 800x480 panel. No zoom, no scaling." | Hardware (resolution) |
| `packages/ui/src/ui.spec.yaml:1124` | Application is 800x480 whatever it is rendered in | Hardware (resolution), spec level |
| `packages/core/src/qr/bbqr.ts:105-113`, `packages/core/src/qr/bbqr.spec.yaml:102-106` | Version 12 default derived from "an 800x480 panel" | Tuning |
| `packages/core/src/qr/encode.spec.yaml:109-111`, `packages/ui/src/components/QrDisplay.tsx:5` | "on a 7 inch panel" | Incidental (reasoning) |
| `packages/daemon/src/store/envelope.ts:62`, `packages/daemon/src/store/store.spec.yaml:196`, `packages/daemon/src/store/store.ts:183` | Argon2id 64 MiB, three passes, "roughly half a second per guess on a Pi 4" | Tuning |
| `packages/daemon/src/psbt.spec.yaml:85-89` | Index build "takes long enough to notice on a Pi" | Incidental |
| `packages/core/src/psbt/parse.spec.yaml:83` | Size limits motivated by memory "on a Raspberry Pi" | Tuning |
| `packages/daemon/src/entropy/health.ts:38-45`, `health.spec.yaml:56` | Reads `/dev/hwrng` | Linux interface, not model specific |
| `packages/core/src/entropy/combine.spec.yaml:11` | "a user who does not trust the Pi hardware RNG" | Incidental |
| `packages/ui/src/screens/ScanScreen.tsx:62-69` | Camera via `getUserMedia`, 1280x720 ideal, any camera | Generic; see 3.4 |
| Many UI screens (`WordKeyboard.tsx:10`, `PsbtScreen.tsx:648`, `SeedScreen.tsx:203`, `ReceiveScreen.tsx:15` and others) | "7 inch panel", "480px" in comments explaining layout choices | Incidental in comments; the layout itself is Hardware (resolution) |
| `packages/core/src/psbt/attribution.ts:9`, `packages/daemon/src/ipc/methods/psbt.ts:186` | "a fleet of identical Raspberry Pis" | Incidental |

### 3.3 Tests, checks and docs

| File | Assumption | Class |
| --- | --- | --- |
| `tools/checks/check-screen-fit.mjs:5`, `:116` | Every screen state measured at 800x480; "one screen size ... not negotiable" | Hardware (resolution) |
| `tools/checks/check-device-ui.mjs:94-243` | Frontend must render at 800x480 | Hardware (resolution) |
| `tools/gen-device-shots.mjs:153`, `tools/screens/gallery.tsx:2` | Screenshots at 800x480 | Hardware (resolution) |
| `test/provisioning/image.test.ts:255-467`, `test/provisioning/rootfs.test.ts:163-198` | Fixtures name `nullroute-7inch-dsi` | Hardware (panel), follows the profile |
| `docs/ENTROPY.md:227-228` | "the Raspberry Pi hardware RNG at `/dev/hwrng` (the BCM2711 `iproc-rng200` block)" | Hardware statement about one SoC |
| `docs/VERIFICATION.md:360-377`, `README.md:106-110` | Parts table: Pi 4 (4GB), official 7 inch touchscreen, Pi Camera Module 3 optional; Pi 4 radios | Hardware |
| `docs/USING.md:7` | "The device is a fixed 800x480 touchscreen" | Hardware (resolution) |
| `docs/INSTALL.md:10-11`, `:104` | First run on a Pi 4; Pi firmware reads config.txt and `kernel8.img` | Hardware |
| `docs/THREAT-MODEL.md:391` | Raspberry Pi radios | Hardware |
| `apps/web/app/page.tsx:99`, `:258`, `apps/web/components/hero/Hero.tsx:73`, `:95`, `:141` | Website copy: Pi 4 and the 7 inch touchscreen | Website, not device |

### 3.4 What this means for a board-neutral specification

The hard dependencies are three, and all three sit in `provisioning/` and the
UI geometry, not in `packages/core`:

1. **Device tree and boot files** for the BCM2711 Pi 4. This is where a second
   board would need its own profile entry, tree and overlay.
2. **The DSI panel overlay** and its touch controller. A different display needs
   a different overlay, and the verifiers already say so
   (`provisioning/checks/rootfs.mjs:926`).
3. **800x480 as the only viewport**, enforced by `check-screen-fit` and
   `check-device-ui`. A draft specification would state a minimum readable
   area rather than a resolution.

The camera path is the least pinned-down item. The parts table names the Pi
Camera Module 3 (`docs/VERIFICATION.md:362`), but nothing in `provisioning/`
mentions a camera sensor driver (a search for `camera`, `imx708`, `unicam` and
`v4l2` in `provisioning/` finds only a comment at
`provisioning/units/nullrouted.service:117`). Whether the image as built exposes
that camera to Chromium's `getUserMedia` is **UNVERIFIED** and belongs to the
hardware bring-up milestone.

---

## 4. The published documents and five comparable projects

### 4.1 Published documents consulted

All fetched from the primary repository on 24 September 2026.

**BIP-174, PSBT** (`https://raw.githubusercontent.com/bitcoin/bips/master/bip-0174.mediawiki`,
"Status: Deployed"). Defines two representations and no QR transport: "A PCSBT
can be represented in two ways: in binary (as a file) or as a Base64 string
using the encoding described in RFC4648." and "Binary PSBT files should use the
.psbt file extension." On display it is permissive only: "The Signer can
additionally compute the addresses and values being sent, and the transaction
fee, optionally showing this data to the user as a confirmation of intent".
BIP-370 (`.../bip-0370.mediawiki`) has no QR text either.

**BIP-380, descriptors** (`.../bip-0380.mediawiki`, "Status: Deployed"): "may
be followed by #CHECKSUM, where CHECKSUM is an 8 character alphanumeric
descriptor checksum."

**BIP-129, BSMS** (`.../bip-0129.mediawiki`, "Status: Complete"). The only BIP
found that specifies QR transport of wallet data, and it does so by pointing
at Blockchain Commons: "key and descriptor records can be converted to QR
codes, following [bcr-2020-005-ur.md the BCR standard]". A search of the whole
`bitcoin/bips` tree for "QR" found no other BIP defining PSBT or descriptor
transport by QR.

**BIP-388, wallet policies** (`.../bip-0388.mediawiki`, "Status: Complete").
The nearest thing to a display requirement, and it is about registration, not
signing: "The device shows the wallet policy to the user using the secure
screen." and "aggregate flows of funds of all accounts affected by the
transaction may (and should) be displayed to the user".

**Blockchain Commons UR** (`https://raw.githubusercontent.com/BlockchainCommons/Research/master/papers/bcr-2020-005-ur.md`,
"Version: 2.1.0 ... Revised: Aug 21, 2023"). The repository README says:
"Blockchain Commons Research papers (BCRs) are _not_ standards. They are fluid
specifications ... BCRs might change without notice." Format: "ur:<type>/<message>"
single part, "ur:<type>/<seq>/<fragment>" multipart; "Use the alphanumeric QR
code mode for efficiency"; payload "MUST be valid dCBOR". Multipart fountain
coding is in `bcr-2024-001-multipart-ur.md`: parts beyond `seqLen` are XOR
mixes chosen by `Xoshiro256**` seeded from SHA-256 of `seqNum` and the
checksum, and a CRC-32 of the whole message is carried in every part.

**UR type registry** (`.../papers/bcr-2020-006-urtypes.md`, "Revised: April 26,
2025"). The `crypto-` names are deprecated: "it is RECOMMENDED that such
software only read the deprecated types and tags and not write them, preferring
the version 2 types and tags instead." Current names and tags: `psbt` (40310,
was `crypto-psbt` 310), `output-descriptor` (40308, was `crypto-output` 308),
`account-descriptor` (40311, was `crypto-account` 311), `hdkey` (40303, was
`crypto-hdkey` 303). The `psbt` payload "MUST be a valid Partially Signed
Bitcoin Transaction encoded in the binary format specified by [BIP174]". The
current descriptor encoding, `bcr-2023-010-output-descriptor.md`, carries the
descriptor text with keys replaced by `@0`, `@1` placeholders and the keys in a
CBOR array. Which structure tag 40308 means today is **UNVERIFIED**: the
registry row cites the superseded BCR-2020-010 while BCR-2023-010 claims the
same tag.

**BBQr** (`https://raw.githubusercontent.com/coinkite/BBQr/master/BBQr.md`; the
README says "Project Status: **Deployed Widely**"). Header `B$`, one encoding
character, one file type character, two base36 digits of total and two of
index. Encodings "H | HEX", "2 | Base32 using RFC 4648 alphabet", "Z | Zlib
compressed (wbits=10, no header) then Base32", and "The above encodings
**must** be implemented by receivers". File types include "P | PSBT file",
"T | Ready to send Bitcoin wire transaction", "J | JSON data", "U | Unicode
text". Normative text on the symbol: "Your QR **MUST** use the "alphanumeric"
character encoding" and "we recommend always using level "L" (lowest)". Parts:
"All blocks **must** be equal length, except for the last one." No checksum and
no fountain coding: "All "N" QR codes must be scanned, there is no way to
"skip" one". The document itself says "seven-character header" in one place and
"8-byte header" in another; the field layout is eight characters.

**Dice.** No BIP defines a dice-to-seed method; the only matches for "dice" in
`bitcoin/bips` are a BIP-39 wordlist entry and BIP-85's DICE application, which
runs the other way (seed to rolls). The one published proposal is
`bcr-2020-001-entropy-to-seed.md` (listed as Research in the README): "Die rolls
"123456" would translate to the byte array {0x01, 0x02, 0x03, 0x04, 0x05,
0x06}", then "perform SHA256 on it and use the resulting digest as a seed for a
HKDF_SHA256-based RNG", and it says of itself "Existing third-party tools do
*not* use this proposed system".

### 4.2 Comparison table

Sources: SeedSigner release `0.8.7` and branch `dev`; Krux `main`; Specter DIY
`master`; Coldcard firmware `master`; Jade `master`. All fetched 24 September
2026. Full URLs and quotes are in 4.3.

| | QR for PSBT | QR for descriptors | Dice rule | Before signing (change) | Firmware verification |
| --- | --- | --- | --- | --- | --- |
| **nullroute** | Read: bare base64, BBQr `2`/`H`/`Z`. Write: bare base64, BBQr `2` in byte mode. No UR | Read: bare descriptor, Sparrow/Specter/Core JSON, BSMS, Coldcard file. Write: descriptor text, nullroute JSON bundle | SHA-256 of ASCII `1`-`6` string, at least 100 rolls, 24 words only | Change only if re-derived from seed or registered quorum; no PSBT field consulted; sighash other than ALL/DEFAULT blocks; must scroll to end | Daemon refuses to start unless verification passed; manifest root and dm-verity root shown before unlock with an on-screen caveat; no signed boot |
| **SeedSigner** | Read: UR `crypto-psbt`, Specter `pMofN`, base64, base43, BBQr `P`. Write: UR `crypto-psbt` only | UR `crypto-output`, `crypto-account`, `bytes`; Specter JSON; Coldcard-style text; bare descriptor only if it contains `sortedmulti` | SHA-256 of ASCII `1`-`6` string; exactly 50 or 99 rolls | Single-sig: re-derived; mismatch forces discard. Multisig in 0.8.7: needs loaded descriptor, else "Skip verification" continues to signing | Reproducible images from v0.7.0; GPG-signed hash file, one key holder; no on-device hash found |
| **Krux** | Read and write: UR `crypto-psbt`, BBQr `P`, `pMofN`, base64/base58/base43; replies in the format it read | UR `crypto-output`/`crypto-account`, JSON with `descriptor`, Coldcard/BlueWallet text, bare descriptor | SHA-256 of ASCII `1`-`6` string (D20 hyphen-joined); minimum 50 or 99; shows SHA-256 of rolls; Shannon and pattern checks, proceed anyway allowed | Change only if loaded descriptor `owns` it; multisig with no descriptor shows every output as spend; warnings for unverified input amounts, high fee | Signed releases (openssl, secp256k1); reproducible; device verifies SD update signature and shows its SHA-256; experimental flash hash |
| **Specter DIY** | Base64 single, `pMofN`, legacy `ur:bytes`, UR `crypto-psbt`; replies in kind. No BBQr found | `addwallet name&descriptor` or bare descriptor text; no descriptor UR found | None; entropy from MCU TRNG and touch | Change auto-verified only with one unambiguous wallet and re-derived script; "Invalid change metadata!" otherwise; only signs for known wallets | Bootloader accepts only signed upgrades (vendor and maintainer keys), first install unverified; reproducible; anti-phishing words |
| **Coldcard** | Read: BBQr, base64, hex, binary. Write: hex single frame, BBQr `2` base32 when larger. No UR | Coldcard text file or descriptor text; exports as QR or BBQr | Dice-only: SHA-256 of ASCII `1`-`6` string; recommends 99 (24 words) or 50 (12 words) | Full change validation, `FraudulentChangeOutput` on mismatch; multisig via registered wallet; fee above 10% fatal | Factory-signed firmware (PGP key published); secure element firmware checksum drives Genuine/Caution LEDs; repro build compared after stripping signature; anti-phishing words |
| **Jade** | UR `crypto-psbt` read and write. No BBQr found | Coldcard-style multisig text (plain or `ur:bytes`); xpub out as `crypto-account` or `crypto-hdkey` | None on device; final-word helper for hand-made mnemonics | Change re-derived against registered wallet before flagged; verified change hidden unless warning | Only Blockstream-signed firmware runs; fwhash shown on screen during update; reproducible build compared minus signature block; per-device Genuine Check key |

### 4.3 Notes per project, with sources

**SeedSigner.**

- Scan formats: `src/seedsigner/models/decode_qr.py` at tag 0.8.7
  (`https://raw.githubusercontent.com/SeedSigner/seedsigner/0.8.7/src/seedsigner/models/decode_qr.py`):
  `re.search("^UR:CRYPTO-PSBT/", s, re.IGNORECASE)` (line 348),
  `r'^p(\d+)of(\d+) ([A-Za-z0-9+\/=]+$)'` (357), `r"^B\$[2HZ]P[0-9A-Z]{4}"`
  (366). Whether the unprefixed `ur:psbt` is accepted is **UNVERIFIED**; no
  pattern for it was found.
- Output: `UR("crypto-psbt", UR_PSBT(self.psbt.serialize()).to_cbor())` in
  `src/seedsigner/models/encode_qr.py` (`dev`, line 405).
- Dice: `DICE__NUM_ROLLS__24WORD = 99` and
  `entropy_bytes = hashlib.sha256(roll_data.encode()).digest()`
  (`src/seedsigner/helpers/mnemonic_generation.py:18`, `:74`, identical in
  0.8.7 and `dev`). Faces map to `"1"` through `"6"`
  (`src/seedsigner/gui/screens/tools_screens.py:316-321`). The docstring says
  "This method is NOT compatible with iancoleman's "Dice" mode"
  (`mnemonic_generation.py:68-72`).
- Review in 0.8.7: multisig change with no loaded descriptor offers
  `[self.VERIFY_MULTISIG, self.SKIP_VERIFICATION]`, and skip continues to
  signing (`src/seedsigner/views/psbt_views.py:364-366`, `:435-445`). `dev`
  separates `claimed_` from `verified_` values and states "The metadata it
  carries about keys ... is a claim, not a fact"
  (`dev` `src/seedsigner/models/psbt_parser.py:118-150`); not released as of
  the fetch.
- Firmware: "Starting with v0.7.0, the images distributed via GitHub are
  reproducible" and GPG verification of `seedsigner.0.8.7.sha256.txt.sig`
  (`https://raw.githubusercontent.com/SeedSigner/seedsigner/dev/README.md`,
  lines 108, 155-163). No on-device firmware hash found in README or docs;
  code not fully searched (**UNVERIFIED** absence).

**Krux** (`https://raw.githubusercontent.com/selfcustody/krux/main/`).

- Formats: `FORMAT_PMOFN=1`, `FORMAT_UR=2`, `FORMAT_BBQR=3`
  (`src/krux/qr.py:27-30`); BBQr file types `P`, `T`, `J`, `U` and encodings
  `H`, `2`, `Z` (`src/krux/bbqr.py:29-34`). The PSBT is returned "in the same
  form it was read as a QR code" (`src/krux/psbt.py:560-583`). UR type name
  written (`crypto-psbt` or `psbt`) is **UNVERIFIED**.
- Dice: `D6_24W_MIN_ROLLS = 99` (`src/krux/pages/new_mnemonic/dice_rolls.py:43`);
  `"".join(self.rolls) if self.num_sides < 10 else "-".join(self.rolls)` (309);
  `hashlib.sha256(entropy_bytes).digest()[:num_bytes]` (348); the screen shows
  "SHA256 of rolls:" before continuing (335-340). Docs claim SeedSigner and
  Coldcard "share the same logic that Krux uses and will give the same mnemonic"
  (`docs/getting-started/usage/generating-a-mnemonic.en.md:111`) and state
  "For 24 words, a minimum of 99 rolls is required for 256 bits of entropy"
  (line 41).
- Review: output is ours only if `self.wallet.descriptor.owns(psbt_output)`
  (`src/krux/psbt.py:268-299`); "Unverified input amounts! The fee shown may be
  lower than the real fee." (`src/krux/pages/home_pages/home.py:414-423`).
- Firmware: `.zip.sig` verified with `selfcustody.pem` via `openssl pkeyutl`
  (`docs/getting-started/installing/from-pre-built-release.en.md:8-31`); SD
  update shows "Version ... SHA256: <hex>" after signature check
  (`src/krux/firmware.py:339-369`).

**Specter DIY** (`https://raw.githubusercontent.com/cryptoadvance/specter-diy/master/`).

- PSBT: "Just display a base64-encoded PSBT transaction as a QR code."
  (`docs/communication.md`); `"p%dof%d %s"` framing and `CryptoPSBTEncoder`
  (`src/qrencoder.py`); `if d.startswith("ur:"):  # ur:bytes or ur:crypto-psbt`
  (`src/hosts/qr.py:806`). No BBQr and no descriptor UR found in `src/`; the
  `microur` submodule was not read (**UNVERIFIED** absence).
- Descriptors: "`addwallet <wallet_name>&<wallet_descriptor>`"
  (`docs/communication.md`).
- Dice: none. "We use multiple sources of entropy: **TRNG of the
  microcontroller** ... **Touchscreen.**" (`docs/security-model.md`).
- Review: "Change is verified for you automatically only when there is one
  unambiguous spending wallet ... and the device re-derives the exact output
  script" (`docs/security-model.md`); `"Invalid change metadata! Host claimed
  this output as wallet change, "` (`src/apps/wallets/manager.py`).
- Firmware: "After the initial installation, the device only accepts signed
  firmware" (`docs/security-model.md`); "*initial* firmware installation is
  *not verified*" (`docs/faq.md`); reproducible build in
  `docs/reproducible-build.md`. The bootloader repository was not read, so
  whether any firmware hash is shown on the device is **UNVERIFIED**.

**Coldcard** (`https://raw.githubusercontent.com/Coldcard/firmware/master/`).

- BBQr reader: `self.encoding, self.file_type = taste[2:4]`
  (`shared/bbqr.py`). Writer: "default to Base32, because always best option"
  and "Should always do zlib compression ... BUT: need zlib compress (not
  present) .. delayed for now" (`shared/ux_q1.py`, `show_bbqr_codes`, lines
  1197-1225). A PSBT that fits one frame goes out as uppercase hex
  (`shared/auth.py:926-937`); a larger one as BBQr type `P` over the binary
  PSBT held in PSRAM (same lines). Single-frame input may be binary, hex or
  base64 (`psbt_encoding_taster` in `shared/auth.py`). No UR handling found.
- Dice: `md = sha256(seed)` with `seed = b''`, then `md.update(ch)` per key
  (`shared/seed.py:455`, `:481`, `:533`), `threshold = 99` for 24 words (448).
  Docs: "The seed value is calculated as SHA256 over the rolls, when expressed
  as an ASCII string." (`https://coldcard.com/docs/verifying-dice-roll-math/`).
  The mixing path that adds dice to the hardware RNG uses a different,
  domain-separated hash, `sha256(b'CC\x01' + spec.method)` (`shared/seed.py:694`).
- Review: "we must be **very** careful and fully validate all the details" and
  `FraudulentChangeOutput` (`shared/psbt.py`, `validate()`);
  `DEFAULT_MAX_FEE_PERCENTAGE = const(10)` is fatal above the limit. Taproot
  change is not checked: "P2TR - unsupported, will be properly rendered as
  address (no change check)".
- Firmware: PGP key `4589779ADFC14F3327534EA8A3A31BAD5A2A5B10` and the Genuine
  and Caution lights (`https://coldcard.com/docs/upgrade/`; quoted from a fetch
  summary rather than raw HTML, so **UNVERIFIED** verbatim); `firmware | slot
  14 | SHA256d | SE1 | Firmware checksum, controls green/red LEDs`
  (`docs/secure-elements.md`); reproducible build compared after removing
  "signature data embedded into into the binary" (`docs/notes-on-repro.md`).

**Blockstream Jade** (`https://raw.githubusercontent.com/Blockstream/Jade/master/`).

- UR types in `main/bcur.c`: `"crypto-psbt"`, `"crypto-account"`,
  `"crypto-hdkey"`, `"crypto-bip39"`, `"bytes"` and Jade-specific types.
  Scanned `crypto-psbt` is signed and returned as `BCUR_TYPE_CRYPTO_PSBT`
  (`main/qrmode.c`). No BBQr and no base64 PSBT decoding found; the help page
  says data can be read "either encoded in BC-UR format or as a plain text
  string"
  (`https://help.blockstream.com/blockstream-jade/use-jade-air-gapped/supported-air-gapped-functionality-via-qr`),
  so whether a bare base64 PSBT is accepted is **UNVERIFIED**.
- Multisig registration by the Coldcard-style text file, matched on `Name`,
  `Format`, `Policy`, `Derivation` (`main/qrmode.c`). Descriptor registration
  by QR not confirmed (**UNVERIFIED**).
- Dice: none on the device. The help page describes making the first 11 or 23
  words by hand and letting Jade offer the final word
  (`https://help.blockstream.com/blockstream-jade/add-more-security-functionality/create-a-recovery-phrase-using-dice`).
- Review: outputs are marked change only after
  `verify_singlesig_script_matches` or `verify_multisig_script_matches`
  (`main/process/sign_psbt.c`); "Hide change outputs which have already been
  internally validated" (`main/ui/sign_tx.c`).
- Firmware: "Blockstream Jade units will only run firmware signed by
  Blockstream" and the `.hash` file "can be checked against the **fwhash** ...
  and this is the hash that will be displayed on the screen of the Jade unit"
  (`FWUPDATE.md`); reproducible build compared with "extra padding and data
  suffixed to the binary - this is the signature block" (`REPRODUCIBLE.md`).

### 4.4 What the comparison shows

- **Dice.** Coldcard, SeedSigner and Krux all hash the ASCII digit string
  `1`-`6` with SHA-256, which is nullroute's rule. That is a shared convention
  across three independent codebases, and it is written down in no BIP. The
  only published proposal (BCR-2020-001) uses a different encoding. All three
  products and their documents call 99 rolls sufficient for 256 bits; nullroute
  requires 100 (`docs/ENTROPY.md:73`). Consequence for cross-checking: a
  nullroute seed of exactly 100 rolls can be re-entered on Coldcard and Krux,
  whose counts are minimums, but not on SeedSigner, which takes exactly 99.
- **The Coldcard compatibility sentence** in `docs/ENTROPY.md:128-129` holds
  for Coldcard's dice-only path, per `shared/seed.py` and the Coldcard docs
  page. It does not hold for Coldcard's mixing path, which is domain separated.
  The sentence does not say which path it means.
- **Change verification by re-derivation** is common to all five in some form.
  What differs is the fallback: SeedSigner 0.8.7 lets a multisig change check be
  skipped, Krux and nullroute show an unverifiable output as a payment, Coldcard
  refuses a fraudulent one, and Coldcard does not check taproot change. No
  published document requires any of it.
- **Attestation.** Every other project relies on signed firmware checked by a
  bootloader or secure element. None of the five, as documented, shows the user
  a hash they can recompute from source with coreutils before unlocking.
  nullroute's number is recomputable, but it is reported by the software being
  checked and there is no signed boot chain yet; its own lock screen says so.

---

## 5. Gap list

### 5.1 Where nullroute diverges from a published document

| Id | Gap | Evidence | Effect |
| --- | --- | --- | --- |
| G1 | Multi-frame PSBT written as BBQr `P` carrying base64 text, while BBQr says "PSBT file", BIP-174 defines the file form as binary, Coldcard writes binary, and nullroute's own reader treats a `P` payload as binary | `packages/ui/src/components/QrDisplay.tsx:55-56`, `packages/ui/src/App.tsx:2013-2017`; section 4.1 | Likely rejected or misread by a coordinator that follows the document; two nullroute devices cannot pass a multi-frame PSBT to each other as written. Not tested against any external reader (**UNVERIFIED** in practice) |
| G2 | BBQr frames written in QR byte mode; the BBQr document says "Your QR **MUST** use the "alphanumeric" character encoding" | `packages/core/src/qr/encode.spec.yaml:22-25`; section 4.1 | Decoders read byte mode, so this is a density cost and a stated departure rather than a known interop failure. The spec gives a reason; it does not name the BBQr requirement it departs from |
| G3 | Error correction level M; BBQr recommends L | `packages/core/src/qr/bbqr.ts:114` | Recommendation only; more frames per payload |
| G4 | No UR support at all: no `ur:psbt`/`ur:crypto-psbt`, no descriptor or account UR, no fountain decoding | section 1.1 | SeedSigner writes PSBTs only as UR, Jade reads and writes only UR, Specter DIY replies in UR when scanned in UR. A user pairing nullroute with those, or with coordinators that emit UR by default, has no common animated format. BIP-129 points to UR for BSMS QR transport |
| G5 | The repository says Coldcard writes BBQr `Z` by default; Coldcard's current source writes `2` and says zlib compression is "not present" | `packages/core/src/qr/bbqr.spec.yaml:38-39`, `packages/core/src/qr/bbqr.ts:34-38`, `docs/USING.md:791-794`; Coldcard `shared/ux_q1.py` | Reading `Z` is still required by BBQr ("must be implemented by receivers"), so the behaviour is right and the stated reason is wrong. Which writers do emit `Z` is **UNVERIFIED** |
| G6 | No BBQr test vector from another implementation; all BBQr tests use nullroute's own writer or `CompressionStream` | `packages/core/test/qr.bbqr.test.ts:231-252`, `packages/ui/test/qr-display.test.tsx:101-126` | G1 and G5 were not caught by the suite. The encoder has an independent oracle (zxing); the framing does not |
| G7 | Quorum export is a nullroute-named JSON wrapper, not BSMS, not a Coldcard file, not UR | `packages/core/src/descriptor/coordinator.ts:408-439` | Readers that walk JSON for descriptors (as nullroute's own importer does) will cope; others need the bare descriptor, which is also offered |
| G8 | `docs/AIR-GAP.md` and `docs/PROVISIONING.md` are cited by specs and code and do not exist | `packages/core/src/qr/bbqr.spec.yaml:115`, `packages/core/src/qr/encode.spec.yaml:115`, `packages/daemon/src/psbt.spec.yaml:94` and others | A specification that cites its own missing documents will not survive review |
| G9 | Stale "Raspberry Pi 5" target in build comments and the advisory rpi-image-gen backend | `Makefile:358`, `.github/workflows/ci.yml:389`, `provisioning/backends/rpi-image-gen/nullroute-signer.yaml:14-16` | Contradicts the profile's `boards: [raspberrypi-4]` |

### 5.2 Where no published document exists

| Id | Area | What exists instead |
| --- | --- | --- |
| N1 | Dice-to-seed derivation | No BIP. BCR-2020-001 is a research proposal with a different encoding and says existing tools do not use it. Coldcard, SeedSigner, Krux and nullroute share SHA-256 over the ASCII roll string by convention; roll count (99 against 100) and 12-word truncation differ; none of it is written as a proposal anyone else can cite |
| N2 | What a signer must display before signing | BIP-174 makes display optional. BIP-388 covers showing a wallet policy at registration. No document says what counts as change, what to do with an unverifiable change claim, how fees are to be computed, which sighash types to refuse, or that the review must be read before Sign is live. nullroute has all of these as invariants (section 2.2); the five projects differ on each |
| N3 | What a device must display about the software it runs | Nothing published. The projects use vendor signatures, secure-element checksums, per-device keys and anti-phishing words, all vendor specific. No document defines a user-recomputable hash, what it covers, or what caveat must accompany it |
| N4 | PSBT or descriptor transport by QR as a BIP | Only BIP-129 mentions QR, by reference to UR. BBQr and UR are each a single organisation's document; UR's own maintainers say its papers "are _not_ standards" |
| N5 | Animated-QR frame integrity across transfers | BBQr has no checksum by design; UR carries a CRC-32 per part. nullroute refuses a mixed transfer when the headers differ or one index arrives with two contents (INV-QR-4). The collector compares total, file type and encoding only (`packages/core/src/qr/bbqr.ts:262-285`), so by reading the code two transfers that agree on all three and never deliver the same index twice would be joined. No test exercises that case, and a whole-payload digest is what closes it |
