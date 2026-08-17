export {
  MessageError,
  MAX_MESSAGE_LENGTH,
  taggedHash,
  messageHash,
  reviewMessage,
  assertSignable,
} from './bip322.js'
export type { MessageReview } from './bip322.js'

export { buildToSpend, toSpendTxidForBuilder, signMessage, signMessageWithKey } from './sign.js'
export type { MessageSignature } from './sign.js'
