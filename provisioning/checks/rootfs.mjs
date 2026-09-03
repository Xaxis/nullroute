/**
 * The verifiers that read a built root filesystem.
 *
 * WHAT MAKES THESE HONEST. `provisioning/README.md` states plainly that an
 * offline scan of an unbooted rootfs emits confident false passes: it reports
 * `noexec` and `nosuid` as enforced while the same scan reports the partition
 * does not exist, because `/proc/mounts` is absent. That is why mount options,
 * listening sockets and swap are `needs-device` and stay there.
 *
 * The four here are different in kind. Whether a file exists in a filesystem,
 * whether a package is in the dpkg database, what a unit file declares, and what
 * the bootloader is configured to pass are all properties OF THE ARTIFACT, and
 * reading them from the artifact is the whole of the claim rather than a proxy
 * for a runtime property. Where a limit exists it is named in the verdict
 * rather than left to the reader.
 *
 * They take a directory, not an image. Mounting or loop-devicing an image is a
 * privileged operation this project should not need to run as root, and the
 * build backend can hand over the tree it assembled. That also means they are
 * testable today, against a fixture, before any image exists.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * What every verifier here returns.
 *
 * `limits` is not decoration. Anything measured indirectly says so here, and
 * the reporting tool prints it beside the PASS, because a check whose limit is
 * only in a comment is a check whose limit nobody reads.
 *
 * `unavailable` marks the third outcome: could-not-run, as distinct from
 * failed. It is never a pass.
 *
 * @typedef {object} Verdict
 * @property {string} check
 * @property {boolean} ok
 * @property {string} detail
 * @property {string[]} limits
 * @property {boolean} [unavailable]
 */

/**
 * A verdict about the artifact: it was inspected and it either holds or does not.
 *
 * @returns {Verdict}
 */
function verdict(check, ok, detail, limits = []) {
  return { check, ok, detail, limits }
}

/**
 * A verdict for "this verifier could not run at all".
 *
 * THREE STATES, NOT TWO, and the third is the one that matters. "The unit is
 * too exposed" and "systemd-analyze is not installed on this machine" are both
 * `ok: false`, and collapsing them prints a red FAIL for a missing tool, which
 * trains a reader to ignore red. Worse, the pressure to clear that red is
 * pressure to make a missing tool return true, which is the false pass this
 * whole design exists to stop.
 *
 * So it is never a pass, never counted as satisfied, and reported as unchecked
 * rather than failed.
 */
/** @returns {Verdict} */
function unavailable(check, detail, limits = []) {
  return { check, ok: false, unavailable: true, detail, limits }
}

/** Every file under a directory, as paths relative to it, following no links. */
function walk(root, directory = root, found = []) {
  let entries
  try {
    entries = readdirSync(directory, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    const full = join(directory, entry.name)
    found.push(relative(root, full).split(sep).join('/'))
    // isDirectory() is false for a symlink to one, which is what we want: a
    // link out of the rootfs must not be followed, and a link inside it is
    // already reachable by its real path.
    if (entry.isDirectory()) walk(root, full, found)
  }
  return found
}

/**
 * A glob, limited to the forms the profiles actually use.
 *
 * `*` matches within one path segment, `**` matches across segments. Written
 * out rather than pulled in, because a dependency here would go into the
 * reproducible build manifest to save twenty lines.
 */
function globToRegExp(glob) {
  let out = '^'
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i]
    if (char === '*') {
      if (glob[i + 1] === '*') {
        // `**/` swallows the slash so it can also match zero segments.
        if (glob[i + 2] === '/') {
          out += '(?:.*/)?'
          i += 2
        } else {
          out += '.*'
          i += 1
        }
      } else {
        out += '[^/]*'
      }
    } else if ('\\^$.|?+()[]{}'.includes(char)) {
      out += `\\${char}`
    } else {
      out += char
    }
  }
  return new RegExp(`${out}$`)
}

