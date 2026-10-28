/**
 * Tests for the provisioning verifiers that read a whole image.
 *
 * WHY THESE DID NOT EXIST, AND WHY THAT WAS THE WRONG ANSWER. The rootfs
 * verifiers take a directory precisely so a fixture tree can exercise them
 * without an image, and their suite says so at the top. The image verifiers
 * take a file, and the same argument applies to a file: an image can be
 * synthesised. It was not, so six verifiers ran only against whatever `make
 * image` happened to produce, which means their edge cases ran never. Meanwhile
 * INV-PROV-1 said in its own does_not_cover that "verifier correctness is
 * covered by the verifier suite's own tests", which was not true of any of
 * them.
 *
 * The fixture is a real GPT with a real FAT16 filesystem inside it, built byte
 * by byte below, because the thing being tested IS the byte parsing. Reading a
 * prepared binary fixture out of the repository would hide the layout that the
 * parser and the builder have to agree about, and a fixture nobody can read is
 * a fixture nobody can correct.
 *
 * The rule the rootfs suite states applies here unchanged: the hardest
 * requirement is not detecting a violation, it is refusing to report a pass
 * when the verifier could not look.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  bootFilesExact,
  bootOverlaysPresent,
  identifiersPinned,
  partitionPresent,
  readFatFile,
  readFatRootEntries,
  readGpt,
  rebuildIdentical,
  veritySaltPinned,
} from '../../provisioning/checks/image.mjs'

const SECTOR = 512

/** One file to place in the fixture filesystem. `null` contents means a directory. */
interface Entry {
  readonly name: string
  readonly contents: Buffer | null
  readonly children?: readonly Entry[]
  /**
   * Force the recorded first cluster, to build a directory that cannot be
   * followed. Zero is the honest version of that: a directory entry with no
   * chain to walk, which is what a truncated or corrupt card produces.
   */
  readonly cluster?: number
}

/**
 * A FAT16 filesystem containing the given entries, one level deep.
 *
 * Deliberately the simplest shape that is still FAT16 rather than FAT12: one
 * sector per cluster, one FAT, and enough clusters to clear the 4085 boundary
 * that separates the two. The reader classifies by cluster count, so a smaller
 * image would be FAT12 and it would refuse to follow chains, which is correct
 * behaviour and would test nothing.
 */
