/**
 * Types for the derived image identifiers.
 *
 * The module is plain ESM because it is pointed at a build artifact by a build
 * machine that has node and nothing else, and adding a compile step to the
 * verification path would mean the thing checking the build depends on the
 * build. These declarations exist so the tests that exercise it are typed like
 * everything else rather than being the one untyped corner.
 */

export declare function veritySalt(version: string): string
export declare function diskGuid(version: string): string
export declare function partitionGuid(version: string, name: string): string
export declare function filesystemUuid(version: string, name: string): string
export declare function fatVolumeId(version: string, name: string): string
export declare function hashSeed(version: string, name: string): string

export interface PinnedPartitionInput {
  readonly name: string
  readonly filesystem?: 'ext' | 'fat' | 'verity' | undefined
}

export interface PinnedPartition {
  readonly name: string
  readonly partGuid: string
  readonly fsUuid?: string
  readonly fatVolumeId?: string
}

export interface PinnedIdentifiers {
  readonly diskGuid: string
  readonly partitions: readonly PinnedPartition[]
}

export declare function pinnedIdentifiers(
  version: string,
  partitions: readonly PinnedPartitionInput[]
): PinnedIdentifiers
