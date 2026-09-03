import { type Transaction } from '@scure/btc-signer'

/**
 * An input's locking script, from whichever UTXO field the PSBT carries it in.
 *
 * A segwit input states its own script in `witnessUtxo`. A legacy input instead
 * carries the whole previous transaction, and the script is the one on the
 * output being spent. Undefined means the PSBT did not say, in which case the
 * device cannot tell whose input it is and treats it as not ours. That is the
 * safe direction: refusing to sign something unidentifiable beats guessing.
 */
export function inputScript(tx: Transaction, i: number): Uint8Array | undefined {
  const input = tx.getInput(i)
  const witnessUtxo: unknown = input.witnessUtxo
  if (witnessUtxo !== undefined && witnessUtxo !== null) {
    const script: unknown = (witnessUtxo as { script?: unknown }).script
    if (script instanceof Uint8Array) return script
  }
  const nonWitness: unknown = input.nonWitnessUtxo
  if (nonWitness !== undefined && nonWitness !== null) {
    const outputs: unknown = (nonWitness as { outputs?: unknown }).outputs
    const vout: unknown = input.index
    if (Array.isArray(outputs) && typeof vout === 'number') {
      const out: unknown = outputs[vout]
      const script: unknown = (out as { script?: unknown } | undefined)?.script
      if (script instanceof Uint8Array) return script
    }
  }
  return undefined
}
