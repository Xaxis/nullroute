/**
 * Tests for building a quorum on the device.
 *
 * Forming a multisig used to require software on a networked machine: the
 * device exported its key, somebody assembled a descriptor elsewhere, and the
 * device imported the result. For a fleet of air-gapped devices that made a
 * fourth computer mandatory to create the wallet the other three would then use
 * without one.
 *
 * Two things have to be right here. This device's own key is filled in rather
 * than typed, and building is not registering: the descriptor still goes
 * through the review that refuses a quorum this device holds no key in.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AssembleQuorumScreen } from '../src/screens/AssembleQuorumScreen.js'

afterEach(cleanup)

const OURS = '[73c5da0a/48h/0h/0h/2h]xpub6E64WfdQwBGz85XhbZryr9gU/<0;1>/*'
const THEIRS = '[aabbccdd/48h/0h/0h/2h]xpub6DwwuunwScQuscvvkT8Q2gRU/<0;1>/*'

function setup(overrides: Partial<React.ComponentProps<typeof AssembleQuorumScreen>> = {}) {
  const onOurKey = vi.fn().mockResolvedValue({ keyExpression: OURS, masterFingerprint: '73c5da0a' })
  const onAssemble = vi.fn(async (threshold: number, keys: readonly string[]) =>
    Promise.resolve({
      descriptor: `wsh(sortedmulti(${String(threshold)},${keys.join(',')}))#q35wkfm7`,
      checksum: 'q35wkfm7',
      threshold,
      total: keys.length,
      keys,
    })
  )
  const onReview = vi.fn()
  const onBack = vi.fn()
  render(
    <AssembleQuorumScreen
      onOurKey={onOurKey}
      onAssemble={onAssemble}
      onReview={onReview}
      onBack={onBack}
      {...overrides}
    />
  )
  return { onOurKey, onAssemble, onReview, onBack }
}

describe('AssembleQuorumScreen', () => {
  /**
   * INV-UI-79. This device's own key is filled in, not typed.
   *
   * Asking somebody to paste their own key into their own device is an
   * invitation to paste the wrong one, and a quorum without this device in it
   * is refused later anyway, after more work has been thrown away.
   */
  it('fills-in-this-devices-own-key', async () => {
    const { onOurKey } = setup()
    await waitFor(() => {
      expect(onOurKey).toHaveBeenCalled()
    })
    expect(screen.getByTestId('assemble-our-key').textContent).toContain('73c5da0a')
    // And it is not an editable field, so it cannot be replaced by accident.
    expect(screen.queryByTestId('assemble-key-0')).toBeNull()
  })

  /**
   * INV-UI-79. Building sends every filled key and the chosen threshold, and
   * shows the checksum with the space it deserves: it is what every device in
   * the quorum reads aloud to every other one.
   */
  it('builds-from-the-collected-keys-and-shows-the-checksum', async () => {
    const { onAssemble } = setup()
    await waitFor(() => {
      expect(screen.getByTestId('assemble-our-key')).toBeTruthy()
    })

    fireEvent.change(screen.getByTestId('assemble-key-1'), { target: { value: THEIRS } })
    fireEvent.click(screen.getByTestId('assemble-build'))

    await waitFor(() => {
      expect(onAssemble).toHaveBeenCalledWith(2, [OURS, THEIRS])
    })
    expect(screen.getByTestId('assemble-checksum').textContent).toContain('Checksum')
    // Chunked in fours by Hash, the same as the manifest root, because both
    // are values two people read to each other.
    expect(screen.getByTestId('assemble-checksum-value').textContent).toContain('q35w kfm7')
  })

  /**
   * INV-UI-80. Building is not registering, and the screen says so. The
   * dangerous act is agreeing to a quorum, and that still happens on the review
   * screen where a descriptor this device is not in gets refused.
   */
  it('does-not-register-and-says-so', async () => {
    const { onReview } = setup()
    await waitFor(() => {
      expect(screen.getByTestId('assemble-our-key')).toBeTruthy()
    })
    fireEvent.change(screen.getByTestId('assemble-key-1'), { target: { value: THEIRS } })
    fireEvent.click(screen.getByTestId('assemble-build'))
    await waitFor(() => {
      expect(screen.getByTestId('assemble-built')).toBeTruthy()
    })

    const said = screen.getByTestId('assemble-not-registered').textContent
    expect(said).toContain('Nothing is registered yet')
    expect(said).toContain('Every other cosigner has to register the same descriptor')

    fireEvent.click(screen.getByTestId('assemble-review'))
    expect(onReview).toHaveBeenCalledWith(expect.stringContaining('sortedmulti(2,'))
  })

  /**
   * INV-UI-80. The screen says the collection order does not matter, because
   * the checksum is what the fleet compares and a user who thinks order matters
   * will chase a difference that is not there.
   */
  it('says-the-order-keys-were-collected-in-does-not-matter', async () => {
    setup()
    await waitFor(() => {
      expect(screen.getByTestId('assemble-our-key')).toBeTruthy()
    })
    fireEvent.change(screen.getByTestId('assemble-key-1'), { target: { value: THEIRS } })
    fireEvent.click(screen.getByTestId('assemble-build'))
    await waitFor(() => {
      expect(screen.getByTestId('assemble-order-note')).toBeTruthy()
    })
    expect(screen.getByTestId('assemble-order-note').textContent).toContain(
      'order you collected the keys in does not matter'
    )
  })

  it('will-not-build-from-one-key', async () => {
    setup()
    await waitFor(() => {
      expect(screen.getByTestId('assemble-our-key')).toBeTruthy()
    })
    // Only ours is filled.
    expect(screen.getByTestId<HTMLButtonElement>('assemble-build').disabled).toBe(true)
  })

  it('adds-a-slot-and-drops-a-scanned-key-into-the-first-empty-one', async () => {
    const { onAssemble } = setup({ scanned: THEIRS })
    await waitFor(() => {
      expect(screen.getByTestId<HTMLTextAreaElement>('assemble-key-1').value).toBe(THEIRS)
    })

    fireEvent.click(screen.getByTestId('assemble-add-slot'))
    const third = '[11223344/48h/0h/0h/2h]xpub6DrJ8dVwHt9DDdyKKmSXwiRj/<0;1>/*'
    fireEvent.change(screen.getByTestId('assemble-key-2'), { target: { value: third } })

    fireEvent.click(screen.getByTestId('assemble-threshold-up'))
    fireEvent.click(screen.getByTestId('assemble-build'))
    await waitFor(() => {
      expect(onAssemble).toHaveBeenCalledWith(3, [OURS, THEIRS, third])
    })
  })

  /*
   * TWO scans, which is what building a 2-of-3 by camera actually is.
   *
   * The test above passes `scanned` at mount and then TYPES the third key, so
   * it never exercised a second trip to the camera. That trip unmounts this
   * screen, and the keys were local state, so every scan emptied the list: a
   * quorum could never hold more than this device plus one scanned key, and
   * the flow the screen exists for was impossible.
   *
   * The screen hands what it has to onScan, and takes it back through
   * initialKeys and initialThreshold. Here that round trip is performed by
   * hand, the way App does it.
   */
  it('keeps-the-keys-it-has-collected-across-a-scan', async () => {
    const onScan = vi.fn()
    setup({ scanned: THEIRS, onScan })
    await waitFor(() => {
      expect(screen.getByTestId<HTMLTextAreaElement>('assemble-key-1').value).toBe(THEIRS)
    })

    // Room for a third, then off to the camera for it.
    fireEvent.click(screen.getByTestId('assemble-add-slot'))
    fireEvent.click(screen.getByTestId('assemble-scan'))

    // What it handed over is what it was holding, not an empty list. The
    // threshold is still 2: raising it is correctly refused while the third
    // slot is empty, which is the constraint being carried across as well.
    expect(onScan).toHaveBeenCalledTimes(1)
    const collected = onScan.mock.calls[0]?.[0] as { keys: string[]; threshold: number }
    expect(collected.keys[1]).toBe(THEIRS)
    expect(collected.keys).toHaveLength(3)
    expect(collected.threshold).toBe(2)

    // Coming back from the camera with a third key, the way App remounts it.
    cleanup()
    const third = '[11223344/48h/0h/0h/2h]xpub6DrJ8dVwHt9DDdyKKmSXwiRj/<0;1>/*'
    const { onAssemble } = setup({
      scanned: third,
      initialKeys: collected.keys,
      initialThreshold: collected.threshold,
    })

    await waitFor(() => {
      expect(screen.getByTestId<HTMLTextAreaElement>('assemble-key-2').value).toBe(third)
    })
    // Cosigner two survived, which is the whole point.
    expect(screen.getByTestId<HTMLTextAreaElement>('assemble-key-1').value).toBe(THEIRS)

    // Now that all three are filled, the threshold can reach three.
    fireEvent.click(screen.getByTestId('assemble-threshold-up'))
    fireEvent.click(screen.getByTestId('assemble-build'))
    await waitFor(() => {
      expect(onAssemble).toHaveBeenCalledWith(3, [OURS, THEIRS, third])
    })
  })

  it('reports-a-refused-assembly', async () => {
    const onAssemble = vi
      .fn()
      .mockRejectedValue(new Error('Keys 1 and 2 are the same extended key.'))
    setup({ onAssemble })
    await waitFor(() => {
      expect(screen.getByTestId('assemble-our-key')).toBeTruthy()
    })
    fireEvent.change(screen.getByTestId('assemble-key-1'), { target: { value: OURS } })
    fireEvent.click(screen.getByTestId('assemble-build'))

    await waitFor(() => {
      expect(screen.getByTestId('assemble-error').textContent).toContain('same extended key')
    })
    expect(screen.queryByTestId('assemble-built')).toBeNull()
  })
})

