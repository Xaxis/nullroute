/**
 * The verifiers that read a built image file.
 *
 * WHY THESE ARE SEPARATE from the rootfs verifiers. A partition table, a
 * dm-verity superblock and a filesystem UUID are not files. They live in the
 * bytes between and underneath filesystems, so a directory of assembled files
 * cannot answer any of them, and pretending it could is the exact class of
 * false pass `provisioning/README.md` was written about.
 *
 * WRITTEN BEFORE THE BACKEND, ON PURPOSE. The README argues that a backend is
 * supported when the UNCHANGED verifiers pass against its output, which is only
 * meaningful if the verifiers came first. These encode two named upstream
 * defects in rpi-image-gen as executable gates rather than as a paragraph in a
 * profile:
 *
 *   The verity setup passes a salt from `uuidgen`. The root hash is a function
 *   of (data, salt), so THE ROOT HASH CHANGES ON EVERY BUILD even when the
 *   filesystem is byte-identical. That makes the single number this device
 *   displays at boot meaningless as a published value, which is the number the
 *   whole project asks a user to compare. `verity-salt-pinned` reads the salt
 *   out of the superblock and fails if it is not the pinned one.
 *
 *   `mke2fs` is never given a hash seed, and the GPT GUIDs are generated fresh.
 *   Random identifiers are the commonest single cause of an otherwise
 *   reproducible image failing to reproduce, and they are invisible in a
 *   file-level diff. `identifiers-pinned` reads them out of the image.
 *
 * EVERY OFFSET HERE IS FROM A PUBLISHED ON-DISK FORMAT and is named in a
 * comment, because a verifier that reads the wrong sixteen bytes and reports a
 * confident PASS is worse than one that does not exist.
 *
 * NOTHING HERE MOUNTS ANYTHING. Loop-mounting needs root, and a verification
 * tool that must run privileged is one people run less often. These read the
 * file at an offset, which works on a disk image on any operating system, so
 * they are exercised against a synthetic fixture today.
 */

