# Verifying nullroute

This document is written for someone who does not trust this project and should
not have to. It describes how to check, yourself, that a nullroute device is
running the code it claims to be running, and that the code does what its
specifications say.

Nothing here requires you to run a nullroute tool to check a nullroute build.
Every step has an equivalent you can perform with coreutils and a Bitcoin Core
node, because a verification tool that only its own author can run is not
verification.

---

## The five things you can check

| What | How | Catches |
| --- | --- | --- |
| The build matches the source | Reproduce it and compare hashes | Build tampering, a backdoored release binary |
| The device runs that build | Compare the lock screen root hash | A swapped or reflashed device |
| The code matches its specs | `make verify` and read the report | Code that quietly stopped doing what it documents |
| A signature hides nothing | Recompute it from the seed | Key exfiltration through nonce grinding |
| Your funds do not depend on us | Recover in Bitcoin Core | Lock-in, and nullroute disappearing |

The last one is the most important, and it is the one people skip.

---

## 1. The manifest and the root hash

### What the manifest is

`MANIFEST.lock` is a SHA-256 of every file git tracks under `packages/`,
`spec/` and `provisioning/`, one per line, sorted by path.

Tracked, rather than a list of source extensions. An allowlist of extensions
silently omits any file type nobody thought to add, and this one did: among the
files it left outside the hash was `packages/ui/index.html`, which carries the
content security policy the device frontend runs under.

The file is deliberately in the exact output format of `sha256sum`, so you can
check it with `sha256sum` itself rather than with our tool:

```
f5603a6435f46cecb5040b2afb318027528b4e87b81afade0c260cf7ed7066b2  packages/core/src/entropy/combine.ts
e4c81d6e661b430d874616bb2f2bbf7d5546cfd34097840a4a077991e80ef0dc  packages/core/src/entropy/dice.ts
...
```

