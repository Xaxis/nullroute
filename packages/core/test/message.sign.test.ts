/**
 * Tests for the BIP-322 to_spend transaction.
 *
 * The txid is the whole test. BIP-322 publishes it for a known address and the
 * empty message, and `to_sign` references it, so a single wrong byte anywhere in
 * the construction, the version, the impossible outpoint, the commitment, the
 * sequence, the zero value, produces a different one and a proof nobody can
 * verify.
 *
 * WHY THERE IS NO SIGNING TEST HERE. There was a signing implementation. It
 * produced witnesses of the right shape, deterministically, for the right
 * address. It could not be shown to verify against a BIP-143 digest computed by
 * bitcoinjs-lib, and a message signature that only this device accepts proves
 * nothing to the person asking for it. It was removed rather than shipped, and
 * this comment is here so the next person does not assume the absence is an
 * oversight.
 */

import { describe, expect, it } from 'vitest'
import * as btc from '@scure/btc-signer'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { buildToSpend } from '../src/message/sign.js'

/** The address and to_spend txid BIP-322 publishes, verbatim. */
const VECTOR_ADDRESS = 'bc1q9vza2e8x573nczrlzms0wvx3gsqjx7vavgkx0l'
const VECTOR_TO_SPEND_TXID =
  'c5680aa69bb8d860bf82d4e9cd3504b55dde018de765a91bb566283c545a99a7'

function scriptFor(address: string): Uint8Array {
  return btc.OutScript.encode(btc.Address(btc.NETWORK).decode(address))
}

describe('core.message.bip322 to_spend', () => {
  /**
   * INV-MSG-5. The published txid.
   *
   * The strongest check available for this construction: it is somebody else's
   * number, it covers every byte, and it cannot be matched by an implementation
   * that got any field wrong.
   */
  it('matches-the-published-to_spend-txid', () => {
    const id = sha256(sha256(buildToSpend('', scriptFor(VECTOR_ADDRESS))))
    // Reversed, because a txid is displayed in the opposite order to the way it
    // is hashed, and the document prints the displayed form.
    expect(bytesToHex(Uint8Array.from([...id].reverse()))).toBe(VECTOR_TO_SPEND_TXID)
  })

  it('builds-every-field-the-standard-fixes', () => {
    const hex = bytesToHex(buildToSpend('', scriptFor(VECTOR_ADDRESS)))

    // Version 0, one input, the outpoint no transaction can have.
    expect(hex.startsWith(`0000000001${'00'.repeat(32)}ffffffff`)).toBe(true)
    // OP_0 PUSH32 then the tagged hash of the empty message.
    expect(hex).toContain(
      '220020c90c269c4f8fcbe6880f72a721ddfbf1914268a794cbb21cfafee13770ae19f1'
    )
    // One output of zero satoshis, and locktime 0.
    expect(hex).toContain(`01${'00'.repeat(8)}`)
    expect(hex.endsWith('00000000')).toBe(true)
  })

  /**
   * The commitment is inside the transaction, so two messages give two
   * different to_spend transactions and therefore two different outpoints for
   * to_sign. That is what stops a proof over one message being replayed as a
   * proof over another.
   */
  it('commits-to-the-message-in-the-transaction-itself', () => {
    const script = scriptFor(VECTOR_ADDRESS)
    const a = bytesToHex(buildToSpend('one', script))
    const b = bytesToHex(buildToSpend('two', script))

    expect(a).not.toBe(b)
    // Same length: only the committed hash differs.
    expect(a.length).toBe(b.length)
  })

  /**
   * The address is part of the commitment too, so the same message under two
   * addresses is two different transactions. A proof is about one address.
   */
  it('commits-to-the-address-as-well-as-the-message', () => {
    const a = bytesToHex(buildToSpend('same', scriptFor(VECTOR_ADDRESS)))
    const b = bytesToHex(
      buildToSpend('same', scriptFor('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'))
    )
    expect(a).not.toBe(b)
  })

  it('is-deterministic', () => {
    const script = scriptFor(VECTOR_ADDRESS)
    expect(bytesToHex(buildToSpend('Hello World', script))).toBe(
      bytesToHex(buildToSpend('Hello World', script))
    )
  })
})