import { closeSync, createReadStream, openSync, readSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'

/** Every Raspberry Pi image is 512-byte sectors. */
const SECTOR = 512

/** @typedef {import('./rootfs.mjs').Verdict} Verdict */

function verdict(check, ok, detail, limits = []) {
  return { check, ok, detail, limits }
}

function cannotRun(check, detail) {
  return { check, ok: false, detail, limits: [], unavailable: true }
}

/** Read `length` bytes at an absolute offset, without mapping the whole file. */
function readAt(fd, offset, length) {
  const buffer = Buffer.alloc(length)
  const read = readSync(fd, buffer, 0, length, offset)
  return read === length ? buffer : null
}

/**
 * A GUID as it is written on disk versus as it is printed.
 *
 * The first three fields are little-endian and the last two are big-endian,
 * which is a genuine property of the format rather than an implementation
 * quirk, and reading it as sixteen flat bytes produces a GUID that looks
 * plausible and matches nothing. That is the failure this function exists to
 * make impossible to write twice.
 */
function guid(bytes) {
  const hex = (slice) => Buffer.from(slice).toString('hex')
  return [
    hex(Buffer.from(bytes.subarray(0, 4)).reverse()),
    hex(Buffer.from(bytes.subarray(4, 6)).reverse()),
    hex(Buffer.from(bytes.subarray(6, 8)).reverse()),
    hex(bytes.subarray(8, 10)),
    hex(bytes.subarray(10, 16)),
  ]
    .join('-')
    .toUpperCase()
}

const EMPTY_GUID = '00000000-0000-0000-0000-000000000000'

/**
 * Read the GPT: the header, then every partition entry that is in use.
 *
 * Returns null when the file is not GPT at all, which is a different thing from
 * a GPT that fails an assertion and is reported differently.
 */
export function readGpt(path) {
  let fd
  try {
    fd = openSync(path, 'r')
  } catch {
    return null
  }
  try {
    // LBA 1. LBA 0 is the protective MBR and carries nothing this needs.
    const header = readAt(fd, SECTOR, 92)
    // The signature "EFI PART". A file whose second sector does not start with
    // it is not a GPT, whatever else it may be.
    if (header === null || header.subarray(0, 8).toString('latin1') !== 'EFI PART') return null

    const diskGuid = guid(header.subarray(56, 72))
    const entryLba = Number(header.readBigUInt64LE(72))
    const entryCount = header.readUInt32LE(80)
    const entrySize = header.readUInt32LE(84)

    // A table this size is not a Pi image and is more likely a hostile or
    // corrupt file. Bounded before anything is allocated from it.
    if (entryCount > 256 || entrySize < 128 || entrySize > 1024) return null

    const partitions = []
    for (let index = 0; index < entryCount; index += 1) {
      const entry = readAt(fd, entryLba * SECTOR + index * entrySize, entrySize)
      if (entry === null) break
      const typeGuid = guid(entry.subarray(0, 16))
      // An all-zero type GUID means the slot is unused. Skipped rather than
      // reported, because a 128-entry table is mostly empty slots.
      if (typeGuid === EMPTY_GUID) continue
      partitions.push({
        index: index + 1,
        typeGuid,
        partGuid: guid(entry.subarray(16, 32)),
        firstLba: Number(entry.readBigUInt64LE(32)),
        lastLba: Number(entry.readBigUInt64LE(40)),
        // 72 bytes of UTF-16LE, NUL padded.
        name: entry.subarray(56, 128).toString('utf16le').split('\u0000')[0],
      })
    }
    return { diskGuid, partitions }
  } finally {
    closeSync(fd)
  }
}

/**
 * The dm-verity superblock, from the start of a hash partition.
 *
 * Layout is the on-disk verity superblock from libcryptsetup: an 8 byte
 * signature, then version and hash type as 32 bit LE, a 16 byte UUID, a 32 byte
 * algorithm name, two block sizes, the data block count, then a 16 bit salt
 * size, six bytes of padding, and 256 bytes of salt.
 */
export function readVeritySuperblock(path, offset) {
  let fd
  try {
    fd = openSync(path, 'r')
  } catch {
    return null
  }
  try {
    const block = readAt(fd, offset, 512)
    if (block === null) return null
    // The signature is the ASCII "verity" followed by two NULs. Anything else
    // and this is not a hash partition, which is a different finding from a
    // hash partition carrying the wrong salt.
    if (block.subarray(0, 6).toString('latin1') !== 'verity') return null

    // OFFSET 80, NOT 88, AND THE SALT AT 88 RATHER THAN 96.
    //
    // Both were eight bytes too far, and the first run of this verifier against
    // a real image is what found it. The struct is cryptsetup's `verity_sb`:
    //
    //   signature[8]     0
    //   version          8
    //   hash_type       12
    //   uuid[16]        16
    //   algorithm[32]   32
    //   data_block_size 64
    //   hash_block_size 68
    //   data_blocks     72   (8 bytes)
    //   salt_size       80   (2 bytes)
    //   _pad1[6]        82
    //   salt[256]       88
    //
    // The padding follows salt_size rather than preceding it, which is what the
    // old offsets assumed. This file's own header says a verifier that reads
    // the wrong bytes and reports a confident PASS is worse than one that does
    // not exist. It read the wrong bytes and reported a confident FAIL, which
    // is the better direction to be wrong in and still wrong.
    const saltSize = block.readUInt16LE(80)
    if (saltSize > 256) return null

    return {
      version: block.readUInt32LE(8),
      hashType: block.readUInt32LE(12),
      uuid: guid(block.subarray(16, 32)),
      algorithm: block.subarray(32, 64).toString('latin1').split('\u0000')[0],
      dataBlockSize: block.readUInt32LE(64),
      hashBlockSize: block.readUInt32LE(68),
      dataBlocks: Number(block.readBigUInt64LE(72)),
      salt: block.subarray(88, 88 + saltSize).toString('hex'),
    }
  } finally {
    closeSync(fd)
  }
}

/**
 * The UUID an ext filesystem carries in its superblock.
 *
 * The superblock is 1024 bytes into the partition. The magic 0xEF53 is at
 * offset 56 within it, and the UUID at offset 104. Read as flat bytes, unlike a
 * GPT GUID: ext stores it in the printed order.
 */
/**
 * The filesystem UUID out of an erofs superblock.
 *
 * WHY EROFS IS HERE AT ALL. The system partition was going to be ext4 and is
 * not, because ext4 does not reproduce: mkfs.ext4 stamps wall-clock time into
 * three superblock fields and e2fsprogs 1.47.0 ignores SOURCE_DATE_EPOCH, so
 * two builds of identical content give different root hashes even with the
 * salt, the UUID and the hash seed all pinned. erofs takes the build time as an
 * argument and is byte-identical across builds. See
 * provisioning/backends/rpi-image-gen/README.md for the measurement.
 *
 * OFFSETS, from the on-disk format in the kernel's fs/erofs/erofs_fs.h, and
 * verified against a real image rather than copied from a header:
 *
 *   the superblock starts 1024 bytes into the partition (EROFS_SUPER_OFFSET)
 *   +0x00  magic, 0xe0f5e1e2, stored little-endian
 *   +0x30  uuid, sixteen flat bytes
 *
 * Sixteen FLAT bytes, unlike a GPT GUID, whose first three fields are
 * little-endian. Reading one the way the other is read produces something that
 * looks like a UUID and matches nothing.
 */
export function readErofsUuid(path, offset) {
  let fd
  try {
    fd = openSync(path, 'r')
  } catch {
    return null
  }
  try {
    const sb = readAt(fd, offset + 1024, 128)
    if (sb === null || sb.readUInt32LE(0) !== 0xe0f5e1e2) return null
    const raw = sb.subarray(48, 64).toString('hex')
    return [
      raw.slice(0, 8),
      raw.slice(8, 12),
      raw.slice(12, 16),
      raw.slice(16, 20),
      raw.slice(20, 32),
    ].join('-')
  } finally {
    closeSync(fd)
  }
}

export function readExtUuid(path, offset) {
  let fd
  try {
    fd = openSync(path, 'r')
  } catch {
    return null
  }
  try {
    const sb = readAt(fd, offset + 1024, 264)
    if (sb === null || sb.readUInt16LE(56) !== 0xef53) return null
    const raw = sb.subarray(104, 120).toString('hex')
    return [
      raw.slice(0, 8),
      raw.slice(8, 12),
      raw.slice(12, 16),
      raw.slice(16, 20),
      raw.slice(20, 32),
    ].join('-')
  } finally {
    closeSync(fd)
  }
}

/**
 * The volume id a FAT filesystem carries in its boot sector.
 *
 * FAT32 puts it at offset 0x43 and FAT16 at 0x27, and the two are told apart by
 * the sectors-per-FAT field at 0x16 being zero on FAT32. Getting this wrong
 * reads four bytes of a volume label and reports them as an identifier.
 */
export function readFatVolumeId(path, offset) {
  let fd
  try {
    fd = openSync(path, 'r')
  } catch {
    return null
  }
  try {
    const boot = readAt(fd, offset, 512)
    // 0xAA55 at the end of the boot sector. Absent means this is not FAT.
    if (boot === null || boot.readUInt16LE(510) !== 0xaa55) return null
    const fat32 = boot.readUInt16LE(0x16) === 0
    const id = boot.readUInt32LE(fat32 ? 0x43 : 0x27)
    return id.toString(16).padStart(8, '0').toUpperCase()
  } finally {
    closeSync(fd)
  }
}

/**
 * The file names in the root directory of a FAT partition.
 *
 * WHY THIS PARTITION IS WORTH READING AT ALL. Everything else on the card is
 * under the dm-verity hash tree. The boot partition is not, and cannot be: it
 * is where the firmware reads the root hash FROM, so it is the one region an
 * attacker can rewrite while the device still displays a number of their
 * choosing. docs/THREAT-MODEL.md says tier 1 moves that problem rather than
 * closing it. Knowing exactly which files are on the unprotected partition is
 * not a substitute for a signed boot chain, and it is the strongest thing
 * available below one: a file that appears there without anybody deciding it
 * should is precisely the change nothing else here would notice.
 *
 * Offsets are from the FAT specification's BIOS Parameter Block. FAT12 and
 * FAT16 keep the root directory in a fixed area after the FATs; FAT32 keeps it
 * in the ordinary data area as a cluster chain, so both are handled and the
 * chain is followed rather than assuming one cluster is enough.
 *
 * Long names are reassembled from their LFN entries. Reading only the 8.3 names
 * would report `BCM271~1.DTB` for a device tree blob, which is a name nobody
 * writes in a profile and would make the assertion unwritable.
 */
/**
 * The geometry of one FAT partition, and the two operations that need it.
 *
 * Split out from readFatRootEntries so that reading a file's contents and
 * listing a directory walk the same cluster chains. They had better: a check
 * that reads config.txt off the card to see which overlay the firmware is told
 * to load is only worth anything if it can also see whether that overlay is
 * there, and doing that with a second, subtly different FAT reader would be a
 * way to have the two disagree.
 *
 * Returns null for anything this cannot read, rather than a partial mount.
 */
function mountFat(fd, offset) {
  const boot = readAt(fd, offset, 512)
  if (boot === null || boot.readUInt16LE(510) !== 0xaa55) return null

  const bytesPerSector = boot.readUInt16LE(0x0b)
  const sectorsPerCluster = boot.readUInt8(0x0d)
  const reserved = boot.readUInt16LE(0x0e)
  const numFats = boot.readUInt8(0x10)
  const rootEntryCount = boot.readUInt16LE(0x11)
  const fatSize16 = boot.readUInt16LE(0x16)
  const fatSize32 = boot.readUInt32LE(0x24)
  const rootCluster = boot.readUInt32LE(0x2c)

  // A sector size that is not a power of two in the usual range, or no FATs
  // at all, means this is not FAT however convincing the 0xAA55 was.
  if (![512, 1024, 2048, 4096].includes(bytesPerSector)) return null
  if (numFats === 0 || sectorsPerCluster === 0) return null

  const fatSize = fatSize16 === 0 ? fatSize32 : fatSize16
  const fat32 = fatSize16 === 0
  const clusterBytes = sectorsPerCluster * bytesPerSector
  const dataStart =
    reserved + numFats * fatSize + (fat32 ? 0 : Math.ceil((rootEntryCount * 32) / bytesPerSector))

  /** Every byte of the root directory, however it is laid out. */
  let directory
  if (!fat32) {
    const start = offset + (reserved + numFats * fatSize) * bytesPerSector
    directory = readAt(fd, start, rootEntryCount * 32)
    if (directory === null) return null
  } else {
    const chunks = []
    let cluster = rootCluster
    // Bounded: a corrupt or hostile FAT can describe a cycle, and following
    // one would read until memory ran out.
    for (let hops = 0; hops < 65536 && cluster >= 2 && cluster < 0x0ffffff8; hops += 1) {
      const at = offset + (dataStart + (cluster - 2) * sectorsPerCluster) * bytesPerSector
      const chunk = readAt(fd, at, clusterBytes)
      if (chunk === null) break
      chunks.push(chunk)
      const entryAt = offset + reserved * bytesPerSector + cluster * 4
      const next = readAt(fd, entryAt, 4)
      if (next === null) break
      cluster = next.readUInt32LE(0) & 0x0fffffff
    }
    if (chunks.length === 0) return null
    directory = Buffer.concat(chunks)
  }

  // The FAT width decides how the next link in a chain is read. FAT32 is the
  // 28-bit case the root above already follows. FAT16 is a flat two bytes.
  // FAT12 packs 12 bits per entry across byte boundaries and is deliberately
  // NOT decoded: a boot partition this size is never FAT12, and guessing at a
  // packed nibble would invent file names, which is worse than saying so.
  const totalSectors16 = boot.readUInt16LE(0x13)
  const totalSectors = totalSectors16 === 0 ? boot.readUInt32LE(0x20) : totalSectors16
  const clusterCount = Math.floor(Math.max(0, totalSectors - dataStart) / sectorsPerCluster)
  const fatKind = fat32 ? 32 : clusterCount < 4085 ? 12 : 16

  /** Every byte of a cluster chain, or null if it cannot be followed. */
  const chain = (first) => {
    if (fatKind === 12) return null
    const eoc = fatKind === 32 ? 0x0ffffff8 : 0xfff8
    const width = fatKind === 32 ? 4 : 2
    const chunks = []
    // Bounded for the same reason the root walk is: a hostile FAT can
    // describe a cycle, and following one reads until memory runs out.
    let cluster = first
    for (let hops = 0; hops < 65536 && cluster >= 2 && cluster < eoc; hops += 1) {
      const at = offset + (dataStart + (cluster - 2) * sectorsPerCluster) * bytesPerSector
      const chunk = readAt(fd, at, clusterBytes)
      if (chunk === null) break
      chunks.push(chunk)
      const next = readAt(fd, offset + reserved * bytesPerSector + cluster * width, width)
      if (next === null) break
      cluster = fatKind === 32 ? next.readUInt32LE(0) & 0x0fffffff : next.readUInt16LE(0)
    }
    return chunks.length === 0 ? null : Buffer.concat(chunks)
  }

  /** The entries of one directory, given every byte of it. */
  const decode = (directory) => {
    const entries = []
    let longName = []
    for (let at = 0; at + 32 <= directory.length; at += 32) {
      const entry = directory.subarray(at, at + 32)
      const first = entry.readUInt8(0)
      if (first === 0x00) break
      if (first === 0xe5) {
        longName = []
        continue
      }
      const attr = entry.readUInt8(11)

      if ((attr & 0x0f) === 0x0f) {
        // An LFN entry. They are stored in reverse, so the sequence number in
        // the low five bits says where this fragment belongs.
        const sequence = (first & 0x1f) - 1
        const text = Buffer.concat([
          entry.subarray(1, 11),
          entry.subarray(14, 26),
          entry.subarray(28, 32),
        ]).toString('utf16le')
        longName[sequence] = text
        continue
      }

      // The volume label is a directory entry and is not a file.
      if ((attr & 0x08) !== 0) {
        longName = []
        continue
      }

      let name
      if (longName.length > 0) {
        /* eslint-disable no-control-regex -- matching NUL is the point: an LFN
           fragment is padded with U+0000 and then U+FFFF, so the first of
           either ends the name. A rule that forbids naming it would leave the
           padding in the file name. */
        name = longName.join('').replace(/[\u0000\uffff].*$/u, '')
        /* eslint-enable no-control-regex */
      } else {
        const base = entry.subarray(0, 8).toString('latin1').trimEnd()
        const ext = entry.subarray(8, 11).toString('latin1').trimEnd()
        // The NT reserved byte records that a purely 8.3 name was written in
        // lower case, which is how mtools stores `cmdline.txt` without spending
        // an LFN entry on it. Ignoring it reports CMDLINE.TXT for a file the
        // firmware and the profile both call cmdline.txt.
        const flags = entry.readUInt8(12)
        const cased = (part, bit) => ((flags & bit) !== 0 ? part.toLowerCase() : part)
        name = ext === '' ? cased(base, 0x08) : `${cased(base, 0x08)}.${cased(ext, 0x10)}`
      }
      longName = []

      if (name === '.' || name === '..') continue
      entries.push({
        name,
        size: entry.readUInt32LE(28),
        directory: (attr & 0x10) !== 0,
        // Multiplied, not shifted. `high << 16` is a 32-bit signed operation in
        // JavaScript, so a high word above 0x7fff yields a negative cluster and
        // the chain walk below rejects it as out of range.
        cluster: entry.readUInt16LE(20) * 0x10000 + entry.readUInt16LE(26),
      })
    }
    return entries
  }

  return { decode, chain, directory }
}

export function readFatRootEntries(path, offset) {
  let fd
  try {
    fd = openSync(path, 'r')
  } catch {
    return null
  }
  try {
    const mounted = mountFat(fd, offset)
    if (mounted === null) return null
    const { decode, chain, directory } = mounted
    const root = decode(directory)

    // ONE LEVEL DOWN, WHICH IS WHERE THE OVERLAY LIVES. Reading only the root
    // reported `overlays/` as a name and said nothing about its contents, so a
    // file added inside it was seen by nothing at all, on the one partition
    // dm-verity does not cover. `children` is null rather than empty when the
    // directory could not be read, because an unreadable directory and an empty
    // one are the same set of names and must not be the same verdict.
    for (const entry of root) {
      if (!entry.directory) continue
      const bytes = chain(entry.cluster)
      entry.children = bytes === null ? null : decode(bytes).map((child) => child.name)
    }
    return root
  } finally {
    closeSync(fd)
  }
}

/**
 * The bytes of one file on a FAT partition, by path, or null.
 *
 * Case-insensitive, because FAT is, and one level of directory is enough to
 * reach `overlays/`. This exists so a check can read what the firmware reads
 * off the card itself, rather than reading the copy of config.txt left in the
 * root filesystem and assuming the two are the same file.
 */
export function readFatFile(path, offset, filePath) {
  let fd
  try {
    fd = openSync(path, 'r')
  } catch {
    return null
  }
  try {
    const mounted = mountFat(fd, offset)
    if (mounted === null) return null
    const { decode, chain, directory } = mounted

    const segments = filePath.split('/')
    let entries = decode(directory)
    for (const [index, segment] of segments.entries()) {
      const entry = entries.find((one) => one.name.toLowerCase() === segment.toLowerCase())
      if (entry === undefined) return null
      const last = index === segments.length - 1
      if (last === entry.directory) return null

      // An empty file has no first cluster to follow, so the chain walk would
      // report it as unreadable rather than as empty.
      if (last && entry.size === 0) return Buffer.alloc(0)
      const bytes = chain(entry.cluster)
      if (bytes === null) return null
      if (last) return bytes.subarray(0, entry.size)
      entries = decode(bytes)
    }
    return null
  } finally {
    closeSync(fd)
  }
}

/** sha256 of a whole file, streamed so a 4GB image does not become 4GB of heap. */
export async function hashFile(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => {
      resolve(hash.digest('hex'))
    })
  })
}

