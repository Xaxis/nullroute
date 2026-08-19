/**
 * Tests for the goal hub.
 *
 * The device is organised by feature because that is how the code is shaped.
 * Nobody arrives thinking in features, and the mapping from "get my three Pis
 * onto one wallet" to a sequence of screens is knowledge the device has and the
 * user does not.
 *
 * What has to be right is the preamble. Tapping a goal must not start it: the
 * expensive failure in every one of these flows is finding out at step three
 * that you needed a die, a second device in the room, or somewhere to write 24
 * words, and by then there is a seed on the screen and stopping is not free.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StartScreen } from '../src/screens/StartScreen.js'
import { JOURNEYS, journeyById } from '../src/journeys.js'

afterEach(cleanup)

function setup(overrides: Partial<React.ComponentProps<typeof StartScreen>> = {}) {
  const onBegin = vi.fn()
  const onSkip = vi.fn()
  render(<StartScreen walletOpen onBegin={onBegin} onSkip={onSkip} {...overrides} />)
  return { onBegin, onSkip }
}

describe('StartScreen', () => {
  /**
   * INV-UI-55. Choosing a goal shows what it needs and does not start it.
   */
  it('shows-what-a-goal-needs-before-starting-it', () => {
    const { onBegin } = setup()

    fireEvent.click(screen.getByTestId('start-goal-multisig'))
    expect(onBegin).not.toHaveBeenCalled()

    const needs = screen.getByTestId('start-needs').textContent
    expect(needs).toContain('Every other device in the quorum')
    expect(needs).toContain('Coordinator software')
    expect(needs).toContain('cannot be finished on one device')

    // Every step, numbered, so the length of the thing is visible up front.
    const steps = screen.getByTestId('start-steps').textContent
    for (const step of journeyById('multisig')?.steps ?? []) {
      expect(steps).toContain(step.label)
    }

    fireEvent.click(screen.getByTestId('start-begin'))
    expect(onBegin).toHaveBeenCalledWith('multisig')
  })

  /**
   * INV-UI-55. What the journey does NOT finish is said before starting as well
   * as at the end. A flow whose last screen is the first mention of "this is
   * not done yet" has already let somebody believe it was.
   */
  it('says-up-front-what-the-journey-does-not-finish', () => {
    setup()
    fireEvent.click(screen.getByTestId('start-goal-multisig'))
    const then = screen.getByTestId('start-then').textContent
    expect(then).toContain('does not finish')
    expect(then).toContain('register the same descriptor')
    expect(then).toContain('zero balance')
  })

  /**
   * INV-UI-56. A journey that operates on a wallet OPENS one when none is open,
   * rather than refusing to start.
   *
   * This screen used to disable the button and say "open a wallet first". That
   * is a refusal, and a guide that stops at its own first prerequisite has
   * failed at the one thing it exists to do. This is a cold storage device:
   * signing needs a key in memory and deriving an address needs a seed, which
   * is the ordinary state of the machine rather than an obstacle to report.
   */
  it('opens-a-wallet-as-a-step-rather-than-refusing-to-start', () => {
    const { onBegin } = setup({ walletOpen: false })

    expect(screen.getByTestId('start-goal-sign').textContent).toContain('opens a wallet first')
    // A journey that makes a wallet is not marked, because it does not need one.
    expect(screen.getByTestId('start-goal-new-wallet').textContent).not.toContain(
      'opens a wallet first'
    )

    fireEvent.click(screen.getByTestId('start-goal-sign'))
    const begin = screen.getByTestId<HTMLButtonElement>('start-begin')
    expect(begin.disabled).toBe(false)

    // The extra step is in the list and in the count, because opening a wallet
    // is a real step and hiding it would make the counter wrong.
    expect(screen.getByTestId('start-steps').textContent).toContain('Open a wallet')
    const signing = journeyById('sign')
    expect(begin.textContent).toContain(String((signing?.steps.length ?? 0) + 1))
    expect(screen.getByTestId('start-opens-a-wallet').textContent).toContain(
      'a step rather than an obstacle'
    )

    fireEvent.click(begin)
    expect(onBegin).toHaveBeenCalledWith('sign')
  })

  it('does-not-add-that-step-when-a-wallet-is-already-open', () => {
    const { onBegin } = setup({ walletOpen: true })
    fireEvent.click(screen.getByTestId('start-goal-sign'))

    expect(screen.getByTestId('start-steps').textContent).not.toContain('Open a wallet')
    expect(screen.queryByTestId('start-opens-a-wallet')).toBeNull()
    const signing = journeyById('sign')
    expect(screen.getByTestId('start-begin').textContent).toContain(
      String(signing?.steps.length ?? 0)
    )

    fireEvent.click(screen.getByTestId('start-begin'))
    expect(onBegin).toHaveBeenCalledWith('sign')
  })

  /**
   * INV-UI-56. The hub is a route in, never the only one. A user who knows the
   * device walks past it, and a hub that became mandatory would make the device
   * worse for the second week of owning it.
   */
  it('can-be-walked-past', () => {
    const { onSkip } = setup()
    fireEvent.click(screen.getByTestId('start-skip'))
    expect(onSkip).toHaveBeenCalledOnce()
  })

  it('offers-every-journey-that-exists', () => {
    setup()
    for (const journey of JOURNEYS) {
      const row = screen.getByTestId(`start-goal-${journey.id}`)
      expect(row.textContent, journey.id).toContain(journey.goal)
      // A goal with no explanation beside it is a menu item, not a goal.
      expect(row.textContent, journey.id).toContain(journey.summary)
    }
  })

  it('goes-back-to-the-list-without-starting-anything', () => {
    const { onBegin } = setup()
    fireEvent.click(screen.getByTestId('start-goal-new-wallet'))
    fireEvent.click(screen.getByTestId('start-back'))
    expect(screen.getByTestId('start-goals')).toBeTruthy()
    expect(onBegin).not.toHaveBeenCalled()
  })
})

/**
 * The journey definitions themselves.
 *
 * These are data that the shell trusts: it reads a step's stage and routes to
 * it. A stage name that does not exist would send somebody nowhere, and a
 * journey with no steps would start and immediately end.
 */
describe('ui.journeys', () => {
  // INV-UI-57. Every journey is well formed.
  it('every-journey-has-steps-a-goal-and-a-summary', () => {
    expect(JOURNEYS.length).toBeGreaterThan(0)
    const ids = new Set<string>()
    for (const journey of JOURNEYS) {
      expect(journey.steps.length, journey.id).toBeGreaterThan(0)
      expect(journey.goal.length, journey.id).toBeGreaterThan(0)
      expect(journey.summary.length, journey.id).toBeGreaterThan(0)
      expect(ids.has(journey.id), journey.id).toBe(false)
      ids.add(journey.id)
      for (const step of journey.steps) {
        expect(step.label.length, `${journey.id}/${step.stage}`).toBeGreaterThan(0)
      }
    }
  })

  /**
   * INV-UI-57. A journey that takes more than this device says so. This is the
   * whole reason `thenWhat` exists, and an empty one on the multisig journey
   * would be the device claiming a quorum is finished when it is inert.
   */
  it('says-what-is-unfinished-for-anything-that-needs-another-device', () => {
    for (const id of ['multisig', 'sign', 'new-wallet', 'restore-wallet'] as const) {
      const journey = journeyById(id)
      expect(journey?.thenWhat.length, id).toBeGreaterThan(0)
    }
  })

  it('finds-nothing-for-a-goal-that-does-not-exist', () => {
    // @ts-expect-error deliberately not a JourneyId
    expect(journeyById('learn-to-fly')).toBeUndefined()
  })
})