function buildFat16(entries: readonly Entry[], volumeId = 0x1234abcd): Buffer {
  const sectorsPerCluster = 1
  const reserved = 1
  const rootEntryCount = 32
  const rootDirSectors = (rootEntryCount * 32) / SECTOR
  const fatSize = 24
  const clusters = 5000
  const dataStart = reserved + fatSize + rootDirSectors
  const totalSectors = dataStart + clusters * sectorsPerCluster

  const image = Buffer.alloc(totalSectors * SECTOR)

  const boot = image.subarray(0, SECTOR)
  boot.writeUInt16LE(SECTOR, 0x0b)
  boot.writeUInt8(sectorsPerCluster, 0x0d)
  boot.writeUInt16LE(reserved, 0x0e)
  boot.writeUInt8(1, 0x10)
  boot.writeUInt16LE(rootEntryCount, 0x11)
  boot.writeUInt16LE(totalSectors, 0x13)
  boot.writeUInt16LE(fatSize, 0x16)
  boot.write('FAT16   ', 54, 'latin1')
  // BS_VolID. FAT16 keeps it at 0x27, FAT32 at 0x43, and identifiers-pinned
  // reads it because the boot partition has no UUID of the kind ext or erofs
  // carry: this four byte number is the only identifier it has.
  boot.writeUInt32LE(volumeId, 0x27)
  boot.writeUInt16LE(0xaa55, 510)

  const fatStart = reserved * SECTOR
  const rootStart = (reserved + fatSize) * SECTOR
  const clusterAt = (cluster: number): number =>
    (dataStart + (cluster - 2) * sectorsPerCluster) * SECTOR

  let nextCluster = 2
  /** Write bytes into a fresh chain and return its first cluster. */
  const allocate = (bytes: Buffer): number => {
    const first = nextCluster
    const needed = Math.max(1, Math.ceil(bytes.length / (sectorsPerCluster * SECTOR)))
    for (let index = 0; index < needed; index += 1) {
      const cluster = first + index
      bytes.copy(
        image,
        clusterAt(cluster),
        index * sectorsPerCluster * SECTOR,
        (index + 1) * sectorsPerCluster * SECTOR
      )
      const last = index === needed - 1
      image.writeUInt16LE(last ? 0xffff : cluster + 1, fatStart + cluster * 2)
    }
    nextCluster = first + needed
    return first
  }

  /** The 32-byte entries for one name: its LFN fragments, then its 8.3 record. */
  const records = (name: string, attr: number, cluster: number, size: number): Buffer => {
    const short = shortName(name)
    const out: Buffer[] = []

    // A name that does not fit 8.3 gets long-name entries. The reader
    // reassembles them by sequence number, so they are written in the
    // conventional on-disk order: last fragment first, top bit set on it.
    if (short === null) {
      const fragments = Math.ceil(name.length / 13)
      for (let index = fragments - 1; index >= 0; index -= 1) {
        const entry = Buffer.alloc(32, 0xff)
        entry.writeUInt8((index + 1) | (index === fragments - 1 ? 0x40 : 0), 0)
        entry.writeUInt8(0x0f, 11)
        entry.writeUInt8(0, 12)
        entry.writeUInt8(0, 13)
        entry.writeUInt16LE(0, 26)
        const piece = name.slice(index * 13, index * 13 + 13)
        const utf16 = Buffer.from(piece.padEnd(13, '\u0000'), 'utf16le')
        utf16.copy(entry, 1, 0, 10)
        utf16.copy(entry, 14, 10, 22)
        utf16.copy(entry, 28, 22, 26)
        out.push(entry)
      }
    }

    const entry = Buffer.alloc(32)
    const [base, ext, flags] = short ?? [`FILE${String(cluster)}`.slice(0, 8), '', 0]
    entry.write(base.toUpperCase().padEnd(8, ' '), 0, 'latin1')
    entry.write(ext.toUpperCase().padEnd(3, ' '), 8, 'latin1')
    entry.writeUInt8(attr, 11)
    entry.writeUInt8(flags, 12)
    entry.writeUInt16LE(cluster >>> 16, 20)
    entry.writeUInt16LE(cluster & 0xffff, 26)
    entry.writeUInt32LE(size, 28)
    out.push(entry)
    return Buffer.concat(out)
  }

  /** The directory table for a set of entries, allocating their data first. */
  const table = (list: readonly Entry[]): Buffer => {
    const out: Buffer[] = []
    for (const item of list) {
      if (item.contents === null) {
        const inner = table(item.children ?? [])
        const cluster = item.cluster ?? allocate(inner)
        out.push(records(item.name, 0x10, cluster, 0))
      } else {
        // A zero-length file has no first cluster, which is the case the reader
        // has to answer as "empty" rather than as "unreadable".
        const cluster = item.contents.length === 0 ? 0 : allocate(item.contents)
        out.push(records(item.name, 0x20, cluster, item.contents.length))
      }
    }
    return Buffer.concat(out)
  }

  // The root directory is a fixed region, so its data is allocated by the
  // recursion above and only the table itself lands here.
  const root = table(entries)
  root.copy(image, rootStart, 0, Math.min(root.length, rootEntryCount * 32))
  return image
}

/**
 * The 8.3 form of a name, with the NT case flags, or null if it does not fit.
 *
 * mtools writes `cmdline.txt` this way rather than spending a long-name entry
 * on it, so the reader honours those flags and so does this.
 */