// --- Verifiers --------------------------------------------------------------

/**
 * The partitions the profile names are present, and large enough.
 *
 * Params: `expect`, a list of `{ name, minMiB }`. Matched by name rather than
 * by position, because a layout that gained a partition would otherwise shift
 * every assertion silently by one.
 */
function partitionPresent(context, params) {
  const gpt = readGpt(context.image)
  if (gpt === null) {
    return cannotRun('partition-present', 'that file has no GPT, so there is nothing to read')
  }

  const expect = params?.expect ?? []
  if (expect.length === 0) {
    return cannotRun(
      'partition-present',
      'the assertion names no partitions to look for, so this checks nothing'
    )
  }

  const problems = []
  for (const want of expect) {
    const found = gpt.partitions.find((partition) => partition.name === want.name)
    if (found === undefined) {
      problems.push(`no partition named ${want.name}`)
      continue
    }
    if (want.minMiB !== undefined) {
      const mib = ((found.lastLba - found.firstLba + 1) * SECTOR) / (1024 * 1024)
      if (mib < want.minMiB) {
        problems.push(
          `${want.name} is ${mib.toFixed(1)}MiB, under the ${String(want.minMiB)} required`
        )
      }
    }
  }

  return verdict(
    'partition-present',
    problems.length === 0,
    problems.length === 0
      ? `${String(gpt.partitions.length)} partitions, and every one the profile names is present`
      : problems.join('; '),
    [
      'reads the primary GPT only. A damaged primary with an intact backup reads as no GPT at all here.',
      'says a partition exists and is large enough. It says nothing about what is in it.',
    ]
  )
}

