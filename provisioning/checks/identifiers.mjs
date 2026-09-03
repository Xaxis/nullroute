/**
 * Every identifier in the image, derived from the release version.
 *
 * ONE DEFINITION, TWO CONSUMERS. The build backend calls this to SET the salt,
 * the GUIDs and the filesystem UUIDs. The verifier calls it to CHECK them. A
 * profile that instead listed the literal values would need editing every
 * release, and the release where somebody forgot is the release where the
 * assertion silently stops meaning anything.
 *
 * WHY IT IS A HASH AND NOT A COUNTER. INV-PROV-5 asks for "a pinned
 * deterministic function of the release version". Deterministic is the whole
 * requirement: two builds of the same commit have to produce the same bytes,
 * and randomly generated identifiers are the commonest single cause of an
 * otherwise reproducible image failing to reproduce. They are also invisible in
 * a file-level diff of the root filesystem, so two trees compare equal while
 * the images differ in sixteen bytes each.
 *
 * WHAT A THIRD PARTY DOES WITH THIS. Recomputes it. Every value below is
 * SHA-256 of a short ASCII string that is written out in full here, so somebody
 * checking our work needs `sha256sum` and this file, not our tool. That is the
 * same argument the manifest format rests on.
 *
 *     printf 'nullroute/verity-salt/0.4.0' | sha256sum
 *
 * NONE OF THIS IS A SECRET AND NONE OF IT IS SECURITY. A verity salt is public,
 * published, and part of what a user compares. Deriving it from a version
 * rather than from entropy costs nothing, because the salt's job in dm-verity
 * is domain separation between images rather than unpredictability. Anyone who
 * thinks a predictable salt is a weakness here should read
 * `docs/PROVISIONING.md`: the root hash is published, the image is public, and
 * there is nothing for a salt to hide.
 */

import { createHash } from 'node:crypto'

/** The domain-separated digest every identifier below is a slice of. */
function digest(domain, version) {
  return createHash('sha256').update(`nullroute/${domain}/${version}`, 'utf8').digest()
}

/**
 * A UUID in printed form, from the first sixteen bytes of a digest.
 *
 * Version 8 and the RFC variant bits are set, which makes it a well formed
 * custom UUID rather than sixteen bytes wearing hyphens. Tools that parse a
 * UUID and check its version accept it; without the bits, some reject it and
 * the failure appears at flash time.
 */
function uuidFrom(bytes) {
  const out = Buffer.from(bytes.subarray(0, 16))
  out[6] = (out[6] & 0x0f) | 0x80 // version 8, custom
  out[8] = (out[8] & 0x3f) | 0x80 // variant 10xx, RFC 4122
  const hex = out.toString('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-')
}

/**
 * The verity salt, 32 bytes of hex.
 *
 * THE DEFECT THIS REPLACES. rpi-image-gen generates it with `uuidgen`. The root
 * hash is a function of (data, salt), so a fresh salt means a fresh root hash
 * on every build even when the filesystem is byte-identical, and the number
 * this device displays at boot becomes meaningless as a published value.
 */
export function veritySalt(version) {
  return digest('verity-salt', version).toString('hex')
}

/** The GPT disk GUID. Upper case, as GPT tools print it. */
export function diskGuid(version) {
  return uuidFrom(digest('disk-guid', version)).toUpperCase()
}

/** A GPT partition GUID, per partition name. */
export function partitionGuid(version, name) {
  return uuidFrom(digest(`partition-guid/${name}`, version)).toUpperCase()
}

/** An ext filesystem UUID, per partition name. Lower case, as ext tools print it. */
export function filesystemUuid(version, name) {
  return uuidFrom(digest(`filesystem-uuid/${name}`, version))
}

/**
 * A FAT volume id, which is four bytes rather than sixteen.
 *
 * FAT has no room for a UUID. It has a 32 bit serial, which is why this is a
 * separate function rather than a truncation of the one above: truncating a
 * UUID would look like the same thing and would collide differently.
 */
export function fatVolumeId(version, name) {
  return digest(`fat-volume-id/${name}`, version).subarray(0, 4).toString('hex').toUpperCase()
}

/**
 * The ext4 directory hash seed.
 *
 * THE SECOND NAMED DEFECT. `mke2fs` is never given `-E hash_seed=`, so it picks
 * a random one per build. It changes nothing a user can see and it changes the
 * bytes of the filesystem, which is exactly the kind of thing that makes a
 * reproducible build fail for a reason nobody can find.
 */
export function hashSeed(version, name) {
  return uuidFrom(digest(`ext4-hash-seed/${name}`, version))
}

/**
 * Everything at once, in the shape the image verifiers take as params.
 *
 * Assembled here rather than in the profile so the profile states WHICH
 * partitions are pinned and this states WHAT the pinned value is. A profile
 * holding literal hex would be a profile that goes stale silently.
 */
export function pinnedIdentifiers(version, partitions) {
  return {
    diskGuid: diskGuid(version),
    partitions: partitions.map((partition) => ({
      name: partition.name,
      partGuid: partitionGuid(version, partition.name),
      ...(partition.filesystem === 'ext'
        ? { fsUuid: filesystemUuid(version, partition.name) }
        : {}),
      // Same derivation, different superblock to read it out of. The system
      // partition is erofs rather than ext4 because ext4 does not reproduce:
      // see provisioning/checks/image.mjs, readErofsUuid.
      ...(partition.filesystem === 'erofs'
        ? { erofsUuid: filesystemUuid(version, partition.name) }
        : {}),
      ...(partition.filesystem === 'fat'
        ? { fatVolumeId: fatVolumeId(version, partition.name) }
        : {}),
    })),
  }
}
