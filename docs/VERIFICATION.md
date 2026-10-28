# Verifying nullroute

This document is for someone who does not trust this project and should not
have to. It shows how to check, yourself, that a nullroute device runs the code
it claims to, and that the code does what its specifications say. No step
needs a nullroute tool: each has an equivalent using coreutils and a Bitcoin
Core node.

---

## The five things you can check

| What | How | Catches |
| --- | --- | --- |
| The build matches the source | Reproduce it and compare hashes | Build tampering, a backdoored release binary |
| The device runs that build | Compare the lock screen root hash | A swapped or reflashed device |
| The code matches its specs | `make verify` and read the report | Code that quietly stopped doing what it documents |
| A signature hides nothing | Recompute it from the seed | Key exfiltration through nonce grinding |
| Your funds do not depend on us | Recover in Bitcoin Core | Lock-in, and nullroute disappearing |

The last is the most important, and the one people skip.

---

## 1. The manifest and the root hash

### What the manifest is

`MANIFEST.lock` lists the SHA-256 of every file git tracks in the manifest
roots (`package.json`, `package-lock.json`, `packages/`, `spec/`,
`provisioning/`), one per line, sorted by path. Every tracked file counts, not
an allowlist of extensions; an allowlist once missed `packages/ui/index.html`,
which carries the device frontend's content security policy.

It uses the exact output format of `sha256sum`, so `sha256sum` itself can check
it:

```
f5603a6435f46cecb5040b2afb318027528b4e87b81afade0c260cf7ed7066b2  packages/core/src/entropy/combine.ts
e4c81d6e661b430d874616bb2f2bbf7d5546cfd34097840a4a077991e80ef0dc  packages/core/src/entropy/dice.ts
...
```

**The root hash is the SHA-256 of `MANIFEST.lock` itself.** The device shows it
on its lock screen, and each release will publish it. There are no releases
yet.

### Checking it

Verify that every file on disk matches the manifest:

```console
$ sha256sum -c MANIFEST.lock
packages/core/src/entropy/combine.ts: OK
packages/core/src/entropy/dice.ts: OK
...
```

Compute the root hash:

```console
$ sha256sum MANIFEST.lock
f08ead186b9eb2a84e77e5850cccad26b7eb7486757d0911558ff296113e7d0c  MANIFEST.lock
```

Regenerate the manifest from scratch and confirm it matches what is committed:

```console
$ git ls-files -z package.json package-lock.json packages spec provisioning | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum
f08ead186b9eb2a84e77e5850cccad26b7eb7486757d0911558ff296113e7d0c  -
```

On macOS use `shasum -a 256` in place of `sha256sum`; the values are
identical. If any of the three disagree, stop.

### Why sorted concatenation and not a Merkle tree

A Merkle tree's per-file inclusion proofs help nobody who has the whole
repository, and no standard command line tool computes a Merkle root over a
directory, so you would have to run our implementation to check ours. A sorted
concatenation needs three coreutils commands.

`LC_ALL=C` in the sort is required: locale-aware sorting orders paths
differently between machines, tying the root hash to your language settings.

### What the manifest deliberately excludes

The lockfile is covered, so the root hash moves when a dependency does. Not
covered:

- `apps/web`, the public website, which never ships to the device
- `node_modules`, pinned by integrity hash in the lockfile
- `.tsbuildinfo` and other incremental build caches, which are not
  reproducible and not shipped
- `docs/`, which is prose and does not execute

Excluding the website, a networked Next.js application, is a security
decision: a change to a marketing page must not alter the hash a user compares
before opening a wallet.

---

## 2. Reproducing the build

Identical inputs must produce a byte-identical `dist/`, or the manifest root
hash means nothing: you could not have checked it.

```bash
git clone git@github.com:Xaxis/nullroute.git
cd nullroute
git checkout <commit>          # the commit you are verifying; no release is tagged yet
make install                   # npm ci, exact versions from the lockfile
make build
make manifest-check            # refuses untracked files under the roots, then checks every lock entry's hash
```

Then compare the root hash you computed with the one on your device's lock
screen. With no release there is no published third value. Two values, equal,
or something is wrong.