export function matchesGlob(path, glob) {
  return globToRegExp(glob).test(path)
}

/**
 * INV-PROV-13, INV-PROV-17. Named paths do not exist in the rootfs.
 *
 * The strongest of these four: a file is either in the filesystem or it is not,
 * and there is no runtime behaviour being inferred. A wireless driver that is
 * absent cannot be loaded by editing a configuration file, which is the whole
 * argument for removing rather than disabling.
 */
export function absentPaths(root, params) {
  const globs = params.globs ?? []
  if (globs.length === 0) return verdict('absent-paths', false, 'no globs were given to check')

  const files = walk(root)
  const found = []
  for (const glob of globs) {
    for (const file of files) {
      if (matchesGlob(file, glob)) found.push(`${file} (matched ${glob})`)
    }
  }

  return found.length === 0
    ? verdict('absent-paths', true, `${String(globs.length)} glob(s) match nothing in the rootfs`)
    : verdict(
        'absent-paths',
        false,
        `${String(found.length)} path(s) present that must not be: ${found.slice(0, 8).join(', ')}`
      )
}

/**
 * The package names dpkg believes are installed, read from the rootfs database.
 *
 * A package is "installed" only when its Status field says so. A removed
 * package leaves a `deinstall ok config-files` stanza behind, and counting that
 * as present would fail every image that had ever had the package removed,
 * which is exactly how the image is built.
 */
function installedPackages(root) {
  const status = join(root, 'var/lib/dpkg/status')
  if (!existsSync(status)) return null

  const installed = new Set()
  for (const stanza of readFileSync(status, 'utf8').split('\n\n')) {
    const name = /^Package:\s*(\S+)/m.exec(stanza)?.[1]
    const state = /^Status:\s*(.+)$/m.exec(stanza)?.[1] ?? ''
    if (name !== undefined && / installed$/.test(state.trim())) installed.add(name)
  }
  return installed
}

/**
 * INV-PROV-13, INV-PROV-16. Named packages are not installed.
 *
 * The limit is real and is stated in the verdict: this sees the package
 * database, so equivalent functionality statically linked into some other
 * binary is invisible to it. The assertions concede that in `does_not_cover`
 * and the verdict repeats it, because a verifier that quietly implies more than
 * it measured is the thing this whole design exists to prevent.
 */
export function absentPackages(root, params) {
  const packages = params.packages ?? []
  if (packages.length === 0) {
    return verdict('absent-packages', false, 'no package names were given to check')
  }

  const installed = installedPackages(root)
  if (installed === null) {
    // NOT a pass. An image with no dpkg database is one this verifier cannot
    // speak about, and "I could not look" must never render as "it is absent".
    return unavailable(
      'absent-packages',
      'no dpkg database at var/lib/dpkg/status, so nothing here was checked'
    )
  }

  const present = packages.filter((name) => installed.has(name))
  const limits = [
    'Reads the package database, so functionality linked into another binary is invisible to it.',
  ]

  return present.length === 0
    ? verdict(
        'absent-packages',
        true,
        `none of ${String(packages.length)} named package(s) are installed, of ${String(installed.size)} present`,
        limits
      )
    : verdict('absent-packages', false, `installed and must not be: ${present.join(', ')}`, limits)
}

/** Every systemd unit file in the rootfs, as { path, text }. */
function units(root) {
  const found = []
  for (const directory of [
    'etc/systemd/system',
    'usr/lib/systemd/system',
    'lib/systemd/system',
    'run/systemd/system',
  ]) {
    const base = join(root, directory)
    if (!existsSync(base)) continue
    for (const relativePath of walk(base)) {
      const full = join(base, relativePath)
      if (!/\.(service|socket|target|timer|mount|path)$/.test(relativePath)) continue
      let stats
      try {
        stats = statSync(full)
      } catch {
        continue
      }
      if (!stats.isFile()) continue
      found.push({ path: `${directory}/${relativePath}`, text: readFileSync(full, 'utf8') })
    }
  }
  return found
}

