# Provisioning

The build system that turns a supported board into a verified nullroute device.

Two ideas govern the design, and both come from what already makes
`MANIFEST.lock` worth having.

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
  backends/             Per-distribution build recipes. Advisory.
  checks/               Verifier implementations, keyed by assertion `check`
```

## Status

The profile schema and the assertion set are being defined first, before any
backend, so that the first backend is written against a contract rather than the
contract being reverse-engineered from whatever the first backend happened to
do.

See [docs/PROVISIONING.md](../docs/PROVISIONING.md) for the tier model, the
hardware, and the honest limits.