CI runs a double build on every push to main and every pull request, and fails
if the two differ. It compares the tsc output in each package's `dist/`; the
Vite bundle the device serves, `packages/ui/dist-app`, is not compared.

### What makes it reproducible

- Every dependency pinned exactly, `npm ci` only, lockfile committed
- `ignore-scripts=true`: no package can run code at install time and change
  the tree underneath you
- `SOURCE_DATE_EPOCH` is not set for this build, since nothing in the Node
  toolchain reads it. The image build, which does honour it, sets it from the
  commit timestamp
- File ordering sorted, not filesystem-dependent
- Output file names fixed in the device UI's Vite build, not content-hashed

---

## 3. The verification report

`make verify` performs five checks and writes `verification-report.json`.
**The daemon refuses to start if that report is missing, stale, or failing**
(INV-BUILD-1), so a spec that stops matching its code stops the device booting.

| Check | What it asserts |
| --- | --- |
| Coverage | Every runtime export from the entry points of `packages/core`, the daemon and the ui appears in some spec's `covers` list; type-only exports are exempt. An uncovered export, or a `covers` entry naming a symbol that no longer exists, is a hard failure. |
| Invariant binding | Every declared invariant names at least one test, that test exists, and it passed. `make verify` runs the whole suite first, so failing vector and differential tests fail here. |
| Vectors | Every vector file a spec declares in `spec/vectors/` exists and still matches its pinned SHA-256. The vectors themselves run in the suite. |
| Differential | `core.address.derive`, `core.derive.hd` and `core.psbt.sign` each still declare a differential oracle, and critical-tier oracles declare at least 100 cases. Agreement with `bitcoinjs-lib` is tested in the suite. |
| Integrity | Every file `MANIFEST.lock` lists exists and matches its hash, and the lock is sorted with no paths differing only by case. A tracked file missing from the lock is not caught here. The root hash is computed for the report, not compared with anything. |

It then writes the report: assurance tier, root hash, spec and invariant
counts, specs per assurance tier, each check's status, coverage, the invariant
bindings, a summary of each spec, and an overall `passed`. It holds no test
results and no dependency tree hash. That is output, not a sixth check: a
report cannot certify itself.

Vectors and differential report `not-applicable`, never `passed`, when no spec
declares any. Coverage, invariant binding and integrity report only `passed` or
`failed`, so an empty run of one of those would read as `passed`.

The report's tier is not measured from the build: the verifier writes the
literal `signer`, and the tier is not an input to the root hash. There is one
tier anyway: `packages/` holds `core`, `daemon`, `ui` and `verify`,
`packages/wallet` does not exist, and phase 5 has not opened. The field cannot
hold a second value, and the lock screen distinguishes nothing by it.

### Reading it yourself

`verification-report.json` is plain JSON. The fields that matter:

- `rootHash`: compare with the lock screen, and with a published release once
  one exists
- `tier`: `signer`, and only `signer`, today
- `coverage.uncovered`: must be empty
- `invariants[].status`: every one must be `passed`. Each entry is one binding,
  an invariant `id` and one test selector in `test`, so an invariant bound to
  several tests has several entries; there is no `tests` array

No field covers how `node_modules` resolved. The report has never carried a
`dependencyTreeHash`, and nothing in `packages/`, `tools/` or the Makefile
computes one. That is a gap; standing in for it are `make repro-check`, which
builds twice from a clean tree and compares the output, and the SBOM.

A passing report is only as trustworthy as the build that produced it, which is
why step 2 comes first.

---

## 4. Reproducing a signature

A device that makes randomised signatures can leak your private key through
valid transactions alone: grind the nonce until chosen bits of the signature
encode part of the key, publish, repeat. Every signature verifies, and nothing
on the device looks wrong.

nullroute is deterministic instead:

- ECDSA nonces come from RFC 6979
- Schnorr signing uses BIP-340 with `aux_rand` fixed to 32 zero bytes

So given the seed and the PSBT, **the signature bytes are fully determined**,
leaving no free space to hide anything in.

To check, sign the same unsigned PSBT with the same seed in any independent
implementation that does RFC 6979 and BIP-340 the same way, and compare bytes.
A difference means the device put something in your signature that it did not
have to.

