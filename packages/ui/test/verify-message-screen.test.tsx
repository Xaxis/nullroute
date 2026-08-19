/**
 * Tests for the screen that checks somebody else's proof.
 *
 * The verification is arithmetic and is tested in core. What is checked here is
 * what a person is told, and the two that matter are opposite dangers: a pass
 * must not be read as "this person is who they say they are", and a failure
 * must not be read as an accusation when the commonest cause by far is a
 * message that differs by one character.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { VerifyMessageScreen } from '../src/screens/VerifyMessageScreen.js'

afterEach(() => {
  cleanup()
})

const PROOF = {
  address: 'bc1ppv609nr0vr25u07u95waq5lucwfm6tde4nydujnu8npg4q75mr5sxq8lt3',
  message: 'I control this address.',
  signature: 'AUDjpClYFHngjnqQ3F0=',
}

describe('VerifyMessageScreen', () => {
  /**
   * INV-UI-86. A pass says what it proves AND what it does not. A green tick a
   * user reads as "this person is who they say" is a worse outcome than no
   * check at all, because it was arrived at deliberately.
   */
  it('says-what-a-pass-does-not-prove', async () => {
    render(
      <VerifyMessageScreen
        scannedProof={PROOF}
        onVerify={async () => Promise.resolve({ valid: true, scriptType: 'p2tr' })}
        onBack={() => undefined}
      />
    )
    fireEvent.click(screen.getByTestId('verify-run'))
    await waitFor(() => screen.getByTestId('verify-result'))

    const text = screen.getByTestId('verify-result').textContent
    expect(text).toContain('The proof checks out')
    expect(text).toContain('does not say when')
    expect(text).toContain('the person who gave it to you')
  })

  /**
   * INV-UI-86. A failure names the usual cause. Without this the screen reads
   * as an accusation, and the commonest reason by a wide margin is a trailing
   * space or a smart quote.
   */
  it('points-at-the-message-before-the-other-party', async () => {
    render(
      <VerifyMessageScreen
        scannedProof={PROOF}
        onVerify={async () =>
          Promise.resolve({ valid: false, scriptType: 'p2tr', reason: 'It does not match.' })
        }
        onBack={() => undefined}
      />
    )
    fireEvent.click(screen.getByTestId('verify-run'))
    await waitFor(() => screen.getByTestId('verify-usual-cause'))

    expect(screen.getByTestId('verify-result').textContent).toContain('It does not match.')
    expect(screen.getByTestId('verify-usual-cause').textContent).toContain(
      'The commonest cause is the message, not the signature'
    )
  })

  /**
   * INV-UI-86. One scan fills all three. Typing an address, a message and a
   * base64 signature on a panel with no keyboard is a screen nobody uses twice.
   */
  it('fills-every-field-from-one-scanned-proof', () => {
    render(
      <VerifyMessageScreen
        scannedProof={PROOF}
        onVerify={async () => Promise.resolve({ valid: true, scriptType: 'p2tr' })}
        onBack={() => undefined}
      />
    )
    // Every tab says it holds something, and the check button is live.
    for (const field of ['address', 'message', 'signature']) {
      expect(screen.getByTestId(`verify-tab-${field}`).textContent).toMatch(/ set$/)
    }
    expect(screen.getByTestId<HTMLButtonElement>('verify-run').disabled).toBe(false)
  })

  /**
   * INV-UI-86. A result about a field that has since changed is a result about
   * something no longer on the screen.
   */
  it('drops-a-result-when-a-field-is-edited-under-it', async () => {
    render(
      <VerifyMessageScreen
        scannedProof={PROOF}
        onVerify={async () => Promise.resolve({ valid: true, scriptType: 'p2tr' })}
        onBack={() => undefined}
      />
    )
    fireEvent.click(screen.getByTestId('verify-run'))
    await waitFor(() => screen.getByTestId('verify-result'))

    // Any key on the on-screen keyboard counts as editing the active field.
    fireEvent.click(screen.getByTestId('verify-tab-message'))
    const key = screen.getByTestId('verify-keyboard').querySelector('button')
    if (key === null) throw new Error('the keyboard rendered no keys')
    fireEvent.click(key)

    expect(screen.queryByTestId('verify-result')).toBeNull()
  })

  /**
   * INV-UI-86. A verification that failed to RUN is not a verification that
   * failed, and showing the second for the first is how somebody rejects a
   * good proof.
   */
  it('separates-a-check-that-could-not-run-from-one-that-failed', async () => {
    render(
      <VerifyMessageScreen
        scannedProof={PROOF}
        onVerify={async () => Promise.reject(new Error('the daemon went away'))}
        onBack={() => undefined}
      />
    )
    fireEvent.click(screen.getByTestId('verify-run'))
    await waitFor(() => screen.getByTestId('verify-error'))

    expect(screen.getByTestId('verify-error').textContent).toContain('Could not check it')
    expect(screen.queryByTestId('verify-result')).toBeNull()
  })
})
