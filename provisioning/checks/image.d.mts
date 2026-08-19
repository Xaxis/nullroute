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
export declare function hashFile(path: string): Promise<string>

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
}
