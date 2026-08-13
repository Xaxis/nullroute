/**
 * BIP-32 derivation path parsing.
 *
 * Spec: core.derive.path
 *
 * Two notations exist for a hardened index and they are used in different parts
 * of the ecosystem: `84'` (apostrophe, from BIP-32 itself) and `84h` (letter h,
 * which BIP-380 descriptors and Bitcoin Core both emit). They mean the same
 * thing and a user will paste either.
 *
 * The underlying library accepts only the apostrophe form and throws on the
 * other, so normalising here is not cosmetic: without it, importing a
 * descriptor from Bitcoin Core fails with "Invalid child index: 84h", which
 * reads as a corrupt descriptor rather than a notation difference.
 *
 * Parsing is strict in every other respect. A path is an instruction about
 * where money lives, and a permissive parser that quietly accepts something
 * ambiguous is how a user ends up deriving from a path they did not mean.
 */

/** Indices at or above this are hardened. */
export const HARDENED_OFFSET = 0x80000000

export class PathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PathError'
  }
}

export interface ParsedPath {
  /** The canonical apostrophe form, e.g. m/84'/0'/0'. */
  readonly canonical: string
  /** Raw child indices, hardened ones already offset. */
  readonly indices: readonly number[]
  readonly depth: number
}

/**
 * Parse a BIP-32 path, accepting both hardened notations and emitting the
 * canonical apostrophe form.
 *
 * Accepts `m` (the master key, depth 0) and rejects a relative path with no
 * `m` prefix: relative paths are meaningful only against a stated parent, and
 * accepting one here would silently treat it as absolute.
 */
export function parsePath(path: string): ParsedPath {
  const trimmed = path.trim()
  if (trimmed.length === 0) throw new PathError('Empty derivation path.')

  const segments = trimmed.split('/')
  const head = segments[0]
  if (head !== 'm' && head !== 'M') {
    throw new PathError(
      `Derivation path must start with "m", got ${JSON.stringify(head ?? '')}. ` +
        `A path without it is relative, and relative paths are ambiguous without a stated parent.`
    )
  }

  const indices: number[] = []
  const canonicalSegments: string[] = ['m']

  for (let i = 1; i < segments.length; i += 1) {
    const segment = segments[i]
    if (segment === undefined || segment.length === 0) {
      throw new PathError(`Empty path component at position ${String(i)} in "${trimmed}".`)
    }

    // Both notations, and only at the end of the component.
    const hardened = /['hH]$/.test(segment)
    const digits = hardened ? segment.slice(0, -1) : segment

    if (!/^[0-9]+$/.test(digits)) {
      throw new PathError(
        `Path component ${JSON.stringify(segment)} is not a number ` +
          `(optionally followed by ' or h for hardened).`
      )
    }

    // Parsed as a number only after the digit check, so "1e9" and "0x10" cannot
    // slip through Number()'s permissiveness.
    const index = Number(digits)
    if (!Number.isSafeInteger(index) || index >= HARDENED_OFFSET) {
      throw new PathError(
        `Path component ${JSON.stringify(segment)} is out of range. ` +
          `Indices must be below ${String(HARDENED_OFFSET)}; hardening is expressed with ' or h.`
      )
    }

    indices.push(hardened ? index + HARDENED_OFFSET : index)
    canonicalSegments.push(hardened ? `${String(index)}'` : String(index))
  }

  return {
    canonical: canonicalSegments.join('/'),
    indices,
    depth: indices.length,
  }
}

/**
 * Normalise a path to the apostrophe form the crypto layer accepts.
 *
 * This is the function to call before handing a path to any library. See the
 * note at the top: descriptors from Bitcoin Core use `h` and would otherwise
 * throw.
 */
export function normalizePath(path: string): string {
  return parsePath(path).canonical
}

/** Render indices back to a canonical path string. */
export function formatPath(indices: readonly number[]): string {
  const parts = indices.map((index) =>
    index >= HARDENED_OFFSET ? `${String(index - HARDENED_OFFSET)}'` : String(index)
  )
  return ['m', ...parts].join('/')
}

/** True if every component of the path is hardened. */
export function isFullyHardened(path: string): boolean {
  const { indices } = parsePath(path)
  return indices.length > 0 && indices.every((i) => i >= HARDENED_OFFSET)
}