function shortName(name: string): [string, string, number] | null {
  const dot = name.lastIndexOf('.')
  const base = dot === -1 ? name : name.slice(0, dot)
  const ext = dot === -1 ? '' : name.slice(dot + 1)
  if (base.length === 0 || base.length > 8 || ext.length > 3) return null
  if (/[^A-Za-z0-9_~-]/u.test(base + ext)) return null
  const lower = (part: string): boolean => part === part.toLowerCase() && /[a-z]/u.test(part)
  if (base !== base.toLowerCase() && base !== base.toUpperCase()) return null
  return [base, ext, (lower(base) ? 0x08 : 0) | (lower(ext) ? 0x10 : 0)]
}

/**
 * A GUID as GPT stores it: the first three groups little-endian, the last two
 * as written. Spelled out from the UEFI layout rather than borrowed from the
 * parser, so a byte-order mistake there cannot be agreed with here.
 */
function guidBytes(text: string): Buffer {
  const hex = text.replace(/-/gu, '')
  const bytes = Buffer.from(hex, 'hex')
  return Buffer.concat([
    Buffer.from(bytes.subarray(0, 4)).reverse(),
    Buffer.from(bytes.subarray(4, 6)).reverse(),
    Buffer.from(bytes.subarray(6, 8)).reverse(),
    bytes.subarray(8, 16),
  ])
}

/** A GPT holding the given partitions, in order, written to `path`. */
function writeImage(
  path: string,
  parts: readonly { name: string; bytes: Buffer; type?: string; attributes?: bigint }[]
): void {
  const firstLba = 64
  const total = firstLba * SECTOR + parts.reduce((sum, part) => sum + part.bytes.length, 0) + SECTOR
  const image = Buffer.alloc(total)

  const header = image.subarray(SECTOR, SECTOR + 92)
  header.write('EFI PART', 0, 'latin1')
  Buffer.alloc(16, 0x11).copy(header, 56)
  header.writeBigUInt64LE(2n, 72)
  header.writeUInt32LE(Math.max(4, parts.length), 80)
  header.writeUInt32LE(128, 84)

  let lba = firstLba
  for (const [index, part] of parts.entries()) {
    const entry = image.subarray(2 * SECTOR + index * 128, 2 * SECTOR + (index + 1) * 128)
    ;(part.type === undefined ? Buffer.alloc(16, 0x22) : guidBytes(part.type)).copy(entry, 0)
    Buffer.alloc(16, 0x33 + index).copy(entry, 16)
    entry.writeBigUInt64LE(BigInt(lba), 32)
    entry.writeBigUInt64LE(BigInt(lba + part.bytes.length / SECTOR - 1), 40)
    entry.writeBigUInt64LE(part.attributes ?? 0n, 48)
    entry.write(part.name, 56, 'utf16le')
    part.bytes.copy(image, lba * SECTOR)
    lba += part.bytes.length / SECTOR
  }
  writeFileSync(path, image)
}

/** The common case: one FAT partition named boot, which is the card's shape. */
function writeBootImage(path: string, fat: Buffer): void {
  writeImage(path, [{ name: 'boot', bytes: fat }])
}

/**
 * A dm-verity superblock carrying `salt`, as cryptsetup writes it.
 *
 * The offsets here are the ones the reader documents, and they are worth
 * writing out twice: they were wrong by eight bytes once, salt_size read at 88
 * and the salt at 96, and the only thing that found it was the first run
 * against a real image. A fixture that agreed with the parser rather than with
 * the struct would have kept that bug company, so this follows the struct.
 */
function veritySuperblock(salt: Buffer, algorithm = 'sha256'): Buffer {
  const block = Buffer.alloc(512)
  block.write('verity\u0000\u0000', 0, 'latin1')
  block.writeUInt32LE(1, 8)
  block.writeUInt32LE(1, 12)
  Buffer.alloc(16, 0x55).copy(block, 16)
  block.write(algorithm, 32, 'latin1')
  block.writeUInt32LE(4096, 64)
  block.writeUInt32LE(4096, 68)
  block.writeBigUInt64LE(64n, 72)
  block.writeUInt16LE(salt.length, 80)
  salt.copy(block, 88)
  return block
}

