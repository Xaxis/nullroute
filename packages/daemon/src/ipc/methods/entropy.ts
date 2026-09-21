/**
 * Collecting entropy, and turning it into a wallet.
 *
 * The dice path, the two paths that do not involve a die, and importing words
 * somebody already has. All four end in a seed, which is why they live together
 * rather than beside the screens that drive them.
 *
 * One of thirteen tables that make up the IPC surface. See ipc/context.ts for
 * why they are tables rather than one switch.
 */

import {
  Secret,
  accountEntropy,
  combineEntropy,
  detectPatterns,
  diceToEntropy,
  entropyToWords,
  isValidMnemonic,
  mnemonicToSeed,
  validateRolls,
} from '@nullroute/core'
import { checkEntropyHealth } from '../../entropy/health.js'
import { params, requireString, optionalString, requireNumber } from '../params.js'
import { randomBytes } from 'node:crypto'
import { type HandlerContext, type MethodTable } from '../context.js'

export function entropyMethods(ctx: HandlerContext): MethodTable {
  const { session } = ctx

  return {
    /** Live accounting during dice entry. Takes rolls, returns counts only. */
    'entropy.account': (request) => {
      const rolls = optionalString(request, 'rolls')
      if (rolls.length > 0) validateRolls(rolls)
      return { accounting: accountEntropy(rolls), warnings: detectPatterns(rolls) }
    },

    /**
     * Turn dice rolls into a wallet.
     *
     * The mnemonic is NOT returned here. It is placed in the session and must
     * be asked for separately, so that the act of revealing a seed is one
     * explicit call rather than a side effect of creating a wallet.
     */
    'entropy.fromDice': (request) => {
      const rolls = requireString(request, 'rolls')
      const mixMachine = params(request)['mixMachine'] === true

      using diceEntropy = diceToEntropy(rolls)

      let entropy: Secret
      if (mixMachine) {
        // Mode B. The combiner's guarantee is that the result keeps full
        // entropy if ANY single source has it, so a compromised machine RNG
        // cannot weaken good dice. See docs/ENTROPY.md.
        using machine = Secret.fromBytes(randomBytes(32), 'urandom')
        entropy = combineEntropy([
          { id: 'dice', material: diceEntropy },
          { id: 'urandom', material: machine },
        ])
      } else {
        entropy = Secret.copyOf(diceEntropy.bytes, 'dice-entropy')
      }

      try {
        const mnemonic = entropyToWords(entropy)
        const bip39Passphrase = optionalString(request, 'passphrase').length > 0
        const seed = mnemonicToSeed(mnemonic, optionalString(request, 'passphrase'))
        /*
         * THE PASSPHRASE IS RECORDED, and on this path it was not.
         *
         * wallet.import computes exactly this flag and passes it. Both paths
         * that GENERATE a seed applied the passphrase to the derivation and
         * then loaded the session with no options, so the session said false,
         * wallets.create sealed `bip39Passphrase: session.bip39Passphrase`, and
         * the wallet recorded that it has none.
         *
         * What that flag turns on is the must-see banner on the unlocked
         * screen: a wrong passphrase does not produce an error, it opens a
         * different, valid, empty wallet, every screen after looks normal, and
         * the mnemonic alone will not recover this one. Every wallet made on
         * this device with dice and a passphrase has been missing it.
         */
        session.load(seed, mnemonic, 'generated', { bip39Passphrase })
        return {
          fingerprint: session.fingerprint,
          wordCount: mnemonic.split(' ').length,
          mixedWithMachineEntropy: mixMachine,
        }
      } finally {
        entropy.dispose()
      }
    },

    'entropy.health': () => {
      return checkEntropyHealth()
    },

    /**
     * Roll a die, or several, using the device's generator.
     *
     * WHAT THIS IS AND IS NOT. The roll string it produces hashes exactly like
     * a hand-rolled one, so the arithmetic downstream stays checkable. What
     * is NOT checkable is the string itself: you did not watch these dice
     * land. A device that wanted to hand you a seed it had chosen would do it
     * exactly here, and the result would be indistinguishable from this.
     *
     * So this is machine entropy wearing a dice costume, and the screen says
     * so. It is offered because rolling 100 dice by hand is ten minutes and
     * some people will otherwise pick the first mode that is quick, and a
     * user who understands the trade is better served than one who does not
     * know there was one.
     *
     * REJECTION SAMPLING, not modulo. 256 is not divisible by 6, so `byte % 6`
     * makes 1 through 4 more likely than 5 and 6 by about 1.6 percent. That is
     * small and it is exactly the kind of quiet bias this project has no
     * business shipping. Bytes above 251 are discarded and re-drawn.
     */
    'entropy.rollDice': (request) => {
      const count = Math.min(Math.max(requireNumber(request, 'count', 1), 1), 100)
      const rolls: number[] = []
      while (rolls.length < count) {
        for (const byte of randomBytes(64)) {
          if (rolls.length >= count) break
          // 252 = 42 * 6. Anything above is discarded rather than folded in.
          if (byte >= 252) continue
          rolls.push((byte % 6) + 1)
        }
      }
      return {
        rolls: rolls.join(''),
        // Said in the payload so a screen cannot forget it.
        fromDevice: true,
        note:
          'These were generated by this device, not observed by you. The arithmetic that ' +
          'follows is still checkable; the rolls themselves are not.',
      }
    },

    /**
     * Mode C. A seed from the machine's CSPRNG, with no dice at all.
     *
     * This is what every other hardware wallet does by default, and it is the
     * mode whose failure prompted this project. It is not broken. It is
     * UNVERIFIABLE, which is different and, here, worse: nothing about the
     * result can be checked by hand, so the user is trusting the hardware
     * RNG, the kernel, and this code to have combined them honestly.
     *
     * Two things guard it. The health gates must pass, so a stuck generator
     * or an unseeded pool refuses rather than silently producing a weak seed.
     * And the caller has to pass `acknowledged: true`, which the screen only
     * sends after the user has read what they are giving up: this cannot be
     * reached by tapping through.
     */
    'entropy.fromMachine': (request) => {
      if (params(request)['acknowledged'] !== true) {
        throw new Error(
          'A machine-only seed cannot be checked by hand. Nothing about it is reproducible ' +
            'with a die and a laptop, which is the property that makes this device worth ' +
            'using. Confirm you understand that before it will be generated.'
        )
      }

      const health = checkEntropyHealth()
      if (!health.healthy) {
        const bad = health.checks.filter((check) => check.verdict !== 'ok')
        throw new Error(
          `This device cannot confirm its entropy sources are sound, so it will not generate ` +
            `a seed from them alone: ${bad.map((c) => `${c.name} (${c.verdict}), ${c.detail}`).join('; ')}. ` +
            `Roll dice instead, which does not depend on any of this.`
        )
      }

      // randomBytes, never Math.random, which is banned in this package. The
      // 32 bytes are 256 bits, the same width the dice path produces.
      using entropy = Secret.fromBytes(randomBytes(32), 'urandom')
      const mnemonic = entropyToWords(entropy)
      const seed = mnemonicToSeed(mnemonic, optionalString(request, 'passphrase'))
      // Recorded, for the reason the dice path above spells out.
      session.load(seed, mnemonic, 'generated', {
        bip39Passphrase: optionalString(request, 'passphrase').length > 0,
      })
      return {
        fingerprint: session.fingerprint,
        wordCount: mnemonic.split(' ').length,
        // Said in the response so a screen cannot forget it.
        reproducible: false,
        note:
          'This seed came from the device and cannot be reproduced by hand. Your written ' +
          'mnemonic is the only record of it.',
      }
    },

    'mnemonic.validate': (request) => {
      return { valid: isValidMnemonic(requireString(request, 'mnemonic')) }
    },

    /** Import an existing mnemonic. */
    'wallet.import': (request) => {
      const mnemonic = requireString(request, 'mnemonic')
      if (!isValidMnemonic(mnemonic)) {
        throw new Error(
          'That mnemonic is not valid: a word is not in the BIP-39 list, or the checksum does ' +
            'not match. A single mistyped word usually fails here. A mistyped word that still ' +
            'checksums produces a different wallet, so check the fingerprint.'
        )
      }
      const seed = mnemonicToSeed(mnemonic, optionalString(request, 'passphrase'))
      // Ephemeral is opt-in and set here, at load, because the session has no
      // way to turn it off afterwards. See Session.assertPersistable.
      const ephemeral = params(request)['ephemeral'] === true
      const bip39Passphrase = optionalString(request, 'passphrase').length > 0
      session.load(seed, mnemonic, 'imported', { ephemeral, bip39Passphrase })
      return {
        fingerprint: session.fingerprint,
        ephemeral,
        // The fingerprint is the ONLY signal that a passphrase was mistyped.
        // A wrong one produces a valid, different, empty wallet, so this is
        // returned for display rather than left to a caller to ask for.
        passphraseApplied: bip39Passphrase,
      }
    },
  }
}
