# Hardening controls

What the built image does to itself, control by control, and what each one is
worth on this hardware.

This lived in `docs/VERIFICATION.md` until it was ten thousand characters of a
document a person reads to check a root hash. It is reference material for
whoever is editing a profile in this directory, not something a reader of the
website needs in order to decide whether to trust a signature, and it sat
between two sections they do need.

It is here rather than deleted because the profiles in `profiles/` assert a
subset of it, and the reasoning behind a control is what tells you whether a
verifier is measuring the right thing. `MANIFEST.lock` covers this directory, so
this file is inside the hash a user compares.

Read it as a specification with a status. `make image` builds a card, and
`make image-boot-test` boots it under QEMU. Nothing has been published yet, and
the rows here are observed under QEMU; observing them on the Pi itself comes
with hardware bring-up, which is next. A row marked not applied is a control this image does not have.
`README.md` in this directory carries the status of the verifiers that judge
it.

The controls below are the ones that matter for a single-purpose, air-gapped
device. That qualifier is doing real work: most published hardening baselines
(CIS, STIG) are written for multi-user networked servers, and a large fraction
of their controls are about SSH configuration, firewall rules, audit daemons,
password aging and login banners. On a device with no network, no interactive
users and one application, those controls are theater. Applying them anyway
would produce a longer checklist and no more security, and would make it harder
to see which controls are load-bearing.

## Removing the network, not disabling it

| Control | Implementation |
| --- | --- |
| No network daemons | `dhcpcd`, `wpa_supplicant`, `sshd` and `avahi` are absent from the image, not merely masked (INV-PROV-13, INV-PROV-16). `systemd-networkd` ships inside the `systemd` package and is not removed |
| Loopback only | The kernel network stack is retained for the Unix domain socket and loopback IPC, and nothing binds beyond it (INV-NET-1) |
| No code path to a socket | Enforced in the application by a lint rule with its own regression suite (INV-NET-2), not by firewall configuration |

A firewall is not in this list on purpose. A firewall is a control that says
"this traffic is not allowed out". Having no network interface and no code that
can open a socket is a stronger statement, and adding a firewall on top would
suggest the weaker one was the real defence.

## Filesystem and data remanence

| Control | Implementation |
| --- | --- |
| Immutable root | Read-only root filesystem with an integrity hash tree over it, so modification is detected rather than merely discouraged |
| State partition | A separate plain ext4 partition holds the wallet store. It is not encrypted at the partition level: LUKS2 is planned and not built. The wallet is protected by the application's own Argon2id and AES-256-GCM envelope, which is one layer, not two |
| No swap | No swap device or file, confirmed on the running device (INV-PROV-11). Swap is how a seed reaches persistent storage in plaintext without anyone deciding it should |
| Scratch in RAM | `/tmp` on tmpfs, mounted `noexec,nosuid,nodev` |
| Removable media | Not applied. Nothing in the image mounts removable media: no automount, no udev rule, no mount unit. See the threat model's section on malicious QR or SD payloads |

## Kernel and process isolation

| Control | Implementation |
| --- | --- |
| Memory hygiene | Not applied. `init_on_alloc=1 init_on_free=1` are not on the pinned kernel command line (INV-PROV-21), so secrets are zeroed only by application code (INV-KEY-2) |
| Daemon sandbox | The signer runs under systemd with `ProtectSystem=strict`, `ProtectHome=true`, `PrivateTmp=true`, `PrivateUsers=true`, `PrivateNetwork=true`, `NoNewPrivileges=true`, an empty `CapabilityBoundingSet`, `RestrictAddressFamilies=AF_UNIX`, `IPAddressDeny=any`, and a `@system-service` syscall filter |
| Device access | `DevicePolicy=closed` with `DeviceAllow=/dev/hwrng r` and nothing else |
| No shell on the console | The device boots into the kiosk, not into a login prompt |

`RestrictAddressFamilies=AF_UNIX` and `IPAddressDeny=any` are worth calling out:
they mean that even if every application-level defence failed and code tried to
open an internet socket, the kernel would refuse. They are the backstop behind
INV-NET-2, which is otherwise enforced only by a lint rule.

## Three claims this document deliberately does not make

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

## How the hardening is checked

A checklist nobody verifies is prose. Each control above is machine-checked, at
the point where it can actually be observed:

- **At build time**, against the unbooted image, with
  `systemd-analyze security --offline=true --root=<rootfs> --json=short`. This
  is the one standard tool that machine-checks real unit hardening offline, with
  no network and no booted system, and it emits JSON that binds into the same
  spec system the application code uses.
- **At build time**, by asserting on the plain text a human can also read:
  `cmdline.txt` (`cmdline-exact`), `config.txt` (`boot-config-display`), the
  absence of `openssh-server`, `chrony`, `auditd` and `cron` from the package
  list (`absent-packages`), the absence of named paths including `/dev/rtc0`
  (`absent-paths`), and file modes and ownership (`file-modes`). Greppable and
  hashable, which preserves hand-verifiability.
- **At first boot on the device**, for the facts that are provably invisible to
  offline inspection: actual mount options from `/proc/mounts`
  (`mount-options`), no listening socket outside `AF_UNIX` except the permitted
  loopback bridge (`no-listening-sockets`), and no active swap (`no-swap`).

Each name in brackets is a verifier in `checks/registry.mjs`, which is the list
`make profiles` counts and `make verify-image` runs.

**WHAT THIS LIST USED TO CLAIM AND DOES NOT CHECK.** It named `/etc/fstab` and
`/etc/sysctl.d/*` at build time, and actual `/proc/sys` values and actual unit
state at first boot. No assertion in either profile mentions any of them and no
verifier reads them: `sysctl-values` and `unit-state` appear as names in
`RUNTIME_ONLY_CHECKS` in `tools/checks/check-profiles.mjs`, which classifies
what a check WOULD need if it existed, and neither is in the registry. A
document claiming four machine-checks that do not exist is the failure this
directory argues against, in the file that argues it.

It also listed `/dev/hwrng` present. That one is observed, and not by this
system: the daemon's entropy health refuses a source it cannot read and reports
unknown rather than healthy (INV-ENTHEALTH-1). It is not a provisioning
assertion and does not belong on this list.

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

## The standard this follows

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

## The kiosk

Chromium runs against localhost with background networking, sync, translation,
component updates and first-run behaviour all disabled. The flags matter less
than the fact that there is nothing for them to reach: verify with `ss` that no
connection is ever attempted, rather than trusting a flag list.

## No wall clock

The Pi has no battery-backed real time clock. The device therefore **never
depends on wall time for anything cryptographic**. Rate limiting uses monotonic
time. Any design that needs "now" to be correct is wrong on this hardware, and
that constraint is easier to hold if it is stated up front.
