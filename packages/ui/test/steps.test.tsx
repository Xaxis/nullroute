/**
 * Tests for the step indicator.
 *
 * Small component, one job: say where you are without lying about it. Every
 * journey on this device has an irreversible action somewhere in it, and a user
 * who cannot tell how far along they are cannot tell whether they have passed
 * it.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Steps } from '../src/components/Steps.js'
import { Screen } from '../src/components/Screen.js'

afterEach(cleanup)

describe('ui.components.steps', () => {
  /**
   * INV-UI-58. One-based, because it is read aloud and compared with a written
   * guide, and named, because "step 3 of 5" alone says nothing.
   */
  it('counts-from-one-and-names-the-step', () => {
    render(<Steps current={2} total={5} label="Check the quorum that comes back" />)
    const said = screen.getByTestId('steps').textContent
    expect(said).toContain('Step 2 of 5')
    expect(said).toContain('Check the quorum that comes back')
  })

  /**
   * INV-UI-58. It sits above the title. A user scanning a screen reads the
   * title first and stops, so the thing saying "you are three steps into
   * something with an irreversible step at the end" has to come before it.
   */
  it('sits-above-the-screen-title', () => {
    render(
      <Screen
        title="Write these down"
        steps={<Steps current={3} total={4} label="Write the words down" />}
        testId="s"
      >
        <p>body</p>
      </Screen>
    )
    const indicator = screen.getByTestId('steps')
    const title = document.querySelector('.nr-screen__title')
    expect(title).not.toBeNull()
    expect(
      indicator.compareDocumentPosition(title as Node) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  /**
   * A screen not in a journey shows nothing at all, rather than "step 1 of 1".
   * Most of the device is used outside a journey and a counter there would be
   * noise claiming structure that is not present.
   */
  it('is-absent-from-a-screen-that-is-not-part-of-a-journey', () => {
    render(
      <Screen title="Wallet" testId="s">
        <p>body</p>
      </Screen>
    )
    expect(screen.queryByTestId('steps')).toBeNull()
  })
})
