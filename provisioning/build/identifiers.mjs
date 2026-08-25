#!/usr/bin/env node
/**
 * Print the pinned identifiers for a build, as shell assignments.
 *
 * ONE DEFINITION, TWO CONSUMERS is the rule stated at the top of
 * provisioning/checks/identifiers.mjs: the backend calls it to SET the salt and
 * the UUIDs, and the verifier calls it to CHECK them. The build script here is
 * shell running in a container with no Node, so it cannot import that module.
 *
 * Rather than reimplement the derivation in shell, which is exactly the second
 * definition the rule exists to prevent, this runs on the host and hands the
 * values across as environment variables. The shell never computes an
 * identifier; it only spends one.
 *
 * The first draft of build-system.sh did reimplement it, and got it wrong: it
 * invented a domain string of its own for the filesystem UUID and sliced the
 * digest by hand, so it produced a value the verifier would never accept and
 * did not set the UUID version bits at all.
 *
 *   node provisioning/build/identifiers.mjs            uses package.json's version
 *   node provisioning/build/identifiers.mjs 0.4.0      an explicit one
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { veritySalt, filesystemUuid, fatVolumeId, diskGuid, partitionGuid } from '../checks/identifiers.mjs'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

/**
 * The kernel command line INV-PROV-21 pins, taken from the profile.
 *
 * Parsed out of the YAML with a regular expression rather than a parser,
 * because adding a YAML dependency to reach one string is a dependency on the
 * device's build path, and this repository does not add those lightly. The
 * shape it matches is a folded block scalar, which is how the profile writes
 * it; anything else fails loudly here rather than producing a shorter command
 * line that the verifier would then confirm.
 */
function pinnedCmdline() {
  const yaml = readFileSync(join(ROOT, 'provisioning/profiles/os-signer.yaml'), 'utf8')
  const match = /\n(\s+)cmdline: >-\n([\s\S]*?)\n(?=\s*\S+:|\s*-\s)/.exec(yaml)
  if (match === null) throw new Error('no pinned cmdline in provisioning/profiles/os-signer.yaml')
  const tokens = match[2]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
  if (tokens.length === 0) throw new Error('the pinned cmdline in os-signer.yaml is empty')
  return tokens.join(' ')
}
const version =
  process.argv[2] ?? JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version

const out = [
  ['NULLROUTE_VERSION', version],
  ['NULLROUTE_VERITY_SALT', veritySalt(version)],
  ['NULLROUTE_SYSTEM_FS_UUID', filesystemUuid(version, 'system')],
  ['NULLROUTE_BOOT_VOLUME_ID', fatVolumeId(version, 'boot')],
  ['NULLROUTE_DISK_GUID', diskGuid(version)],
  ['NULLROUTE_BOOT_PART_GUID', partitionGuid(version, 'boot')],
  ['NULLROUTE_SYSTEM_PART_GUID', partitionGuid(version, 'system')],
  ['NULLROUTE_SYSTEM_HASH_PART_GUID', partitionGuid(version, 'system-hash')],
  // The kernel command line, read out of the profile that pins it rather than
  // written here, so there is one copy and the verifier compares the image
  // against the same string the build wrote.
  ['NULLROUTE_CMDLINE', pinnedCmdline()],
]

for (const [key, value] of out) process.stdout.write(`${key}=${value}\n`)
