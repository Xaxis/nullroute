/**
 * Loading and validating *.spec.yaml files.
 *
 * Spec files are in-repo and therefore trusted, but they are parsed with the
 * hardened profile anyway. The habit is the point: the same loader will
 * eventually read a spec bundle that arrived across the air gap, and a parser
 * that is only safe because of where its input came from is not safe.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { load as loadYaml, JSON_SCHEMA } from 'js-yaml'
import { Ajv2020 } from 'ajv/dist/2020.js'
import type { ValidateFunction } from 'ajv'

export interface SpecInvariant {
  readonly id: string
  readonly statement: string
  readonly tests: readonly string[]
}

export interface SpecVector {
  readonly name: string
  readonly file: string
  readonly sha256: string
  readonly source?: string
}

export interface ModuleSpec {
  readonly id: string
  readonly version: number
  readonly title: string
  readonly assurance_tier: 'critical' | 'standard' | 'experimental'
  readonly status: 'draft' | 'implemented' | 'verified'
  readonly purpose: string
  readonly covers: readonly string[]
  readonly invariants: readonly SpecInvariant[]
  readonly threats?: readonly string[]
  readonly vectors?: readonly SpecVector[]
  readonly differential?: { readonly oracle: string; readonly min_cases: number }
  readonly algorithm?: string
  readonly security_notes?: string
  readonly references?: readonly string[]
}

export interface LoadedSpec {
  /** Repo-relative path to the spec file. */
  readonly path: string
  readonly spec: ModuleSpec
}

/**
 * Hardened YAML options.
 *
 * js-yaml is used rather than the `yaml` package specifically because it hard
 * errors on an unknown or custom tag, where `yaml` silently resolves one to its
 * underlying value with only a warning. For a file format where a typo must be
 * a hard failure, silent acceptance is the worse behaviour.
 *
 * The defaults are NOT safe: maxAliases defaults to unlimited, which is a
 * billion-laughs expansion, and there is no depth cap. Both are set explicitly.
 * maxAliases of 0 also removes YAML merge keys, which would otherwise let a
 * spec smuggle in fields that the schema never sees at the top level.
 */
const YAML_OPTIONS = {
  schema: JSON_SCHEMA,
  maxAliases: 0,
  maxDepth: 20,
  json: false,
} as const

export class SpecError extends Error {
  readonly path: string
  constructor(path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'SpecError'
    this.path = path
  }
}

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.next', 'out'])

/** Every *.spec.yaml under `root`, as repo-relative paths, sorted. */
export function findSpecFiles(root: string, searchDirs: readonly string[]): string[] {
  const found: string[] = []

  const walk = (dir: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      if (SKIP_DIRS.has(name)) continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (name.endsWith('.spec.yaml')) found.push(relative(root, full))
    }
  }

  for (const dir of searchDirs) walk(join(root, dir))
  return found.sort()
}

export function createSpecValidator(schemaPath: string): ValidateFunction {
  // The schema is a repo file we control, so the assertion is a statement about
  // provenance rather than a shortcut. ajv rejects a malformed schema at
  // compile time anyway, and `strict: true` below makes that rejection loud.
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as Record<string, unknown>
  // allErrors so a spec with three mistakes reports three, not one at a time.
  // strict catches a schema that references an undefined keyword, which would
  // otherwise silently validate everything.
  //
  // strictRequired is the one strict check that is turned off, and only because
  // it cannot see through a conditional. The tier rules use if/then to require
  // `algorithm` and `security_notes` at the critical tier, and those properties
  // are declared at the schema root rather than inside the `then` branch.
  // strictRequired reads that as a required property with no definition. It is a
  // schema-authoring lint, not a validation rule, so nothing about what specs
  // are accepted changes.
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false })
  return ajv.compile(schema)
}

export function loadSpec(root: string, specPath: string, validate: ValidateFunction): LoadedSpec {
  const text = readFileSync(join(root, specPath), 'utf8')

  let parsed: unknown
  try {
    parsed = loadYaml(text, YAML_OPTIONS)
  } catch (err) {
    throw new SpecError(specPath, `YAML did not parse: ${(err as Error).message}`)
  }

  if (parsed === null || typeof parsed !== 'object') {
    throw new SpecError(specPath, 'spec must be a YAML mapping')
  }

  if (!validate(parsed)) {
    const problems = (validate.errors ?? [])
      .map((e) => `  ${e.instancePath || '/'} ${e.message ?? ''}`)
      .join('\n')
    throw new SpecError(specPath, `does not match spec/schema.json:\n${problems}`)
  }

  return { path: specPath, spec: parsed as ModuleSpec }
}

/**
 * Load every spec, and enforce the cross-file rules the JSON Schema cannot see:
 * ids are unique, and invariant ids are unique across the whole repository.
 *
 * Duplicate invariant ids matter more than they look. Two specs both claiming
 * INV-KEY-2 means a reader cannot tell which code an invariant governs, and a
 * report that lists it once hides that one of them is untested.
 */
export function loadAllSpecs(
  root: string,
  searchDirs: readonly string[],
  schemaPath: string
): LoadedSpec[] {
  const validate = createSpecValidator(schemaPath)
  const specs = findSpecFiles(root, searchDirs).map((p) => loadSpec(root, p, validate))

  const byId = new Map<string, string>()
  const invariantOwner = new Map<string, string>()

  for (const { path, spec } of specs) {
    const existing = byId.get(spec.id)
    if (existing !== undefined) {
      throw new SpecError(path, `duplicate spec id "${spec.id}", already declared in ${existing}`)
    }
    byId.set(spec.id, path)

    for (const inv of spec.invariants) {
      const owner = invariantOwner.get(inv.id)
      if (owner !== undefined) {
        throw new SpecError(
          path,
          `duplicate invariant id "${inv.id}", already declared in ${owner}. ` +
            `Invariant ids must be unique across the repository.`
        )
      }
      invariantOwner.set(inv.id, path)
    }
  }

  return specs
}
