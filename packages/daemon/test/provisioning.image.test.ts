/**
 * Tests for the verifiers that read a built image.
 *
 * THEY ARE WRITTEN BEFORE THE BACKEND EXISTS, which is the whole design:
 * `provisioning/README.md` argues that a backend is supported when the
 * UNCHANGED verifiers pass against its output, and that only means something if
 * the verifiers came first. So the fixture here is a synthetic image built byte
 * by byte in this file: a protective MBR, a GPT, a FAT boot sector, an ext
 * superblock and a dm-verity superblock, each written at the offsets the
 * published formats put them at.
 *
 * A SYNTHETIC FIXTURE IS A REAL LIMIT AND IS WORTH NAMING. It proves the
 * verifiers read the offsets they claim to read and reach the verdicts they
 * claim to reach. It does not prove they agree with what `sgdisk`, `mke2fs` and
 * `veritysetup` actually write, and it cannot until an image exists. What it
 * rules out is the failure that would otherwise be discovered on that day: a
 * verifier that reads the wrong sixteen bytes and reports a confident PASS.
 *
 * The two defects these encode are named in
 * `provisioning/profiles/os-signer.yaml` and were prose until now.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  IMAGE_VERIFIERS,
  readFatVolumeId,
  readGpt,
  readVeritySuperblock,
} from '../../../provisioning/checks/image.mjs'

const SECTOR = 512
/** Big enough for a table plus four small partitions, small enough to be instant. */
const SECTORS = 2048

const DISK_GUID = '11111111-2222-3333-4444-555555555555'
const BOOT_GUID = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE'
const SYSTEM_GUID = '99999999-8888-7777-6666-555555555555'
const HASH_GUID = '12121212-3434-5656-7878-909090909090'
const PINNED_SALT = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
const FS_UUID = 'deadbeef-1234-5678-9abc-def012345678'
const FAT_ID = '1A2B3C4D'

/** A GUID string back into its on-disk mixed-endian form. */
function guidBytes(text: string): Buffer {
  const parts = text.toLowerCase().split('-')
  const rev = (hex: string): Buffer => Buffer.from(Buffer.from(hex, 'hex')).reverse()
  return Buffer.concat([
    rev(parts[0] ?? ''),
    rev(parts[1] ?? ''),
    rev(parts[2] ?? ''),
    Buffer.from(parts[3] ?? '', 'hex'),
    Buffer.from(parts[4] ?? '', 'hex'),
  ])
}

interface PartitionSpec {
  readonly name: string
  readonly guid: string
  readonly firstLba: number
  readonly lastLba: number
}

interface ImageSpec {
  readonly diskGuid?: string
  readonly partitions?: readonly PartitionSpec[]
  /** The salt written into the verity superblock, or none to write no superblock. */
  readonly salt?: string | undefined
  readonly fsUuid?: string
  readonly fatVolumeId?: string
  /** Bytes appended so two otherwise identical images differ. */
  readonly tail?: string
}

const DEFAULT_PARTITIONS: readonly PartitionSpec[] = [
  { name: 'boot', guid: BOOT_GUID, firstLba: 64, lastLba: 127 },
  { name: 'system', guid: SYSTEM_GUID, firstLba: 128, lastLba: 1023 },
  { name: 'hash', guid: HASH_GUID, firstLba: 1024, lastLba: 1279 },
]

/**
 * A disk image, written at the offsets the published formats specify.
 *
 * Only the fields the verifiers read are filled in. Everything else is zero,
 * which is why this is a fixture rather than a bootable card.
 */
