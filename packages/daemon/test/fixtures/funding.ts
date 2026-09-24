/**
 * An input funded by a real previous transaction, for PSBT fixtures.
 *
 * A segwit v0 input whose PSBT carries only the witness UTXO has an amount
 * the device cannot check, and review blocks it (SP-REV-3): that is the BIP-174
 * fee attack. Real coordinators include the previous transaction, so fixtures
 * do too. The txid is computed from that transaction, which is what the PSBT
 * library checks it against.
 *
 * `salt` makes two inputs with the same script and amount spend different
 * transactions rather than the same outpoint twice.
 */

import * as btc from '@scure/btc-signer'

export function fundedBy(
  script: Uint8Array,
  amount: bigint,
  salt = 0
): {
  txid: string
  index: number
  witnessUtxo: { script: Uint8Array; amount: bigint }
  nonWitnessUtxo: Uint8Array
} {
  const previous = new btc.Transaction()
  previous.addInput({ txid: new Uint8Array(32).fill(salt + 1), index: 0 })
  previous.addOutput({ script, amount })
  return {
    txid: previous.id,
    index: 0,
    witnessUtxo: { script, amount },
    nonWitnessUtxo: previous.toBytes(true, false),
  }
}
