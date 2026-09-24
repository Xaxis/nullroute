/**
 * Tests for the BIP-85 child seed screen.
 *
 * This screen deliberately displays key material, which puts it in a category
 * with exactly one other screen on this device. What has to be right is not the
 * derivation, which is tested against published vectors elsewhere, but the two
 * things a user can lose money to: a child written down without its path, which
 * is unrecoverable, and a child handed to somebody else in the belief that it is
 * independent of the wallet that made it, which it is not.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ChildSeedScreen } from '../src/screens/ChildSeedScreen.js'

afterEach(cleanup)

function setup(overrides: Partial<React.ComponentProps<typeof ChildSeedScreen>> = {}) {
  const onDerive = vi.fn().mockResolvedValue({
    path: "m/83696968'/39'/0'/12'/0'",
    words:
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    wordCount: 12,
  })
  const onBack = vi.fn()
  render(<ChildSeedScreen onDerive={onDerive} onBack={onBack} {...overrides} />)
  return { onDerive, onBack }
}

describe('ChildSeedScreen', () => {
  /**
   * INV-UI-49. The path is shown with the words rather than on request.
   *
   * A child mnemonic without its path cannot be rederived from the master, so
   * a user who wrote down only the words has recorded the half their own seed
   * already implies and none of the half that identifies which child it is.
   */
  it('shows-the-path-beside-the-words', async () => {
    setup()
    fireEvent.click(screen.getByTestId('child-derive'))

    await waitFor(() => {
      expect(screen.getByTestId('child-words')).toBeTruthy()
    })
    expect(screen.getByTestId('child-path').textContent).toBe("m/83696968'/39'/0'/12'/0'")
    // Not behind a disclosure, and said again in the subtitle.
    expect(document.querySelector('.nr-screen__subtitle')?.textContent).toContain('path')
  })

  /**
   * INV-UI-49. The screen says a child is not independent of its parent, and
   * says it where the child is on screen rather than only beforehand.
   */
  it('says-the-child-is-still-controlled-by-the-parent-seed', async () => {
    setup()

    // Before deriving.
    expect(screen.getByTestId('child-warning').textContent).toContain(
      'recoverable from this wallet'
    )

    fireEvent.click(screen.getByTestId('child-derive'))
    await waitFor(() => {
      expect(screen.getByTestId('child-parent-warning')).toBeTruthy()
    })

    // And beside the words, which is where somebody decides to hand it over.
    const warning = screen.getByTestId('child-parent-warning').textContent
    expect(warning).toContain('derive this child and every other one')
    expect(warning).toContain('does not give them something separate')
    // With the alternative, so the warning is actionable rather than only
    // discouraging.
    expect(warning).toContain('roll dice')
  })

  it('says-nothing-was-written-to-the-device', async () => {
    setup()
    fireEvent.click(screen.getByTestId('child-derive'))
    await waitFor(() => {
      expect(screen.getByTestId('child-not-saved').textContent).toContain('Nothing was written')
    })
  })

  /**
   * INV-UI-50. Each application sends the size under the name the standard
   * gives it, and switching application resets to a size that application
   * allows.
   *
   * Sending all three names would have the daemon read whichever it wants and
   * ignore the rest, which is how a screen and a device end up disagreeing
   * about what was derived. Carrying 12 over to hex would be refused by name,
   * since BIP-85 allows 16 to 64 bytes.
   */
  it('sends-a-size-each-application-allows', async () => {
    const { onDerive } = setup()

    fireEvent.click(screen.getByTestId('child-derive'))
    await waitFor(() => {
      expect(screen.getByTestId('child-done')).toBeTruthy()
    })
    expect(onDerive).toHaveBeenCalledWith('mnemonic', 0, 12)
    fireEvent.click(screen.getByTestId('child-done'))

    fireEvent.click(screen.getByTestId('child-app-hex'))
    // 12 is not a size hex allows, so it must not have survived the switch.
    expect(screen.queryByTestId('child-size-12')).toBeNull()
    expect(screen.getByTestId('child-size-16').getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByTestId('child-size-64'))
    fireEvent.click(screen.getByTestId('child-derive'))
    await waitFor(() => {
      expect(onDerive).toHaveBeenCalledWith('hex', 0, 64)
    })
  })

  it('derives-a-different-child-per-index', async () => {
    const { onDerive } = setup()

    expect(screen.getByTestId<HTMLButtonElement>('child-index-down').disabled).toBe(true)
    fireEvent.click(screen.getByTestId('child-index-up'))
    fireEvent.click(screen.getByTestId('child-index-up'))
    expect(screen.getByTestId('child-index').textContent).toBe('2')

    fireEvent.click(screen.getByTestId('child-derive'))
    await waitFor(() => {
      expect(onDerive).toHaveBeenCalledWith('mnemonic', 2, 12)
    })
  })

  it('reports-a-refusal-rather-than-showing-an-empty-child', async () => {
    const onDerive = vi.fn().mockRejectedValue(new Error('No wallet is loaded.'))
    setup({ onDerive })

    fireEvent.click(screen.getByTestId('child-derive'))
    await waitFor(() => {
      expect(screen.getByTestId('child-error').textContent).toContain('No wallet is loaded')
    })
    expect(screen.queryByTestId('child-words')).toBeNull()
  })
})