**The root hash is the SHA-256 of `MANIFEST.lock` itself.** That is the value
the device shows on its lock screen. It will also be published with each
release once there are releases; there are none yet.

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
3fe715a6f132d8372019fcaf8340ee156341234565049cc7efd9a118fdc6a6fd  MANIFEST.lock
```

Regenerate the manifest from scratch and confirm it matches what is committed:

```console
$ git ls-files -z packages spec provisioning | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum
3fe715a6f132d8372019fcaf8340ee156341234565049cc7efd9a118fdc6a6fd  -
```

On macOS use `shasum -a 256` in place of `sha256sum`. The values are identical.

If any of those three disagree, stop.

### Why sorted concatenation and not a Merkle tree

A Merkle tree buys you compact inclusion proofs for individual files. Nobody
needs that here: the verifier always has the whole tree, because they have the
whole repository.

What a Merkle tree costs is exactly the property that matters. There is no
standard command line tool that computes a Merkle root over a directory, so a
Merkle design would force you to run our implementation to check our
implementation. A sorted concatenation is reproducible with three coreutils
commands that predate this project by forty years, and that is worth more than
an inclusion proof nobody will use.

`LC_ALL=C` in the sort is not optional. Locale-aware sorting orders paths
differently between machines, which would make the root hash depend on your
system's language settings.

### What the manifest deliberately excludes

The manifest covers `packages/`, `spec/` and `provisioning/`. It does not
cover:

- `apps/web`, the public website, which never ships to the device
- `node_modules`, which is covered separately by the lockfile's integrity hashes
- `.tsbuildinfo` and other incremental build caches, which are not reproducible
  and are not shipped
- `docs/`, which is prose and does not execute

Excluding the website is a security decision, not a convenience. The website is
a networked Next.js application, and folding it into the device's integrity
claim would mean a change to a marketing page altered the hash a user compares
before opening a wallet. The two artifacts are independent and their hashes
are independent.

---

## 2. Reproducing the build

Identical inputs must produce a byte-identical `dist/`. If they do not, the
manifest root hash means nothing, because you could not have checked it.

```bash
git clone git@github.com:Xaxis/nullroute.git
cd nullroute
git checkout <commit>          # the commit you are verifying; no release is tagged yet
make install                   # npm ci, exact versions from the lockfile
make build
make manifest-check            # regenerates the manifest, diffs against committed
```

Then compare the root hash you computed against the one displayed on your
device's lock screen. Nothing has been released, so there is no published value
to make it three. Two values, equal, or something is wrong.

CI runs a double build on every commit and fails if the two differ, so a
reproducibility regression is caught at the commit that caused it rather than at
the release.

### What makes it reproducible

- Every dependency pinned exactly, `npm ci` only, lockfile committed
- `ignore-scripts=true`, so no package can run arbitrary code at install time
  and change the tree underneath you
- `SOURCE_DATE_EPOCH` is deliberately not set for this build, because nothing
  in the Node toolchain reads it. It is set from the commit timestamp for the
  image build only, which does honour it
- File ordering sorted rather than filesystem-dependent
- Build ids pinned rather than randomly generated

---

## 3. The verification report

`make verify` performs five checks and writes `verification-report.json`.

**The daemon refuses to start if that report is missing, stale, or failing**
(INV-BUILD-1). This is the mechanism that makes the specs load-bearing rather
than decorative: a spec that stops matching its code stops the device from
booting.

| Check | What it asserts |
| --- | --- |
| Coverage | Every exported symbol in `packages/core` appears in some spec's `covers` list. An uncovered export is a hard failure. |
| Invariant binding | Every declared invariant names at least one test, that test exists, and it passed. |
| Vectors | All official BIP test vectors in `spec/vectors/` pass. |
| Differential | The cross-implementation suite agrees with `bitcoinjs-lib` on derivation, addresses, and signatures. |
| Integrity | Every tracked source file matches `MANIFEST.lock`, and the root hash recomputes. |

The run then writes the report itself: spec count, invariant count, per-check
status, test results, dependency tree hash, assurance tier, and root hash. That
is the output of the five checks, not a sixth check, and it is counted that way
because a report that certified itself would be worth nothing.

A check with nothing to do is recorded as `not-applicable`, never as `passed`.
Reporting an empty check as a pass would claim assurance the project has not
earned.

The report records which assurance tier was built, and the tier is part of what
the root hash covers, so a signer-only build and a full build would have
different root hashes by construction.

Today there is one tier. `packages/` holds `core`, `daemon`, `ui` and `verify`;
`packages/wallet` does not exist, phase 5 has not been opened, and the verifier
writes the literal `signer`. So the field cannot hold a second value and the
lock screen distinguishes nothing by it. The mechanism is real and what it
would prove is not yet a choice anybody has.

### Reading it yourself

`verification-report.json` is plain JSON. The fields that matter:

- `rootHash`: compare against the lock screen, and against a published release
  once one exists
- `tier`: `signer` today, and only `signer`. See above.
- `coverage.uncovered`: must be empty
- `invariants[].status`: every one must be `passed`. Each entry is one
  invariant and the one test selector it binds, in `test`, so there is no
  `tests` array to index into

This list used to end with `dependencyTreeHash`, which no version of the report
has ever carried and which nothing in `packages/`, `tools/` or the Makefile
computes. It was the only one of these fields covering how `node_modules`
resolved, so its absence is a gap rather than a tidy-up: what stands in for it
is `make repro-check`, which builds twice from a clean tree and compares the
output, and the SBOM.

A report that says everything passed is only as trustworthy as the build that
produced it, which is why step 2 comes first.

---

## 4. Reproducing a signature

This is the check that catches key exfiltration, and it is the one that is
unique to how this device signs.

A signing device that produces randomised signatures can leak your private key
through nothing but valid transactions. Grind the nonce until chosen bits of the
signature encode part of the key, publish, repeat. Every signature verifies.
Nothing on the device looks wrong.

nullroute closes this by being deterministic:

- ECDSA nonces come from RFC 6979
- Schnorr signing uses BIP-340 with `aux_rand` fixed to 32 zero bytes

So given the seed and the PSBT, **the signature bytes are fully determined**.
There is no free space to hide anything in.

To check it, take the seed and the unsigned PSBT to any independent
implementation that does RFC 6979 and BIP-340 the same way, sign, and compare
bytes. If they differ, the device put something in your signature that it did
not have to.

The device's own test suite signs the same PSBT one hundred times and asserts
byte-identical output every time, and the differential suite checks the bytes
against `bitcoinjs-lib`. Both run in CI. Neither is a substitute for checking a
signature you actually care about.

Note the trade being made here. BIP-340 permits a randomised `aux_rand`, which
defends against certain fault injection attacks. Fixing it to zero gives that up
in exchange for verifiability. For a device whose premise is that you can audit
it, that is the right side of the trade, but it is a real trade and this
document is not going to pretend otherwise.

---

## 5. Recovering without nullroute

**This is the most important check in this document.** If it fails, your funds
depend on this project continuing to exist, which is a worse failure than any
bug.

The rule (INV-INTEROP-1) is that every wallet nullroute creates is fully
recoverable from the BIP-39 mnemonic (plus passphrase, if you set one) and a
standard output descriptor, using third-party software, with no nullroute code
in the path.

To confirm it for your own wallet, against a Bitcoin Core node:

1. Export the descriptor from nullroute. It is a canonical BIP-380 descriptor
   with a checksum.
2. In Bitcoin Core, create a fresh wallet and import the descriptor:

   ```console
   $ bitcoin-cli createwallet "recovery-check" true true "" false true
   $ bitcoin-cli -rpcwallet=recovery-check importdescriptors '[{"desc":"<your descriptor>","timestamp":0,"active":true}]'
   ```

3. Confirm Core derives the same addresses nullroute shows you:

   ```console
   $ bitcoin-cli -rpcwallet=recovery-check deriveaddresses "<your descriptor>" "[0,5]"
   ```

4. Confirm the balance matches, and that Core can construct a spend.

Do this on a testnet or signet wallet first, with the same script type as your
real one.

CI runs exactly this drill on every commit, against a Bitcoin Core downloaded
from bitcoincore.org and checked against a pinned SHA-256. For a **2-of-3
quorum**, and for **all four**
address types, taproot included, it creates the wallet in nullroute, exports the
receive and change descriptors, asks Core to derive the addresses and asserts
they are identical, funds one, has Core build the spend, signs it with
nullroute, and has Core finalise and broadcast it. The only thing nullroute
contributes to the recovery path is a signature.

One limit, stated rather than implied: the drill exits non-zero rather than
skipping when no regtest node is reachable, because a vacuous pass on this
particular claim would put a green tick beside the statement that somebody's
funds are recoverable.

Taproot was absent from this drill for a long time, and this document said the
reason was that signing one "needs taproot PSBT fields the drill does not build
yet". That was wrong twice over. The drill does not build the PSBT; Core does,
and Core populates those fields for a `tr()` descriptor. The signing path
already handled taproot. Nobody had tried it, and the device was handing out
p2tr addresses whose recoverability nothing had checked.

Run it yourself with `make test-recovery-drill` against a local regtest node.

If you ever cannot reproduce this by hand, that is a security report, not a
support question. See [SECURITY.md](../SECURITY.md).

---

## What verification does not give you

Being precise about this, because the whole document is an argument for
trusting arithmetic instead of people, and that argument has limits.

**It does not verify the operating system.** The manifest covers the
application. If the Raspberry Pi OS image you flashed was already backdoored,
the root hash it displays is whatever the backdoor wants it to say. Half of the
usual answer exists: `make image` builds a card from this repository, and CI
builds the system partition and checks the unit hardening
assertions (INV-PROV-18, INV-PROV-19) against it. The other half does not: no
image has been published or signed, so there is nothing to check a signature
on, and hardware bring-up on a Raspberry Pi is the next milestone rather than a
finished one. Until both are done, that is the largest gap in what this
document promises, and it is stated here rather than left to be discovered. Verification defends the application and cannot bootstrap trust in
the thing that runs it.

**It does not verify the hardware.** We check the software supply chain. We
cannot check that your Pi is a real Pi.

**It does not prove the specs are the right specs.** `make verify` proves that
the code does what the specifications say. Whether the specifications describe a
secure design is a question for human review, and the specs are written in a
readable format specifically so that review is possible.

**It does not prove the dependencies are correct.** We cross-check against an
independent implementation, which catches disagreement. It would not catch both
implementations being wrong in the same way.

**It does not prove the absence of bugs.** It proves the absence of a specific
class of drift: code that no longer matches its documented behaviour, and builds
that no longer match their sources.

---

---

## Building a device

Everything above is how you check a device somebody handed you, or one you
built. This is how you build one, and it is the same argument from the other
end: the image has to be something a stranger can check.

### Hardware

Target build is under $120.

| Part | Choice | Notes |
| --- | --- | --- |
| Board | Raspberry Pi 4 (4GB) | The only board this image supports, and the only device tree on the card. |
| Display | Official Raspberry Pi 7 inch touchscreen | The DSI panel, described by `provisioning/build/overlays/nullroute-7inch-dsi.dts`. INV-PROV-25 says config.txt names the overlay, INV-PROV-26 says the overlay is on the card and is a device tree blob, and the build refuses to finish unless merging it into this image's `bcm2711-rpi-4-b.dtb` leaves `dsi@7e700000` enabled with the panel and its touch controller present. Whether the panel lights up is answered only by a boot with it attached. Every screen is measured at exactly 800x480 and no other size. |
| Camera | Pi Camera Module 3 | Optional. Without it, use SD card transport and build in camera-less mode. |
| Storage | 16GB+ SD card, A2 class | The image is small; the class rating matters for Argon2id-adjacent I/O, not capacity. |
| Case | Any | Consider one that makes tampering visible rather than one that looks nice. |
| Power | Official PSU | An underpowered supply causes undervoltage throttling, which shows up as inexplicable slowness. |

**Radios.** The Pi 4 has wifi and Bluetooth, and the chip stays on the board.
What the image does is remove the software that drives it:

- the `firmware-brcm80211`, `bluez`, `wpasupplicant` and `wireless-tools`
  packages are absent
- the wireless and Bluetooth kernel modules (the drivers, the 802.11 stack and
  the Bluetooth subsystem) and the `brcm` firmware files are absent

INV-PROV-13 asserts both against the built image, and the boot test counts
radio modules in the mounted root filesystem. There is no
`dtoverlay=disable-wifi` or `dtoverlay=disable-bt` in `config.txt` and no
modprobe blacklist.

The radio hardware itself is still present and still attached to the SoC.
Anyone who can rewrite the card can put the drivers and firmware back. If you
want physical certainty, use a board with no radio hardware at all.

---

### What the hardening actually does

The image removes the network stack rather than disabling it, mounts what it
can read-only, drops the capabilities and syscalls the daemon does not need, and
runs the browser as a separate unconfined-on-purpose unit. Which controls, why
each one, and what three of them are worth on this hardware (less than they
look) is a specification in its own right, and it is in
[provisioning/HARDENING.md](https://github.com/Xaxis/nullroute/blob/main/provisioning/HARDENING.md)
next to the profiles that assert it.

It is not on this page because it is ten thousand characters of reference
material for somebody editing a hardening profile, and this page is for somebody
checking a root hash before entering a PIN. Those are different readers.

---

### The three tiers

Provisioning is staged, because the strongest option is irreversible and the
useful option is not. Never describe a lower tier using a higher tier's
language.

| Tier | What it establishes | What it costs | Lands |
| --- | --- | --- | --- |
| 0 | The image you flashed is byte-identical to one built from the source. Today that means an image you built: `make image` writes checksums and `make image-repro` shows two builds agree. Checking a published, signed image is planned: nothing is published or signed. | Nothing irreversible. Works on any supported board. | Phase 2, signing and publishing planned |
| 1 | The system partition has not been modified since the build, and the device says so at boot. | A more involved build. Still reversible. | Phase 3 |
| 2 | The boot chain itself is verified by the silicon, so the root hash the device shows cannot be chosen by an attacker. | **Irreversible.** Burns one-time fuses. Losing the signing key bricks every device provisioned with it. | Phase 7 |

**Tier 0 is the one that answers "let me spin up another one".** It needs no
fuses burned, no key custody, and no special hardware, and it is the default.

**Tier 1's limit is the important one.** A dm-verity hash tree means the system
partition cannot be altered without changing its root hash. But the boot
partition is not covered, and the root hash is read from there: the initramfs
reads `/boot/system.roothash`. An attacker who rewrites the boot partition
supplies their own `system.roothash` and their own initramfs, and the device
displays exactly the number they chose. Tier
1 raises the bar and gives an attentive user a chance to notice. It does not
close the gap.

**Tier 2 closes it, at a real price.** The root hash travels inside an image the
BootROM verifies against a key whose hash is fused into the chip. The chain runs
from silicon to every block of the root filesystem. It also means the earliest
link is closed-source code nobody outside Raspberry Pi can audit, so the honest
description is that tier 2 moves the question from "do you trust this SD card"
to "do you trust this BootROM", which is better without being elimination.

---

### Verifying an image

The design principle is the one already load-bearing elsewhere in this project:
**you check our tool with someone else's tools.** A verification procedure that
requires running a nullroute binary to check a nullroute image is not
verification. Every command below is `sha256sum`, `dd` or `veritysetup`, none of
which are ours.

#### What a build produces

`make image` writes three files to `out/release/`:

| File | What it is |
| --- | --- |
| `nullroute-<version>.img` | The card image |
| `system.roothash` | The dm-verity root hash of the system partition |
| `SHA256SUMS` | Plain `sha256sum` output covering the other two |

Note the shape of `SHA256SUMS`: it is the same choice as `MANIFEST.lock`, for
the same reason. One file, in the output format of a tool that already exists on
every machine, so `sha256sum -c` checks the set.

**Planned, not built:** a published release carrying these files, a detached
`minisign` signature over `SHA256SUMS`, lock files recording the pinned build
values, the package list and every contributing `.deb`, an SBOM, and a
`REPRODUCE.md`. No signing key exists, so there is no public key to compare and
nothing is signed.

#### Before flashing

```console
$ cd out/release && sha256sum -c SHA256SUMS
```

This compares the image against checksums written by the same build, so it
catches a file damaged between the build and the flash, and nothing more. It is
not a signature check.

#### After flashing

Read the card back and confirm the bytes that landed are the bytes you wrote.
This catches a failing SD card as readily as a tampered one:

```console
$ sudo dd if=/dev/<card> bs=4M count=<image size> | sha256sum
```

Then, at tier 1 and above, confirm the hash tree over the system partition:

```console
$ sudo veritysetup verify /dev/<card>p2 /dev/<card>p3 $(cat system.roothash)
```

#### At boot

The lock screen shows two hashes.

The first is `sha256sum MANIFEST.lock`, which attests the application. Compare
it against the value you computed from the source at the same commit.

The second is the dm-verity root hash of the system partition, and it appears
only where there is a mapping. It is read from the live device-mapper table
through `nullroute-attest.service` rather than from `/boot/system.roothash` on
the card, because the file on the card is the number an attacker who rewrote
the boot partition would have chosen, and the table is a statement about what
the kernel is actually checking. Where there is no mapping, under `make dev` on
a workstation, no second number is drawn rather than a blank or a zero.

THIS SECTION SAID THE OPPOSITE UNTIL NOW, in three parts that were each true
when written and are not any more: that the panel showed one hash, that there
was nothing behind a verity number because dm-verity had not landed, and that
the attestation the daemon builds carries a single `rootHash`. Tier 1 landed,
INV-BOOT-1 declares the behaviour, and the paragraph below this one has been
saying "both numbers" over the top of it. A reader told to expect one hash and
shown two has the same problem in reverse as the one this warning was written
for: they cannot tell which one they were supposed to check.

**Both numbers are reported by the software you are looking at.** That is not a
reason to skip reading them, and it is a reason not to treat them as proof on
their own. They catch an accident, a failed write, and an unsophisticated
substitution. Until tier 2, they do not catch an attacker who replaced the code
that draws them.

#### Reproducing the build

The strongest check available, and the only one that does not rely on us at all,
is to build the image yourself and compare hashes. There is no release and so
no `REPRODUCE.md` yet: check out the commit, run `make image`, and compare
`system.roothash` against the number the device shows.

Where reproducibility stops short, that is stated rather than glossed. What is
measured today is two builds on ONE machine, in two separate containers: `make
image-repro` runs them and the root hash and the whole card image agree. What is
not measured is a second machine, a second path, or a second architecture, so
the honest claim is that the build is deterministic here and unproven elsewhere.

That distinction is not academic, and this document had it wrong in the more
flattering direction. It used to concede a non-reproducible disk image while
asserting a reproducible root filesystem, and the root filesystem was the half
that did not reproduce: `mmdebstrap` writes the build machine's hostname into
`/etc/hostname`, Docker assigns a fresh container id per run, and the dm-verity
root hash was therefore a function of that id. Four separate builds of one
commit produced four different root hashes. The gate did not catch it because it
ran both builds inside a single container, where the hostname is constant, so
the one configuration it measured was the one where the defect cannot appear.

---

### What provisioning does not solve

Stated here rather than discovered later.

**The root of trust is closed source.** On a Pi, the earliest boot code lives in
silicon and is not auditable by anyone outside Raspberry Pi Ltd. A signed boot
chain moves the question from "do you trust this SD card" to "do you trust this
BootROM", which is better, but it is a move rather than an elimination.

**Signed boot is irreversible.** Enabling it burns one-time-programmable fuses.
A mistake is permanent and can brick the board. It will never be the default,
and any device that has it enabled cannot be returned to a state where it does
not.

**On its own, dm-verity moves the gap rather than closing it.** This is the most
important limitation on the page. A verity hash tree means an attacker cannot
alter the system partition without changing its root hash. But without a signed
boot chain, the boot partition is unprotected, and an attacker who rewrites it
supplies their own `system.roothash`, which the initramfs reads from that
partition, along with their own initramfs. The device then cheerfully displays whatever root hash the attacker
chose. That is the same failure the threat model already describes, relocated
one layer down. Only OTP-fused secure boot, with the root hash carried inside
the signed image, actually closes it.

**An integrity hash tree detects modification; it does not prevent it.** What an
attacker cannot do is make a replacement produce the same root hash, so the
device notices. That only helps if someone reads the number.

**dm-verity provides integrity, not confidentiality.** It says nothing about
whether anyone can read the system partition, and nothing at all about the boot
partition.

**Nothing here defends the hardware.** We check the software supply chain. We
cannot check that your Pi is a real Pi, that its BootROM is the published one,
or that nothing was added to the board between the factory and you.

**Reproducibility depends on upstream archives.** A reproducible image needs its
package inputs to remain fetchable at the versions used. Today the build
installs from the live Debian mirror, not a snapshot, so two builds of one
commit agree only while that archive has not moved. Pinning to a snapshot, and
recording the hash of every input so a future verifier can at least confirm what
went in, are planned and not built.

---

### Status of this document

The hardware, the hardening controls and the constraints above are settled and
will not change materially.

The image builds and boots under QEMU. `make image-boot-test` opens the
dm-verity mapping, reads every block, starts the signing daemon, and requires a
copy with one byte changed to fail. Its first run on a Raspberry Pi is the next
milestone, and that is what exercises the firmware path from power-on to the
kernel. Signing and publishing are
planned and not built.

**The contract that build has to satisfy is written and runs.** That half had to
come first. A backend is supported when the unchanged verifiers pass against its
output, and verifiers written afterwards would be written to agree with whatever
the backend happened to produce, which is not a check. Every provisioning
assertion carries a verifier that executes. Some read the profiles, some an
assembled root filesystem, some an image file, and some the console log of a
booted device. `make profiles` prints the current counts and checks the ones
`provisioning/README.md` states.

Two of the image verifiers cover defects that would otherwise make the root
hash meaningless. A dm-verity salt generated at random changes the root hash on
every build even when the filesystem is byte-identical, and generated partition
and filesystem identifiers make two images differ while being invisible in a
file-level diff. Both would leave the number this device displays at boot
impossible to compare against anything.

Every identifier is instead derived from the release version by
`provisioning/checks/identifiers.mjs`, so a third party recomputes it with
coreutils rather than with our tool:

```
printf 'nullroute/verity-salt/0.4.0' | sha256sum
```

To see those verifiers fail on purpose, use `make fixture-image`. It writes a
synthetic image with the superblocks and the partition table at the offsets the
published formats put them at, then another with a drifting salt so the
verifier can be watched failing. It is not bootable. The real image is checked
by the same verifiers through `make verify-image` and `make image-repro`.

The design is being written against a specific requirement: that building a new
nullroute on any supported board is a repeatable, checkable operation, and that
the build system is layered so support for a second distribution is a matter of
adding a backend rather than rewriting the tooling.

---

## Reporting a verification failure

If any check in this document fails, treat it as a security issue and report
it privately. See [SECURITY.md](../SECURITY.md).

Include the commit, the root hash you computed, the root hash the device
displayed, and the exact commands you ran.
