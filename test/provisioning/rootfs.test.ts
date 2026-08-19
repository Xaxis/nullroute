/**
 * Tests for the provisioning verifiers that read a root filesystem.
 *
 * These exist to be run against a real built image, and the image build system
 * is not written. That is exactly why they take a DIRECTORY rather than an
 * image: a fixture tree exercises every path through them today, so the day an
 * image exists the verifiers are already known to work and the only new thing
 * is the artifact.
 *
 * The hardest requirement here is not detecting a violation. It is refusing to
 * report a pass when the verifier could not look. `provisioning/README.md`
 * describes an offline scan reporting `noexec` as enforced while also reporting
 * that the partition does not exist, and "I could not look" rendering as "it is
 * absent" is the same failure in a different costume.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  absentPackages,
  absentPaths,
  cmdlineExact,
  matchesGlob,
  noUnitOrdering,
} from '../../provisioning/checks/rootfs.mjs'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'nullroute-rootfs-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** Put a file in the fixture rootfs, creating whatever it needs. */
function put(path: string, contents = ''): void {
  const full = join(root, path)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, contents)
}

/** A dpkg status stanza, in the format the real database uses. */
function dpkg(entries: readonly { name: string; status: string }[]): void {
  put(
    'var/lib/dpkg/status',
    entries.map((e) => `Package: ${e.name}\nStatus: ${e.status}\nVersion: 1.0\n`).join('\n')
  )
}

describe('provisioning.absent-paths', () => {
  /**
   * INV-PROV-13. A wireless driver present in the rootfs fails, and the verdict
   * names the file rather than only the rule it broke.
   */
  it('finds-a-path-that-must-not-be-there', () => {
    put('lib/modules/6.6.0/kernel/drivers/net/wireless/brcm/brcmfmac.ko')
    const result = absentPaths(root, {
      globs: ['lib/modules/*/kernel/drivers/net/wireless/**'],
    })
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('brcmfmac.ko')
  })

  it('passes-a-rootfs-with-no-radio-in-it', () => {
    put('lib/modules/6.6.0/kernel/drivers/net/ethernet/broadcom/bcmgenet.ko')
    put('lib/firmware/rpi/start.elf')
    const result = absentPaths(root, {
      globs: ['lib/modules/*/kernel/drivers/net/wireless/**', 'lib/firmware/brcm/**'],
    })
    expect(result.ok).toBe(true)
  })

  /**
   * A verifier given nothing to check must not report a pass. An assertion
   * whose params were dropped would otherwise go green while checking nothing,
   * which is the exact shape of the failure the profile system exists to stop.
   */
  it('refuses-to-pass-when-given-nothing-to-check', () => {
    expect(absentPaths(root, { globs: [] }).ok).toBe(false)
    expect(absentPaths(root, {}).ok).toBe(false)
  })

  it('matches-globs-the-way-the-profiles-expect', () => {
    // `*` stays inside a segment.
    expect(matchesGlob('lib/modules/6.6.0/x', 'lib/modules/*/x')).toBe(true)
    expect(matchesGlob('lib/modules/6.6.0/deep/x', 'lib/modules/*/x')).toBe(false)
    // `**` crosses them, and matches zero segments too.
    expect(matchesGlob('lib/firmware/brcm/a/b/c.bin', 'lib/firmware/brcm/**')).toBe(true)
    expect(matchesGlob('lib/firmware/brcm', 'lib/firmware/brcm/**')).toBe(false)
    // A dot is a dot, not "any character".
    expect(matchesGlob('etc/hosts', 'etc/host.')).toBe(false)
  })
})

describe('provisioning.absent-packages', () => {
  /**
   * INV-PROV-16. An installed SSH server fails, and a removed one does not.
   *
   * The distinction matters because removing a package leaves a
   * `deinstall ok config-files` stanza behind, and counting that as present
   * would fail every image built the way this one is.
   */
  it('sees-installed-packages-and-ignores-removed-ones', () => {
    dpkg([
      { name: 'openssh-server', status: 'install ok installed' },
      { name: 'chrony', status: 'deinstall ok config-files' },
      { name: 'nodejs', status: 'install ok installed' },
    ])

    const bad = absentPackages(root, { packages: ['openssh-server', 'chrony'] })
    expect(bad.ok).toBe(false)
    expect(bad.detail).toContain('openssh-server')
    // Removed, so not reported as present.
    expect(bad.detail).not.toContain('chrony')

    expect(absentPackages(root, { packages: ['chrony', 'ufw'] }).ok).toBe(true)
  })

  /**
   * INV-PROV-16. "I could not look" is not a pass.
   *
   * An image with no dpkg database is one this verifier cannot speak about, and
   * reporting absence from an absence of evidence is how a scan of an unbooted
   * rootfs comes to claim that `noexec` is enforced.
   */
  it('fails-rather-than-passing-when-there-is-no-package-database', () => {
    const result = absentPackages(root, { packages: ['openssh-server'] })
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('no dpkg database')
  })

  /**
   * The limit is carried in the verdict rather than left in a comment, because
   * package-level absence cannot see functionality linked into another binary
   * and a pass that implies otherwise overclaims.
   */
  it('states-what-package-absence-does-not-prove', () => {
    dpkg([{ name: 'nodejs', status: 'install ok installed' }])
    const result = absentPackages(root, { packages: ['openssh-server'] })
    expect(result.ok).toBe(true)
    expect(result.limits.join(' ')).toContain('linked into another binary')
  })

  it('refuses-to-pass-when-given-no-package-names', () => {
    dpkg([{ name: 'nodejs', status: 'install ok installed' }])
    expect(absentPackages(root, { packages: [] }).ok).toBe(false)
  })
})

