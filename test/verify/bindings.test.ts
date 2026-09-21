/**
 * Tests for the part of the verification system that decides whether an
 * invariant is proven.
 *
 * WHY THIS FILE EXISTS. packages/verify had no tests at all. It is the package
 * CLAUDE.md calls a first-class deliverable, the one the whole premise rests
 * on, and it was the only one in the tree with nothing exercising it. That is
 * not an oversight anybody would defend out loud; it is what happens when the
 * thing that checks everything else is the thing nobody thinks to check.
 *
 * It had already cost something. The status expression in cli.ts asked how many
 * differential blocks were declared before it asked whether the check passed,
 * so removing every block reported `not-applicable` and the report passed with
 * three guard failures riding along inside it. A test over that expression
 * would have caught it the day it was written.
 *
 * WHAT IS TESTED HERE is the decision, not the plumbing: given a report and a
 * selector, is this invariant proven. Every case below is one where answering
 * wrongly means the device boots on an invariant nothing established, which is
 * the only kind of bug this package can have that matters.
 */

import { describe, expect, it } from 'vitest'
import { resolveBinding, checkBindings } from '../../packages/verify/src/tests.js'

const ROOT = '/repo'

/** A report in the shape vitest's JSON reporter emits. */
function report(
  files: readonly {
    name: string
    tests: readonly { title: string; ancestors?: readonly string[]; status: string }[]
  }[]
) {
  return {
    numTotalTests: files.reduce((sum, f) => sum + f.tests.length, 0),
    testResults: files.map((f) => ({
      name: f.name,
      assertionResults: f.tests.map((t) => ({
        title: t.title,
        ancestorTitles: [...(t.ancestors ?? [])],
        status: t.status,
      })),
    })),
  } as unknown as Parameters<typeof resolveBinding>[1]
}

const oneTest = (status: string) =>
  report([
    {
      name: '/repo/packages/core/test/dice.test.ts',
      tests: [{ title: 'refuses-a-short-roll', ancestors: ['core.entropy.dice'], status }],
    },
  ])

const SELECTOR = 'packages/core/test/dice.test.ts::refuses-a-short-roll'

describe('verify.bindings resolution', () => {
  it('proves-an-invariant-only-when-the-test-passed', () => {
    const binding = resolveBinding(ROOT, oneTest('passed'), 'INV-DICE-1', SELECTOR)
    expect(binding.ok).toBe(true)
    expect(binding.status).toBe('passed')
  })

  /**
   * THE ONE THE WHOLE APPARATUS EXISTS FOR.
   *
   * The Makefile says it in as many words: `it.skip` leaves vitest at exit 0
   * with success true, so a check reading the exit code would certify
   * invariants that never ran. Every status that is not literally "passed" has
   * to leave the invariant unproven, and each of these is a way a test stops
   * running without anything going red.
   */
  it('refuses-every-status-that-is-not-passed', () => {
    for (const status of ['skipped', 'todo', 'pending', 'disabled', 'failed']) {
      const binding = resolveBinding(ROOT, oneTest(status), 'INV-DICE-1', SELECTOR)
      expect(binding.ok, status).toBe(false)
      expect(binding.status, status).toBe(status)
      expect(binding.detail, status).toContain('not proven')
    }
  })

  /**
   * A status vitest adds after this was written must not read as a pass.
   *
   * The enum exists so a widened `string` cannot let one through, and the
   * unknown case has to carry the raw value or the report cannot say what it
   * saw.
   */
  it('treats-a-status-it-has-never-heard-of-as-unproven', () => {
    const binding = resolveBinding(ROOT, oneTest('quarantined'), 'INV-DICE-1', SELECTOR)
    expect(binding.ok).toBe(false)
    expect(binding.status).toBe('unknown')
    expect(binding.rawStatus).toBe('quarantined')
  })

  it('reports-a-selector-naming-a-file-that-is-not-in-the-report', () => {
    const binding = resolveBinding(
      ROOT,
      oneTest('passed'),
      'INV-DICE-1',
      'packages/core/test/gone.test.ts::refuses-a-short-roll'
    )
    expect(binding.ok).toBe(false)
    expect(binding.status).toBe('missing')
    expect(binding.detail).toContain('no test file')
  })

  it('reports-a-selector-naming-a-test-that-is-not-there', () => {
    const binding = resolveBinding(
      ROOT,
      oneTest('passed'),
      'INV-DICE-1',
      'packages/core/test/dice.test.ts::a-test-nobody-wrote'
    )
    expect(binding.ok).toBe(false)
    expect(binding.status).toBe('missing')
  })

  it('refuses-a-selector-with-no-test-name-at-all', () => {
    const binding = resolveBinding(ROOT, oneTest('passed'), 'INV-DICE-1', 'packages/core/test/x.ts')
    expect(binding.ok).toBe(false)
    expect(binding.detail).toContain('<path>::<test name>')
  })

  /**
   * Two tests with the same title is an ambiguity, not a match.
   *
   * The comment in resolveBinding gives the reason and it is the right one: a
   * duplicate title could let a passing test stand in for a failing one, and
   * the invariant would be reported as proven by whichever the search reached
   * first.
   */
  it('refuses-a-selector-that-matches-more-than-one-test', () => {
    const duplicated = report([
      {
        name: '/repo/packages/core/test/dice.test.ts',
        tests: [
          { title: 'refuses-a-short-roll', ancestors: ['first'], status: 'passed' },
          { title: 'refuses-a-short-roll', ancestors: ['second'], status: 'failed' },
        ],
      },
    ])
    const binding = resolveBinding(ROOT, duplicated, 'INV-DICE-1', SELECTOR)
    expect(binding.ok).toBe(false)
    expect(binding.status).toBe('ambiguous')
    expect(binding.detail).toContain('stand in for a failing one')
  })

  /** Ancestor titles disambiguate, which is what the message above tells you to do. */
  it('accepts-a-selector-qualified-by-its-describe-block', () => {
    const duplicated = report([
      {
        name: '/repo/packages/core/test/dice.test.ts',
        tests: [
          { title: 'refuses-a-short-roll', ancestors: ['first'], status: 'failed' },
          { title: 'refuses-a-short-roll', ancestors: ['second'], status: 'passed' },
        ],
      },
    ])
    const passing = resolveBinding(
      ROOT,
      duplicated,
      'INV-DICE-1',
      'packages/core/test/dice.test.ts::second>refuses-a-short-roll'
    )
    expect(passing.ok).toBe(true)

    const failing = resolveBinding(
      ROOT,
      duplicated,
      'INV-DICE-1',
      'packages/core/test/dice.test.ts::first>refuses-a-short-roll'
    )
    expect(failing.ok).toBe(false)
    expect(failing.status).toBe('failed')
  })
})