/**
 * The dm-verity salt is the pinned one, not a fresh random value.
 *
 * THE DEFECT THIS EXISTS FOR. rpi-image-gen generates the salt with `uuidgen`.
 * The root hash is a function of (data, salt), so a random salt means the root
 * hash changes on every build even when the filesystem is byte-identical. The
 * number this device shows at boot is then meaningless as a published value,
 * and it is the number the project asks a user to compare.
 *
 * Params: `partition`, the GPT name of the hash partition, and `salt`, the
 * pinned value in hex.
 */
function veritySaltPinned(context, params) {
  const gpt = readGpt(context.image)
  if (gpt === null) {
    return cannotRun(
      'verity-salt-pinned',
      'that file has no GPT, so the hash partition cannot be found'
    )
  }

  const name = params?.partition
  const expected = params?.salt
  if (name === undefined || expected === undefined) {
    return cannotRun(
      'verity-salt-pinned',
      'the assertion does not name the hash partition and the pinned salt, so there is nothing to compare'
    )
  }

  const partition = gpt.partitions.find((entry) => entry.name === name)
  if (partition === undefined) {
    return verdict('verity-salt-pinned', false, `there is no partition named ${name} in this image`)
  }

  const sb = readVeritySuperblock(context.image, partition.firstLba * SECTOR)
  if (sb === null) {
    return verdict(
      'verity-salt-pinned',
      false,
      `${name} does not begin with a dm-verity superblock, so no hash tree was written there`
    )
  }

  const want = String(expected).toLowerCase()
  if (sb.salt !== want) {
    return verdict(
      'verity-salt-pinned',
      false,
      `the salt is ${sb.salt.slice(0, 16)} and the profile pins ${want.slice(0, 16)}. ` +
        `A salt that changes per build makes the root hash change per build, which makes the ` +
        `number this device displays meaningless as a published value.`
    )
  }

  return verdict(
    'verity-salt-pinned',
    true,
    `the salt matches the pinned value, under ${sb.algorithm} with ` +
      `${String(sb.dataBlockSize)} byte data blocks`,
    [
      'checks the salt, not the root hash. A pinned salt is necessary for a reproducible root hash and is not sufficient.',
      'says nothing about whether the boot partition carrying the root hash is protected. See INV-PROV-9.',
    ]
  )
}

