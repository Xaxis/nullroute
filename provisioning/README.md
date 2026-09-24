# Provisioning

The build system that turns a supported board into a verified nullroute device.

Two ideas govern the design, and both come from what already makes
`MANIFEST.lock` worth having.

| File | What it is |
| --- | --- |
| [HARDENING.md](HARDENING.md) | Every control the image applies, why, and what three of them are worth on this hardware, which is less than they look |
| `profiles/*.yaml` | Assertions about the built artifact, each with a verifier |
| `checks/*.mjs` | The verifiers. They read artifacts, never recipes |
| `build/` | The pinned Linux host and the script that builds a system partition |
| `units/` | The systemd units that ship in the image |

HARDENING.md is the reasoning; the profiles assert a subset of it. A verifier
measuring the wrong thing is easiest to spot by reading why the control exists,
so the two belong next to each other.

## 1. A profile is a set of assertions, not a recipe

The obvious way to support more than one distribution is a templating layer: one
configuration file that compiles down to a pi-gen stage, a Buildroot fragment, a
NixOS module. That abstraction is **unfalsifiable**. If a backend quietly fails
to implement one of the hardening rules, nothing catches it, and the profile
still says the rule is applied.

So the inversion: a profile states **what must be true of the built artifact**,
and every assertion carries a verifier that inspects the artifact itself. The
backend is a hint about how to get there. The verifier is the contract.

```
profile assertion  ->  "no package matching openssh-server is installed"
backend            ->  (advisory) "rpi-image-gen: omit from bdebstrap packages"
verifier           ->  reads var/lib/dpkg/status in the built rootfs
```

A backend that forgets the rule fails the verifier. A new backend is correct
when the verifiers pass, not when someone reviewed its recipe. That is the same
reason the manifest is `sha256sum` output rather than a bespoke format: the
check does not depend on trusting the thing being checked.

## 2. Verify where the fact is actually observable

Some properties can be read from an unbooted image. Some cannot, and pretending
otherwise produces confident false answers.

Offline compliance scanning of a built image emits **demonstrable false passes**.
A scan of an unbooted rootfs will report `noexec` and `nosuid` mount options as
passing while the same scan reports that the partition does not exist. The mount
checks pass vacuously because `/proc/mounts` is absent. A gate that reports
success for hardening that was never applied is worse than no gate.

Each assertion therefore declares **where** it is checked:

| Stage | Reads | Good for |
| --- | --- | --- |
| `image` | The built artifact: files, package lists, unit files, config text | Package presence, file content, unit hardening directives, partition layout |
| `boot` | The running device on first boot | Mount options, `/proc/sys` values, unit state, listening sockets, device nodes |

An assertion that could only be answered by a running system is not allowed to
claim `image` stage. That rule is what keeps the build gate honest.

## Layout

```
provisioning/
  schema.json           JSON Schema for a hardening profile
  profiles/             The profiles themselves, one per device class
  backends/             Per-distribution build recipes. Advisory, and unrun.
  checks/               Verifier implementations, keyed by assertion `check`
```

**No backend has ever been run here.** Building needs `mmdebstrap`,
`veritysetup` and `genimage`, which are Linux tools, and this repository is
developed on macOS. `make profiles` runs `check-backends`, which enforces that a
recipe on disk is declared in a profile, that a recipe whose profile says
`planned` says so in its own README, and that every patch a recipe requires
exists. It does not and cannot check that a recipe works: `make verify-image`
against real output is the only thing that answers that.

## Running the verifiers

There are two kinds of artifact and they answer different questions.

A **root filesystem directory** answers what is in the files: which packages are
installed, which paths exist, what a unit declares, what the bootloader passes
on the kernel command line.

An **image file** answers what is in the bytes between and underneath
filesystems: the partition table, the dm-verity superblock, filesystem
identifiers. A directory of files cannot answer any of those, and a verifier
pointed at the wrong one says so rather than passing.

```
make verify-image ROOT=/path/to/assembled/rootfs
make verify-image IMAGE=build/nullroute.img COMPARE=build/nullroute-again.img
```

Neither is mounted. Mounting or loop-mounting needs root, and a verification
tool that has to run privileged is one people run less often. The build backend
already has the tree it assembled, and an image is read at an offset, which
works on any operating system.

`COMPARE` is a second build. Without it the reproducibility assertion reports
could-not-run rather than passing, because one file compared against nothing is
not evidence that two builds agree.

### Before there is a backend

```
make fixture-image
```

writes a synthetic image with this release's pinned identifiers, runs the image
verifiers against it, and then writes a third with a drifting dm-verity salt so
the verifier can be watched failing. A verifier nobody has seen fail is a
verifier nobody knows works.