function buildImage(spec: ImageSpec = {}): Buffer {
  const image = Buffer.alloc(SECTORS * SECTOR)

  // LBA 1: the GPT header. Signature, disk GUID at 56, entry LBA at 72, entry
  // count at 80, entry size at 84.
  const header = image.subarray(SECTOR, SECTOR * 2)
  header.write('EFI PART', 0, 'latin1')
  guidBytes(spec.diskGuid ?? DISK_GUID).copy(header, 56)
  header.writeBigUInt64LE(2n, 72)
  header.writeUInt32LE(8, 80)
  header.writeUInt32LE(128, 84)

  // LBA 2 onward: the entries. Type GUID, partition GUID, first and last LBA,
  // then 72 bytes of UTF-16LE name at offset 56.
  const partitions = spec.partitions ?? DEFAULT_PARTITIONS
  partitions.forEach((partition, index) => {
    const entry = image.subarray(SECTOR * 2 + index * 128, SECTOR * 2 + (index + 1) * 128)
    // Any non-zero type marks the slot as used. The verifiers match by name.
    entry.write('0fc63daf', 0, 'hex')
    guidBytes(partition.guid).copy(entry, 16)
    entry.writeBigUInt64LE(BigInt(partition.firstLba), 32)
    entry.writeBigUInt64LE(BigInt(partition.lastLba), 40)
    entry.write(partition.name, 56, 'utf16le')
  })

  const at = (name: string): number => {
    const found = partitions.find((partition) => partition.name === name)
    return found === undefined ? -1 : found.firstLba * SECTOR
  }

  // A FAT boot sector on `boot`: 0xAA55 at 510, sectors-per-FAT zero for FAT32,
  // volume id at 0x43.
  const bootAt = at('boot')
  if (bootAt !== -1) {
    image.writeUInt16LE(0xaa55, bootAt + 510)
    image.writeUInt16LE(0, bootAt + 0x16)
    image.writeUInt32LE(Number.parseInt(spec.fatVolumeId ?? FAT_ID, 16), bootAt + 0x43)
  }

  // An ext superblock on `system`: 1024 bytes in, magic 0xEF53 at 56, UUID at
  // 104 in printed byte order.
  const systemAt = at('system')
  if (systemAt !== -1) {
    image.writeUInt16LE(0xef53, systemAt + 1024 + 56)
    Buffer.from((spec.fsUuid ?? FS_UUID).replaceAll('-', ''), 'hex').copy(
      image,
      systemAt + 1024 + 104
    )
  }

  // A dm-verity superblock on `hash`: signature, version, algorithm at 32,
  // block sizes, salt size at 80, salt at 88.
  //
  // These were 88 and 96, the same eight byte error the verifier and the
  // synthetic fixture both carried. Three places agreeing with each other and
  // all three disagreeing with cryptsetup is what let it survive: the padding
  // in `verity_sb` follows salt_size rather than preceding it, and the first
  // run against a real veritysetup image is what found it.
  const hashAt = at('hash')
  const salt = spec.salt ?? PINNED_SALT
  if (hashAt !== -1 && salt !== '') {
    image.write('verity', hashAt, 'latin1')
    image.writeUInt32LE(1, hashAt + 8)
    image.writeUInt32LE(1, hashAt + 12)
    image.write('sha256', hashAt + 32, 'latin1')
    image.writeUInt32LE(4096, hashAt + 64)
    image.writeUInt32LE(4096, hashAt + 68)
    image.writeBigUInt64LE(1000n, hashAt + 72)
    const bytes = Buffer.from(salt, 'hex')
    image.writeUInt16LE(bytes.length, hashAt + 80)
    bytes.copy(image, hashAt + 88)
  }

  return spec.tail === undefined ? image : Buffer.concat([image, Buffer.from(spec.tail)])
}

let dir: string
let imagePath: string

