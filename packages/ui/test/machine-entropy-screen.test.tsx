/**
 * Tests for letting the device choose the seed.
 *
 * This is the mode every other hardware wallet uses by default, and it is the
 * mode whose failure prompted this project. It is not broken. It is
 * unverifiable, which is different and here worse: a correct generator and a
 * backdoored one look identical from outside, because both hand you 24 words.
 *
 * What the screen has to get right is therefore not the generation. It is the
 * honesty: that the health report is a weak claim rather than reassurance, and
 * that the user cannot reach a seed without saying they understand what they
 * gave up.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  MachineEntropyScreen,
  type HealthReportView,
} from '../src/screens/MachineEntropyScreen.js'

afterEach(cleanup)

const HEALTHY: HealthReportView = {
  healthy: true,
  unknown: false,
  checks: [
    { name: 'kernel-pool', verdict: 'ok', detail: 'entropy_avail is 4096' },
    { name: 'hardware-rng', verdict: 'ok', detail: 'two reads, different, neither all zero' },
    { name: 'boot-age', verdict: 'ok', detail: 'a hardware RNG is present' },
  ],
}

function setup(overrides: Partial<React.ComponentProps<typeof MachineEntropyScreen>> = {}) {
  const onHealth = vi.fn().mockResolvedValue(HEALTHY)
  const onGenerate = vi.fn().mockResolvedValue(undefined)
  const onBack = vi.fn()
  render(
    <MachineEntropyScreen
      onHealth={onHealth}
      onGenerate={onGenerate}
      onBack={onBack}
      {...overrides}
    />
  )
  return { onHealth, onGenerate, onBack }
}

describe('MachineEntropyScreen', () => {
  /**
   * INV-UI-74. A seed cannot be generated without an explicit acknowledgement,
   * and the acknowledgement names what is being given up rather than being a
   * blank consent tick.
   */
  it('will-not-generate-until-the-user-says-what-they-are-giving-up', async () => {
    const { onGenerate } = setup()
    await waitFor(() => {
      expect(screen.getByTestId('machine-health')).toBeTruthy()
    })

    expect(screen.getByTestId<HTMLButtonElement>('machine-generate').disabled).toBe(true)
    fireEvent.click(screen.getByTestId('machine-generate'))
    expect(onGenerate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('machine-acknowledge'))
    expect(screen.getByTestId<HTMLButtonElement>('machine-generate').disabled).toBe(false)
    fireEvent.click(screen.getByTestId('machine-generate'))
    await waitFor(() => {
      expect(onGenerate).toHaveBeenCalledWith(true)
    })
  })

  /**
   * INV-UI-74. The warning is what the screen leads with, and it says the thing
   * that is actually true: a correct generator and a backdoored one are
   * indistinguishable from out here.
   */
  it('says-what-is-lost-rather-than-that-the-device-is-trustworthy', () => {
    setup()
    const warning = screen.getByTestId('machine-warning').textContent
    expect(warning).toContain('cannot check')
    expect(warning).toContain('reproduced with a die')
    expect(warning).toContain('backdoored one look identical')
  })

  /**
   * INV-UI-75. The health report is bounded next to the report itself. Three
   * green ticks otherwise read as "the device checked its randomness", which is
   * not what happened.
   */
  it('bounds-what-the-health-checks-mean', async () => {
    setup()
    await waitFor(() => {
      expect(screen.getByTestId('machine-health')).toBeTruthy()
    })

    const limit = screen.getByTestId('machine-health-limit').textContent
    expect(limit).toContain('say nothing about the quality')
    expect(limit).toContain('predictable output passes all of them')
    expect(limit).toContain('rolling dice makes impossible')
  })

  /**
   * INV-UI-75. An unknown source blocks generation. Unknown is not fine, and
   * this is the state a developer machine is always in, which is exactly where
   * a lax rule would be written and never noticed.
   */
  it('refuses-when-a-source-could-not-be-checked', async () => {
    setup({
      onHealth: vi.fn().mockResolvedValue({
        healthy: false,
        unknown: true,
        checks: [{ name: 'hardware-rng', verdict: 'unknown', detail: 'no /dev/hwrng here' }],
      } satisfies HealthReportView),
    })
    await waitFor(() => {
      expect(screen.getByTestId('machine-unknown')).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('machine-acknowledge'))
    expect(screen.getByTestId<HTMLButtonElement>('machine-generate').disabled).toBe(true)
    expect(screen.getByTestId('machine-unknown').textContent).toContain('not the same as being fine')
  })

  it('refuses-and-points-at-dice-when-a-source-has-failed', async () => {
    setup({
      onHealth: vi.fn().mockResolvedValue({
        healthy: false,
        unknown: false,
        checks: [
          { name: 'hardware-rng', verdict: 'failed', detail: 'two consecutive reads identical' },
        ],
      } satisfies HealthReportView),
    })
    await waitFor(() => {
      expect(screen.getByTestId('machine-unhealthy')).toBeTruthy()
    })
    expect(screen.getByTestId('machine-unhealthy').textContent).toContain('Roll dice instead')
    fireEvent.click(screen.getByTestId('machine-acknowledge'))
    expect(screen.getByTestId<HTMLButtonElement>('machine-generate').disabled).toBe(true)
  })

  it('reports-a-refusal-from-the-daemon', async () => {
    setup({
      onGenerate: vi.fn().mockRejectedValue(new Error('This device cannot confirm its sources.')),
    })
    await waitFor(() => {
      expect(screen.getByTestId('machine-health')).toBeTruthy()
    })
    fireEvent.click(screen.getByTestId('machine-acknowledge'))
    fireEvent.click(screen.getByTestId('machine-generate'))
    await waitFor(() => {
      expect(screen.getByTestId('machine-error').textContent).toContain('cannot confirm')
    })
  })
})
