export {
  MessageError,
  MAX_MESSAGE_LENGTH,
  SIMPLE_PREFIX,
  taggedHash,
  messageHash,
  reviewMessage,
  assertSignable,
} from './bip322.js'
export type { MessageReview } from './bip322.js'

export { buildToSpend, toSpendTxidForBuilder, signMessage, signMessageWithKey } from './sign.js'
export type { MessageSignature } from './sign.js'

export { verifyMessage } from './verify.js'
export type { MessageVerification } from './verify.js'

export {
  legacyMessageHash,
  signLegacyMessage,
  signLegacyMessageWithKey,
  verifyLegacyMessage,
} from './legacy.js'
export type { LegacySignature } from './legacy.js'

export { parseSignedMessageBlock } from './armor.js'
export type { SignedMessageBlock } from './armor.js'