/**
 * INV-PROV-17. Nothing orders itself before the signer.
 *
 * A unit that runs first on a device with no network has no business existing,
 * and one that inserts itself ahead of the daemon is either a mistake or an
 * attempt to observe the device in the window before the thing holding keys
 * starts. Ordering is a declaration, so reading the declaration IS the check,
 * with no runtime property being inferred.
 */
export function noUnitOrdering(root, params) {
  const target = params.unit ?? 'nullrouted.service'
  const all = units(root)
  if (all.length === 0) {
    return unavailable('no-unit-ordering', 'no systemd units found in the rootfs')
  }

  const offenders = []
  for (const unit of all) {
    const name = unit.path.split('/').pop() ?? unit.path
    if (name === target) continue
    for (const line of unit.text.split('\n')) {
      const before = /^\s*Before\s*=\s*(.+)$/.exec(line)?.[1]
      if (before !== undefined && before.split(/\s+/).includes(target)) {
        offenders.push(`${unit.path} declares Before=${target}`)
      }
      const after = /^\s*After\s*=\s*(.+)$/.exec(line)?.[1]
      if (after !== undefined && after.split(/\s+/).includes(target)) {
        // Ordering AFTER the signer is fine and common. Named only so the
        // verdict can say how many units were actually read.
        continue
      }
    }
  }

  return offenders.length === 0
    ? verdict(
        'no-unit-ordering',
        true,
        `${String(all.length)} unit(s) read, none orders itself before ${target}`
      )
    : verdict('no-unit-ordering', false, offenders.join('; '))
}

/**
 * INV-PROV-21. The kernel command line is exactly what was pinned.
 *
 * Exactly, not "contains": a parameter appended by a build step is a parameter
 * nobody reviewed, and the whole point of pinning is that the set is closed.
 *
 * THE LIMIT MATTERS HERE and is stated in the verdict. This reads the file the
 * bootloader is configured to pass. It is not the line the kernel received,
 * which lives in /proc/cmdline on a running device and is the only place the
 * difference shows. An attacker who rewrote the boot partition supplies their
 * own file, and this check reads theirs.
 */
export function cmdlineExact(root, params) {
  const expected = (params.cmdline ?? '').trim()
  if (expected.length === 0) {
    return verdict('cmdline-exact', false, 'no expected command line was given')
  }

  const candidates = ['boot/firmware/cmdline.txt', 'boot/cmdline.txt']
  const path = candidates.map((c) => join(root, c)).find((c) => existsSync(c))
  if (path === undefined) {
    return unavailable('cmdline-exact', `no cmdline.txt at any of: ${candidates.join(', ')}`)
  }

  const limits = [
    'Reads what the bootloader is configured to pass, not what the kernel received. Only /proc/cmdline on a running device shows that, and an attacker who rewrote the boot partition supplies this file.',
  ]

  // Whitespace-insensitive between parameters, order-sensitive within them: the
  // kernel treats the line as a sequence of tokens and so does this.
  const actual = readFileSync(path, 'utf8').trim()
  const normalise = (line) => line.split(/\s+/).filter(Boolean).join(' ')

  if (normalise(actual) !== normalise(expected)) {
    const extra = normalise(actual)
      .split(' ')
      .filter((token) => !normalise(expected).split(' ').includes(token))
    const missing = normalise(expected)
      .split(' ')
      .filter((token) => !normalise(actual).split(' ').includes(token))
    const parts = []
    if (extra.length > 0) parts.push(`unexpected: ${extra.join(' ')}`)
    if (missing.length > 0) parts.push(`missing: ${missing.join(' ')}`)
    if (parts.length === 0) parts.push('the parameters are in a different order')
    return verdict('cmdline-exact', false, parts.join('; '), limits)
  }

  return verdict(
    'cmdline-exact',
    true,
    `matches the pinned line exactly, ${String(normalise(expected).split(' ').length)} parameter(s)`,
    limits
  )
}