/**
 * The threshold cannot exceed the keys collected.
 *
 * Found by looking at the screen rather than by a test: it opened reading
 * "2 of 1", because the default threshold is 2 and only this device's key is
 * present at that moment. That is the first thing somebody sees on a screen
 * whose whole job is getting a quorum right.
 */
describe('AssembleQuorumScreen threshold', () => {
  it('never-shows-a-threshold-larger-than-the-keys-collected', async () => {
    render(
      <AssembleQuorumScreen
        onOurKey={vi.fn().mockResolvedValue({ keyExpression: OURS, masterFingerprint: '73c5da0a' })}
        onAssemble={vi.fn()}
        onReview={vi.fn()}
        onBack={vi.fn()}
      />
    )
    await waitFor(() => {
      expect(screen.getByTestId('assemble-our-key')).toBeTruthy()
    })

    // One key present, so one of one. Never "2 of 1".
    expect(screen.getByTestId('assemble-threshold').textContent).toBe('1 of 1')
    expect(screen.getByTestId('assemble-count').textContent).toBe('1 of 1')

    fireEvent.change(screen.getByTestId('assemble-key-1'), { target: { value: THEIRS } })
    // The stored 2 comes back once there are two keys to satisfy it, rather
    // than the user having to set it again.
    expect(screen.getByTestId('assemble-threshold').textContent).toBe('2 of 2')
  })

  it('builds-with-the-clamped-threshold-not-the-stored-one', async () => {
    const onAssemble = vi.fn(async (threshold: number, keys: readonly string[]) =>
      Promise.resolve({
        descriptor: 'wsh(sortedmulti(2,a,b))#q35wkfm7',
        checksum: 'q35wkfm7',
        threshold,
        total: keys.length,
        keys,
      })
    )
    render(
      <AssembleQuorumScreen
        onOurKey={vi.fn().mockResolvedValue({ keyExpression: OURS, masterFingerprint: '73c5da0a' })}
        onAssemble={onAssemble}
        onReview={vi.fn()}
        onBack={vi.fn()}
      />
    )
    await waitFor(() => {
      expect(screen.getByTestId('assemble-our-key')).toBeTruthy()
    })
    fireEvent.change(screen.getByTestId('assemble-key-1'), { target: { value: THEIRS } })
    fireEvent.click(screen.getByTestId('assemble-build'))

    await waitFor(() => {
      expect(onAssemble).toHaveBeenCalledWith(2, [OURS, THEIRS])
    })
  })
})
