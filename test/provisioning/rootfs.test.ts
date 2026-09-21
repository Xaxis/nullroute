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
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  absentPackages,
  absentPaths,
  cmdlineExact,
  matchesGlob,
  bootConfigDisplay,
  fileModes,
  noUnitOrdering,
  systemdExposure,
  unitExecutables,
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
    // And marked as "could not look" rather than as a property of the image.
    // Collapsing the two prints a failure for a missing artifact, and the
    // pressure to clear that is pressure to make it return true.
    expect(result.unavailable).toBe(true)
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

describe('provisioning.boot-config-display', () => {
  const OVERLAYS = ['nullroute-7inch-dsi']

  /**
   * INV-PROV-25. The state the image was actually in when this was written.
   *
   * config.txt held four lines, none of them a dtoverlay, and the device tree
   * the image ships has dsi@7e700000 disabled with no node describing the panel
   * or its touch controller. The drivers are all in the rootfs, so it looked
   * provisioned. The screen is dark.
   */
  it('fails-a-config-that-names-no-overlay-at-all', () => {
    put(
      'boot/firmware/config.txt',
      'arm_64bit=1\nkernel=kernel8.img\ninitramfs initramfs.img followkernel\ndisable_splash=1\n'
    )
    const result = bootConfigDisplay(root, { overlays: OVERLAYS })
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('nullroute-7inch-dsi')
    expect(result.detail).toContain('no overlay at all')
    // What it cannot answer is stated every time, because naming an overlay is
    // not the same as the panel lighting up.
    expect(result.limits.join(' ')).toContain('not that the panel lights up')
  })

  it('fails-a-config-that-names-a-different-overlay', () => {
    put('boot/firmware/config.txt', 'arm_64bit=1\ndtoverlay=vc4-kms-v3d\n')
    const result = bootConfigDisplay(root, { overlays: OVERLAYS })
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('nullroute-7inch-dsi')
  })

  /** Parameters after a comma are the overlay's own, and do not change its name. */
  it('passes-a-config-that-names-both-with-parameters', () => {
    put(
      'boot/firmware/config.txt',
      '# a comment\narm_64bit=1\ndtoverlay=nullroute-7inch-dsi,sizex\n'
    )
    const result = bootConfigDisplay(root, { overlays: OVERLAYS })
    expect(result.ok).toBe(true)
  })

  /**
   * INV-PROV-25. Unavailable, not passed. An image whose config.txt cannot be
   * read here has not been shown to enable anything, and this tool never counts
   * could-not-look as a pass.
   */
  it('reports-unavailable-rather-than-passing-when-there-is-no-config', () => {
    const result = bootConfigDisplay(root, { overlays: OVERLAYS })
    expect(result.ok).toBe(false)
    expect(result.unavailable).toBe(true)
  })

  it('refuses-to-decide-which-overlays-matter', () => {
    put('boot/firmware/config.txt', 'arm_64bit=1\n')
    const result = bootConfigDisplay(root, {})
    expect(result.ok).toBe(false)
    expect(result.unavailable).toBeUndefined()
    expect(result.detail).toContain('named no overlays')
  })
})

