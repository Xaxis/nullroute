/**
 * Tests for the message signing screen.
 *
 * This screen carries the signing screen's risk in a smaller package. A
 * signature is a proof that whoever holds the key agreed to a specific string,
 * so if somebody else chose the string and it means something elsewhere, the
 * user authorised it without ever seeing a transaction.
 *
 * The tests are therefore about the same things: reviewing is separate from
 * signing, the text is shown in full, a refusal blocks, and what leaves the
 * device is enough for somebody else to check.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MessageScreen, type MessageReviewView } from '../src/screens/MessageScreen.js'

afterEach(cleanup)

const HASH = 'f0eb03b1a75ac6d9847f55c624a99169b5dccba2a31f5b23bea77ba270de0a7a'

function reviewOf(overrides: Partial<MessageReviewView> = {}): MessageReviewView {
  return {
    message: 'Hello World',
    hashHex: HASH,
    characters: 11,
    bytes: 11,
    refusals: [],
    warnings: [],
    ...overrides,
  }
}

function setup(overrides: Partial<MessageReviewView> = {}) {
  const onReview = vi.fn().mockResolvedValue(reviewOf(overrides))
  const onSign = vi.fn().mockResolvedValue({
    address: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
    message: 'Hello World',
    signature: 'AkcwRAIgAAAA',
    path: "m/84'/0'/0'/0/0",
  })
  const onBack = vi.fn()
  render(<MessageScreen onReview={onReview} onSign={onSign} onBack={onBack} />)
  return { onReview, onSign, onBack }
}

/** Type a message on the on-screen keyboard and review it. */
async function reachReview(): Promise<void> {
  for (const key of ['h', 'i']) fireEvent.click(screen.getByTestId(`pk-key-${key}`))
  fireEvent.click(screen.getByTestId('message-review'))
  await waitFor(() => {
    expect(screen.getByTestId('message-text')).toBeTruthy()
  })
}

describe('MessageScreen', () => {
  /**
   * INV-UI-38. Reviewing never signs. Signing is a separate action that only
   * becomes available after the message has been rendered in full.
   */
  it('does-not-sign-when-reviewing', async () => {
    const { onSign } = setup()
    await reachReview()

    expect(onSign).not.toHaveBeenCalled()
    expect(screen.getByTestId('message-sign')).toBeTruthy()
    // And there is no sign button before a review exists.
    cleanup()
    setup()
    expect(screen.queryByTestId('message-sign')).toBeNull()
  })

  /**
   * INV-UI-38. The message is shown in full. Truncating it would be truncating
   * the thing being agreed to.
   */
  it('shows-the-whole-message-and-what-a-verifier-recomputes', async () => {
    const long = 'I agree to the following terms, at length, '.repeat(6)
    setup({ message: long, characters: long.length, bytes: long.length })
    await reachReview()

    expect(screen.getByTestId('message-text').textContent).toBe(long)
    const body = screen.getByTestId('message-screen').textContent
    expect(body).toContain(`${String(long.length)} characters`)
    // The commitment, so it can be checked against whoever asked. Rendered
    // abbreviated and chunked in fours, which is INV-UI-6: a full unbroken 64
    // characters gets skimmed, and a skimmed hash is worse than an abbreviated
    // one because it feels like it was read.
    const flat = body.replace(/\s+/g, '')
    expect(flat).toContain(HASH.slice(0, 8))
    expect(flat).toContain(HASH.slice(-8))
    expect(body).toContain('does not depend on your keys')
  })

  /**
   * INV-UI-39. A refusal blocks signing outright. There is no override here,
   * unlike the transaction screen: a message that cannot be displayed honestly
   * has no legitimate reason to be signed.
   */
  it('refuses-to-sign-a-message-the-review-rejected', async () => {
    setup({
      refusals: ['That message contains characters that can make it display differently.'],
    })
    await reachReview()

    expect(screen.getByTestId('message-refusal').textContent).toContain('display differently')
    expect(screen.getByTestId<HTMLButtonElement>('message-sign').disabled).toBe(true)
  })

  it('shows-warnings-without-blocking', async () => {
    setup({ warnings: ['This message is 3 lines. Read all of them before signing.'] })
    await reachReview()

    expect(screen.getByTestId('message-warning').textContent).toContain('3 lines')
    expect(screen.getByTestId<HTMLButtonElement>('message-sign').disabled).toBe(false)
  })

  /**
   * INV-UI-39. What leaves the device is the address, the message AND the
   * signature. A signature alone proves nothing and cannot be checked.
   */
  it('hands-over-everything-a-verifier-needs', async () => {
    setup()
    await reachReview()
    fireEvent.click(screen.getByTestId('message-sign'))

    await waitFor(() => {
      expect(screen.getByTestId('message-signed')).toBeTruthy()
    })

    const proof = screen.getByTestId<HTMLTextAreaElement>('message-proof').value
    const parsed = JSON.parse(proof) as Record<string, string>
    expect(parsed['address']).toBe('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu')
    expect(parsed['message']).toBe('Hello World')
    expect(parsed['signature']).toBe('AkcwRAIgAAAA')

    // And the screen says why all three are needed.
    expect(screen.getByTestId('message-signed').textContent).toContain('proves nothing')
    // The QR carries the same thing, since that is how it actually leaves.
    expect(screen.getByTestId('message-qr')).toBeTruthy()
  })

  /**
   * INV-UI-39, and it used to assert the defect.
   *
   * This required the screen to pass `m/49'/0'/0'/0/0`, which is the path the
   * screen used to build for itself with the coin type written out as a
   * literal 0. That is mainnet. On signet and testnet the coin type is 1, so
   * the screen asked for a signature on the mainnet branch and the device
   * produced a valid proof for an address the open wallet does not hold.
   *
   * The screen has no network and no way to learn one, so the assertion could
   * only ever have been about a constant it had no business knowing. What it
   * does know is which script type and which address the user picked, and that
   * is what it passes now. INV-MSG-15 covers the path the daemon derives from
   * them.
   */
  it('asks-for-the-script-type-and-address-the-user-chose', async () => {
    const { onSign } = setup()
    await reachReview()

    fireEvent.click(screen.getByTestId('message-script-p2sh-p2wpkh'))
    // No derivation path is promised before there is a signature, because this
    // screen has no network and cannot know one.
    expect(document.body.textContent).not.toContain("m/49'")

    // The second address, so the index is the user's choice rather than a
    // constant on the other side of the call.
    fireEvent.click(screen.getByTestId('message-index'))
    fireEvent.click(screen.getByTestId('message-sign'))

    await waitFor(() => {
      expect(onSign).toHaveBeenCalledWith('hi', 'p2sh-p2wpkh', 1)
    })
  })

  it('asks-for-the-first-address-by-default', async () => {
    const { onSign } = setup()
    await reachReview()

    fireEvent.click(screen.getByTestId('message-sign'))
    await waitFor(() => {
      expect(onSign).toHaveBeenCalledWith('hi', 'p2wpkh', 0)
    })
  })

  it('reports-a-failure-and-leaves-nothing-stale', async () => {
    const onReview = vi.fn().mockRejectedValue(new Error('That message is not readable.'))
    render(<MessageScreen onReview={onReview} onSign={vi.fn()} onBack={vi.fn()} />)

    fireEvent.click(screen.getByTestId('pk-key-a'))
    fireEvent.click(screen.getByTestId('message-review'))

    await waitFor(() => {
      expect(screen.getByTestId('message-error').textContent).toContain('not readable')
    })
    // No review rendered, so there is nothing to sign by mistake.
    expect(screen.queryByTestId('message-sign')).toBeNull()
  })
})
