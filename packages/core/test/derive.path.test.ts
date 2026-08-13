/**
 * Tests for core.derive.path.
 */

import { describe, expect, it } from 'vitest'
import {
  HARDENED_OFFSET,
  PathError,
  formatPath,
  isFullyHardened,
  normalizePath,
  parsePath,
} from '../src/derive/path.js'

describe('core.derive.path', () => {
  // INV-PATH-1: both hardened notations normalise to the same canonical form.
  // Descriptors and Bitcoin Core emit `h`; the crypto layer accepts only `'`.
  it('normalizes-both-hardened-notations', () => {
    expect(normalizePath("m/84'/0'/0'")).toBe("m/84'/0'/0'")
    expect(normalizePath('m/84h/0h/0h')).toBe("m/84'/0'/0'")
    expect(normalizePath('m/84H/0H/0H')).toBe("m/84'/0'/0'")
    expect(normalizePath("m/84h/0'/0H/0/1")).toBe("m/84'/0'/0'/0/1")
    expect(normalizePath('m')).toBe('m')
  })

  it('parses-indices', () => {
    const parsed = parsePath("m/84'/0'/0'/0/5")
    expect(parsed.depth).toBe(5)
    expect(parsed.indices).toEqual([
      84 + HARDENED_OFFSET,
      0 + HARDENED_OFFSET,
      0 + HARDENED_OFFSET,
      0,
      5,
    ])
  })

  // INV-PATH-2: strict. A path says where money lives, and a parser that
  // quietly accepts something ambiguous derives from a path nobody meant.
  it('rejects-ambiguous-input', () => {
    expect(() => parsePath('')).toThrow(PathError)
    expect(() => parsePath("84'/0'/0'")).toThrow(/must start with "m"/)
    expect(() => parsePath('m//0')).toThrow(/Empty path component/)
    expect(() => parsePath('m/0x10')).toThrow(/not a number/)
    expect(() => parsePath('m/1e9')).toThrow(/not a number/)
    expect(() => parsePath('m/-1')).toThrow(/not a number/)
    expect(() => parsePath("m/0''")).toThrow(/not a number/)
    expect(() => parsePath('m/1.5')).toThrow(/not a number/)
    // Hardening is expressed with a suffix, not by adding the offset yourself.
    expect(() => parsePath(`m/${String(HARDENED_OFFSET)}`)).toThrow(/out of range/)
  })

  it('round-trips-through-format', () => {
    for (const path of ["m/84'/0'/0'/0/0", 'm/0/1/2', "m/44'/1'/0'", 'm']) {
      expect(formatPath(parsePath(path).indices)).toBe(normalizePath(path))
    }
  })

  it('detects-fully-hardened-paths', () => {
    expect(isFullyHardened("m/84'/0'/0'")).toBe(true)
    expect(isFullyHardened('m/84h/0h/0h')).toBe(true)
    expect(isFullyHardened("m/84'/0'/0'/0")).toBe(false)
    expect(isFullyHardened('m')).toBe(false)
  })
})
