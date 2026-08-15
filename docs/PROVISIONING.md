# Provisioning a nullroute device

How to turn a Raspberry Pi into a nullroute signer, and how to check that the
one you built is the one we published.

This document covers the hardware, the hardening applied to the operating
system, and the verification you can perform before and after flashing. The
image build system itself is under active design; see
[Status](#status-of-this-document).

**Related:** [Threat model](THREAT-MODEL.md), [Verification](VERIFICATION.md)

---

## Why this document exists

`docs/THREAT-MODEL.md` concedes something important:

> It does not verify the operating system. If the Raspberry Pi OS image you
> flashed was already backdoored, the root hash it displays is whatever the
> backdoor wants it to say.

That is an honest statement of a real gap, and it is the gap this work closes.
An application-level verification system sitting on an unverifiable operating
system is a lock on a door in a wall made of paper. Every guarantee in
`docs/VERIFICATION.md` is conditional on the code that runs it, and until the
image is verifiable, that condition is unmet.

The goal is that provisioning becomes a **checkable operation** rather than a
folder of shell scripts someone runs by hand.

---

## Hardware

Target build is under $120.

| Part | Choice | Notes |
| --- | --- | --- |
| Board | Raspberry Pi 4 (4GB) or Pi 5 | Pi 5 is preferred: its BCM2712 supports a signed boot chain the Pi 4 does not. Pi Zero 2 W works but has no secure boot path and a slower Argon2id. |
| Display | 7 inch 800x480 touchscreen | Any small HDMI display works. The UI is designed for 800x480 and scales up. |
| Camera | Pi Camera Module 3 | Optional. Without it, use SD card transport and build in camera-less mode. |
| Storage | 16GB+ SD card, A2 class | The image is small; the class rating matters for Argon2id-adjacent I/O, not capacity. |
| Case | Any | Consider one that makes tampering visible rather than one that looks nice. |
| Power | Official PSU | An underpowered supply causes undervoltage throttling, which shows up as inexplicable slowness. |

**Radios.** On any board with wifi or Bluetooth, both are disabled at two
levels, and neither level alone is sufficient:

- `dtoverlay=disable-wifi` and `dtoverlay=disable-bt` in `config.txt`
- the `firmware-brcm80211` and `bluez` packages removed from the image, so the
  hardware cannot function even if someone reverts the overlay
- `brcmfmac`, `brcmutil`, `btbcm`, `hci_uart`, `cfg80211` and `bluetooth`
  blacklisted in modprobe config

If you want physical certainty rather than configuration certainty, use a board
with no radio hardware at all. Configuration can be changed by whoever holds the
card; a missing chip cannot.

---

## What the hardening actually does

The controls below are the ones that matter for a single-purpose, air-gapped
device. That qualifier is doing real work: most published hardening baselines
(CIS, STIG) are written for multi-user networked servers, and a large fraction
of their controls are about SSH configuration, firewall rules, audit daemons,
password aging and login banners. On a device with no network, no interactive
users and one application, those controls are theater. Applying them anyway
would produce a longer checklist and no more security, and would make it harder
to see which controls are load-bearing.

### Removing the network, not disabling it

| Control | Implementation |
| --- | --- |
| No network daemons | `dhcpcd`, `wpa_supplicant`, `sshd`, `avahi` and `systemd-networkd` are absent from the image, not merely masked |
| Loopback only | The kernel network stack is retained for the Unix domain socket and loopback IPC, and nothing binds beyond it (INV-NET-1) |
| No code path to a socket | Enforced in the application by a lint rule with its own regression suite (INV-NET-2), not by firewall configuration |

A firewall is not in this list on purpose. A firewall is a control that says
"this traffic is not allowed out". Having no network interface and no code that
can open a socket is a stronger statement, and adding a firewall on top would
suggest the weaker one was the real defence.

### Filesystem and data remanence

| Control | Implementation |
| --- | --- |
| Immutable root | Read-only root filesystem with an integrity hash tree over it, so modification is detected rather than merely discouraged |
| Encrypted state | A separate LUKS2 partition holds the wallet store, unlocked with a key derived from the user PIN |
| No swap | `dphys-swapfile` disabled and purged. Swap is how a seed reaches persistent storage in plaintext without anyone deciding it should |
| Scratch in RAM | `/tmp` on tmpfs, mounted `noexec,nosuid,nodev` |
| Removable media | Mounted `noexec,nosuid,nodev`. Nothing is ever auto-executed from an SD card or USB device |

### Kernel and process isolation

| Control | Implementation |
| --- | --- |
| Memory hygiene | `init_on_alloc=1 init_on_free=1` on the kernel command line, so freed pages are zeroed by the kernel rather than only by application code |
| Daemon sandbox | The signer runs under systemd with `ProtectSystem=strict`, `ProtectHome=true`, `PrivateTmp=true`, `PrivateUsers=true`, `PrivateNetwork=true`, `NoNewPrivileges=true`, an empty `CapabilityBoundingSet`, `RestrictAddressFamilies=AF_UNIX`, `IPAddressDeny=any`, and a `@system-service` syscall filter |
| Device access | `DevicePolicy=closed` with `DeviceAllow=/dev/hwrng r` and nothing else |
| No shell on the console | The device boots into the kiosk, not into a login prompt |

`RestrictAddressFamilies=AF_UNIX` and `IPAddressDeny=any` are worth calling out:
they mean that even if every application-level defence failed and code tried to
open an internet socket, the kernel would refuse. They are the backstop behind
INV-NET-2, which is otherwise enforced only by a lint rule.

### Three claims this document deliberately does not make

Each of these is a hardening measure that reads well, appears in most
checklists, and does not do what it appears to do on this hardware. Writing them
down as applied would be exactly the kind of overclaim this project treats as a
defect.

**Kernel lockdown is not enabled, because it cannot be.** Passing `lockdown=` on
the kernel command line is a no-op on stock Raspberry Pi kernels: the
`rpi-6.12.y` defconfig does not build `CONFIG_SECURITY_LOCKDOWN_LSM`. Enabling
it would mean shipping a custom kernel, which makes this project a kernel
maintainer with a permanent CVE backlog. If a future release does ship one, this
paragraph changes.

**AppArmor confinement is not claimed.** AppArmor is compiled into the Pi kernel
but inert, because the defconfig sets `CONFIG_LSM=""`. It does nothing until
`lsm=apparmor` is passed on the command line. Where profiles are shipped, that
parameter is set and the fact is checked at build time; where it is not, the
confinement is decorative and is not counted.

**`MemoryDenyWriteExecute` is not set on the daemon.** It is the single most
effective directive in the list and it crashes Node: V8's baseline compiler
needs writable-then-executable pages, and the process dies during startup. It
works under `node --jitless`, and that was previously described here as an
acceptable trade for a workload that is not throughput bound. **That is no
longer true.** The wallet store stretches its passphrase with Argon2id from
`@noble/hashes`, which is pure JavaScript, and an interpreter with no JIT runs
it roughly fifty times slower. Measured at the shipped parameters of 64 MiB and
three passes: 643 ms with the JIT and 34.4 seconds without it, on a development
machine considerably faster than a Pi.

Adopting the directive therefore now costs one of three things: minutes per
unlock attempt, a much weaker key derivation, or a native or WASM Argon2
implementation and the supply-chain review that comes with it. None of those is
obviously right, so the directive stays absent and this paragraph records why
rather than leaving a future reader to rediscover it with a stopwatch. The
constant-time re-validation problem also still applies.

The Chromium kiosk cannot be hardened anywhere near the daemon, and averaging
the two would hide that. Chromium's own sandbox requires unprivileged user
namespaces, so the directives that make the daemon safe (`PrivateUsers=true`,
`RestrictNamespaces=~user`) force `--no-sandbox`, which is strictly worse than
a slightly higher exposure score. **The browser is the weakest component on the
device.** The design response is to keep trust out of it: the daemon holds the
keys, and the frontend receives only xpubs, addresses, descriptors and PSBTs
(INV-KEY-1).

### How the hardening is checked

A checklist nobody verifies is prose. Each control above is machine-checked, at
the point where it can actually be observed:

- **At build time**, against the unbooted image, with
  `systemd-analyze security --offline=true --root=<rootfs> --json=short`. This
  is the one standard tool that machine-checks real unit hardening offline, with
  no network and no booted system, and it emits JSON that binds into the same
  spec system the application code uses.
- **At build time**, by asserting on the plain text a human can also read:
  `cmdline.txt`, `config.txt`, `/etc/fstab`, `/etc/sysctl.d/*`, and the absence
  of `openssh-server`, `chrony`, `auditd` and `cron` from the package list.
  Greppable and hashable, which preserves hand-verifiability.
- **At first boot on the device**, for the facts that are provably invisible to
  offline inspection: actual `/proc/sys` values, actual mount options from
  `/proc/mounts`, actual unit state, zero listening sockets, `/dev/hwrng`
  present, `/dev/rtc0` absent.

That last split is not fastidiousness. Offline compliance scanning of a built
image produces **false passes** on exactly the controls that matter here: a scan
of an unbooted rootfs reports `noexec` and `nosuid` mount options as passing
while simultaneously reporting that the partition in question does not exist.
The checks pass vacuously because `/proc/mounts` is absent. A gate that can
report success for hardening that was never applied is worse than no gate, so
mount options and kernel parameters are verified on the running device or not
counted.

`systemd-analyze security` has an honest limit too, and it is stated here rather
than in a footnote: **it measures declared directives, not enforced behaviour.**
A good score certifies that a unit file asks for sandboxing. It certifies
nothing about what the binary does inside that sandbox. It is a configuration
linter, and treating its number as a security measurement would be an overclaim.
Its weights also change between systemd releases, so the systemd version used
for verification is pinned and recorded in the report.

### The standard this follows

**ANSSI-BP-028**, cited by control id, rather than CIS or DISA STIG.

ANSSI is the only one of the three with maintained first-class Debian profiles,
and its levels suit an appliance. CIS Debian control ids are referenced where
they genuinely apply.

What is not done is shipping a scanner and reporting a compliance percentage.
Roughly 125 of the 343 controls in the CIS Debian benchmark are irrelevant or
actively wrong on this device. The `auditd` family (55 controls), `sshd` (23),
PAM (25), password aging (17), banners (6) and firewall (5) are vacuous with no
network, no interactive users and one application, and the time synchronisation
family (6) would actively violate this device's no-network and no-wall-clock
constraints. Publishing that reasoning is worth more than a percentage, and a
high score achieved by applying controls that do nothing would be actively
misleading.

### The kiosk

Chromium runs against localhost with background networking, sync, translation,
component updates and first-run behaviour all disabled. The flags matter less
than the fact that there is nothing for them to reach: verify with `ss` that no
connection is ever attempted, rather than trusting a flag list.

### No wall clock

The Pi has no battery-backed real time clock. The device therefore **never
depends on wall time for anything cryptographic**. Rate limiting uses monotonic
time. Any design that needs "now" to be correct is wrong on this hardware, and
that constraint is easier to hold if it is stated up front.

---

## The three tiers

Provisioning is staged, because the strongest option is irreversible and the
useful option is not. Never describe a lower tier using a higher tier's
language.

| Tier | What it establishes | What it costs | Lands |
| --- | --- | --- | --- |
| 0 | The image you flashed is the image that was published, and the published image was built from the published source. | Nothing irreversible. Works on any supported board. | Phase 2 |
| 1 | The system partition has not been modified since the build, and the device says so at boot. | A more involved build. Still reversible. | Phase 3 |
| 2 | The boot chain itself is verified by the silicon, so the root hash the device shows cannot be chosen by an attacker. | **Irreversible.** Burns one-time fuses. Losing the signing key bricks every device provisioned with it. | Phase 7 |

**Tier 0 is the one that answers "let me spin up another one".** It needs no
fuses burned, no key custody, and no special hardware, and it is the default.

**Tier 1's limit is the important one.** A dm-verity hash tree means the system
partition cannot be altered without changing its root hash. But the boot
partition is not covered, and the root hash is passed to the kernel from there.
An attacker who rewrites the boot partition supplies their own `roothash=` and
their own initramfs, and the device displays exactly the number they chose. Tier
1 raises the bar and gives an attentive user a chance to notice. It does not
close the gap.

**Tier 2 closes it, at a real price.** The root hash travels inside an image the
BootROM verifies against a key whose hash is fused into the chip. The chain runs
from silicon to every block of the root filesystem. It also means the earliest
link is closed-source code nobody outside Raspberry Pi can audit, so the honest
description is that tier 2 moves the question from "do you trust this SD card"
to "do you trust this BootROM", which is better without being elimination.

---

## Verifying an image

The design principle is the one already load-bearing elsewhere in this project:
**you check our tool with someone else's tools.** A verification procedure that
requires running a nullroute binary to check a nullroute image is not
verification. Every command below is `sha256sum`, `minisign`, `dd` or
`veritysetup`, none of which are ours.

### The published artifact set

A release publishes, alongside the image:

| File | What it is |
| --- | --- |
| `nullroute-<version>.img.xz` | The image |
| `SHA256SUMS` | Plain `sha256sum` output covering every other file in the set |
| `SHA256SUMS.minisig` | Detached signature over `SHA256SUMS` |
| `system.roothash` | The dm-verity root hash, tier 1 and above |
| `BUILD.lock` | Every value the build pinned to be deterministic: the epoch, the snapshot timestamp, the verity salt, and every UUID and GUID |
| `PACKAGES.lock` | Exact package list, `dpkg-query` output sorted under `LC_ALL=C` |
| `DEBS.lock` | Every contributing `.deb` with a sha256 and a resolvable pool URL |
| `sbom.spdx.json` | Software bill of materials |
| `REPRODUCE.md` | How to rebuild it and arrive at the same hashes |

Note the shape of `SHA256SUMS`: it is the same choice as `MANIFEST.lock`, for
the same reason. One file, in the output format of a tool that already exists on
every machine, so `sha256sum -c` checks the set and `minisign -V` checks the
file.

### Before flashing

```console
$ minisign -Vm SHA256SUMS -P <the project public key>
$ sha256sum -c SHA256SUMS
```

The public key appears verbatim in this repository, in the release, and on the
device's own boot screen. Compare all three: a key you fetched from the same
place as the file it verifies is not an independent check.

### After flashing

Read the card back and confirm the bytes that landed are the bytes you wrote.
This catches a failing SD card as readily as a tampered one:

```console
$ sudo dd if=/dev/<card> bs=4M count=<image size> | sha256sum
```

Then, at tier 1 and above, confirm the hash tree over the system partition:

```console
$ sudo veritysetup verify /dev/<card>p2 /dev/<card>p3 $(cat system.roothash)
```

### At boot

The lock screen shows exactly two hashes: the dm-verity root hash of the system
partition, and `sha256sum MANIFEST.lock` for the application. Compare both
against the release.

**Both numbers are reported by the software you are looking at.** That is not a
reason to skip reading them, and it is a reason not to treat them as proof on
their own. They catch an accident, a failed write, and an unsophisticated
substitution. Until tier 2, they do not catch an attacker who replaced the code
that draws them.

### Reproducing the build

The strongest check available, and the only one that does not rely on us at all,
is to build the image yourself and compare hashes. `REPRODUCE.md` in each
release gives the exact commands, the pinned builder commit, and the snapshot
timestamp.

Where reproducibility stops short, that is stated rather than glossed. Until the
image reproduces byte-identically across different machines, different paths and
different times, the honest claim is a reproducible root filesystem and a
non-reproducible disk image, and nothing stronger.

---

## What provisioning does not solve

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
supplies their own `roothash=` on the kernel command line along with their own
initramfs. The device then cheerfully displays whatever root hash the attacker
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
package inputs to remain fetchable at the versions used. Where an upstream
archive offers no snapshot service, the mitigation is to record and publish the
hashes of every input, so a future verifier can at least confirm what went in
even if they can no longer reassemble it themselves.

---

## Status of this document

The hardware, the hardening controls and the constraints above are settled and
will not change materially.

The image build system, the exact verification commands, and the boot
attestation chain are in active design. That work also revisits the phase plan,
because provisioning turned out to be foundational rather than the phase 7
footnote the original brief made it: an unverifiable operating system undercuts
every application-level guarantee this project makes.

The design is being written against a specific requirement: that building a new
nullroute on any supported board is a repeatable, checkable operation, and that
the build system is layered so support for a second distribution is a matter of
adding a backend rather than rewriting the tooling.
