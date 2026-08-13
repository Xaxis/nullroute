export {
  BITS_PER_ROLL,
  TARGET_BITS,
  MIN_ROLLS,
  DiceValidationError,
  validateRolls,
  accountEntropy,
  detectPatterns,
  diceToEntropy,
} from './dice.js'
export type { EntropyAccounting, PatternWarning, PatternWarningKind } from './dice.js'

export {
  SEED_LENGTH,
  MIN_SOURCES,
  MAX_SOURCES,
  MIN_SOURCE_BYTES,
  MAX_SOURCE_BYTES,
  MAX_SOURCE_ID_BYTES,
  EntropyCombinerError,
  combineEntropy,
} from './combine.js'
export type { EntropySource } from './combine.js'
