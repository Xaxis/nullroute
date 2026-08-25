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
 *   implemented  the verifier runs and returns a verdict. Some of these need an
 *                artifact to point at and are still implemented: they take a
 *                root filesystem DIRECTORY rather than an image, so they are
 *                exercised against a fixture tree today and the only thing
 *                missing on the day an image exists is the image.
 *   needs-image  it cannot run until there is a built image to inspect, which
 *                is blocked on the build system itself. What is left here
 *                genuinely needs the whole artifact: two builds to compare, a
 *                partition table, a verity superblock.
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

  // --- Read a built image file. Implemented, and waiting for an image. -----
  //
  // These were `needs-image` and are not any more. The distinction that
  // mattered was never "is there an image yet", it was "does the verifier
  // exist": a backend is supported when the UNCHANGED verifiers pass against
  // its output, so writing them AFTER the backend would mean writing them to
  // agree with whatever it happened to produce. They read a file at an offset,
  // which needs no mounting and no Linux, and they are exercised against a
  // synthetic image today.
  'rebuild-identical': {
    status: 'implemented',
    describes: 'two clean builds are byte-identical',
  },
  // --- Read a root filesystem. Implemented, and take a directory. ----------
  // Whether a file is in a filesystem, what the package database says, what a
  // unit declares and what the bootloader is configured to pass are properties
  // OF THE ARTIFACT. Reading them from the artifact is the whole claim rather
  // than a proxy for a runtime property, which is what separates these from the
  // needs-device three below.
  'absent-packages': {
    status: 'implemented',
    describes: 'named packages are not installed, read from the rootfs dpkg database',
  },
  'absent-paths': {
    status: 'implemented',
    describes: 'named paths do not exist in the rootfs',
  },
  'no-unit-ordering': {
    status: 'implemented',
    describes: 'no systemd unit declares itself before the signer',
  },
  'systemd-exposure': {
    status: 'implemented',
    describes:
      'a unit DECLARES hardening within its allowance, which is a configuration lint rather than a measurement of enforced behaviour',
  },
  'cmdline-exact': {
    status: 'implemented',
    describes:
      'the bootloader is configured to pass exactly the pinned kernel command line, which is not the same as the line the kernel received',
  },
  'identifiers-pinned': {
    status: 'implemented',
    describes: 'every GPT GUID, filesystem UUID and FAT volume id is the pinned one',
  },
  'partition-present': {
    status: 'implemented',
    describes: 'the partition layout matches',
  },
  'verity-salt-pinned': {
    status: 'implemented',
    describes: 'the dm-verity salt is pinned, not generated per build',
  },

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

/**
 * Verifiers that read a root filesystem, so they need an artifact to run.
 *
 * Implemented and not yet runnable in CI are different things, and reporting
 * only the first number would say "seven verifiers are checking this image"
 * when three are checking the profiles and four are waiting for a rootfs to
 * point at. This project treats that kind of rounding in its own favour as a
 * bug, so the two counts are printed separately.
 */
/**
 * Verifiers that read an IMAGE FILE rather than a directory of files.
 *
 * A partition table, a verity superblock and a filesystem UUID are not files.
 * They live in the bytes between and underneath filesystems, so a rootfs
 * directory cannot answer any of them, and a verifier pointed at one has to say
 * so rather than pass.
 */
export const NEEDS_IMAGE = new Set([
  'partition-present',
  'verity-salt-pinned',
  'identifiers-pinned',
  // And a SECOND image, which is why it reports could-not-run with one.
  'rebuild-identical',
])

/**
 * Verifiers that need no artifact at all.
 *
 * They read the profiles and the verifier sources rather than a build, so they
 * run in `make profiles` on every commit and are already satisfied by the time
 * anybody points `verify-image` at anything.
 *
 * NAMED HERE BECAUSE verify-image WAS LYING ABOUT THEM. Anything it could not
 * run was reported as "no --root given", so these two printed that even when a
 * root filesystem had been given, which is the class of small false statement
 * this whole directory exists to prevent. They are not unchecked; they are
 * checked somewhere else.
 */
export const NEEDS_NOTHING = new Set(['profile-self-check', 'verifier-ignores-backends'])

export const NEEDS_ROOTFS = new Set([
  'absent-packages',
  'absent-paths',
  'no-unit-ordering',
  'cmdline-exact',
  // Also needs `systemd-analyze` on the machine running it, which is a Linux
  // tool. It fails rather than passing when that is missing.
  'systemd-exposure',
])