/**
 * Every identifier in the image is the pinned one.
 *
 * Random identifiers are the commonest single cause of an otherwise
 * reproducible image failing to reproduce, and they are invisible in a
 * file-level diff of the root filesystem: two trees compare equal while the
 * images differ in sixteen bytes each.
 *
 * Params: `diskGuid`, and `partitions`, a list of
 * `{ name, partGuid, fsUuid, fatVolumeId }` where each identifier is optional.
 * A partition whose identifiers are deliberately not pinned, such as the state
 * partition created on first boot, is simply not listed.
 */
function identifiersPinned(context, params) {
  const gpt = readGpt(context.image)
  if (gpt === null) {
    return cannotRun('identifiers-pinned', 'that file has no GPT, so there is nothing to read')
  }

  const problems = []
  const checked = []

  const wantDisk = params?.diskGuid
  if (wantDisk !== undefined) {
    checked.push('disk GUID')
    if (gpt.diskGuid !== String(wantDisk).toUpperCase()) {
      problems.push(`the disk GUID is ${gpt.diskGuid} and the profile pins ${String(wantDisk)}`)
    }
  }

  for (const want of params?.partitions ?? []) {
    const partition = gpt.partitions.find((entry) => entry.name === want.name)
    if (partition === undefined) {
      problems.push(`no partition named ${want.name}`)
      continue
    }
    const at = partition.firstLba * SECTOR

    if (want.partGuid !== undefined) {
      checked.push(`${want.name} partition GUID`)
      if (partition.partGuid !== String(want.partGuid).toUpperCase()) {
        problems.push(
          `${want.name} has partition GUID ${partition.partGuid}, pinned as ${String(want.partGuid)}`
        )
      }
    }

    if (want.fsUuid !== undefined) {
      checked.push(`${want.name} filesystem UUID`)
      const found = readExtUuid(context.image, at)
      if (found === null) {
        problems.push(`${want.name} holds no ext superblock, so its UUID cannot be read`)
      } else if (found !== String(want.fsUuid).toLowerCase()) {
        problems.push(`${want.name} has filesystem UUID ${found}, pinned as ${String(want.fsUuid)}`)
      }
    }

    if (want.erofsUuid !== undefined) {
      checked.push(`${want.name} filesystem UUID`)
      const found = readErofsUuid(context.image, at)
      if (found === null) {
        problems.push(`${want.name} holds no erofs superblock, so its UUID cannot be read`)
      } else if (found !== String(want.erofsUuid).toLowerCase()) {
        problems.push(
          `${want.name} has filesystem UUID ${found}, pinned as ${String(want.erofsUuid)}`
        )
      }
    }

    if (want.fatVolumeId !== undefined) {
      checked.push(`${want.name} FAT volume id`)
      const found = readFatVolumeId(context.image, at)
      if (found === null) {
        problems.push(`${want.name} holds no FAT boot sector, so its volume id cannot be read`)
      } else if (found !== String(want.fatVolumeId).toUpperCase()) {
        problems.push(`${want.name} has volume id ${found}, pinned as ${String(want.fatVolumeId)}`)
      }
    }
  }

  if (checked.length === 0) {
    return cannotRun(
      'identifiers-pinned',
      'the assertion pins no identifiers, so this checks nothing'
    )
  }

  return verdict(
    'identifiers-pinned',
    problems.length === 0,
    problems.length === 0
      ? `${String(checked.length)} identifiers match the pinned values: ${checked.join(', ')}`
      : problems.join('; '),
    [
      'checks the identifiers the profile lists. A new random identifier introduced by a backend change passes here until somebody adds it.',
      'reads ext and FAT. A partition holding neither is reported as unreadable rather than as pinned.',
    ]
  )
}

