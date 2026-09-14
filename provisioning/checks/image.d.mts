/**
 * Types for the verifiers that read a built image.
 *
 * The module is plain ESM for the reason identifiers.d.mts gives: it runs on a
 * build machine with node and nothing else, and the thing checking a build must
 * not depend on the build. These declarations exist so the tests that exercise
 * it are typed like everything else.
 */

export interface Verdict {
  readonly check: string
  readonly ok: boolean
  readonly detail: string
  readonly limits: readonly string[]
  /** Could-not-run, which is the third state and is never a pass. */
  readonly unavailable?: boolean
}

export interface GptPartition {
  readonly index: number
  readonly typeGuid: string
  readonly partGuid: string
  readonly firstLba: number
  readonly lastLba: number
  readonly name: string
}

export interface Gpt {
  readonly diskGuid: string
  readonly partitions: readonly GptPartition[]
}

export interface VeritySuperblock {
  readonly version: number
  readonly hashType: number
  readonly uuid: string
  readonly algorithm: string
  readonly dataBlockSize: number
  readonly hashBlockSize: number
  readonly dataBlocks: number
  readonly salt: string
}

export declare function readGpt(path: string): Gpt | null
export declare function readVeritySuperblock(path: string, offset: number): VeritySuperblock | null
export declare function readExtUuid(path: string, offset: number): string | null
export declare function readFatVolumeId(path: string, offset: number): string | null
/**
 * Sixteen flat bytes, unlike a GPT GUID whose first three fields are
 * little-endian. Reading one the way the other is read produces something that
 * looks like a UUID and matches nothing.
 */
export declare function readErofsUuid(path: string, offset: number): string | null
export declare function hashFile(path: string): Promise<string>

/** One name in a FAT directory. */
export interface FatEntry {
  readonly name: string
  readonly size: number
  readonly directory: boolean
  /** First cluster of the chain, 0 for an empty file. */
  readonly cluster: number
  /**
   * For a directory, the names inside it, or null when the chain could not be
   * followed. Null and empty are different answers and must stay that way: an
   * unreadable directory and an empty one hold the same set of names.
   */
  readonly children?: readonly string[] | null
}

export declare function readFatRootEntries(path: string, offset: number): FatEntry[] | null
export declare function readFatFile(path: string, offset: number, file: string): Buffer | null

/** What a verifier is pointed at. `compare` is a second build, for reproducibility. */
export interface ImageContext {
  readonly image: string
  readonly compare?: string | undefined
}

export declare const IMAGE_VERIFIERS: {
  'partition-present': (
    context: ImageContext,
    params: { expect?: readonly { name: string; minMiB?: number }[] }
  ) => Verdict
  'verity-salt-pinned': (
    context: ImageContext,
    params: { partition?: string; salt?: string }
  ) => Verdict
  'identifiers-pinned': (
    context: ImageContext,
    params: {
      diskGuid?: string
      partitions?: readonly {
        name: string
        partGuid?: string
        fsUuid?: string
        fatVolumeId?: string
      }[]
    }
  ) => Verdict
  'rebuild-identical': (context: ImageContext) => Promise<Verdict>
  'boot-files-exact': (
    context: ImageContext,
    params: { partition?: string | undefined; files?: readonly string[] | undefined }
  ) => Verdict
  'boot-overlays-present': (
    context: ImageContext,
    params: { partition?: string | undefined }
  ) => Verdict
}

/*
 * The verifiers by name as well as through the map.
 *
 * They were reachable only through IMAGE_VERIFIERS, and this file did not
 * declare half of its keys, so a typed test could not import one at all. That
 * is not a small thing: it is why these six had no tests while the rootfs nine,
 * which are exported individually, had a suite from the start.
 */
export declare function partitionPresent(
  context: ImageContext,
  params: { expect?: readonly { name: string; minMiB?: number }[] }
): Verdict
export declare function veritySaltPinned(
  context: ImageContext,
  params: { partition?: string; salt?: string }
): Verdict
export declare function identifiersPinned(
  context: ImageContext,
  params: {
    diskGuid?: string
    partitions?: readonly {
      name: string
      partGuid?: string
      fsUuid?: string
      fatVolumeId?: string
    }[]
  }
): Verdict
export declare function rebuildIdentical(context: ImageContext): Promise<Verdict>
export declare function bootFilesExact(
  context: ImageContext,
  params: { partition?: string | undefined; files?: readonly string[] | undefined }
): Verdict
export declare function bootOverlaysPresent(
  context: ImageContext,
  params: { partition?: string | undefined }
): Verdict