/**
 * INV-PROV-18, INV-PROV-19. A unit's declared hardening scores no worse than
 * the profile allows.
 *
 * THE LIMIT IS THE INTERESTING PART and it is stated twice, in the assertion's
 * `does_not_cover` and again in every verdict this returns. `systemd-analyze
 * security --offline=true` reads the unit file. It measures DECLARED
 * directives, not enforced behaviour: it is a configuration linter, and its
 * number is not a security measurement. It also cannot see that AppArmor is
 * inert without `lsm=apparmor` on this hardware, or that MemoryDenyWriteExecute
 * would crash the daemon. A unit could score perfectly and be running with none
 * of it in effect.
 *
 * The score is coupled to the systemd version, whose weights change between
 * releases, which is why the profile pins that version.
 *
 * WHEN THE TOOL IS ABSENT this fails rather than passing. `systemd-analyze` is
 * not on macOS, where much of this project is written, and a verifier that
 * reported success because it could not find its own tool would be the
 * README's false pass with a different cause.
 */
export function systemdExposure(root, params, run = defaultRun) {
  const unit = params.unit
  const max = params.max_exposure
  if (typeof unit !== 'string' || typeof max !== 'number') {
    return verdict('systemd-exposure', false, 'the assertion gave no unit name or no threshold')
  }

  const limits = [
    'Measures directives DECLARED in the unit file, not behaviour enforced at runtime. A unit can score well with none of it in effect: on this hardware AppArmor is inert without lsm=apparmor, and MemoryDenyWriteExecute crashes the daemon.',
    'The score is coupled to the systemd version, whose weights change between releases.',
  ]

  const outcome = run(root, unit)
  if (!outcome.ok) {
    return outcome.unavailable === true
      ? unavailable('systemd-exposure', outcome.detail, limits)
      : verdict('systemd-exposure', false, outcome.detail, limits)
  }

  let exposure
  try {
    const parsed = JSON.parse(outcome.stdout)
    const row = Array.isArray(parsed) ? parsed[0] : parsed
    exposure = Number(row?.exposure ?? row?.Exposure)
  } catch {
    return verdict(
      'systemd-exposure',
      false,
      `systemd-analyze produced output this verifier could not parse as JSON`,
      limits
    )
  }

  if (!Number.isFinite(exposure)) {
    return verdict('systemd-exposure', false, 'no exposure score in the output', limits)
  }

  return exposure <= max
    ? verdict(
        'systemd-exposure',
        true,
        `${unit} declares an exposure of ${String(exposure)}, at or under the ${String(max)} allowed`,
        limits
      )
    : verdict(
        'systemd-exposure',
        false,
        `${unit} declares an exposure of ${String(exposure)}, over the ${String(max)} allowed`,
        limits
      )
}

/** Shell out to systemd-analyze. Injectable so the tests do not need it. */
function defaultRun(root, unit) {
  const result = spawnSync(
    'systemd-analyze',
    ['security', '--offline=true', `--root=${root}`, '--json=short', unit],
    { encoding: 'utf8' }
  )
  if (result.error !== undefined || result.status === null) {
    return {
      ok: false,
      unavailable: true,
      detail:
        'systemd-analyze is not on this machine, so this was NOT checked. It is a Linux tool and much of this project is written on macOS.',
    }
  }
  if (result.status !== 0) {
    return {
      ok: false,
      detail: `systemd-analyze exited ${String(result.status)}: ${(result.stderr ?? '').trim().slice(0, 200)}`,
    }
  }
  return { ok: true, stdout: result.stdout }
}

/** Every rootfs verifier, by the name a profile assertion uses. */
export const ROOTFS_VERIFIERS = {
  'absent-paths': absentPaths,
  'absent-packages': absentPackages,
  'no-unit-ordering': noUnitOrdering,
  'cmdline-exact': cmdlineExact,
  'systemd-exposure': systemdExposure,
}
