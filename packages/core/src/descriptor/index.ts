export {
  DescriptorChecksumError,
  descriptorChecksum,
  withChecksum,
  stripChecksum,
  verifyChecksum,
} from './checksum.js'
export type { ChecksumVerdict } from './checksum.js'

export {
  DescriptorParseError,
  parseDescriptor,
  parseKeyExpression,
  descriptorKeys,
} from './parse.js'
export type {
  Descriptor,
  ScriptNode,
  KeyExpression,
  RawKey,
  ExtendedKey,
  KeyOrigin,
  ParseOptions,
} from './parse.js'

export { tapTreeLeaves } from './parse.js'
export type { TapTree } from './parse.js'

export { deriveMultisigAddresses, multisigShape, findOwnKey } from './multisig.js'
export type {
  MultisigAddress,
  MultisigKind,
  MultisigShape,
  DeriveMultisigOptions,
} from './multisig.js'

export { deriveTaprootAddresses, taprootQuorum } from './taproot.js'
export type { TaprootAddress, TaprootQuorum, DeriveTaprootOptions } from './taproot.js'

export { importCoordinatorFile, exportBundle, CoordinatorFormatError } from './coordinator.js'
export type {
  CoordinatorImport,
  CoordinatorFormat,
  ImportedDescriptor,
  BundleOptions,
} from './coordinator.js'

export { deriveQuorumAddresses } from './quorum-addresses.js'
export type { QuorumAddress, DeriveQuorumOptions } from './quorum-addresses.js'
