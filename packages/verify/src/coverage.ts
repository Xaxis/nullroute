/**
 * Check 1: every exported symbol in packages/core is covered by some spec.
 *
 * An uncovered export is a hard failure, not a warning. The claim this project
 * makes is that every module ships with a machine-checkable specification, and
 * an export nobody specified is a hole in that claim which nothing else would
 * surface.
 *
 * Exports are enumerated with the TypeScript compiler API rather than by
 * importing the built module, because a runtime import sees only values.
 * Type-only exports (interfaces, type aliases) would be invisible, and those
 * are exactly the declarations that describe the shape of key material.
 */

import { join, relative } from 'node:path'
import ts from 'typescript'

export interface ExportedSymbol {
  /** Repo-relative POSIX path of the declaring file. */
  readonly file: string
  readonly name: string
  /** True for interfaces and type aliases, which carry no runtime value. */
  readonly typeOnly: boolean
}

export interface CoverageResult {
  readonly exports: readonly ExportedSymbol[]
  readonly covered: readonly string[]
  readonly uncovered: readonly string[]
  /** `covers` entries that name a symbol which does not exist. */
  readonly dangling: readonly string[]
  readonly ok: boolean
}

/** `packages/core/src/entropy/dice.ts::diceToEntropy` */
function selector(file: string, name: string): string {
  return `${file}::${name}`
}

/**
 * Enumerate the public API of a package: every symbol reachable from its entry
 * point, attributed to the file that declares it.
 *
 * Reachability from the entry point is the right question. A symbol exported
 * from an internal module but never re-exported is not public API, so requiring
 * a spec for it would push the project toward specifying its own internals.
 */
export function enumerateExports(root: string, entryPoint: string): ExportedSymbol[] {
  const entry = join(root, entryPoint)

  const program = ts.createProgram([entry], {
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    // The UI package is .tsx. Without this the compiler cannot parse it, its
    // declarations are invisible, and every symbol a spec covers there looks
    // like it does not exist.
    jsx: ts.JsxEmit.ReactJSX,
  })

  const checker = program.getTypeChecker()
  const source = program.getSourceFile(entry)
  if (source === undefined) {
    throw new Error(`verify: could not load entry point ${entryPoint}`)
  }

  const moduleSymbol = checker.getSymbolAtLocation(source)
  if (moduleSymbol === undefined) {
    throw new Error(`verify: ${entryPoint} is not a module`)
  }

  const out: ExportedSymbol[] = []
  const seen = new Set<string>()

  for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
    // Follow re-exports back to the symbol that actually declares the thing.
    const resolved =
      (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol

    const declaration = resolved.declarations?.[0] ?? symbol.declarations?.[0]
    if (declaration === undefined) continue

    const declFile = declaration.getSourceFile().fileName
    // Ignore anything declared outside the repository, such as a type
    // re-exported from a dependency.
    if (!declFile.startsWith(root)) continue

    const file = relative(root, declFile).replaceAll('\\', '/')
    const name = symbol.getName()
    const key = selector(file, name)
    if (seen.has(key)) continue
    seen.add(key)

    const typeOnly =
      (resolved.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias)) !== 0 &&
      (resolved.flags & ts.SymbolFlags.Value) === 0

    out.push({ file, name, typeOnly })
  }

  return out.sort((a, b) => selector(a.file, a.name).localeCompare(selector(b.file, b.name)))
}

/**
 * Compare the enumerated exports against every spec's `covers` list.
 *
 * Type-only exports are not required to be covered. An interface has no
 * behaviour to specify, and demanding a spec entry for every type alias would
 * turn the coverage check into noise that people learn to suppress. Values,
 * classes and functions all require coverage.
 */
export function checkCoverage(
  exports: readonly ExportedSymbol[],
  coversLists: readonly (readonly string[])[]
): CoverageResult {
  const declared = new Set(coversLists.flat())
  const actual = new Set(exports.map((e) => selector(e.file, e.name)))

  const covered: string[] = []
  const uncovered: string[] = []

  for (const exported of exports) {
    const key = selector(exported.file, exported.name)
    if (declared.has(key)) covered.push(key)
    else if (!exported.typeOnly) uncovered.push(key)
  }

  // A `covers` entry naming a symbol that no longer exists means the spec is
  // describing code that was deleted or renamed. Silently ignoring it lets a
  // spec drift into fiction while still reporting full coverage.
  const dangling = [...declared]
    .filter((entry) => !actual.has(entry))
    // Class members are written Class#method and are not separate exports.
    .filter((entry) => !entry.includes('#'))
    .sort()

  return {
    exports,
    covered: covered.sort(),
    uncovered: uncovered.sort(),
    dangling,
    ok: uncovered.length === 0 && dangling.length === 0,
  }
}