function write(name: string, spec: ImageSpec = {}): string {
  const path = join(dir, name)
  writeFileSync(path, buildImage(spec))
  return path
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nullroute-image-'))
  imagePath = write('good.img')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('provisioning image verifiers', () => {
  /**
   * INV-PROV-9. Reading the GPT at all, including the mixed-endian GUID, which
   * is the single easiest thing here to get plausibly wrong: read flat, it
   * produces a GUID that looks fine and matches nothing.
   */
  it('reads-the-partition-table-including-the-mixed-endian-guids', () => {
    const gpt = readGpt(imagePath)
    expect(gpt?.diskGuid).toBe(DISK_GUID)
    expect(gpt?.partitions.map((p) => p.name)).toEqual(['boot', 'system', 'hash'])
    expect(gpt?.partitions[0]?.partGuid).toBe(BOOT_GUID)
  })

  /** INV-PROV-9. A file that is not a GPT is not a GPT with problems. */
  it('says-nothing-rather-than-guessing-when-the-file-is-not-an-image', () => {
    const path = join(dir, 'rubbish.img')
    writeFileSync(path, Buffer.alloc(4096, 0x41))
    expect(readGpt(path)).toBeNull()
    expect(IMAGE_VERIFIERS['partition-present']({ image: path }, {}).unavailable).toBe(true)
  })

  /** INV-PROV-9. The hash tree is on its own partition, and large enough. */
  it('finds-the-partitions-a-profile-names-and-checks-their-size', () => {
    const ok = IMAGE_VERIFIERS['partition-present'](
      { image: imagePath },
      { expect: [{ name: 'system' }, { name: 'hash' }] }
    )
    expect(ok.ok).toBe(true)

    const missing = IMAGE_VERIFIERS['partition-present'](
      { image: imagePath },
      { expect: [{ name: 'state' }] }
    )
    expect(missing.ok).toBe(false)
    expect(missing.detail).toContain('no partition named state')

    // 128 sectors is 64KiB, so a 1MiB floor is not met.
    const small = IMAGE_VERIFIERS['partition-present'](
      { image: imagePath },
      { expect: [{ name: 'boot', minMiB: 1 }] }
    )
    expect(small.ok).toBe(false)
    expect(small.detail).toContain('under the 1 required')
  })

  /**
   * INV-PROV-1. An assertion that names nothing to look for is could-not-run,
   * never a pass. A verifier that returns green having checked nothing is the
   * exact failure the profile system exists to prevent.
   */
  it('reports-could-not-run-rather-than-passing-when-it-checks-nothing', () => {
    for (const [check, params] of [
      ['partition-present', {}],
      ['verity-salt-pinned', {}],
      ['identifiers-pinned', {}],
    ] as const) {
      const result = IMAGE_VERIFIERS[check]({ image: imagePath }, params)
      expect(result.unavailable, check).toBe(true)
      expect(result.ok, check).toBe(false)
    }
  })

  /**
   * INV-PROV-4, and the reason this file exists. rpi-image-gen generates the
   * verity salt with uuidgen. The root hash is a function of (data, salt), so a
   * random salt means the root hash changes on every build even when the
   * filesystem is byte-identical, and the number this device displays at boot
   * is then meaningless as a published value.
   */
  it('catches-a-verity-salt-that-was-generated-rather-than-pinned', () => {
    const good = IMAGE_VERIFIERS['verity-salt-pinned'](
      { image: imagePath },
      { partition: 'hash', salt: PINNED_SALT }
    )
    expect(good.ok).toBe(true)
    expect(good.detail).toContain('sha256')

    // The same image built again, with a salt from uuidgen.
    const random = write('random.img', { salt: '0f9e8d7c6b5a49382716051423324150' })
    const caught = IMAGE_VERIFIERS['verity-salt-pinned'](
      { image: random },
      { partition: 'hash', salt: PINNED_SALT }
    )
    expect(caught.ok).toBe(false)
    expect(caught.detail).toContain('meaningless as a published value')
  })

  /**
   * INV-PROV-4. No hash tree at all is a different finding from the wrong salt,
   * and reporting the second for the first sends somebody looking at their
   * pinning configuration when the verity step never ran.
   */
  it('separates-no-hash-tree-from-the-wrong-salt', () => {
    const none = write('nohash.img', { salt: '' })
    const result = IMAGE_VERIFIERS['verity-salt-pinned'](
      { image: none },
      { partition: 'hash', salt: PINNED_SALT }
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('no hash tree was written there')
  })

  /** INV-PROV-4. The superblock fields the verdict quotes are really read. */
  it('reads-the-verity-superblock-fields-it-reports', () => {
    const sb = readVeritySuperblock(imagePath, 1024 * SECTOR)
    expect(sb?.algorithm).toBe('sha256')
    expect(sb?.dataBlockSize).toBe(4096)
    expect(sb?.salt).toBe(PINNED_SALT)
  })

  /**
   * INV-PROV-5. Random identifiers are the commonest cause of an otherwise
   * reproducible image failing to reproduce, and they are invisible in a
   * file-level diff: two trees compare equal while the images differ.
   */
  it('catches-an-identifier-that-was-generated-rather-than-pinned', () => {
    const pins = {
      diskGuid: DISK_GUID,
      partitions: [
        { name: 'boot', partGuid: BOOT_GUID, fatVolumeId: FAT_ID },
        { name: 'system', partGuid: SYSTEM_GUID, fsUuid: FS_UUID },
      ],
    }
    const good = IMAGE_VERIFIERS['identifiers-pinned']({ image: imagePath }, pins)
    expect(good.ok).toBe(true)
    expect(good.detail).toContain('5 identifiers match')

    // mke2fs without a pinned hash seed: the filesystem UUID moves.
    const drifted = write('drifted.img', { fsUuid: 'cafebabe-0000-1111-2222-333344445555' })
    const caught = IMAGE_VERIFIERS['identifiers-pinned']({ image: drifted }, pins)
    expect(caught.ok).toBe(false)
    expect(caught.detail).toContain('filesystem UUID')
  })

  /** INV-PROV-5. FAT32 and FAT16 keep the volume id at different offsets. */
  it('reads-the-fat-volume-id-from-the-right-offset', () => {
    expect(readFatVolumeId(imagePath, 64 * SECTOR)).toBe(FAT_ID)
    // Not FAT at all: no boot signature.
    expect(readFatVolumeId(imagePath, 128 * SECTOR)).toBeNull()
  })

  /**
   * INV-PROV-3. Everything else is conditional on this, and one image cannot
   * demonstrate that two builds agree. Passing on a single artifact would be
   * the vacuous green the whole design exists to prevent.
   */
  it('refuses-to-call-one-image-a-reproducible-build', async () => {
    const alone = await IMAGE_VERIFIERS['rebuild-identical']({ image: imagePath })
    expect(alone.unavailable).toBe(true)
    expect(alone.ok).toBe(false)
    expect(alone.detail).toContain('One image cannot demonstrate')
  })

  /** INV-PROV-3. Two builds, compared by bytes rather than by trust. */
  it('compares-two-builds-by-their-bytes', async () => {
    const same = write('again.img')
    const agreed = await IMAGE_VERIFIERS['rebuild-identical']({
      image: imagePath,
      compare: same,
    })
    expect(agreed.ok).toBe(true)

    const different = write('changed.img', { salt: '0f9e8d7c6b5a49382716051423324150' })
    const disagreed = await IMAGE_VERIFIERS['rebuild-identical']({
      image: imagePath,
      compare: different,
    })
    expect(disagreed.ok).toBe(false)
    expect(disagreed.detail).toContain('something in them is not pinned')

    // A size difference is caught before either file is hashed.
    const longer = write('longer.img', { tail: 'x' })
    const sized = await IMAGE_VERIFIERS['rebuild-identical']({
      image: imagePath,
      compare: longer,
    })
    expect(sized.ok).toBe(false)
    expect(sized.detail).toContain('not the same build')
  })

  /**
   * INV-PROV-3. The limit belongs in the verdict, not in a comment. Two builds
   * on THIS machine agreeing is a weaker property than reproducibility across
   * machines, paths and times, and a reader who sees only a green tick will
   * assume the stronger one.
   */
  it('states-the-limit-of-what-a-local-rebuild-proves', async () => {
    const same = write('again.img')
    const agreed = await IMAGE_VERIFIERS['rebuild-identical']({
      image: imagePath,
      compare: same,
    })
    expect(agreed.limits.join(' ')).toContain('different machines, paths and times')
  })
})
