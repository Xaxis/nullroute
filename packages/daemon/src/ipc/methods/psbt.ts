/**
 * Reviewing a transaction and signing it.
 *
 * Two methods, and the review is much the larger: it is what a person reads
 * before authorising a spend, and every field on it exists because something
 * about a transaction is not visible from the amount alone.
 *
 * One of thirteen tables that make up the IPC surface. See ipc/context.ts for
 * why they are tables rather than one switch.
 */

import { buildOwnedIndex, changeLookup, signingPathsFor } from '../../psbt.js'
import {
  encodePsbt,
  formatBtc,
  parsePsbt,
  reviewTransaction,
  signTransaction,
} from '@nullroute/core'
import { inputScript } from '../input-script.js'
import { params, requireString, requireNumber } from '../params.js'
import { type HandlerContext, type MethodTable } from '../context.js'

export function psbtMethods(ctx: HandlerContext): MethodTable {
  const { session, whoStillHasToSign, activeWallet } = ctx

  return {
    /**
     * Review a transaction. Reads nothing, signs nothing, changes nothing.
     *
     * Kept separate from signing on purpose. The user has to be able to look
     * at a transaction and walk away, and a combined method would mean the
     * act of looking carried the risk of signing.
     *
     * Every amount crosses this boundary as a decimal STRING. Satoshi amounts
     * are bigint in core because 21 million BTC in satoshis exceeds what a
     * double holds exactly, and `JSON.stringify` cannot serialise a bigint at
     * all. Converting to Number here would silently reintroduce the very
     * rounding the bigint exists to prevent, on the screen the user checks
     * before approving a payment.
     */
    'psbt.review': (request) => {
      const tx = parsePsbt(requireString(request, 'psbt'))
      const index = buildOwnedIndex(session.requireSeed(), session.network, {
        gapLimit: requireNumber(request, 'gapLimit', 100),
        registrations: session.registrations,
      })
      const review = reviewTransaction(tx, {
        network: session.network,
        isChange: changeLookup(index),
      })

      return {
        signable: review.signable,
        replaceable: review.replaceable,
        locktime: review.locktime,
        // Before signing, not after. A user on the second device of a 2-of-3
        // needs to know they are the last signature, or that they are not,
        // while deciding whether to sign at all.
        signatures: review.signatures,
        network: {
          id: review.network.id,
          label: review.network.label,
          isMainnet: review.network.isMainnet,
        },
        sighash: {
          type: review.sighash.type,
          name: review.sighash.name,
          meaning: review.sighash.meaning,
          acceptable: review.sighash.acceptable,
        },
        fee: {
          feeSats: review.fee.feeSats.toString(),
          feeBtc: formatBtc(review.fee.feeSats),
          totalInSats: review.fee.totalInSats.toString(),
          totalOutSats: review.fee.totalOutSats.toString(),
          vsize: review.fee.vsize,
          satsPerVbyte: review.fee.satsPerVbyte,
          percentOfSpend: review.fee.percentOfSpend,
        },
        inputs: review.inputs.map((i) => ({
          index: i.index,
          txid: i.txid,
          vout: i.vout,
          amountSats: i.amountSats.toString(),
          amountBtc: formatBtc(i.amountSats),
          sighashType: i.sighashType ?? null,
          derivationPath: i.derivationPath ?? null,
        })),
        outputs: review.outputs.map((o) => ({
          index: o.index,
          address: o.address ?? null,
          // The user's own note about this address, if a label file gave one.
          // Attached here rather than in core, because core has no idea what
          // a label is and should not learn: a label decides nothing about
          // whether an output is change, which is decided by re-deriving it.
          label:
            o.address === undefined
              ? null
              : (session.labels.find((entry) => entry.type === 'addr' && entry.ref === o.address)
                  ?.label ?? null),
          amountSats: o.amountSats.toString(),
          amountBtc: formatBtc(o.amountSats),
          kind: o.kind,
          changePath: o.changePath ?? null,
          changeRejectedBecause: o.changeRejectedBecause ?? null,
        })),
        warnings: review.warnings.map((w) => ({
          kind: w.kind,
          message: w.message,
          blocking: w.blocking,
        })),
        /** Which inputs this device can actually sign. Zero is not an error. */
        ownedInputs: signingPathsFor(
          Array.from({ length: tx.inputsLength }, (_, i) => inputScript(tx, i)),
          index,
          session.network
        ).length,
      }
    },

    /**
     * Sign. The irreversible one.
     *
     * The transaction is reviewed again here, from the same bytes, rather
     * than trusting a verdict the caller passed back. A caller that could
     * hand in its own review could sign anything, which would make every
     * check in review.ts advisory.
     */
    'psbt.sign': (request) => {
      const tx = parsePsbt(requireString(request, 'psbt'))
      const seed = session.requireSeed()
      const index = buildOwnedIndex(seed, session.network, {
        gapLimit: requireNumber(request, 'gapLimit', 100),
        registrations: session.registrations,
      })
      const review = reviewTransaction(tx, {
        network: session.network,
        isChange: changeLookup(index),
      })

      const paths = signingPathsFor(
        Array.from({ length: tx.inputsLength }, (_, i) => inputScript(tx, i)),
        index,
        session.network
      )
      if (paths.length === 0) {
        throw new Error(
          'None of this transaction’s inputs belong to this wallet, so there is ' +
            'nothing here for this device to sign.'
        )
      }

      const result = signTransaction(tx, seed, {
        network: session.network,
        paths,
        review,
        // Requires an explicit, per-call flag from the caller. It is never
        // persisted and there is no setting that turns it on.
        overrideBlockingWarnings: params(request)['overrideBlockingWarnings'] === true,
      })

      return {
        psbt: encodePsbt(result.psbt),
        inputsSigned: result.inputsSigned,
        signedWith: result.signedWith,
        // The fleet answer: does this signature finish the transaction, or
        // does it have to go to another device? Without this the user cannot
        // tell whether to broadcast or keep walking.
        signatures: result.signatures,
        // WHICH device to walk to next, not just that there is one. On a
        // fleet of identical Raspberry Pis in different rooms, "carry this
        // to the next cosigner" is true and is not an answer.
        // Re-parsed from the encoded output rather than reusing the builder's
        // object, so what is attributed is the transaction actually handed
        // back. Attributing a different object than the one returned is how
        // a screen ends up describing something the user does not have.
        attribution: whoStillHasToSign(
          parsePsbt(encodePsbt(result.psbt)),
          result.signatures.inputs.flatMap((input) => input.signedBy)
        ),
        wasAlreadySigned: result.wasAlreadySigned,
        // Present only when nothing else has to sign. A coordinator wants the
        // PSBT above; a node wants this. Both are returned rather than making
        // the user discover which they needed.
        ...(result.finalised === undefined ? {} : { finalised: result.finalised }),
        activeWallet: activeWallet(),
      }
    },
  }
}
