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
import { WalletScreen } from '../src/screens/WalletScreen.js'

afterEach(() => {
  cleanup()
})

const ADDRESS = 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3'
const QUORUMS = [
  { checksum: '8rf6pq2t', threshold: 2, total: 3, descriptor: 'wsh(sortedmulti(...))#8rf6pq2t' },
]

function open(overrides: Record<string, unknown> = {}) {
  const onAddress = vi
    .fn()
    .mockResolvedValue({ address: ADDRESS, path: "m/84'/0'/0'/0/0", index: 0 })
  const onQuorumAddress = vi
    .fn()
    .mockResolvedValue({ address: ADDRESS, path: 'quorum index 0', index: 0 })
  const onVerify = vi.fn().mockResolvedValue({ found: true, path: "m/84'/0'/0'/0/0" })
  const onVerifyQuorum = vi.fn().mockResolvedValue({ found: true, index: 0 })

  render(
    <ReceiveScreen
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
    expect(warning).toContain('what the quorum prevents')
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
    expect(screen.getByTestId('receive-verified').textContent).toContain('belongs to the quorum')
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

/**
 * The same confusion, one screen over.
 *
 * The Addresses tab is a reference view rather than the one labelled Receive,
 * so a note is the proportionate fix rather than a choice. What it must not do
 * is show a column of this device's own addresses to somebody holding a quorum
 * without saying whose they are.
 */
describe('WalletScreen addresses on a device holding a quorum', () => {
  const QUORUM = {
    descriptor: 'wsh(sortedmulti(...))#8rf6pq2t',
    checksum: '8rf6pq2t',
    threshold: 2,
    total: 3,
    ourPosition: 1,
    cosigners: [],
    unreadable: null,
  }

  function openWallet(quorums: readonly (typeof QUORUM)[]) {
    render(
      <WalletScreen
        fingerprint="73c5da0a"
        quorums={quorums}
        onAddresses={async () =>
          Promise.resolve({
            addresses: [{ address: ADDRESS, path: "m/84'/0'/0'/0/0", index: 0 }],
          })
        }
        onDescriptor={async () => Promise.resolve({ descriptor: 'x', checksum: 'y' })}
        onXpub={async () =>
          Promise.resolve({ xpub: 'xpub', path: "m/84'/0'/0'", masterFingerprint: '73c5da0a' })
        }
        onVerifyAddress={async () => Promise.resolve({ found: true })}
      />
    )
  }

  /** INV-UI-88. Said where somebody could otherwise take the wrong address. */
  it('says-these-are-not-the-quorum-s-addresses', async () => {
    openWallet([QUORUM])
    await waitFor(() => screen.getByTestId('addresses-not-the-quorum'))
    // Both halves of the claim, because the note was shortened to one line and
    // an assertion on a fragment would have passed on half a warning.
    const note = screen.getByTestId('addresses-not-the-quorum').textContent
    expect(note).toContain('own key alone can spend these')
    expect(note).toContain('Receive')
  })

  /** INV-UI-88. And not said on a device where there is nothing to confuse. */
  it('says-nothing-on-a-device-that-is-in-no-quorum', () => {
    openWallet([])
    expect(screen.queryByTestId('addresses-not-the-quorum')).toBeNull()
  })
})

/**
 * Tests for what a quorum device tells you to back up.
 *
 * THE LOSS THIS PREVENTS is not theoretical and is not recoverable. A 2-of-3
 * cannot be reconstructed from mnemonics alone: holding all three seed phrases
 * is not enough, because you also need the other keys, the threshold and the
 * script type, and none of that is derivable from a seed. That is what the
 * descriptor records.
 *
 * The export tab said, under a single-signature descriptor, that it "makes this
 * wallet recoverable without nullroute". On a quorum device that sentence is
 * false, and somebody acting on it would find out at the worst possible moment.
 */
describe('WalletScreen export on a device holding a quorum', () => {
  const QUORUM = {
    descriptor: 'wsh(sortedmulti(2,[73c5da0a/48h]xpubA,[aabbccdd/48h]xpubB))#8rf6pq2t',
    checksum: '8rf6pq2t',
    threshold: 2,
    total: 3,
    ourPosition: 1,
    cosigners: [],
    unreadable: null,
  }

  async function openExport(quorums: readonly (typeof QUORUM)[]) {
    render(
      <WalletScreen
        fingerprint="73c5da0a"
        quorums={quorums}
        onAddresses={async () => Promise.resolve({ addresses: [] })}
        onDescriptor={async () =>
          Promise.resolve({
            descriptor: 'wpkh([73c5da0a/84h]xpubC/<0;1>/*)#aaaaaaaa',
            checksum: 'aaaaaaaa',
          })
        }
        onXpub={async () =>
          Promise.resolve({ xpub: 'xpub', path: "m/84'/0'/0'", masterFingerprint: '73c5da0a' })
        }
        onVerifyAddress={async () => Promise.resolve({ found: true })}
      />
    )
    fireEvent.click(screen.getByTestId('tab-export'))
    await waitFor(() => screen.getByTestId('descriptor'))
  }

  /**
   * INV-UI-89. The quorum descriptor is offered, and named as the thing to
   * back up, on the screen where somebody goes to back something up.
   */
  it('offers-the-quorum-descriptor-as-the-thing-to-back-up', async () => {
    await openExport([QUORUM])

    const block = screen.getByTestId('export-quorum')
    expect(block.textContent).toContain('Back this up: your quorum')
    expect(block.textContent).toContain('mnemonics are not enough')
    expect(screen.getByTestId('export-quorum-descriptor').textContent).toBe(QUORUM.descriptor)
  })

  /**
   * INV-UI-89. And the single-signature one stops claiming to be the wallet.
   * That sentence is the one somebody would have acted on.
   */
  it('stops-calling-the-single-signature-descriptor-the-recoverable-wallet', async () => {
    await openExport([QUORUM])
    const page = document.body.textContent

    expect(page).toContain('This device alone, not the quorum')
    expect(page).toContain('backing it up does not back your quorum up')
    expect(page).not.toContain('makes this wallet recoverable')
  })

  /** INV-UI-89. Unchanged on a device that holds no quorum. */
  it('says-what-it-always-said-on-a-single-signature-device', async () => {
    await openExport([])
    const page = document.body.textContent

    expect(screen.queryByTestId('export-quorum')).toBeNull()
    expect(page).toContain('makes this wallet recoverable')
  })
})