describe('provisioning.no-unit-ordering', () => {
  /**
   * INV-PROV-17. A unit ordered after a target this device cannot reach.
   *
   * THE TESTS THAT USED TO BE HERE called this with `{}` and asserted that a
   * unit declaring Before=nullrouted.service was reported. The profile passes
   * `{ after: time-sync.target }` and the verifier read `params.unit ??
   * 'nullrouted.service'`, so the default answered a question the assertion
   * never asked, and these tests exercised the default rather than the
   * parameter. Code and tests agreed with each other and with nothing in the
   * profile, and INV-PROV-17 was unverified while an unwritten rule was
   * enforced in its place. That rule is also false by design: attesting the
   * system and remounting /run both order themselves before the daemon on
   * purpose.
   *
   * Ordering is a declaration, so reading the declaration is the whole check
   * with nothing inferred about runtime.
   */
  it('finds-a-unit-ordered-after-the-named-target', () => {
    put('usr/lib/systemd/system/nullrouted.service', '[Unit]\nDescription=nullroute daemon\n')
    put(
      'etc/systemd/system/telemetry.service',
      '[Unit]\nDescription=telemetry\nAfter=time-sync.target\n'
    )
    const result = noUnitOrdering(root, { after: 'time-sync.target' })
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('telemetry.service')
    expect(result.detail).toContain('After=time-sync.target')
  })

  /**
   * The board has no battery-backed clock and no network, so a unit waiting on
   * time-sync.target waits for something that cannot arrive. Ordering after
   * anything else is ordinary and must not be reported.
   */
  it('allows-a-unit-ordered-after-something-else', () => {
    put('usr/lib/systemd/system/nullrouted.service', '[Unit]\nDescription=nullroute daemon\n')
    put('usr/lib/systemd/system/kiosk.service', '[Unit]\nAfter=nullrouted.service\n')
    const result = noUnitOrdering(root, { after: 'time-sync.target' })
    expect(result.ok).toBe(true)
    expect(result.detail).toContain('time-sync.target')
  })

  /**
   * INV-PROV-17. NO DEFAULT. A verifier that picks its own target when the
   * assertion names none is how this check came to answer the wrong question
   * for as long as it has existed, so it refuses instead.
   */
  it('refuses-to-choose-a-target-the-assertion-did-not-name', () => {
    put('usr/lib/systemd/system/nullrouted.service', '[Unit]\nDescription=nullroute daemon\n')
    const result = noUnitOrdering(root, {})
    expect(result.ok).toBe(false)
    expect(result.unavailable).toBeUndefined()
    expect(result.detail).toContain('no `after` target')
  })

  it('fails-rather-than-passing-a-rootfs-with-no-units-at-all', () => {
    const result = noUnitOrdering(root, { after: 'time-sync.target' })
    expect(result.ok).toBe(false)
    expect(result.unavailable).toBe(true)
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
   * INV-PROV-21. The limit is stated in the verdict, and it used to be stated
   * wrongly in the direction that matters.
   *
   * It said "an attacker who rewrote the boot partition supplies this file".
   * It does not: this reads the copy inside the system partition, which is
   * under the hash tree, and on a running device that path is where the FAT
   * boot partition is mounted, so the firmware reads a different file with the
   * same name. Nothing verifies that one's contents. The verdict has to say so,
   * because the verdict is what a reader of the report sees.
   */
  it('says-that-it-read-a-configuration-and-not-a-running-kernel', () => {
    put('boot/firmware/cmdline.txt', PINNED)
    const result = cmdlineExact(root, { cmdline: PINNED })
    expect(result.ok).toBe(true)
    const limits = result.limits.join(' ')
    expect(limits).toContain('/proc/cmdline')
    // The copy it really read, and the one it did not.
    expect(limits).toContain('inside the system partition')
    expect(limits).toContain('boot-files-exact')
    // And it must NOT claim to be reading the attacker's file.
    expect(limits).not.toContain('supplies this file')
  })

  it('fails-rather-than-passing-when-there-is-no-cmdline-at-all', () => {
    const result = cmdlineExact(root, { cmdline: PINNED })
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('no cmdline.txt')
    expect(result.unavailable).toBe(true)
  })

  /**
   * INV-PROV-21. A cmdline that is present and wrong is a FAILURE, not a
   * could-not-look. The distinction is the whole point of the third state: if
   * a wrong artifact and a missing tool report the same way, one of them stops
   * being read.
   */
  it('separates-a-wrong-command-line-from-a-missing-one', () => {
    put('boot/firmware/cmdline.txt', `${PINNED} init=/bin/sh`)
    const wrong = cmdlineExact(root, { cmdline: PINNED })
    expect(wrong.ok).toBe(false)
    expect(wrong.unavailable).toBeUndefined()
  })
})

describe('provisioning.systemd-exposure', () => {
  const stub = (stdout: string) => () => ({ ok: true as const, stdout })

  /**
   * What `systemd-analyze security --offline=true --root=... <unit>` prints.
   *
   * THESE STUBS USED TO BE JSON, of the shape `[{"exposure":0.4}]`, and the
   * verifier parsed exactly that, so the two agreed with each other and with
   * nothing else. systemd-analyze emits that shape only when it is run over
   * every unit; asked about one, `--json=short` gives a row per SETTING, eighty
   * one of them, with no overall score anywhere in it. The number the profile
   * sets a limit on exists only on the line below.
   *
   * A workstation has no systemd, so the verifier returned unavailable here and
   * was never counted, and CI had not run a job in three days. Between them,
   * INV-PROV-18 and INV-PROV-19 had never been checked once.
   */
  const analyzed = (unit: string, score: string, verdict = 'OK') =>
    [
      '  NAME                        DESCRIPTION                                 EXPOSURE',
      '✓ PrivateNetwork=             Service has no access to the host network          ',
      '✗ SystemCallFilter=~@swap     System call allow list defined, and @swap is not  0.2',
      '',
      `→ Overall exposure level for ${unit}: ${score} ${verdict} 🙂`,
      '',
    ].join('\n')

  /**
   * INV-PROV-18. A unit within its allowance passes, and the verdict carries
   * what the number does not mean.
   *
   * `systemd-analyze security` reads the unit FILE. It measures declared
   * directives, not enforced behaviour, and on this hardware three of the most
   * effective ones are inert or fatal: AppArmor without `lsm=apparmor`,
   * `lockdown=` on a stock Pi kernel, and MemoryDenyWriteExecute, which crashes
   * Node outright. A unit can score perfectly with none of it in effect, so a
   * pass that did not say so would be a number pretending to be a measurement.
   */
  it('passes-a-unit-within-its-allowance-and-says-what-the-score-is-not', () => {
    const result = systemdExposure(
      root,
      { unit: 'nullrouted.service', max_exposure: 0.5 },
      stub(analyzed('nullrouted.service', '0.4', 'SAFE'))
    )

    expect(result.ok).toBe(true)
    expect(result.detail).toContain('0.4')
    expect(result.limits.join(' ')).toContain('DECLARED')
    expect(result.limits.join(' ')).toContain('not behaviour enforced at runtime')
    // The version coupling, because the weights change between releases.
    expect(result.limits.join(' ')).toContain('systemd version')
  })

  /**
   * INV-PROV-18. The shape CI actually produced, which the old parser read as a
   * score and this one refuses.
   *
   * `--json=short` on one unit returns a row per setting. The first row's
   * `exposure` is that SETTING's, and on the runner's systemd it has none at
   * all, so the verifier got NaN and said "no exposure score in the output"
   * while systemd-analyze had answered on a line it never looked at. A verifier
   * that cannot find the answer must say so rather than read a different
   * number, which is the whole three-state design here.
   */
  it('refuses-per-setting-json-rather-than-reading-the-first-row-as-a-score', () => {
    const perSetting = JSON.stringify([
      { set: true, name: 'SystemCallFilter=~@swap', json_field: 'SystemCallFilter_swap' },
      { set: false, name: 'PrivateNetwork=', json_field: 'PrivateNetwork' },
    ])
    const result = systemdExposure(
      root,
      { unit: 'nullrouted.service', max_exposure: 0.5 },
      stub(perSetting)
    )

    expect(result.ok).toBe(false)
    expect(result.detail).toContain('Overall exposure level')
    // And it quotes what it did get, because the last time this failed the
    // message named the symptom and ruled nothing out.
    expect(result.detail).toContain('SystemCallFilter')
  })

  it('fails-a-unit-over-its-allowance', () => {
    const result = systemdExposure(
      root,
      { unit: 'nullroute-kiosk.service', max_exposure: 3.0 },
      stub(analyzed('nullroute-kiosk.service', '6.2', 'MEDIUM'))
    )

    expect(result.ok).toBe(false)
    expect(result.detail).toContain('6.2')
    expect(result.detail).toContain('over the 3 allowed')
  })

  /**
   * INV-PROV-18. A missing tool is not a pass.
   *
   * systemd-analyze is a Linux tool and much of this project is written on
   * macOS. A verifier reporting success because it could not find its own tool
   * is the README's false pass with a different cause, and it would be the
   * easiest one in this file to ship by accident.
   */
  it('fails-rather-than-passing-when-the-tool-is-not-there', () => {
    const result = systemdExposure(root, { unit: 'nullrouted.service', max_exposure: 0.5 }, () => ({
      ok: false,
      unavailable: true,
      detail: 'systemd-analyze is not on this machine, so this was NOT checked.',
    }))

    expect(result.ok).toBe(false)
    expect(result.detail).toContain('NOT checked')
    // Could not look, not a verdict about the unit. A missing tool reported
    // the same way as an over-exposed unit trains a reader to ignore both.
    expect(result.unavailable).toBe(true)
  })

  /** An over-exposed unit is a real failure and must not be softened into one. */
  it('separates-an-over-exposed-unit-from-a-missing-tool', () => {
    const result = systemdExposure(
      root,
      { unit: 'nullrouted.service', max_exposure: 0.5 },
      stub('[{"exposure":9.1}]')
    )
    expect(result.ok).toBe(false)
    expect(result.unavailable).toBeUndefined()
  })

  it('fails-on-output-it-cannot-read', () => {
    for (const output of ['not json', '[]', '[{"unit":"x"}]', '[{"exposure":"high"}]']) {
      const result = systemdExposure(
        root,
        { unit: 'nullrouted.service', max_exposure: 0.5 },
        stub(output)
      )
      expect(result.ok, output).toBe(false)
    }
  })

  it('refuses-an-assertion-that-named-no-unit-or-no-threshold', () => {
    const call = (params: Record<string, unknown>) =>
      systemdExposure(root, params, stub('[{"exposure":0}]')) as {
        ok: boolean
      }
    expect(call({}).ok).toBe(false)
    expect(call({ unit: 'nullrouted.service' }).ok).toBe(false)
    expect(call({ max_exposure: 0.5 }).ok).toBe(false)
  })
})

describe('provisioning.file-modes', () => {
  it('passes-when-the-mode-and-owner-are-what-the-profile-pins', () => {
    put('usr/bin/thing', 'x')
    chmodSync(join(root, 'usr/bin/thing'), 0o0755)
    const result = fileModes(root, { files: [{ path: '/usr/bin/thing', mode: '0755' }] })
    expect(result.ok).toBe(true)
  })

  it('fails-on-a-mode-that-is-not-the-pinned-one', () => {
    put('usr/bin/thing', 'x')
    chmodSync(join(root, 'usr/bin/thing'), 0o0777)
    const result = fileModes(root, { files: [{ path: '/usr/bin/thing', mode: '0755' }] })
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('is mode 0777, not 0755')
  })

  it('fails-when-the-file-is-not-in-the-image', () => {
    put('usr/bin/other', 'x')
    const result = fileModes(root, { files: [{ path: '/usr/bin/thing', mode: '0755' }] })
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('not in the image')
  })

  /**
   * THE EXPORT IS NOT THE IMAGE. A macOS bind mount drops setuid on the way
   * out of the container, so a tree with no setuid bit anywhere cannot
   * represent one, and reporting "mode 0755, not 4755" would describe the
   * export and send somebody to fix a file that was already correct.
   */
  it('reports-unavailable-when-the-tree-cannot-hold-a-setuid-bit', () => {
    put('usr/bin/helper', 'x')
    chmodSync(join(root, 'usr/bin/helper'), 0o0755)
    const result = fileModes(root, { files: [{ path: '/usr/bin/helper', mode: '4755' }] })
    expect(result.ok).toBe(false)
    expect(result.unavailable).toBe(true)
  })

  it('fails-with-no-files-to-check-rather-than-passing', () => {
    const result = fileModes(root, { files: [] })
    expect(result.ok).toBe(false)
  })
})

describe('provisioning.unit-executables', () => {
  /** A unit plus the enabling symlink `systemctl enable` would have created. */
  function unit(name: string, text: string, enable?: string): void {
    put(`usr/lib/systemd/system/${name}`, text)
    if (enable !== undefined) put(`etc/systemd/system/${enable}.wants/${name}`, '')
  }

  beforeEach(() => {
    put('etc/passwd', 'root:x:0:0::/root:/bin/sh\nnullroute:x:1000:1000::/home/n:/bin/sh\n')
    put('etc/group', 'root:x:0:\nnullroute:x:1000:\n')
  })

  it('passes-a-unit-whose-program-exists-and-which-something-enables', () => {
    put('usr/bin/nullrouted', 'x')
    unit(
      'nullroute.service',
      '[Service]\nExecStart=/usr/bin/nullrouted\nUser=nullroute\n\n[Install]\nWantedBy=multi-user.target\n',
      'multi-user.target'
    )
    const result = unitExecutables(root, { units: ['nullroute.service'] })
    expect(result.ok).toBe(true)
  })

  it('fails-when-the-program-a-unit-runs-is-not-in-the-image', () => {
    unit(
      'nullroute.service',
      '[Service]\nExecStart=/usr/bin/nullrouted\n\n[Install]\nWantedBy=multi-user.target\n',
      'multi-user.target'
    )
    const result = unitExecutables(root, { units: ['nullroute.service'] })
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('/usr/bin/nullrouted')
  })

  /**
   * ENABLED, NOT MERELY PRESENT. Both units shipped this way once: the card
   * booted to a systemd that started neither the signing daemon nor the
   * frontend, because a unit nothing wants is a unit that never runs.
   */
  it('fails-a-unit-that-declares-wantedby-and-nothing-enables', () => {
    put('usr/bin/nullrouted', 'x')
    unit(
      'nullroute.service',
      '[Service]\nExecStart=/usr/bin/nullrouted\n\n[Install]\nWantedBy=multi-user.target\n'
    )
    const result = unitExecutables(root, { units: ['nullroute.service'] })
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('never starts')
  })

  /**
   * A backslash-newline is one directive, and this is the shape where that
   * matters. The program sits on the continued line, so without the join the
   * directive reads as `ExecStart=\`, which does not start with a slash, so it
   * is skipped and a missing program is never noticed.
   *
   * The obvious test does not test this. A unit written
   * `ExecStart=/usr/bin/cage \` with its arguments continued underneath passes
   * either way: joined, the first token is the program; unjoined, the argument
   * lines do not match the Exec regex at all and are simply ignored. Written
   * that way first, and a mutation removing the join left it green.
   */
  it('reads-a-continued-execstart-as-one-directive', () => {
    unit(
      'kiosk.service',
      '[Service]\nExecStart=\\\n  /usr/bin/cage --kiosk\n\n[Install]\nWantedBy=graphical.target\n',
      'graphical.target'
    )
    const result = unitExecutables(root, { units: ['kiosk.service'] })
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('/usr/bin/cage')
  })

  it('passes-that-same-unit-once-the-program-is-in-the-image', () => {
    put('usr/bin/cage', 'x')
    unit(
      'kiosk.service',
      '[Service]\nExecStart=\\\n  /usr/bin/cage --kiosk\n\n[Install]\nWantedBy=graphical.target\n',
      'graphical.target'
    )
    const result = unitExecutables(root, { units: ['kiosk.service'] })
    expect(result.ok).toBe(true)
  })

  it('fails-a-unit-that-runs-as-a-user-the-image-does-not-have', () => {
    put('usr/bin/nullrouted', 'x')
    unit(
      'nullroute.service',
      '[Service]\nExecStart=/usr/bin/nullrouted\nUser=nobodyhere\n\n[Install]\nWantedBy=multi-user.target\n',
      'multi-user.target'
    )
    const result = unitExecutables(root, { units: ['nullroute.service'] })
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('nobodyhere')
  })

  it('fails-when-the-unit-is-not-in-the-image-at-all', () => {
    put('usr/lib/systemd/system/other.service', '[Service]\nExecStart=/bin/true\n')
    const result = unitExecutables(root, { units: ['nullroute.service'] })
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('not in the image at all')
  })

  it('reports-unavailable-when-there-is-no-unit-directory', () => {
    const result = unitExecutables(root, { units: ['nullroute.service'] })
    expect(result.ok).toBe(false)
    expect(result.unavailable).toBe(true)
  })
})