In CI, the test suite signs one p2wpkh PSBT one hundred times and asserts
byte-identical output each time, and signs one taproot input three times and
compares. The differential suite checks p2wpkh signature bytes against
`bitcoinjs-lib`; no Schnorr signature is compared with another implementation.
Neither replaces checking a signature you care about.

**This is a trade.** BIP-340 permits a randomised `aux_rand`, which defends
against certain fault injection attacks. Fixing it to zero gives that up for
verifiability: right for a device you are meant to audit, but a real trade.

---

## 5. Recovering without nullroute

**This is the most important check in this document.** If it fails, your funds
depend on this project continuing to exist.

INV-INTEROP-1, stated in [the threat model](THREAT-MODEL.md) and not declared
as an invariant in any spec: every wallet nullroute creates is fully
recoverable from the BIP-39 mnemonic (plus passphrase, if set) and a standard
output descriptor, with third-party software and no nullroute code in the path.

To confirm it for your own wallet against a Bitcoin Core node:

1. Export both descriptors from nullroute, Receiving and Change. Each is a
   canonical BIP-380 descriptor with a checksum.
2. In Bitcoin Core, create a fresh wallet and import both, the change one as
   `internal`:

   ```console
   $ bitcoin-cli createwallet "recovery-check" true true "" false true
   $ bitcoin-cli -rpcwallet=recovery-check importdescriptors '[{"desc":"<receive descriptor>","timestamp":0,"active":true,"internal":false},{"desc":"<change descriptor>","timestamp":0,"active":true,"internal":true}]'
   ```

3. Confirm Core derives, from the receive descriptor, the same addresses
   nullroute shows you:

   ```console
   $ bitcoin-cli -rpcwallet=recovery-check deriveaddresses "<your descriptor>" "[0,5]"
   ```

4. Confirm the balance matches, and that Core can construct a spend. Core 31
   needs the change descriptor for this: without it, it fails with
   "Transaction needs a change address, but we can't generate it". Unless the
   wallet is p2wpkh, pass a matching `change_type` (`legacy`, `p2sh-segwit` or
   `bech32m`), as the drill does.

Try a testnet or signet wallet first, with the same script type as your real
one.

CI runs this drill on every push to main and every pull request, with a Bitcoin
Core from bitcoincore.org checked against a pinned SHA-256. For **all four**
single-signature address types, taproot included, and for a **2-of-3 quorum**
as `wsh` and as `tr`, it:

- derives each wallet with nullroute's core package from test mnemonics with
  no passphrase. The descriptors are written by the drill, or by nullroute's
  `assembleQuorum` for the `wsh` quorum, not taken from the device's export
- has Core derive receive addresses 0 to 4 and asserts they match nullroute's;
  change addresses are not compared
- imports the receive and change descriptors, funds one address, has Core
  build the spend (Core fills in the taproot PSBT fields for a `tr()`
  descriptor), signs it with nullroute, and has Core finalise and broadcast it

nullroute contributes only a signature to the recovery path. With no regtest
node reachable the drill exits non-zero rather than skipping: a vacuous pass
would put a green tick beside the claim that someone's funds are recoverable.

Run it yourself with `make test-recovery-drill` against a local regtest node.
If you cannot reproduce this by hand, that is a security report, not a support
question: see [SECURITY.md](../SECURITY.md).

---

## What verification does not give you

The argument here, trusting arithmetic instead of people, has limits.

**It does not verify the operating system.** The manifest covers the
application. The card's operating system is Debian, built with `mmdebstrap`;
if the image you flashed was backdoored, the root hash it displays is whatever
the backdoor wants. Half the usual answer exists:
`make image` builds a card from this repository, and CI builds the system
partition and checks the unit hardening assertions (INV-PROV-18, INV-PROV-19)
against it. The other half does not: no image is published or signed, and
Raspberry Pi bring-up is the next milestone. Until both are done, this is the
largest gap in what this document promises. Verification defends the
application and cannot bootstrap trust in what runs it.

**It does not verify the hardware.** We check the software supply chain. We
cannot check that your Pi is a real Pi.

**It does not prove the specs are the right specs.** `make verify` proves the
code does what the specifications say. Whether they describe a secure design is
for human review, which the readable spec format exists to allow.

**It does not prove the dependencies are correct.** Cross-checking against an
independent implementation catches disagreement, not both being wrong the same
way.