It is not bootable and is not an image of anything. What it proves is that the
verifiers read the offsets they claim to read, and that the derivation the build
will use and the derivation the verifier checks are the same function. Whether
they agree with what the real build writes is answered by pointing `make
verify-image` at `out/system/nullroute.img`, which CI does.

### Where the pinned values come from

A profile states WHICH partitions are pinned. WHAT the pinned value is comes
from `provisioning/checks/identifiers.mjs`, derived from the release version. A
profile holding literal hex would need editing every release, and the release
where somebody forgot is the release where the assertion silently stops meaning
anything.

Every value is SHA-256 of a short ASCII string, so a third party recomputes it
with coreutils rather than with our tool:

```
printf 'nullroute/verity-salt/0.4.0' | sha256sum
```

That is the same argument `MANIFEST.lock` rests on. None of it is a secret: a
verity salt is published and is part of what a user compares, and its job in
dm-verity is domain separation between images rather than unpredictability.

There are **three** outcomes, not two: satisfied, failed, and could-not-run. An
assertion whose verifiers are all unwritten, or whose verifier could not run
because the artifact lacks a dpkg database or the machine lacks
`systemd-analyze`, prints as `not checked` and is never counted as satisfied.

Collapsing could-not-run into failed prints a red FAIL because a tool is not
installed, which trains a reader to ignore red, and the pressure to clear that
red is pressure to make a missing tool return true. Collapsing it into satisfied
is the false pass this whole document is about. An assertion where one verifier
agreed and another could not run is not satisfied either: it is only as strong
as its weakest verifier, and one of them was blind.

## Status

The profile schema and the assertion set are being defined first, before any
backend, so that the first backend is written against a contract rather than the
contract being reverse-engineered from whatever the first backend happened to
do.

Twenty-one of the twenty-one verifiers are written. Four inspect the profiles
and the documents they cite, and run on every commit. Eight read a root filesystem, six read a
whole image (two builds to compare, a partition table, a verity superblock, the
boot partition's file list, and the overlays config.txt loads), and the
remaining three need a booted device: mount options, listening sockets and swap.

The last two are both about the display, and the first of them failed the
moment it was written. Nothing in this profile said anything about the display
until the panel turned out not to be described in any device tree the image
carries, which is the whole product failing quietly in the one place no
assertion was looking. The twentieth closes what the nineteenth left open:
config.txt can name an overlay that is not on the card, the firmware ignores it
without a word, and the panel stays exactly as dark.

Those last three used to be unwritten on purpose, because reading any of them
from an unbooted rootfs is the false pass described above. They are written now,
and the split is what makes them honest. `nullroute-runtime-facts.service` runs
on the booted device and prints six files from `/proc` to the console, marking
each section and saying how many lines it printed. It reaches no verdict at all.
`provisioning/checks/runtime.mjs` parses that log on the host and decides,
against the profile, under the manifest.

The artifact under test does not get to grade itself. A `PASS` printed by a
script inside the image can only be believed; raw evidence in a log can be
re-judged by anyone who has the log. The line counts are there because a
console cut off mid-dump has no swap and no listening sockets, which is
indistinguishable from a clean device, so a short read is an error rather than
an empty set. For the same reason `no-listening-sockets` requires the permitted
listener to be PRESENT: without that, the earliest possible sample is the one
most likely to pass.

Run them with `make verify-runtime` after `make image-boot-test`, or directly
with `make verify-image CONSOLE=<log>`.

One of the rootfs verifiers, `systemd-exposure`, also needs `systemd-analyze`
on the machine running it, and reports could-not-run rather than passing when it
is absent. `systemd-analyze` is a Linux tool and much of this project is written
on macOS, so INV-PROV-18 and INV-PROV-19, the two exposure thresholds for the
units, go unchecked on a workstation. The `image` job in CI closes that: it runs
`make image-system` and then `make verify-image` with
`REQUIRE=INV-PROV-18,INV-PROV-19`, so a missing tool there fails the job rather
than passing quietly. Nothing built by that job is published, and none of it has
run on a Raspberry Pi.

These counts are checked against the registry by `make profiles`, because a
status paragraph is exactly the kind of prose that goes stale the first time
somebody writes a verifier and does not think to count again.

The first thing `make verify-image` found, on its first run against a fixture,
was that INV-PROV-21 asserted the kernel command line matched "the pinned token
set exactly" and pinned nothing. The check was declared, the parameter was
absent, and the verifier had nothing to compare against.

See [Building a device](../docs/VERIFICATION.md#building-a-device) for the tier
model, the hardware, and the honest limits.
