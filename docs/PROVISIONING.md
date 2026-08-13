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
| Module loading | Locked down after boot, so a module cannot be inserted at runtime |
| Memory hygiene | `init_on_alloc=1 init_on_free=1` on the kernel command line, so freed pages are zeroed by the kernel rather than only by application code |
| Daemon sandbox | The signer runs under systemd with `ProtectSystem=strict`, `ProtectHome=yes`, `PrivateTmp=yes`, `PrivateDevices=yes` (with `/dev/hwrng` explicitly allowed), `NoNewPrivileges=yes`, `MemoryDenyWriteExecute=yes`, an empty `CapabilityBoundingCommon`, and `RestrictAddressFamilies=AF_UNIX` |
| No shell on the console | The device boots into the kiosk, not into a login prompt |

`RestrictAddressFamilies=AF_UNIX` is worth calling out: it means that even if
every application-level defence failed and code tried to open an internet
socket, the kernel would refuse. It is the backstop behind INV-NET-2.

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

## Verifying an image

The full procedure lands with the image build system. The shape it will take,
consistent with how `MANIFEST.lock` already works, is:

**Before flashing.** Check the published `sha256` of the image and a detached
signature over it, using tools that are not ours. That is one hash command and
one signature-verification command.

**After flashing.** Read the card back and confirm it matches what you wrote,
then confirm the integrity hash tree over the system partition verifies. This
catches a bad write as well as a tampered one.

**At boot.** The device displays the integrity root hash of its own system
partition alongside the application manifest root hash, before unlock. Two
numbers, both comparable against what was published.

The design principle is the one already load-bearing elsewhere in this project:
**you check our tool with someone else's tools.** A verification procedure that
requires running a nullroute binary to check a nullroute image is not
verification.

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

**An integrity hash tree detects modification; it does not prevent it.** An
attacker with the card can replace the system partition. What they cannot do is
make the replacement produce the same root hash, so the device notices. That
only helps if someone reads the number.

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
