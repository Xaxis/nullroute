/**
 * Tests for which wallet a receive address is actually for.
 *
 * THE BUG THESE EXIST FOR. This screen derived a single-signature address and
 * nothing else. On a device holding a registered 2-of-3, tapping Receive
 * produced an address spendable by that one device: money protected by one key
 * instead of two, which is precisely what the quorum was set up to prevent, and
 * nothing on the screen said which kind of address it was showing.
 *
 * So the quorum is the default, the single-signature choice is deliberate and
 * says what it costs, and the address is verified against whichever thing it
 * actually came from. That last one matters more than it looks: asking whether
 * a quorum address derives from this device alone answers no, correctly, about
 * something that is not wrong, and a screen shouting about it would teach
 * somebody to ignore its only alarm.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReceiveScreen } from '../src/screens/ReceiveScreen.js'

afterEach(() => {
  cleanup()
})

const ADDRESS = 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3'
const QUORUMS = [{ checksum: '8rf6pq2t', threshold: 2, total: 3, descriptor: 'wsh(sortedmulti(...))#8rf6pq2t' }]

function open(overrides: Record<string, unknown> = {}) {
  const onAddress = vi.fn().mockResolvedValue({ address: ADDRESS, path: "m/84'/0'/0'/0/0", index: 0 })
  const onQuorumAddress = vi
    .fn()
    .mockResolvedValue({ address: ADDRESS, path: 'quorum index 0', index: 0 })
  const onVerify = vi.fn().mockResolvedValue({ found: true, path: "m/84'/0'/0'/0/0" })
  const onVerifyQuorum = vi.fn().mockResolvedValue({ found: true, index: 0 })

  render(
    <ReceiveScreen
      walletLabel="Cold storage"
      quorums={QUORUMS}
      onAddress={onAddress}
      onQuorumAddress={onQuorumAddress}
      onVerify={onVerify}
      onVerifyQuorum={onVerifyQuorum}
      onBack={() => undefined}
      {...overrides}
    />
  )
  return { onAddress, onQuorumAddress, onVerify, onVerifyQuorum }
}

describe('ReceiveScreen on a device holding a quorum', () => {
  /**
   * INV-UI-88. The quorum is the default. A device that has been through
   * registration is one somebody set up a quorum on, and defaulting to the
   * single-signature address there is defaulting to the weaker answer
   * silently.
   */
  it('derives-the-quorum-address-rather-than-this-device-s-own', async () => {
    const { onAddress, onQuorumAddress } = open()
    await waitFor(() => screen.getByTestId('receive-address'))

    expect(onQuorumAddress).toHaveBeenCalledWith(QUORUMS[0]?.descriptor, 0)
    expect(onAddress).not.toHaveBeenCalled()
    expect(screen.getByTestId('receive-quorum-note').textContent).toContain('8rf6pq2t')
  })

  /**
   * INV-UI-88. Choosing this device alone is allowed and says what it costs.
   * Whoever holds one device can spend anything sent there.
   */
  it('says-what-the-single-signature-choice-costs', async () => {
    const { onAddress } = open()
    await waitFor(() => screen.getByTestId('receive-address'))

    fireEvent.click(screen.getByTestId('receive-source-single'))
    await waitFor(() => screen.getByTestId('receive-single-warning'))

    expect(onAddress).toHaveBeenCalled()
    const warning = screen.getByTestId('receive-single-warning').textContent
    expect(warning).toContain('protected by this device alone')
    expect(warning).toContain('the thing the quorum was set up to prevent')
  })

  /**
   * INV-UI-88. The address is checked against whatever produced it. Asking the
   * single-signature verifier about a quorum address answers no about
   * something correct, and the screen would shout.
   */
  it('checks-a-quorum-address-against-the-descriptor-not-against-this-device', async () => {
    const { onVerify, onVerifyQuorum } = open()
    await waitFor(() => screen.getByTestId('receive-address'))

    fireEvent.click(screen.getByTestId('receive-verify'))
    await waitFor(() => screen.getByTestId('receive-verified'))

    expect(onVerifyQuorum).toHaveBeenCalledWith(QUORUMS[0]?.descriptor, ADDRESS)
    expect(onVerify).not.toHaveBeenCalled()
    expect(screen.getByTestId('receive-verified').textContent).toContain(
      'belongs to the quorum'
    )
  })

  /**
   * INV-UI-88. A device in no quorum has one answer, and a tab bar with one
   * tab is furniture on a panel with none to spare.
   */
  it('offers-no-choice-on-a-device-that-is-in-no-quorum', async () => {
    open({ quorums: [] })
    await waitFor(() => screen.getByTestId('receive-address'))

    expect(screen.queryByTestId('receive-sources')).toBeNull()
    expect(screen.queryByTestId('receive-single-warning')).toBeNull()
  })

  /**
   * INV-UI-88. A build that cannot derive a quorum address REFUSES rather than
   * falling back. Handing somebody the weaker address at the moment they were
   * told they were getting the stronger one is the failure that matters here.
   */
  it('refuses-rather-than-quietly-showing-the-weaker-address', async () => {
    const { onAddress } = open({ onQuorumAddress: undefined })
    await waitFor(() => screen.getByTestId('receive-error'))

    expect(onAddress).not.toHaveBeenCalled()
    expect(screen.getByTestId('receive-error').textContent).toContain(
      'Do not use the single-signature address'
    )
    expect(screen.queryByTestId('receive-address')).toBeNull()
  })
})