/**
 * Two builds of the same commit produced the same bytes.
 *
 * Everything else is conditional on this. A published hash a third party cannot
 * arrive at independently is a number rather than a check.
 *
 * Needs a second artifact, passed as `--compare`. Without one it reports
 * could-not-run rather than passing, because a reproducibility check that
 * "passed" having compared one file against nothing is precisely the vacuous
 * green this whole design exists to prevent.
 */
async function rebuildIdentical(context) {
  if (context.compare === undefined) {
    return cannotRun(
      'rebuild-identical',
      'needs a second image to compare against, passed as --compare. One image cannot demonstrate that two builds agree.'
    )
  }

  let sizes
  try {
    sizes = [statSync(context.image).size, statSync(context.compare).size]
  } catch (error) {
    return cannotRun('rebuild-identical', `could not read both images: ${error.message}`)
  }

  if (sizes[0] !== sizes[1]) {
    return verdict(
      'rebuild-identical',
      false,
      `the two images are ${String(sizes[0])} and ${String(sizes[1])} bytes, so they are not the same build`
    )
  }

  const [first, second] = await Promise.all([hashFile(context.image), hashFile(context.compare)])
  return verdict(
    'rebuild-identical',
    first === second,
    first === second
      ? `both builds hash to ${first.slice(0, 16)}`
      : `the builds hash to ${first.slice(0, 16)} and ${second.slice(0, 16)}, so something in them is not pinned`,
    [
      'compares two images built HERE. Reproducibility across different machines, paths and times is a strictly stronger property and is not what this measures.',
      'says the bytes agree. It does not say that what is in them is correct.',
    ]
  )
}

