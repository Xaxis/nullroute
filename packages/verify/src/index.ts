/**
 * @nullroute/verify: the spec verification system.
 *
 * Exported so the daemon can read and re-check a verification report at boot
 * (INV-BUILD-1) without shelling out to the CLI.
 */

export { loadAllSpecs, loadSpec, findSpecFiles, createSpecValidator, SpecError } from './specs.js'
export type { ModuleSpec, LoadedSpec, SpecInvariant, SpecVector } from './specs.js'

export { enumerateExports, checkCoverage } from './coverage.js'
export type { ExportedSymbol, CoverageResult } from './coverage.js'

export { loadReport, resolveBinding, checkBindings, TestReportError } from './tests.js'
export type { TestBinding, BindingResult } from './tests.js'

export { parseManifest, rootHashOf, checkIntegrity, ManifestError } from './manifest.js'
export type { ManifestEntry, IntegrityResult } from './manifest.js'

export { checkVectors, checkDifferential } from './vectors.js'
export type { VectorResult, DifferentialResult } from './vectors.js'