describe('verify.bindings over a whole spec set', () => {
  /**
   * An invariant is proven only if EVERY test it names passed.
   *
   * A spec listing four tests is making four claims. Treating the set as
   * satisfied by any one of them would let three rot while the row stayed
   * green, and a row that stays green is the whole failure mode here.
   */
  it('fails-the-invariant-when-any-one-of-its-tests-did-not-pass', () => {
    const mixed = report([
      {
        name: '/repo/packages/core/test/dice.test.ts',
        tests: [
          { title: 'one', status: 'passed' },
          { title: 'two', status: 'skipped' },
        ],
      },
    ])
    const result = checkBindings(ROOT, mixed, [
      {
        id: 'INV-DICE-1',
        tests: ['packages/core/test/dice.test.ts::one', 'packages/core/test/dice.test.ts::two'],
      },
    ])
    expect(result.ok).toBe(false)
    expect(result.bindings.filter((b) => !b.ok)).toHaveLength(1)
  })

  it('passes-only-when-every-named-test-passed', () => {
    const allGood = report([
      {
        name: '/repo/packages/core/test/dice.test.ts',
        tests: [
          { title: 'one', status: 'passed' },
          { title: 'two', status: 'passed' },
        ],
      },
    ])
    const result = checkBindings(ROOT, allGood, [
      {
        id: 'INV-DICE-1',
        tests: ['packages/core/test/dice.test.ts::one', 'packages/core/test/dice.test.ts::two'],
      },
    ])
    expect(result.ok).toBe(true)
    expect(result.totalTests).toBe(2)
  })

  /**
   * An invariant naming no tests produces no evidence, and must not produce a
   * pass either.
   *
   * The schema requires at least one test, so this is about what happens if
   * that guard is ever relaxed. `every` over an empty list is true, so an
   * assertion written as "all its bindings passed" would report an invariant
   * with no tests as proven, which is the vacuous truth this project keeps
   * finding in other people's checks.
   */
  it('produces-no-binding-at-all-for-an-invariant-that-names-no-tests', () => {
    const result = checkBindings(ROOT, oneTest('passed'), [
      { id: 'INV-DICE-1', tests: [] },
      { id: 'INV-DICE-2', tests: [SELECTOR] },
    ])
    // One binding, for the one invariant that named a test. Nothing anywhere
    // downstream can report INV-DICE-1 as proven, because there is no row for
    // it to be proven by.
    expect(result.bindings).toHaveLength(1)
    expect(result.bindings[0]?.invariantId).toBe('INV-DICE-2')
    expect(result.bindings.some((b) => b.invariantId === 'INV-DICE-1')).toBe(false)
  })
})