**It does not prove the absence of bugs.** It proves the absence of one class
of drift: code that no longer matches its documented behaviour, and builds that
no longer match their sources.

---

## Building a device

Everything above checks a device you were handed or built. This part builds
one whose image a stranger can check.

### Hardware

The design asks for capabilities, not a model: arm64, enough memory for
Argon2id at the shipped cost plus a Chromium kiosk with no swap, an 800x480
touchscreen and a camera. Today's image targets the board below; others follow
as each boots it. [research/pi-boards.md](../research/pi-boards.md) lists what
each needs first. Target build is under $120.

| Part | Choice | Notes |
| --- | --- | --- |
| Board | Raspberry Pi 4 (4GB) | The only board this image supports. |
| Board, in bring-up | Raspberry Pi 5 | The card carries its boot files, on Raspberry Pi's own kernel, the only one that drives the 7 inch panel on a Pi 5. Nothing has booted on one yet: bring-up, not support. |
| Display | Official Raspberry Pi 7 inch touchscreen | The DSI panel, `provisioning/build/overlays/nullroute-7inch-dsi.dts`. Pi 4: config.txt names the overlay in the Pi 4's section (INV-PROV-25) and it is on the card as a device tree blob (INV-PROV-26); the build refuses to finish unless merging it into `bcm2711-rpi-4-b.dtb` leaves `dsi@7e700000` enabled with the panel and touch controller present. Pi 5: the firmware detects the panel and loads Raspberry Pi's own overlay; both overlays it can choose are on the card (INV-PROV-26), and the build refuses to finish unless every label they target exists in all three Pi 5 trees. Touch Display 2 (720x1280 portrait) is driven but not supported. Only a boot with the panel attached shows whether it lights up. Every screen is measured at exactly 800x480. |
| Camera | A USB (UVC) webcam | CSI camera modules come later: the pinned Debian kernel (`linux-image-6.12.94+deb13-arm64`) builds no IMX708 driver (not in mainline) or IMX219 driver and leaves the Pi 4's CSI receiver (`VIDEO_BCM2835_UNICAM`) unset, so on that kernel only a USB (UVC) camera has a driver. Raspberry Pi's kernel, which the card also carries for the Pi 5, has not been checked for CSI drivers. INV-PROV-29 checks every kernel version under the card's `lib/modules`: in each, `uvcvideo` and every module that version's `modules.dep` says it needs are present as files (not shown to load). The card also carries `systemd-udevd` and the two rules that load the driver on hotplug and give the node the `video` group (INV-PROV-30). The kiosk's device cgroup adds only `char-video4linux` (INV-PROV-27); the browser's managed policy grants the camera to `http://127.0.0.1:5180` alone, audio off (INV-PROV-28). No camera has streamed on a Pi yet. Without one the device shows codes and receives nothing; an SD card transport is planned, not built. |
| Storage | 16GB+ SD card, A2 class | The image is small; the class rating matters for Argon2id-adjacent I/O, not capacity. |
| Case | Any | Prefer one that makes tampering visible over one that looks nice. |
| Power | Official PSU | An underpowered supply causes undervoltage throttling, which shows up as inexplicable slowness. |

**Radios.** The Pi 4's wifi and Bluetooth chip stays on the board; the image
removes the software that drives it:

- the `firmware-brcm80211`, `bluez`, `wpasupplicant` and `wireless-tools`
  packages are absent
- the wireless and Bluetooth kernel modules (drivers, 802.11 stack, Bluetooth
  subsystem) and the `brcm` firmware files are absent

INV-PROV-13 asserts both against the built image. The boot test prints a count
of radio modules in the mounted root filesystem, but nothing checks that count.
There is no
`dtoverlay=disable-wifi` or `dtoverlay=disable-bt` in `config.txt` and no
modprobe blacklist. The radio hardware is still attached to the SoC, and anyone
who can rewrite the card can put the drivers and firmware back. For physical
certainty, use a board with no radio hardware.

---

### What the hardening actually does

