/**
 * Tests for the journey completion screen.
 *
 * The only reason this screen exists is the gap between "this device has
 * finished its part" and "the thing you set out to do works". For multisig that
 * gap is enormous: a registered quorum can receive and cannot spend until every
 * other cosigner registers the same descriptor, and it is invisible to the
 * software that builds transactions until the coordinator imports the bundle.
 * Dropping somebody on the wallet screen at that moment says, by saying
 * nothing, that the job is done.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { FinishScreen } from '../src/screens/FinishScreen.js'
import { journeyById, type Journey } from '../src/journeys.js'

afterEach(cleanup)

function journeyOr(id: 'multisig' | 'receive'): Journey {
  const found = journeyById(id)
  if (found === undefined) throw new Error(`no journey ${id}`)
  return found
}

describe('FinishScreen', () => {
  /**
   * INV-UI-59. A journey with work left over says so, lists it, and does not
   * call itself done.
   */
  it('does-not-say-done-when-the-device-has-only-done-its-part', () => {
    render(<FinishScreen journey={journeyOr('multisig')} onDone={vi.fn()} />)

    const title = document.querySelector('.nr-screen__title')?.textContent
    expect(title).toBe('This device has done its part')
    expect(title).not.toBe('Done')

    expect(screen.getByTestId('finish-outstanding').textContent).toContain('3 things are not')

    const left = screen.getByTestId('finish-steps').textContent
    for (const item of journeyOr('multisig').thenWhat) {
      expect(left).toContain(item)
    }
    // The specific ones that cost money to miss.
    expect(left).toContain('register the same descriptor')
    expect(left).toContain('zero balance')
    expect(left).toContain('same index on every device')
  })

  /**
   * INV-UI-59. A journey that really is finished says that plainly, rather than
   * leaving the user to infer it from an absence.
   */
  it('says-plainly-when-nothing-is-left', () => {
    const complete: Journey = { ...journeyOr('receive'), thenWhat: [] }
    render(<FinishScreen journey={complete} onDone={vi.fn()} />)

    expect(document.querySelector('.nr-screen__title')?.textContent).toBe('Done')
    expect(screen.getByTestId('finish-complete').textContent).toContain('Nothing else is needed')
    expect(screen.queryByTestId('finish-outstanding')).toBeNull()
  })

  it('counts-one-leftover-in-the-singular', () => {
    const one: Journey = {
      ...journeyOr('receive'),
      thenWhat: ['Read the address off this screen.'],
    }
    render(<FinishScreen journey={one} onDone={vi.fn()} />)
    expect(screen.getByTestId('finish-outstanding').textContent).toContain('One thing is not')
  })

  /**
   * A recap of what was done, because these journeys are long enough that the
   * first step is not in mind by the last one, and somebody checking their work
   * against another device needs to know what this one claims to have done.
   */
  it('recaps-the-steps-that-were-taken', () => {
    render(<FinishScreen journey={journeyOr('multisig')} onDone={vi.fn()} />)
    const recap = screen.getByTestId('finish-recap').textContent
    for (const step of journeyOr('multisig').steps) {
      expect(recap).toContain(step.label)
    }
  })

  it('dismisses-to-wherever-the-last-step-went', () => {
    const onDone = vi.fn()
    render(<FinishScreen journey={journeyOr('multisig')} onDone={onDone} />)
    fireEvent.click(screen.getByTestId('finish-done'))
    expect(onDone).toHaveBeenCalledOnce()
  })
})
