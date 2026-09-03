/**
 * Tests for the one place that dispatches on a quorum's script kind.
 *
 * WHY IT IS ONE PLACE. Taproot quorums and the older kinds derive through
 * different functions, and the branch had been written out four times: the
 * owned index, the registration smoke test, and eventually the two IPC methods
 * that show a user an address. The IPC methods were written without it.
 *
 * A taproot quorum could then be registered, signed for and recognised as
 * change, and never displayed. Nothing was wrong with either derivation. What
 * was wrong was that a rule everybody had to remember was remembered in three
 * places out of five.
 */

import { describe, expect, it } from 'vitest'
import {
  deriveAccountXpub,
  deriveMultisigAddresses,
  deriveQuorumAddresses,
  deriveTaprootAddresses,
  mnemonicToSeed,
  networkById,
  parseDescriptor,
  withChecksum,
} from '../src/index.js'

const NETWORK = networkById('regtest')
const NUMS = '50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0'
const MNEMONICS = [
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  'legal winner thank year wave sausage worth useful legal winner thank yellow',
]

/** Any account path: what is under test is the dispatch, not the derivation. */
const PATH = "m/48'/1'/0'/2'"

function keys(): string[] {
  return MNEMONICS.map((mnemonic) => {
    using seed = mnemonicToSeed(mnemonic, '')
    const account = deriveAccountXpub(seed, NETWORK, PATH)
    return `[${account.masterFingerprint}${PATH.slice(1)}]${account.xpub}/<0;1>/*`
  })
}

describe('core.descriptor.quorum-addresses', () => {
  /**
   * INV-DESC-8. The same answer the wsh function gives, so routing through the
   * dispatch cannot change what an existing quorum derives.
   */
  it('agrees-with-the-multisig-function-for-a-wsh-quorum', () => {
    const descriptor = parseDescriptor(withChecksum(`wsh(sortedmulti(2,${keys().join(',')}))`))
    const options = { network: NETWORK, change: false, start: 0, count: 3 }

    expect(deriveQuorumAddresses(descriptor, options).map((entry) => entry.address)).toEqual(
      deriveMultisigAddresses(descriptor, options).map((entry) => entry.address)
    )
  })

  /**
   * INV-DESC-8. And the taproot function for a taproot quorum, which is the
   * case every un-dispatched call site got wrong.
   */
  it('agrees-with-the-taproot-function-for-a-taproot-quorum', () => {
    const descriptor = parseDescriptor(
      withChecksum(`tr(${NUMS},sortedmulti_a(2,${keys().join(',')}))`)
    )
    const options = { network: NETWORK, change: false, start: 0, count: 3 }

    expect(deriveQuorumAddresses(descriptor, options).map((entry) => entry.address)).toEqual(
      deriveTaprootAddresses(descriptor, options).map((entry) => entry.address)
    )
  })

  /**
   * INV-DESC-8. The two kinds must not derive the same addresses. If they did,
   * every test above would pass while the dispatch did nothing.
   */
  it('derives-genuinely-different-addresses-for-the-two-kinds', () => {
    const options = { network: NETWORK, change: false, start: 0, count: 3 }
    const wsh = deriveQuorumAddresses(
      parseDescriptor(withChecksum(`wsh(sortedmulti(2,${keys().join(',')}))`)),
      options
    )
    const tr = deriveQuorumAddresses(
      parseDescriptor(withChecksum(`tr(${NUMS},sortedmulti_a(2,${keys().join(',')}))`)),
      options
    )

    expect(wsh[0]?.address).not.toBe(tr[0]?.address)
    expect(wsh[0]?.address.startsWith('bcrt1q')).toBe(true)
    expect(tr[0]?.address.startsWith('bcrt1p')).toBe(true)
  })

  /**
   * INV-DESC-8. The change branch too, since that is what change detection
   * asks for and getting it wrong makes a wallet blind to its own money.
   */
  it('derives-the-change-branch-for-both-kinds', () => {
    for (const text of [
      withChecksum(`wsh(sortedmulti(2,${keys().join(',')}))`),
      withChecksum(`tr(${NUMS},sortedmulti_a(2,${keys().join(',')}))`),
    ]) {
      const descriptor = parseDescriptor(text)
      const receive = deriveQuorumAddresses(descriptor, {
        network: NETWORK,
        change: false,
        start: 0,
        count: 1,
      })
      const change = deriveQuorumAddresses(descriptor, {
        network: NETWORK,
        change: true,
        start: 0,
        count: 1,
      })
      expect(change[0]?.address).not.toBe(receive[0]?.address)
    }
  })

  /**
   * INV-DESC-8. A descriptor that is not a quorum is refused by the function
   * that knows why, rather than by a third vaguer message written here.
   */
  it('refuses-a-single-signature-descriptor-through-the-underlying-error', () => {
    const single = parseDescriptor(withChecksum(`wpkh(${keys()[0] ?? ''})`))
    expect(() => deriveQuorumAddresses(single, { network: NETWORK, start: 0, count: 1 })).toThrow(
      /not a multisig one/
    )
  })
})