The image removes the network stack rather than disabling it, mounts what it
can read-only, drops capabilities and syscalls the daemon does not need, and
runs the browser as a separate unit, unconfined on purpose.
[provisioning/HARDENING.md](https://github.com/Xaxis/nullroute/blob/main/provisioning/HARDENING.md)
covers which controls, why, and what three are worth on this hardware (less
than they look), next to the profiles that assert it.

---

### The three tiers

Provisioning is staged because the strongest option is irreversible and the
useful one is not. Never describe a lower tier in a higher tier's language.

| Tier | What it establishes | What it costs | Lands |
| --- | --- | --- | --- |
| 0 | The image you flashed is byte-identical to one built from the source. Today that means an image you built: `make image` writes checksums and `make image-repro` shows two builds agree. Checking a published, signed image is planned: nothing is published or signed. | Nothing irreversible. Works on any supported board. | Phase 2, signing and publishing planned |
| 1 | The system partition has not been modified since the build, and the device says so at boot. | A more involved build. Still reversible. | Phase 3 |
| 2 | The boot chain itself is verified by the silicon, so the root hash the device shows cannot be chosen by an attacker. | **Irreversible.** Burns one-time fuses. Losing the signing key bricks every device provisioned with it. | Phase 7 |

**Tier 0 answers "let me spin up another one".** No fuses, no key custody, no
special hardware; it is the default.

**Tier 1's limit is the important one.** dm-verity means the system partition
cannot be altered without changing its root hash. But the boot partition is not
covered, and the initramfs reads the root hash from it
(`/boot/system.roothash`). An attacker who rewrites the boot partition supplies
their own `system.roothash` and initramfs, and the device displays the number
they chose. Tier 1 raises the bar and gives an attentive user a chance to
notice. It does not close the gap.

**Tier 2 closes it, at a real price.** The root hash travels inside an image
the BootROM verifies against a key whose hash is fused into the chip, so the
chain runs from silicon to every block of the root filesystem. Its costs are
listed below.

---

### Verifying an image

**You check our tool with someone else's tools.** The commands below use
coreutils (`sha256sum`, `head`, `stat`) and `veritysetup`, none of them ours.
`make image` prints a `dd` command for the flash itself.

#### What a build produces

`make image` writes three files to `out/release/`:

| File | What it is |
| --- | --- |
| `nullroute-<version>.img` | The card image |
| `system.roothash` | The dm-verity root hash of the system partition |
| `SHA256SUMS` | Plain `sha256sum` output covering the other two |

Like `MANIFEST.lock`, `SHA256SUMS` needs only `sha256sum -c` to check.

**Planned, not built:** a published release carrying these files, a detached
`minisign` signature over `SHA256SUMS`, lock files recording the pinned build
values, the package list and every contributing `.deb`, an SBOM, and a
`REPRODUCE.md`. No signing key exists, so there is no public key to compare and
nothing is signed.

#### Before flashing

```console
$ cd out/release && sha256sum -c SHA256SUMS
```

This compares the image with checksums from the same build. It catches a file
damaged between build and flash, nothing more. It is not a signature check.

#### After flashing

Read the card back to confirm the bytes that landed are the bytes you wrote;
this catches a failing SD card as readily as a tampered one. Read exactly the
image's length: it is not a whole number of 4 MB blocks, and reading past its
end changes the hash.

```console
$ sudo head -c "$(stat -c %s <image>)" /dev/<card> | sha256sum
```

At tier 1 and above, also confirm the hash tree over the system partition:

```console
$ sudo veritysetup verify /dev/<card>p2 /dev/<card>p3 $(cat system.roothash)
```

#### At boot

The lock screen shows two hashes:

- `sha256sum MANIFEST.lock`, attesting the application. Compare it with the
  value you computed from the source at the same commit.
- The dm-verity root hash of the system partition, where there is a mapping.
  `nullroute-attest.service` reads it from the live device-mapper table (what
  the kernel actually checks), not from `/boot/system.roothash` (what an
  attacker who rewrote the boot partition would choose). With no mapping
  (`make dev` on a workstation) no second number is drawn, rather than a blank
  or a zero.

Tier 1 has landed, and INV-BOOT-1 declares this behaviour.

**Both numbers are reported by the software you are looking at.** They catch
an accident, a failed write, and an unsophisticated substitution. Until tier 2
they do not catch an attacker who replaced the code that draws them, so do not
treat them as proof on their own.

#### Reproducing the build

The strongest check, and the only one that does not rely on us at all, is
building the image yourself and comparing hashes. With no release there is no
`REPRODUCE.md` yet: check out the commit, run `make image`, and compare
`system.roothash` with the number the device shows.

Measured today: two builds on ONE machine, in two separate containers;
`make image-repro` runs them, and the root hash and the whole card image
agree. Not measured: a second machine, path or architecture. The build is
deterministic here and unproven elsewhere. A gate running both builds in one
container once missed `mmdebstrap` writing each container's hostname into
`/etc/hostname`, which gave four builds of one commit four root hashes.

---

### What provisioning does not solve

- **The root of trust is closed source.** On a Pi the earliest boot code lives
  in silicon nobody outside Raspberry Pi Ltd can audit. Signed boot moves the
  question from "do you trust this SD card" to "do you trust this BootROM":
  better, but a move, not an elimination.
- **Signed boot is irreversible.** It burns one-time-programmable fuses; a
  mistake is permanent and can brick the board. It will never be the default,
  and a device with it enabled cannot be returned to one without.
- **On its own, dm-verity moves the gap rather than closing it.** This is the
  most important limitation on the page, described under tier 1. Only
  OTP-fused secure boot, with the root hash inside the signed image, closes it.
- **An integrity hash tree detects modification; it does not prevent it.** A
  replacement cannot produce the same root hash, so the device notices, which
  helps only if someone reads the number.
- **dm-verity provides integrity, not confidentiality.** It says nothing about
  who can read the system partition, and nothing at all about the boot
  partition.
- **Nothing here defends the hardware.** We cannot check that your Pi is a real
  Pi, that its BootROM is the published one, or that nothing was added to the
  board between the factory and you.
- **Reproducibility depends on an upstream archive.** The build host, system
  partition, kernel and firmware install from snapshot.debian.org at one
  timestamp (`NULLROUTE_SNAPSHOT` in `provisioning/build/Dockerfile`), so a
  later build of the same commit sees the same archive. That moves the
  dependency rather than removing it: the build relies on snapshot.debian.org
  staying up and serving what it served. The Pi 5's kernel is
  the exception: Raspberry Pi's archive keeps no snapshots, so when it drops
  6.18.50 from its pool the build stops until someone moves the pin. Kernel and
  firmware packages are checked against pinned digests; the rest by apt against
  Debian's signed indices for that moment, with no hashes recorded in the
  repository yet. Builds on different days have not yet been compared.

---

### Status of this document

The hardware, the hardening controls and the constraints above are settled and
will not change materially.

The image builds and boots under QEMU: `make image-boot-test` opens the
dm-verity mapping, reads every block, checks that systemd reports starting the
signing daemon, and requires a copy with one byte changed to fail. The first run on a Raspberry Pi, which
exercises the firmware path from power-on to the kernel, is the next milestone.

**The contract that build has to satisfy is written and runs.** A backend is
supported when the unchanged verifiers pass against its output. Every
provisioning assertion carries an executing verifier, run against the
profiles, an assembled root filesystem, an image file, or a booted device's
console log. `make profiles` prints the current counts and checks the ones
`provisioning/README.md` states.

Two image verifiers catch defects that would make the root hash impossible to
compare: a random dm-verity salt changes it every build, even for a
byte-identical filesystem, and generated partition and filesystem identifiers
make two images differ invisibly to a file-level diff. So every identifier is
derived from the release version, the `version` in package.json, by
`provisioning/checks/identifiers.mjs`. A third party recomputes the verity salt
with coreutils; the digest printed is the salt:

```
printf 'nullroute/verity-salt/0.1.0' | sha256sum
```

`make fixture-image` shows those verifiers failing on purpose. It writes two
synthetic, non-bootable images with the superblocks and partition table at the
offsets the published formats use and checks that they compare equal, then
writes a third with a drifting salt, which the verifier has to catch. The real
image goes through the same verifiers via `make verify-image` and
`make image-repro`.

---

## Reporting a verification failure

If any check in this document fails, treat it as a security issue and report
it privately. See [SECURITY.md](../SECURITY.md).

Include the commit, the root hash you computed, the root hash the device
displayed, and the exact commands you ran.
