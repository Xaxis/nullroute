/**
 * Tests for the receive screen.
 *
 * The wallet screen lists twenty addresses in a table, which is right for
 * auditing an account and wrong for taking one. On a 7 inch panel the eye slips
 * a row, and a row here is a different address.
 *
 * The warning is the reason the screen exists rather than decoration on it. An
 * air-gapped signer protects the key and cannot protect the address on its way
 * to whoever is paying you: software on the networked machine replaces it after
 * it is copied, the payer sends to the attacker, and every screen involved looks
 * correct. Reading the characters off this panel is the only step that catches
 * that, and it has to be said where the address is.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReceiveScreen, chunkAddress } from '../src/screens/ReceiveScreen.js'

afterEach(cleanup)

const ADDRESS = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'

function setup(overrides: Partial<React.ComponentProps<typeof ReceiveScreen>> = {}) {
  const onAddress = vi.fn(async (index: number) =>
    Promise.resolve({
      address: `${ADDRESS}${String(index)}`,
      path: `m/84'/0'/0'/0/${String(index)}`,
      index,
    })
  )
  const onVerify = vi.fn().mockResolvedValue({ found: true, path: "m/84'/0'/0'/0/0" })
  const onBack = vi.fn()
  render(
    <ReceiveScreen
      onAddress={onAddress}
      onVerify={onVerify}
      onBack={onBack}
      {...overrides}
    />
  )
  return { onAddress, onVerify, onBack }
}

describe('ReceiveScreen', () => {
  /**
   * INV-UI-60. One address at a time, with its path, and the warning that this
   * device cannot protect it after it leaves the screen.
   */
  it('shows-one-address-with-its-path-and-says-what-it-cannot-protect', async () => {
    const { onAddress } = setup()

    await waitFor(() => {
      expect(screen.getByTestId('receive-address')).toBeTruthy()
    })
    // One, not a page of twenty.
    expect(onAddress).toHaveBeenCalledWith(0)
    expect(screen.getByTestId('receive-path').textContent).toBe("m/84'/0'/0'/0/0")

    const warning = screen.getByTestId('receive-warning').textContent
    expect(warning).toContain('Read it from this screen')
    expect(warning).toContain('swaps a copied address')
    expect(warning).toContain('every screen involved looks correct')
  })

  /**
   * INV-UI-60. Verification is against a re-derivation, and the claim it
   * supports is bounded: this address on this screen, and nothing about any
   * other screen.
   */
  it('verifies-by-re-deriving-and-does-not-overclaim', async () => {
    const { onVerify } = setup()
    await waitFor(() => {
      expect(screen.getByTestId('receive-verify')).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('receive-verify'))
    await waitFor(() => {
      expect(onVerify).toHaveBeenCalledWith(`${ADDRESS}0`)
    })

    const said = screen.getByTestId('receive-verified').textContent
    expect(said).toContain('Re-derived from this device')
    expect(said).toContain('proves nothing about the address on any other screen')
  })

  /**
   * An address this screen displayed that does not re-derive is a serious
   * failure of the device itself, not a warning to be waved past.
   */
  it('refuses-an-address-it-cannot-re-derive', async () => {
    const onVerify = vi.fn().mockResolvedValue({ found: false })
    setup({ onVerify })
    await waitFor(() => {
      expect(screen.getByTestId('receive-verify')).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('receive-verify'))
    await waitFor(() => {
      expect(screen.getByTestId('receive-unverified').textContent).toContain('Do not use it')
    })
    expect(screen.queryByTestId('receive-verified')).toBeNull()
  })

  /**
   * INV-UI-61. Moving to another address clears the previous verdict. A tick
   * left over from the last address is worse than no tick at all.
   */
  it('clears-the-verdict-when-the-address-changes', async () => {
    const { onAddress } = setup()
    await waitFor(() => {
      expect(screen.getByTestId('receive-verify')).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('receive-verify'))
    await waitFor(() => {
      expect(screen.getByTestId('receive-verified')).toBeTruthy()
    })

    fireEvent.click(screen.getByTestId('receive-next'))
    await waitFor(() => {
      expect(onAddress).toHaveBeenCalledWith(1)
    })
    expect(screen.queryByTestId('receive-verified')).toBeNull()
    expect(screen.getByTestId('receive-verify')).toBeTruthy()
    expect(screen.getByTestId('receive-path').textContent).toBe("m/84'/0'/0'/0/1")
  })

  /**
   * INV-UI-61. The button says "Another", never "next unused". This device has
   * no network, so it cannot know which addresses have been paid to, and a
   * label claiming otherwise is the one lie an air-gapped wallet must not tell.
   */
  it('does-not-claim-to-know-which-addresses-were-used', () => {
    setup()
    expect(screen.getByTestId('receive-next').textContent).toBe('Another')
    expect(document.body.textContent).not.toContain('unused')
  })

  it('cannot-page-back-past-the-first-address', () => {
    setup()
    expect(screen.getByTestId<HTMLButtonElement>('receive-prev').disabled).toBe(true)
  })

  it('reports-a-failed-derivation-rather-than-an-empty-screen', async () => {
    const onAddress = vi.fn().mockRejectedValue(new Error('No wallet is loaded.'))
    setup({ onAddress })
    await waitFor(() => {
      expect(screen.getByTestId('receive-error').textContent).toContain('No wallet is loaded')
    })
    expect(screen.queryByTestId('receive-address')).toBeNull()
  })

  /**
   * Groups of four, the way the manifest hash is chunked, because both are
   * values two people read to each other.
   */
  it('chunks-an-address-into-fours', () => {
    expect(chunkAddress('bc1qcr8te4k')).toBe('bc1q cr8t e4k')
    expect(chunkAddress('abc')).toBe('abc')
    expect(chunkAddress('')).toBe('')
  })
})
