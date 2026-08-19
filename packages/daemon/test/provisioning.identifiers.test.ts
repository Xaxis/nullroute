/**
 * Tests for the derived image identifiers.
 *
 * WHY THIS IS LOAD-BEARING. Two things call this module: the build backend, to
 * SET the salt and the GUIDs, and the verifier, to CHECK them. If it were not
 * deterministic the two would disagree and every build would fail verification;
 * if it were not domain-separated, two different identifiers would collide and
 * one of them would be wrong in a way nothing catches.
 *
 * THE HAND CHECK IS THE POINT. Every value is SHA-256 of a short ASCII string
 * that is written out in the module, so a third party recomputes it with
 * sha256sum rather than with our tool. That is the same argument MANIFEST.lock
 * rests on, and the test below pins the exact digest so the derivation cannot
 * be changed without somebody noticing.
 */

import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import {
  diskGuid,
  fatVolumeId,
  filesystemUuid,
  hashSeed,
  partitionGuid,
  pinnedIdentifiers,
  veritySalt,
} from '../../../provisioning/checks/identifiers.mjs'

const RELEASE = '0.4.0'

describe('provisioning identifiers', () => {
  /**
   * INV-PROV-5. The salt is exactly the digest of a string a person can type,
   * which is what lets somebody check our work with coreutils.
   *
   *     printf 'nullroute/verity-salt/0.4.0' | sha256sum
   */
  it('is-a-value-a-third-party-can-recompute-with-sha256sum', () => {
    const byHand = createHash('sha256').update('nullroute/verity-salt/0.4.0', 'utf8').digest('hex')
    expect(veritySalt(RELEASE)).toBe(byHand)
    expect(veritySalt(RELEASE)).toHaveLength(64)
  })

  /**
   * INV-PROV-5. The whole requirement. The backend sets these and the verifier
   * checks them, so a derivation that varied would fail every build.
   */
  it('gives-the-same-answer-every-time-for-the-same-release', () => {
    expect(veritySalt(RELEASE)).toBe(veritySalt(RELEASE))
    expect(diskGuid(RELEASE)).toBe(diskGuid(RELEASE))
    expect(filesystemUuid(RELEASE, 'system')).toBe(filesystemUuid(RELEASE, 'system'))
  })

  /**
   * INV-PROV-5. "A pinned deterministic function of the release version" means
   * it has to be a function OF the version, or every release would ship the
   * same identifiers and there would be nothing separating two images.
   */
  it('gives-a-different-answer-for-a-different-release', () => {
    expect(veritySalt('0.4.0')).not.toBe(veritySalt('0.4.1'))
    expect(diskGuid('0.4.0')).not.toBe(diskGuid('0.4.1'))
  })

  /**
   * INV-PROV-5. Domain separation. Without it the disk GUID and a partition
   * GUID would be the same sixteen bytes, and the collision would be invisible:
   * both would verify, and both would be wrong in the same way.
   */
  it('separates-every-kind-of-identifier-from-every-other', () => {
    const values = [
      diskGuid(RELEASE),
      partitionGuid(RELEASE, 'boot'),
      partitionGuid(RELEASE, 'system'),
      filesystemUuid(RELEASE, 'system'),
      hashSeed(RELEASE, 'system'),
    ]
    expect(new Set(values).size).toBe(values.length)
  })

  /**
   * INV-PROV-5. A UUID with no version and variant bits is sixteen bytes
   * wearing hyphens. Some tools parse it, check the version, and reject it,
   * and that failure would appear at flash time rather than here.
   */
  it('writes-well-formed-uuids-rather-than-bytes-with-hyphens', () => {
    for (const value of [filesystemUuid(RELEASE, 'system'), hashSeed(RELEASE, 'system')]) {
      expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    }
  })

  /**
   * INV-PROV-5. FAT has no room for a UUID: it has a 32 bit serial. Truncating
   * a UUID would look like the same thing and would collide differently.
   */
  it('gives-fat-a-four-byte-serial-rather-than-a-truncated-uuid', () => {
    const id = fatVolumeId(RELEASE, 'boot')
    expect(id).toMatch(/^[0-9A-F]{8}$/)
    expect(filesystemUuid(RELEASE, 'boot').replaceAll('-', '').slice(0, 8).toUpperCase()).not.toBe(id)
  })

  /**
   * INV-PROV-5. Case matters where the tools disagree: GPT tools print a GUID
   * upper case and ext tools print a UUID lower case, and a verifier comparing
   * strings would fail on the difference alone.
   */
  it('prints-each-identifier-in-the-case-its-own-tools-use', () => {
    expect(diskGuid(RELEASE)).toBe(diskGuid(RELEASE).toUpperCase())
    expect(partitionGuid(RELEASE, 'boot')).toBe(partitionGuid(RELEASE, 'boot').toUpperCase())
    expect(filesystemUuid(RELEASE, 'system')).toBe(filesystemUuid(RELEASE, 'system').toLowerCase())
  })

  /**
   * INV-PROV-5. The assembled shape the verifier takes, and the reason the
   * profile lists partitions rather than values: a partition holding neither
   * ext nor FAT gets no filesystem identifier pinned, rather than one that
   * cannot be read.
   */
  it('pins-only-the-identifiers-a-partition-actually-has', () => {
    const pinned = pinnedIdentifiers(RELEASE, [
      { name: 'boot', filesystem: 'fat' },
      { name: 'system', filesystem: 'ext' },
      { name: 'system-hash', filesystem: 'verity' },
    ])

    expect(pinned.diskGuid).toBe(diskGuid(RELEASE))
    expect(pinned.partitions[0]).toEqual({
      name: 'boot',
      partGuid: partitionGuid(RELEASE, 'boot'),
      fatVolumeId: fatVolumeId(RELEASE, 'boot'),
    })
    expect(pinned.partitions[1]?.fsUuid).toBe(filesystemUuid(RELEASE, 'system'))
    // A verity partition has no filesystem, so nothing beyond its GPT GUID.
    expect(Object.keys(pinned.partitions[2] ?? {})).toEqual(['name', 'partGuid'])
  })
})