/**
 * The boot partition holds exactly the files the profile names, and no others.
 *
 * THE PARTITION THIS IS ABOUT IS THE UNPROTECTED ONE. Every other region of the
 * card is under the dm-verity hash tree. The boot partition cannot be, because
 * it is where the firmware reads the root hash from, and that asymmetry is the
 * whole of why docs/THREAT-MODEL.md says tier 1 MOVES the OS integrity problem
 * rather than closing it. An attacker who rewrites this partition supplies
 * their own initramfs and their own `roothash=`, and the device then displays
 * exactly the number they chose.
 *
 * This does not fix that. Only a signed boot chain does, and that is tier 2 and
 * burns fuses. What an exact file list buys is the smaller thing that is
 * actually available: a file arriving on the unprotected partition without
 * anybody deciding it should is a change that no other check here would see.
 * The reproducibility assertion would notice the bytes moving, but only once
 * somebody has two builds to compare and only if the addition came from the
 * build rather than from the card.
 *
 * EXACT RATHER THAN AT-LEAST, and that is the point of it. A verifier that only
 * confirms the presence of files somebody listed cannot fail on an addition,
 * and an addition is the direction that matters on a partition nothing else
 * protects.
 *
 * Params: `partition`, the GPT name, and `files`, the full expected set.
 */
function bootFilesExact(context, params) {
  const gpt = readGpt(context.image)
  if (gpt === null) {
    return cannotRun('boot-files-exact', 'that file has no GPT, so there is nothing to read')
  }

  const name = params?.partition
  if (typeof name !== 'string') {
    return cannotRun('boot-files-exact', 'the assertion names no partition to read')
  }
  const expected = params?.files
  if (!Array.isArray(expected) || expected.length === 0) {
    // The same trap cmdline-exact fell into: a check declared with nothing to
    // compare against is an assertion that cannot fail.
    return cannotRun(
      'boot-files-exact',
      'the assertion lists no files, so this would pass against any boot partition at all'
    )
  }

  const partition = gpt.partitions.find((entry) => entry.name === name)
  if (partition === undefined) {
    return cannotRun('boot-files-exact', `no partition named ${name} in this image`)
  }

  const entries = readFatRootEntries(context.image, partition.firstLba * SECTOR)
  if (entries === null) {
    return cannotRun(
      'boot-files-exact',
      `the ${name} partition does not hold a FAT filesystem this can read`
    )
  }

  // Case-insensitively, because FAT is. Two files differing only in case cannot
  // both exist here, so folding loses nothing and avoids reporting a mismatch
  // between `CMDLINE.TXT` and the name a person wrote in the profile.
  const fold = (value) => value.toLowerCase()

  // Flattened to paths. A directory contributes its own name AND each name
  // inside it, so an empty directory is still something the profile has to
  // account for rather than something that quietly stops being checked.
  const found = new Set()
  const unreadable = []
  for (const entry of entries) {
    found.add(fold(entry.name))
    if (!entry.directory) continue
    if (entry.children === null) {
      unreadable.push(entry.name)
      continue
    }
    for (const child of entry.children) found.add(fold(`${entry.name}/${child}`))
  }

  // An unreadable directory and an empty one produce the same set of names, so
  // this cannot be allowed to report the set as exact. Same rule as everywhere
  // else here: could-not-run is not a pass.
  if (unreadable.length > 0) {
    return cannotRun(
      'boot-files-exact',
      `could not read ${unreadable.join(', ')} on ${name}, so the set of files it holds is not known`
    )
  }

  const want = new Set(expected.map(fold))

  const missing = [...want].filter((file) => !found.has(file))
  const unexpected = [...found].filter((file) => !want.has(file))

  const problems = []
  if (missing.length > 0) problems.push(`missing: ${missing.join(', ')}`)
  if (unexpected.length > 0) {
    problems.push(`present and not in the profile: ${unexpected.join(', ')}`)
  }

  return verdict(
    'boot-files-exact',
    problems.length === 0,
    problems.length === 0
      ? `${String(found.size)} path(s) on the ${name} partition, exactly the set the profile names`
      : problems.join('; '),
    [
      'descends one level. A directory nested inside a directory is reported by name and its contents are not read, which nothing on a Raspberry Pi boot partition uses.',
      'names and nothing else. It does not hash the files, so a substituted initramfs of the same name passes here. Only a signed boot chain answers that, and that is tier 2.',
    ]
  )
}