describe('provisioning.no-unit-ordering', () => {
  /**
   * INV-PROV-17. A unit inserting itself ahead of the signer fails.
   *
   * Ordering is a declaration, so reading the declaration is the whole check
   * with nothing inferred about runtime.
   */
  it('finds-a-unit-that-orders-itself-before-the-signer', () => {
    put('usr/lib/systemd/system/nullrouted.service', '[Unit]\nDescription=nullroute daemon\n')
    put(
      'etc/systemd/system/telemetry.service',
      '[Unit]\nDescription=telemetry\nBefore=nullrouted.service\n'
    )
    const result = noUnitOrdering(root, {})
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('telemetry.service')
    expect(result.detail).toContain('Before=nullrouted.service')
  })

  /** Ordering AFTER the signer is ordinary and must not be reported. */
  it('allows-a-unit-that-orders-itself-after-the-signer', () => {
    put('usr/lib/systemd/system/nullrouted.service', '[Unit]\nDescription=nullroute daemon\n')
    put('usr/lib/systemd/system/kiosk.service', '[Unit]\nAfter=nullrouted.service\n')
    const result = noUnitOrdering(root, {})
    expect(result.ok).toBe(true)
    expect(result.detail).toContain('2 unit(s) read')
  })

  it('fails-rather-than-passing-a-rootfs-with-no-units-at-all', () => {
    const result = noUnitOrdering(root, {})
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('no systemd units')
  })
})

describe('provisioning.cmdline-exact', () => {
  const PINNED = 'console=tty1 root=/dev/mmcblk0p2 ro rootwait quiet'

  /**
   * INV-PROV-21. Exactly, not "contains". A parameter appended by a build step
   * is one nobody reviewed, and the point of pinning is that the set is closed.
   */
  it('fails-an-extra-parameter-and-names-it', () => {
    put('boot/firmware/cmdline.txt', `${PINNED} init=/bin/sh\n`)
    const result = cmdlineExact(root, { cmdline: PINNED })
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('unexpected: init=/bin/sh')
  })

  it('fails-a-missing-parameter-and-names-it', () => {
    put('boot/firmware/cmdline.txt', 'console=tty1 root=/dev/mmcblk0p2 rootwait quiet\n')
    const result = cmdlineExact(root, { cmdline: PINNED })
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('missing: ro')
  })

  it('accepts-the-pinned-line-whatever-the-spacing', () => {
    put('boot/firmware/cmdline.txt', `  console=tty1   root=/dev/mmcblk0p2 ro rootwait quiet  \n`)
    expect(cmdlineExact(root, { cmdline: PINNED }).ok).toBe(true)
  })

  it('reads-the-older-boot-path-too', () => {
    put('boot/cmdline.txt', PINNED)
    expect(cmdlineExact(root, { cmdline: PINNED }).ok).toBe(true)
  })

  /**
   * INV-PROV-21. The limit is stated in the verdict, because this reads what
   * the bootloader is CONFIGURED to pass and not what the kernel received. An
   * attacker who rewrote the boot partition supplies this file, and dm-verity
   * without a signed boot chain does not close that.
   */
  it('says-that-it-read-a-configuration-and-not-a-running-kernel', () => {
    put('boot/firmware/cmdline.txt', PINNED)
    const result = cmdlineExact(root, { cmdline: PINNED })
    expect(result.ok).toBe(true)
    expect(result.limits.join(' ')).toContain('/proc/cmdline')
    expect(result.limits.join(' ')).toContain('rewrote the boot partition')
  })

  it('fails-rather-than-passing-when-there-is-no-cmdline-at-all', () => {
    const result = cmdlineExact(root, { cmdline: PINNED })
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('no cmdline.txt')
  })
})
