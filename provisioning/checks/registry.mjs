/**
 * The verifiers a profile assertion may name, and which of them exist.
 *
 * THE PROBLEM THIS SOLVES. `provisioning/README.md` argues that a profile
 * assertion without an executable verifier "reads as a guarantee and checks
 * nothing", and INV-PROV-1 asserts that every assertion carries one. All
 * sixteen named a verifier. None existed. `provisioning/checks/` was an empty
 * directory and `make profiles` reported "2 profile(s) valid", because it
 * checked that the `check:` string was non-empty and never that it pointed at
 * anything.
 *
 * So INV-PROV-1 was false about itself, in the one document whose entire thesis
 * is that unfalsifiable abstractions are worthless. That is the failure the
 * design was written to prevent, occurring in the design.
 *
 * This registry makes the gap countable. Every verifier a profile may name is
 * declared here with its status, `make profiles` refuses a `check:` that is not
 * declared, and the count of implemented versus declared is printed on every
 * run so the number is visible rather than discovered.
 *
 * STATUS VALUES.
 *   implemented  the verifier runs and returns a verdict.
 *   needs-image  it cannot run until there is a built image to inspect, which
 *                is blocked on the build system itself.
 *   needs-device it can only be observed on a running device, because reading
 *                it from an unbooted rootfs produces confident false passes.
 *                See provisioning/README.md.
 */

/**
 * Verifiers that can only be observed on a running device.
 *
 * Kept here as well as in tools/check-profiles.mjs would be two lists that can
 * disagree, so the tool reads this one.
 */
export const RUNTIME_ONLY = new Set(['mount-options', 'no-listening-sockets', 'no-swap'])

export const VERIFIERS = {
  // --- Meta. These inspect the profiles themselves and need no artifact. ---
  'profile-self-check': {
    status: 'implemented',
    describes: 'every assertion in every profile names at least one declared verifier',
  },
  'verifier-ignores-backends': {
    status: 'implemented',
    describes: 'no verifier source reads the backends key of a profile',
  },
  'documented-weakness': {
    status: 'implemented',
    describes: 'an assertion that concedes a weakness says what it does not cover',
  },

  // --- Need a built image to inspect. Blocked on the build system. ---------
  'rebuild-identical': { status: 'needs-image', describes: 'two clean builds are byte-identical' },
  'absent-packages': { status: 'needs-image', describes: 'named packages are not installed' },
  'absent-paths': { status: 'needs-image', describes: 'named paths do not exist in the rootfs' },
  'cmdline-exact': { status: 'needs-image', describes: 'the kernel command line is exactly as pinned' },
  'identifiers-pinned': { status: 'needs-image', describes: 'package versions are pinned to a snapshot' },
  'partition-present': { status: 'needs-image', describes: 'the partition layout matches' },
  'systemd-exposure': { status: 'needs-image', describes: 'declared unit hardening scores as expected' },
  'no-unit-ordering': { status: 'needs-image', describes: 'no unit orders itself before the signer' },
  'verity-salt-pinned': { status: 'needs-image', describes: 'the dm-verity salt is pinned, not random' },

  // --- Need a running device. Reading these from an image lies. ------------
  'mount-options': { status: 'needs-device', describes: 'noexec and nosuid are actually enforced' },
  'no-listening-sockets': { status: 'needs-device', describes: 'nothing listens beyond loopback' },
  'no-swap': { status: 'needs-device', describes: 'no swap is active' },
  'daemon-starts-under-mdwe': {
    status: 'needs-device',
    describes: 'the daemon starts under MemoryDenyWriteExecute, which it currently does not',
  },
}

/** Verifiers that run today. */
export function implemented() {
  return Object.entries(VERIFIERS)
    .filter(([, meta]) => meta.status === 'implemented')
    .map(([name]) => name)
}