/**
 * Every overlay config.txt tells the firmware to load is on the card.
 *
 * THE FAILURE THIS CATCHES IS A BLANK SCREEN ON A TOUCHSCREEN PRODUCT. The
 * firmware reads `dtoverlay=` out of config.txt, looks for `overlays/<name>.dtbo`
 * and, if it is not there, carries on booting without a word. There is no error
 * anywhere: the device comes up, the daemon runs, and the panel stays dark.
 *
 * INV-PROV-25 pins the text of config.txt and INV-PROV-22 pins the file list,
 * which between them catch a change to either one alone. They do not catch a
 * consistent edit that removes the overlay and its line from the profile
 * together, which is what tidying up an overlay somebody thought was unused
 * looks like. This asserts the relation itself, from the card, so neither pin
 * has to be maintained for it to hold.
 *
 * It reads config.txt off the boot partition rather than the copy in the root
 * filesystem. Those are written from the same source by build-system.sh and
 * this is the one the firmware actually reads.
 */
function bootOverlaysPresent(context, params) {
  const gpt = readGpt(context.image)
  if (gpt === null) {
    return cannotRun('boot-overlays-present', 'that file has no GPT, so there is nothing to read')
  }

  const name = params?.partition
  if (typeof name !== 'string') {
    return cannotRun('boot-overlays-present', 'the assertion names no partition to read')
  }
  const partition = gpt.partitions.find((entry) => entry.name === name)
  if (partition === undefined) {
    return cannotRun('boot-overlays-present', `no partition named ${name} in this image`)
  }

  const offset = partition.firstLba * SECTOR
  const config = readFatFile(context.image, offset, 'config.txt')
  if (config === null) {
    return cannotRun(
      'boot-overlays-present',
      `no readable config.txt on the ${name} partition, so what the firmware is told to load is not known`
    )
  }

  const wanted = config
    .toString('utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => !line.startsWith('#'))
    .map((line) => /^dtoverlay=([^,\s]+)/u.exec(line)?.[1])
    .filter((overlay) => overlay !== undefined)

  if (wanted.length === 0) {
    // Not a pass. A config.txt naming no overlay is either a device with no
    // overlay, which this product is not, or a config.txt this failed to parse.
    return cannotRun(
      'boot-overlays-present',
      `config.txt on ${name} names no dtoverlay at all, so this has nothing to check and will not report that as agreement`
    )
  }

  const problems = []
  for (const overlay of wanted) {
    const blob = readFatFile(context.image, offset, `overlays/${overlay}.dtbo`)
    if (blob === null) {
      problems.push(`config.txt loads ${overlay} and overlays/${overlay}.dtbo is not on the card`)
      continue
    }
    // 0xd00dfeed is the flattened device tree magic. A .dtbo that is not one is
    // ignored by the firmware exactly as a missing file is.
    if (blob.length < 4 || blob.readUInt32BE(0) !== 0xd00dfeed) {
      problems.push(`overlays/${overlay}.dtbo is not a flattened device tree blob`)
    }
  }

  return verdict(
    'boot-overlays-present',
    problems.length === 0,
    problems.length === 0
      ? `${String(wanted.length)} overlay(s) named by config.txt, each present on ${name} and a device tree blob: ${wanted.join(', ')}`
      : problems.join('; '),
    [
      "says the file is there and is a device tree blob. It does not say the overlay applies cleanly to this board's base tree, which fdtoverlay at build time answers, and it does not say the panel lights up, which only the hardware answers.",
      'reads the partition an attacker rewrites. It says this card is internally consistent, not that it is the card anybody intended.',
    ]
  )
}

/** Keyed by the `check` name a profile assertion uses. */
export const IMAGE_VERIFIERS = {
  'boot-files-exact': bootFilesExact,
  'boot-overlays-present': bootOverlaysPresent,
  'partition-present': partitionPresent,
  'verity-salt-pinned': veritySaltPinned,
  'identifiers-pinned': identifiersPinned,
  'rebuild-identical': rebuildIdentical,
}
