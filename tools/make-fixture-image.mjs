#!/usr/bin/env node
/**
 * Write a synthetic image that satisfies the profile's pinned identifiers.
 *
 * WHY THIS EXISTS. `provisioning/README.md` argues that a backend is supported
 * when the UNCHANGED verifiers pass against its output. Until a backend exists
 * there is no output, and a verifier that has never been pointed at anything is
 * a verifier nobody knows works. This produces something to point it at.
 *
 * IT IS NOT AN IMAGE AND MUST NEVER BE MISTAKEN FOR ONE. There is no
 * filesystem, no kernel, no hash tree: just the superblocks and the table, at
 * the offsets the published formats put them at, with the identifiers this
 * project pins. Flashing it produces a card that does nothing.
 *
 * What it proves is narrow and worth having: that the verifiers read the
 * offsets they claim to read, and that the derivation the build backend will
 * use and the derivation the verifier checks are the same function. The day a
 * real image exists, the only new thing is the image.
 *
 * Usage: node tools/make-fixture-image.mjs <path> [--release <version>] [--drift]
 *
 *   --drift  writes a random verity salt instead of the pinned one, which is
 *            the upstream defect this whole apparatus exists to catch. Use it
 *            to watch the verifier fail rather than trusting that it would.
 */

import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  diskGuid,
  fatVolumeId,
  filesystemUuid,
  partitionGuid,
  veritySalt,
} from '../provisioning/checks/identifiers.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SECTOR = 512

function argument(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const target = process.argv[2]
if (target === undefined || target.startsWith('--')) {
  console.error('make-fixture-image: pass a path to write.')
  console.error('')
  console.error('  This writes a synthetic image with the pinned identifiers in it, so the')
  console.error('  image verifiers have something to run against before a build backend')
  console.error('  exists. It is not bootable and is not an image of anything.')
  process.exit(2)
}

const release =
  argument('release') ?? JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
const drift = process.argv.includes('--drift')

/** A printed GUID back into its on-disk mixed-endian form. */
function guidBytes(text) {
  const parts = text.toLowerCase().split('-')
  const rev = (hex) => Buffer.from(Buffer.from(hex, 'hex')).reverse()
  return Buffer.concat([
    rev(parts[0]),
    rev(parts[1]),
    rev(parts[2]),
    Buffer.from(parts[3], 'hex'),
    Buffer.from(parts[4], 'hex'),
  ])
}

// The layout the profiles assert: a FAT boot partition, an erofs system
// partition, and the verity hash tree on its own partition rather than left
// beside the image as a build artifact (INV-PROV-9).
const LAYOUT = [
  { name: 'boot', filesystem: 'fat', firstLba: 2048, sectors: 1024 * 1024 },
  { name: 'system', filesystem: 'erofs', firstLba: 2048 + 1024 * 1024, sectors: 2048 },
  {
    name: 'system-hash',
    filesystem: 'verity',
    firstLba: 2048 + 1024 * 1024 + 2048,
    sectors: 32768,
  },
]

const total = LAYOUT[LAYOUT.length - 1].firstLba + LAYOUT[LAYOUT.length - 1].sectors + 2048
const image = Buffer.alloc(total * SECTOR)

// LBA 1: the GPT header.
const header = image.subarray(SECTOR, SECTOR * 2)
header.write('EFI PART', 0, 'latin1')
guidBytes(diskGuid(release)).copy(header, 56)
header.writeBigUInt64LE(2n, 72)
header.writeUInt32LE(128, 80)
header.writeUInt32LE(128, 84)

LAYOUT.forEach((partition, index) => {
  const entry = image.subarray(SECTOR * 2 + index * 128, SECTOR * 2 + (index + 1) * 128)
  entry.write('0fc63daf', 0, 'hex')
  guidBytes(partitionGuid(release, partition.name)).copy(entry, 16)
  entry.writeBigUInt64LE(BigInt(partition.firstLba), 32)
  entry.writeBigUInt64LE(BigInt(partition.firstLba + partition.sectors - 1), 40)
  entry.write(partition.name, 56, 'utf16le')

  const at = partition.firstLba * SECTOR

  if (partition.filesystem === 'fat') {
    image.writeUInt16LE(0xaa55, at + 510)
    image.writeUInt16LE(0, at + 0x16)
    image.writeUInt32LE(Number.parseInt(fatVolumeId(release, partition.name), 16), at + 0x43)
  }

  if (partition.filesystem === 'ext') {
    image.writeUInt16LE(0xef53, at + 1024 + 56)
    Buffer.from(filesystemUuid(release, partition.name).replaceAll('-', ''), 'hex').copy(
      image,
      at + 1024 + 104
    )
  }

  // EROFS, because the system partition is erofs now. ext4 does not reproduce:
  // mkfs.ext4 stamps wall-clock time into three superblock fields and
  // e2fsprogs 1.47.0 ignores SOURCE_DATE_EPOCH. See
  // provisioning/backends/rpi-image-gen/README.md.
  //
  // Superblock at 1024 into the partition, magic 0xe0f5e1e2 little-endian at
  // its offset 0, uuid as sixteen flat bytes at its offset 0x30.
  if (partition.filesystem === 'erofs') {
    image.writeUInt32LE(0xe0f5e1e2, at + 1024)
    Buffer.from(filesystemUuid(release, partition.name).replaceAll('-', ''), 'hex').copy(
      image,
      at + 1024 + 48
    )
  }

  if (partition.filesystem === 'verity') {
    // The salt is the whole point. --drift writes a fresh one, which is exactly
    // what rpi-image-gen does today and exactly what has to fail.
    const salt = drift ? randomBytes(32).toString('hex') : veritySalt(release)
    image.write('verity', at, 'latin1')
    image.writeUInt32LE(1, at + 8)
    image.writeUInt32LE(1, at + 12)
    image.write('sha256', at + 32, 'latin1')
    image.writeUInt32LE(4096, at + 64)
    image.writeUInt32LE(4096, at + 68)
    image.writeBigUInt64LE(BigInt(partition.sectors / 8), at + 72)
    // OFFSET 80 AND 88, NOT 88 AND 96.
    //
    // This fixture carried the same eight byte error as the verifier that reads
    // it, which is why nothing caught it: the two agreed with each other and
    // both disagreed with cryptsetup. The padding in `verity_sb` follows
    // salt_size rather than preceding it. A fixture that encodes the reader's
    // mistake is a fixture that certifies the mistake.
    const bytes = Buffer.from(salt, 'hex')
    image.writeUInt16LE(bytes.length, at + 80)
    bytes.copy(image, at + 88)
  }
})

writeFileSync(target, image)
console.log(
  `make-fixture-image: wrote ${target}, ${String(total * SECTOR)} bytes, release ${release}` +
    (drift ? ', WITH A DRIFTING VERITY SALT so the verifier fails' : '')
)
console.log('  Not bootable, and not an image of anything. See the header of this file.')