const FDT = Buffer.concat([Buffer.from([0xd0, 0x0d, 0xfe, 0xed]), Buffer.alloc(60)])
const CONFIG = Buffer.from('# a comment\ndtoverlay=nullroute-7inch-dsi\n', 'utf8')

let dir: string
let image: string

/** The shape the real card has: a few root files and one overlays directory. */
function standard(overrides: Partial<{ overlay: Buffer | null; config: Buffer }> = {}): void {
  const overlay = overrides.overlay === undefined ? FDT : overrides.overlay
  const children: Entry[] =
    overlay === null ? [] : [{ name: 'nullroute-7inch-dsi.dtbo', contents: overlay }]
  writeBootImage(
    image,
    buildFat16([
      { name: 'config.txt', contents: overrides.config ?? CONFIG },
      { name: 'kernel8.img', contents: Buffer.alloc(2048, 7) },
      { name: 'empty.txt', contents: Buffer.alloc(0) },
      { name: 'overlays', contents: null, children },
    ])
  )
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nullroute-image-'))
  image = join(dir, 'card.img')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('the fixture is a real GPT', () => {
  it('finds-the-named-partition', () => {
    standard()
    const gpt = readGpt(image)
    expect(gpt).not.toBeNull()
    expect(gpt?.partitions.map((p) => p.name)).toEqual(['boot'])
  })

  it('reports-null-for-a-file-that-is-not-a-gpt', () => {
    writeFileSync(image, Buffer.alloc(4096, 9))
    expect(readGpt(image)).toBeNull()
  })
})

describe('reading the FAT filesystem', () => {
  it('lists-the-root-and-descends-one-level', () => {
    standard()
    const offset = 64 * SECTOR
    const entries = readFatRootEntries(image, offset)
    expect(entries?.map((e) => e.name).sort()).toEqual([
      'config.txt',
      'empty.txt',
      'kernel8.img',
      'overlays',
    ])
    const overlays = entries?.find((e) => e.name === 'overlays')
    expect(overlays?.directory).toBe(true)
    expect(overlays?.children).toEqual(['nullroute-7inch-dsi.dtbo'])
  })

  it('reads-a-file-in-the-root', () => {
    standard()
    expect(readFatFile(image, 64 * SECTOR, 'config.txt')?.toString('utf8')).toBe(
      CONFIG.toString('utf8')
    )
  })

  it('reads-a-file-inside-a-directory', () => {
    standard()
    const blob = readFatFile(image, 64 * SECTOR, 'overlays/nullroute-7inch-dsi.dtbo')
    expect(blob?.readUInt32BE(0)).toBe(0xd00dfeed)
  })

  it('answers-empty-for-an-empty-file-rather-than-unreadable', () => {
    standard()
    const bytes = readFatFile(image, 64 * SECTOR, 'empty.txt')
    expect(bytes).not.toBeNull()
    expect(bytes?.length).toBe(0)
  })

  it('returns-null-for-a-name-that-is-not-there', () => {
    standard()
    expect(readFatFile(image, 64 * SECTOR, 'overlays/absent.dtbo')).toBeNull()
    expect(readFatFile(image, 64 * SECTOR, 'absent.txt')).toBeNull()
  })

  it('will-not-return-a-directory-as-a-file', () => {
    standard()
    expect(readFatFile(image, 64 * SECTOR, 'overlays')).toBeNull()
  })
})

describe('boot-files-exact', () => {
  const run = (files: readonly string[] | undefined, partition = 'boot') =>
    bootFilesExact({ image }, { partition, files })

  it('passes-on-exactly-the-named-set', () => {
    standard()
    const result = run([
      'config.txt',
      'kernel8.img',
      'empty.txt',
      'overlays',
      'overlays/nullroute-7inch-dsi.dtbo',
    ])
    expect(result.ok).toBe(true)
  })

  /**
   * THE REGRESSION THIS FILE EXISTS FOR. The verifier read the root directory
   * and stopped, so a file added inside overlays/ was seen by nothing at all,
   * on the one partition dm-verity does not cover.
   */
  it('fails-on-a-file-smuggled-into-a-subdirectory', () => {
    writeBootImage(
      image,
      buildFat16([
        { name: 'config.txt', contents: CONFIG },
        {
          name: 'overlays',
          contents: null,
          children: [
            { name: 'nullroute-7inch-dsi.dtbo', contents: FDT },
            { name: 'evil.dtbo', contents: FDT },
          ],
        },
      ])
    )
    const result = run(['config.txt', 'overlays', 'overlays/nullroute-7inch-dsi.dtbo'])
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('overlays/evil.dtbo')
  })

  it('fails-when-a-named-file-is-missing', () => {
    standard()
    const result = run([
      'config.txt',
      'kernel8.img',
      'empty.txt',
      'overlays',
      'overlays/nullroute-7inch-dsi.dtbo',
      'initramfs.img',
    ])
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('initramfs.img')
  })

  it('cannot-run-without-a-file-list-rather-than-passing', () => {
    standard()
    const result = run([])
    expect(result.ok).toBe(false)
    expect(result.unavailable).toBe(true)
  })

  it('cannot-run-when-the-partition-is-not-there', () => {
    standard()
    const result = run(['config.txt'], 'system')
    expect(result.ok).toBe(false)
    expect(result.unavailable).toBe(true)
  })

  /**
   * AN UNREADABLE DIRECTORY AND AN EMPTY ONE HOLD THE SAME SET OF NAMES, and
   * reporting the first as the second would say the card is exactly the pinned
   * set while a directory on it was never opened. Written after a mutation
   * showed the guard could be deleted with all nineteen other tests still
   * green, which made it a guard nothing was holding.
   */
  it('cannot-run-when-a-directory-cannot-be-read-rather-than-calling-it-empty', () => {
    writeBootImage(
      image,
      buildFat16([
        { name: 'config.txt', contents: CONFIG },
        { name: 'overlays', contents: null, children: [], cluster: 0 },
      ])
    )
    const result = run(['config.txt', 'overlays'])
    expect(result.ok).toBe(false)
    expect(result.unavailable).toBe(true)
    expect(result.detail).toContain('overlays')
  })
})

describe('boot-overlays-present', () => {
  const run = () => bootOverlaysPresent({ image }, { partition: 'boot' })

  it('passes-when-config-names-an-overlay-that-is-there', () => {
    standard()
    const result = run()
    expect(result.ok).toBe(true)
    expect(result.detail).toContain('nullroute-7inch-dsi')
  })

  /**
   * The failure is a blank screen on a touchscreen product: the firmware looks
   * for the named overlay, does not find it, and carries on booting silently.
   */
  it('fails-when-the-named-overlay-is-not-on-the-card', () => {
    standard({ overlay: null })
    const result = run()
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('is not on the card')
  })

  it('fails-when-the-overlay-is-not-a-device-tree-blob', () => {
    standard({ overlay: Buffer.alloc(64, 0x41) })
    const result = run()
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('not a flattened device tree blob')
  })

  it('ignores-a-commented-out-dtoverlay-line', () => {
    standard({ config: Buffer.from('#dtoverlay=something-else\ndtoverlay=nullroute-7inch-dsi\n') })
    expect(run().ok).toBe(true)
  })

  /** A config.txt naming nothing is either a device with no overlay, which this
   *  product is not, or a parse that failed. Neither is agreement. */
  it('cannot-run-when-config-names-no-overlay-rather-than-passing', () => {
    standard({ config: Buffer.from('# nothing to see\n') })
    const result = run()
    expect(result.ok).toBe(false)
    expect(result.unavailable).toBe(true)
  })

  it('cannot-run-when-there-is-no-config-rather-than-passing', () => {
    writeBootImage(image, buildFat16([{ name: 'kernel8.img', contents: Buffer.alloc(512, 1) }]))
    const result = run()
    expect(result.ok).toBe(false)
    expect(result.unavailable).toBe(true)
  })

  describe('with display_auto_detect, as the Pi 5 section has it', () => {
    const DETECTABLE = ['vc4-kms-dsi-7inch', 'vc4-kms-dsi-ili9881-7inch']
    const DETECTING = Buffer.from(
      '[pi4]\ndtoverlay=nullroute-7inch-dsi\n[pi5]\ndtoverlay=vc4-kms-v3d-pi5\ndisplay_auto_detect=1\n'
    )
    const card = (overlays: readonly string[]) => {
      writeBootImage(
        image,
        buildFat16([
          { name: 'config.txt', contents: DETECTING },
          {
            name: 'overlays',
            contents: null,
            children: overlays.map((name) => ({ name: `${name}.dtbo`, contents: FDT })),
          },
        ])
      )
    }
    const detect = (autoDetect?: readonly string[]) =>
      bootOverlaysPresent(
        { image },
        autoDetect === undefined ? { partition: 'boot' } : { partition: 'boot', autoDetect }
      )

    it('passes-when-every-overlay-it-may-detect-is-there', () => {
      card(['nullroute-7inch-dsi', 'vc4-kms-v3d-pi5', ...DETECTABLE])
      const result = detect(DETECTABLE)
      expect(result.ok).toBe(true)
      expect(result.detail).toContain('4 overlay(s) config.txt names or may detect')
    })

    /** A Touch Display 2 found on a card that only carries Touch Display 1's overlay. */
    it('fails-when-an-overlay-it-may-detect-is-not-on-the-card', () => {
      card(['nullroute-7inch-dsi', 'vc4-kms-v3d-pi5', 'vc4-kms-dsi-7inch'])
      const result = detect(DETECTABLE)
      expect(result.ok).toBe(false)
      expect(result.detail).toContain(
        'may detect vc4-kms-dsi-ili9881-7inch and overlays/vc4-kms-dsi-ili9881-7inch.dtbo is not on the card'
      )
    })

    /** Detection on and nothing said about what it detects is not agreement. */
    it('cannot-run-when-the-assertion-names-nothing-it-may-detect', () => {
      card(['nullroute-7inch-dsi', 'vc4-kms-v3d-pi5', ...DETECTABLE])
      const result = detect()
      expect(result.ok).toBe(false)
      expect(result.unavailable).toBe(true)
    })
  })
})

describe('partition-present', () => {
  const run = (expect_?: readonly { name: string; minMiB?: number }[]) =>
    partitionPresent({ image }, expect_ === undefined ? {} : { expect: expect_ })

  it('passes-when-the-named-partition-is-there', () => {
    standard()
    expect(run([{ name: 'boot' }]).ok).toBe(true)
  })

  it('fails-when-a-named-partition-is-absent', () => {
    standard()
    const result = run([{ name: 'boot' }, { name: 'system' }])
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('no partition named system')
  })

  it('fails-when-the-partition-is-smaller-than-required', () => {
    standard()
    const result = run([{ name: 'boot', minMiB: 4096 }])
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('under the 4096 required')
  })

  /** An assertion with nothing to look for cannot fail, which is not a pass. */
  it('cannot-run-with-an-empty-expect-list-rather-than-passing', () => {
    standard()
    const result = run([])
    expect(result.ok).toBe(false)
    expect(result.unavailable).toBe(true)
  })

  it('cannot-run-on-a-file-that-is-not-an-image', () => {
    writeFileSync(image, Buffer.alloc(4096, 9))
    const result = run([{ name: 'boot' }])
    expect(result.ok).toBe(false)
    expect(result.unavailable).toBe(true)
  })

  describe('the boot partition the bootloader has to recognise', () => {
    const FAT = 'EBD0A0A2-B9E5-4433-87C0-68B6B72699C7'
    const LINUX = '0FC63DAF-8483-4772-8E79-3D69D8477DE4'
    const boot = (type: string, attributes: bigint) => {
      writeImage(image, [{ name: 'boot', bytes: Buffer.alloc(8 * SECTOR), type, attributes }])
      return partitionPresent({ image }, { expect: [{ name: 'boot', type: FAT, bootable: true }] })
    }

    it('passes-a-fat-typed-bootable-partition', () => {
      expect(boot(FAT, 4n).ok).toBe(true)
    })

    /** genimage's default, which is what every card built before this had. */
    it('fails-a-partition-typed-linux-filesystem', () => {
      const result = boot(LINUX, 4n)
      expect(result.ok).toBe(false)
      expect(result.detail).toContain(`boot is typed ${LINUX}, not ${FAT}`)
    })

    it('fails-a-partition-without-the-bootable-flag', () => {
      const result = boot(FAT, 0n)
      expect(result.ok).toBe(false)
      expect(result.detail).toContain('boot is not marked bootable')
    })

    /** Bit 2 alone is the flag. The other attribute bits say nothing about it. */
    it('reads-only-bit-two-as-bootable', () => {
      expect(boot(FAT, 1n | 2n | (1n << 60n)).ok).toBe(false)
      expect(boot(FAT, 4n | (1n << 63n)).ok).toBe(true)
    })
  })
})

describe('rebuild-identical', () => {
  it('passes-when-two-builds-are-byte-identical', async () => {
    standard()
    const twin = join(dir, 'twin.img')
    writeFileSync(twin, readFileSync(image))
    const result = await rebuildIdentical({ image, compare: twin })
    expect(result.ok).toBe(true)
  })

  it('fails-when-one-byte-differs-at-the-same-size', async () => {
    standard()
    const twin = join(dir, 'twin.img')
    const bytes = readFileSync(image)
    bytes[bytes.length - 1] ^= 0xff
    writeFileSync(twin, bytes)
    const result = await rebuildIdentical({ image, compare: twin })
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('not pinned')
  })

  it('fails-when-the-two-builds-are-different-sizes', async () => {
    standard()
    const twin = join(dir, 'twin.img')
    writeFileSync(twin, readFileSync(image).subarray(0, 1024))
    const result = await rebuildIdentical({ image, compare: twin })
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('not the same build')
  })

  /**
   * One image cannot demonstrate that two builds agree, and reporting that as
   * reproducibility would be the whole claim resting on nothing.
   */
  it('cannot-run-with-only-one-image-rather-than-passing', async () => {
    standard()
    const result = await rebuildIdentical({ image })
    expect(result.ok).toBe(false)
    expect(result.unavailable).toBe(true)
  })

  it('cannot-run-when-the-second-image-is-not-there', async () => {
    standard()
    const result = await rebuildIdentical({ image, compare: join(dir, 'absent.img') })
    expect(result.ok).toBe(false)
    expect(result.unavailable).toBe(true)
  })
})

describe('identifiers-pinned', () => {
  /** The identifiers this fixture actually carries, read back rather than assumed. */
  const actual = () => {
    const gpt = readGpt(image)
    return {
      diskGuid: gpt?.diskGuid ?? '',
      partGuid: gpt?.partitions[0]?.partGuid ?? '',
    }
  }

  it('passes-when-every-pinned-identifier-matches', () => {
    standard()
    const { diskGuid, partGuid } = actual()
    const result = identifiersPinned(
      { image },
      { diskGuid, partitions: [{ name: 'boot', partGuid, fatVolumeId: '1234abcd' }] }
    )
    expect(result.ok).toBe(true)
  })

  it('fails-when-the-disk-guid-is-not-the-pinned-one', () => {
    standard()
    const { partGuid } = actual()
    const result = identifiersPinned(
      { image },
      { diskGuid: '00000000-0000-0000-0000-000000000000', partitions: [{ name: 'boot', partGuid }] }
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('disk GUID')
  })

  it('fails-when-the-partition-guid-is-not-the-pinned-one', () => {
    standard()
    const result = identifiersPinned(
      { image },
      { partitions: [{ name: 'boot', partGuid: '00000000-0000-0000-0000-000000000000' }] }
    )
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('partition GUID')
  })

  /**
   * The boot partition has no UUID of the kind ext or erofs carries, so this
   * four byte number is the only identifier it has, and a build that generates
   * it afresh moves it on every run.
   */
  it('fails-when-the-fat-volume-id-is-not-the-pinned-one', () => {
    standard()
    const result = identifiersPinned(
      { image },
      { partitions: [{ name: 'boot', fatVolumeId: 'deadbeef' }] }
    )
    expect(result.ok).toBe(false)
    // NOT merely false. Deleting the volume id branch leaves nothing checked,
    // which returns could-not-run, which is also ok:false, so asserting that
    // alone let this test pass against a verifier that had stopped looking.
    // Found by mutation, which is the only reason it is written this way.
    expect(result.unavailable).toBeUndefined()
    expect(result.detail).toContain('volume id')
  })

  it('cannot-run-on-a-file-that-is-not-an-image', () => {
    writeFileSync(image, Buffer.alloc(4096, 9))
    const result = identifiersPinned({ image }, { diskGuid: 'whatever' })
    expect(result.ok).toBe(false)
    expect(result.unavailable).toBe(true)
  })
})

describe('verity-salt-pinned', () => {
  const SALT = Buffer.alloc(32, 0xab)
  const hex = SALT.toString('hex')

  /** A card with a boot partition and a hash partition beside it. */
  const withHash = (block: Buffer) => {
    writeImage(image, [
      { name: 'boot', bytes: buildFat16([{ name: 'config.txt', contents: CONFIG }]) },
      { name: 'system-hash', bytes: Buffer.concat([block, Buffer.alloc(1024)]) },
    ])
  }

  it('passes-when-the-salt-is-the-pinned-one', () => {
    withHash(veritySuperblock(SALT))
    const result = veritySaltPinned({ image }, { partition: 'system-hash', salt: hex })
    expect(result.ok).toBe(true)
  })

  /**
   * THE DEFECT THIS VERIFIER EXISTS FOR. A salt generated per build makes the
   * root hash change on every build of a byte-identical filesystem, which makes
   * the number the device shows at boot meaningless as a published value.
   */
  it('fails-on-a-salt-that-was-generated-rather-than-pinned', () => {
    withHash(veritySuperblock(Buffer.alloc(32, 0x5c)))
    const result = veritySaltPinned({ image }, { partition: 'system-hash', salt: hex })
    expect(result.ok).toBe(false)
    // On the mismatch itself, not on a superblock this failed to read. Every
    // other way of reaching this verifier's ok:false says something different,
    // and asserting only the boolean would accept any of them.
    expect(result.detail).toContain('the profile pins')
    expect(result.unavailable).toBeUndefined()
  })

  it('fails-when-the-partition-holds-no-verity-superblock', () => {
    withHash(Buffer.alloc(512, 0x11))
    const result = veritySaltPinned({ image }, { partition: 'system-hash', salt: hex })
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('does not begin with a dm-verity superblock')
  })

  it('fails-when-there-is-no-such-partition', () => {
    withHash(veritySuperblock(SALT))
    const result = veritySaltPinned({ image }, { partition: 'absent', salt: hex })
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('no partition named absent')
  })

  it('cannot-run-when-the-assertion-pins-nothing-rather-than-passing', () => {
    withHash(veritySuperblock(SALT))
    const result = veritySaltPinned({ image }, { partition: 'system-hash' })
    expect(result.ok).toBe(false)
    expect(result.unavailable).toBe(true)
  })
})
